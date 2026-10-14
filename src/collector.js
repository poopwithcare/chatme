(function (root) {
  'use strict';

  const t = (root.ChatExportI18n && root.ChatExportI18n.t) || ((key) => key);

  function endpoint(path, pageUrl) {
    return new URL(path, pageUrl).href;
  }

  // A stalled request must fail fast with a readable error instead of hanging
  // the popup indefinitely. Callers never pass their own signal, so the
  // timeout owns it; init.timeoutMs exists only so tests can use a short fuse.
  const FETCH_TIMEOUT_MS = 30000;

  async function fetchJson(fetchImpl, pageUrl, path, init) {
    const { timeoutMs, headers: extraHeaders, externalSignal, ...restInit } = init || {};
    const timeout = typeof timeoutMs === 'number' ? timeoutMs : FETCH_TIMEOUT_MS;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    // An external signal (e.g. cancelling a speculative request that proved
    // unneeded) joins the timeout signal; either aborts the fetch.
    const signals = [];
    if (controller) signals.push(controller.signal);
    if (externalSignal) signals.push(externalSignal);
    const signal = signals.length > 1 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any(signals) : (signals[0] || null);
    let response;
    try {
      response = await fetchImpl(endpoint(path, pageUrl), {
        credentials: 'include',
        ...restInit,
        headers: { accept: 'application/json', ...(extraHeaders || {}) },
        ...(signal ? { signal } : {})
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error(t('errorTimedOut'));
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response || !response.ok) {
      throw new Error(t('errorRequestFailed', [response ? response.status : t('errorNoResponse')]));
    }
    return response.json();
  }

  function chatGPTId(pageUrl) {
    const url = new URL(pageUrl);
    if (/^\/share\//i.test(url.pathname)) return null;
    const match = /^\/(?:c|g)\/([^/]+)/i.exec(url.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function grokRoute(pageUrl) {
    const url = new URL(pageUrl);
    const share = /^\/share\/([^/]+)/i.exec(url.pathname);
    if (share) return { kind: 'share', id: decodeURIComponent(share[1]) };
    const conversation = /^\/(?:c|chat)\/([^/]+)/i.exec(url.pathname);
    return conversation ? { kind: 'private', id: decodeURIComponent(conversation[1]) } : null;
  }

  function claudeChatId(pageUrl) {
    const url = new URL(pageUrl);
    if (/^\/share\//i.test(url.pathname)) return null;
    const match = /^\/chat\/([^/]+)/i.exec(url.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }

  // A private Claude page only mounts the turns near the viewport, so one DOM
  // read can never promise the whole conversation. The page's own API serves
  // it whole: the organizations listing reveals which org owns the page, and
  // the conversation endpoint returns every turn. Two requests, only when the
  // user clicks, mirroring the ChatGPT session-then-conversation pattern.
  async function claudeConversation(fetchImpl, pageUrl, id) {
    const orgs = await fetchJson(fetchImpl, pageUrl, '/api/organizations');
    const list = Array.isArray(orgs) ? orgs
      : (orgs && Array.isArray(orgs.organizations) ? orgs.organizations : []);
    const org = list.map((entry) => entry && (entry.uuid || entry.id)).filter(Boolean)[0];
    if (!org) throw new Error(t('errorRequestFailed', [t('errorNoResponse')]));
    return fetchJson(fetchImpl, pageUrl,
      `/api/organizations/${encodeURIComponent(org)}/chat_conversations/${encodeURIComponent(id)}`);
  }

  function embeddedPayload(adapters, doc, platform) {
    for (const script of Array.from(doc.querySelectorAll('script[type="application/json"]'))) {
      let data;
      try { data = JSON.parse(script.textContent || ''); } catch (_) { continue; }
      if (adapters.platformForPayload(data) === platform) return data;
    }
    return null;
  }

  // Uploaded and generated images are referenced by file id (sediment://),
  // not by URL. The files endpoint trades each id for a download URL, exactly
  // as ChatGPT exporter extensions do. Failures stay soft: an unresolved id
  // still exports as a named placeholder, never as a dropped turn.
  async function chatGPTFileUrls(fetchImpl, pageUrl, conversationId, ids, headers) {
    const map = {};
    await Promise.all(ids.map(async (fileId) => {
      try {
        const payload = await fetchJson(fetchImpl, pageUrl,
          `/backend-api/files/download/${encodeURIComponent(fileId)}?conversation_id=${encodeURIComponent(conversationId)}`,
          { ...(headers ? { headers } : {}), timeoutMs: 10000 });
        if (payload && typeof payload.download_url === 'string' && /^https?:/i.test(payload.download_url)) {
          map[fileId] = { url: payload.download_url, name: payload.file_name || '' };
        }
      } catch (_) {}
    }));
    return map;
  }

  // Sandbox files (/mnt/data/…) backing a conversation, listed by name with
  // the file id each resolves through. Soft-fails to an empty list: file
  // links simply stay placeholders when the listing is unavailable.
  async function chatGPTConversationFiles(fetchImpl, pageUrl, conversationId, headers, signal) {
    try {
      const listing = await fetchJson(fetchImpl, pageUrl,
        `/backend-api/conversations/${encodeURIComponent(conversationId)}/files`,
        { ...(headers ? { headers } : {}), ...(signal ? { externalSignal: signal } : {}), timeoutMs: 10000 });
      const items = listing && Array.isArray(listing.items) ? listing.items : [];
      return items
        .filter((item) => item && typeof item === 'object' && item.file_id && item.file_name)
        .map((item) => ({
          id: String(item.file_id),
          name: String(item.file_name),
          mime: typeof item.mime_type === 'string' ? item.mime_type : '',
          size: typeof item.file_size_bytes === 'number' ? item.file_size_bytes : null
        }));
    } catch (_) {
      return [];
    }
  }

  // Every sandbox: target the payload links to, so only referenced files are
  // ever fetched for embedding.
  function chatGPTSandboxRefs(data) {
    const found = [];
    const seen = new Set();
    const scan = (text) => {
      if (typeof text !== 'string') return;
      for (const match of text.matchAll(/sandbox:([^)\s]+)/g)) {
        if (!seen.has(match[1])) {
          seen.add(match[1]);
          found.push(match[1]);
        }
      }
    };
    const scanMessage = (msg) => {
      if (!msg || typeof msg !== 'object') return;
      const content = msg.content;
      if (content && Array.isArray(content.parts)) {
        for (const part of content.parts) {
          if (typeof part === 'string') scan(part);
        }
      } else if (content && typeof content.text === 'string') {
        scan(content.text);
      }
      if (typeof msg.text === 'string') scan(msg.text);
    };
    if (data && typeof data === 'object') {
      if (data.mapping && typeof data.mapping === 'object') {
        for (const key of Object.keys(data.mapping)) {
          const entry = data.mapping[key];
          if (entry && entry.message) scanMessage(entry.message);
        }
      }
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) scanMessage(msg);
      }
    }
    return found;
  }

  // Whether any turn carries upload attachments: those resolve by name
  // through the file listing even when the turn carries no file id.
  function chatGPTHasAttachments(data) {
    const scanMessage = (msg) => {
      const meta = msg && msg.metadata;
      return !!meta && Array.isArray(meta.attachments) && meta.attachments.length > 0;
    };
    if (data && typeof data === 'object') {
      if (data.mapping && typeof data.mapping === 'object') {
        for (const key of Object.keys(data.mapping)) {
          const entry = data.mapping[key];
          if (entry && entry.message && scanMessage(entry.message)) return true;
        }
      }
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          if (scanMessage(msg)) return true;
        }
      }
    }
    return false;
  }

  // Text files worth embedding, by extension or MIME. Binaries (images,
  // archives, documents) stay download links.
  const CHATGPT_EMBED_EXTENSIONS = /\.(txt|md|markdown|html?|css|js|mjs|cjs|ts|tsx|jsx|json|csv|tsv|xml|svg|py|rb|java|c|cpp|h|hpp|cs|go|rs|php|swift|kt|kts|sh|bash|zsh|sql|ya?ml|toml|ini|cfg|log|r|jl|lua|pl|vue|svelte|tex)$/i;
  const CHATGPT_EMBED_MIME = /^(text\/|application\/(json|javascript|ecmascript|xml|x-sh|x-python|x-httpd-php)|image\/svg\+xml)/i;
  const CHATGPT_MAX_EMBED_FILES = 10;
  const CHATGPT_MAX_EMBED_BYTES = 200 * 1024;
  const CHATGPT_MAX_EMBED_CHARS = 30000;

  function chatGPTEmbeddableFile(name, mime, size) {
    if (typeof size === 'number' && size > CHATGPT_MAX_EMBED_BYTES) return false;
    if (CHATGPT_EMBED_EXTENSIONS.test(String(name || ''))) return true;
    if (CHATGPT_EMBED_MIME.test(String(mime || ''))) return true;
    return false;
  }

  // Fetch a resolved file's text for embedding. Guards size twice (declared
  // content-length, then actual length) and bails on binary content types, so
  // a mislabeled archive can neither stall the popup nor flood the export.
  // Platform-agnostic: ChatGPT sandbox files and public Grok assets alike.
  async function fetchTextForEmbed(fetchImpl, url, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), typeof timeoutMs === 'number' ? timeoutMs : 15000) : null;
    try {
      const response = await fetchImpl(url, {
        credentials: 'include',
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response || !response.ok) return null;
      const length = Number(response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('content-length') : NaN);
      if (Number.isFinite(length) && length > CHATGPT_MAX_EMBED_BYTES) return null;
      const type = response.headers && typeof response.headers.get === 'function'
        ? String(response.headers.get('content-type') || '') : '';
      // The extension/MIME vetting upstream already limited fetching to
      // text-like files, so only veto content types that are definitively
      // binary. A generic octet-stream (or missing) type must NOT veto: asset
      // hosts commonly serve .py/.txt/.html that way.
      if (/^(image|video|audio|font)\//i.test(type) ||
        /zip|rar|7z|tar|gzip|pdf|exe|binary|dmg|iso|wasm/i.test(type)) return null;
      const text = await response.text();
      if (typeof text !== 'string' || !text) return null;
      if (text.length > CHATGPT_MAX_EMBED_CHARS) {
        return { text: text.slice(0, CHATGPT_MAX_EMBED_CHARS).trimEnd(), truncated: true, total: text.length };
      }
      return { text, truncated: false, total: text.length };
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function collect(options = {}) {
    const root = options.root || globalThis;
    const adapters = options.adapters || root.ChatExportAdapters;
    const doc = options.document || root.document;
    const pageUrl = options.pageUrl || (root.location && root.location.href);
    const fetchImpl = options.fetch || root.fetch.bind(root);
    if (!adapters || !doc || !pageUrl) throw new Error(t('errorPageUnavailable'));

    const location = new URL(pageUrl);
    const platform = adapters.platformFromLocation(location);
    if (!platform || !adapters.conversationRoute(platform, location)) {
      throw new Error(t('errorOpenConversation'));
    }

    let data = null;
    let fileUrls = null;
    let embeddedFiles = null;
    if (platform === 'chatgpt') {
      if (/^\/share\//i.test(location.pathname)) {
        const scripts = Array.from(doc.scripts || []);
        for (const script of scripts) {
          const text = script.textContent || '';
          if (!text.includes('streamController.enqueue(')) continue;
          const conversation = adapters.extractChatGPTShareConversation(text);
          if (conversation) {
            data = {
              mapping: conversation.mapping,
              current_node: conversation.current_node,
              title: conversation.title,
              conversation_id: conversation.conversation_id
            };
            break;
          }
        }
      } else {
        const id = chatGPTId(pageUrl);
        if (id) {
          // The conversation endpoint requires the page's bearer token, which
          // is not in storage. The session endpoint hands it out to the
          // signed-in page, so ask for it on demand: two requests, only when
          // the user clicks, and nothing is observed or kept.
          let headers;
          try {
            const session = await fetchJson(fetchImpl, pageUrl, '/api/auth/session');
            if (session && session.accessToken) headers = { authorization: `Bearer ${session.accessToken}` };
          } catch (_) {}
          data = await fetchJson(fetchImpl, pageUrl, `/backend-api/conversations/${encodeURIComponent(id)}`, headers ? { headers } : undefined);
          // The file listing rides alongside the conversation request: the two
          // are independent and share auth, so the slower one stops gating the
          // faster. It resolves only when awaited below, and only for chats
          // that reference files — otherwise it is aborted before it can
          // complete. Anything unresolved still exports as a named
          // placeholder, and caps keep a media-heavy chat from stalling the
          // popup.
          const listingAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const listingPromise = chatGPTConversationFiles(fetchImpl, pageUrl, id, headers,
            listingAbort ? listingAbort.signal : undefined);
          // Resolve image file ids into download URLs while the bearer token
          // is at hand. The conversation's file listing maps sandbox files by
          // name as well, so `sandbox:/mnt/data/…` links become downloads.
          try {
            const ids = adapters.chatGPTImageFileIds ? adapters.chatGPTImageFileIds(data) : [];
            const needsListing = chatGPTSandboxRefs(data).length > 0 || chatGPTHasAttachments(data);
            if (!needsListing && listingAbort) {
              try { listingAbort.abort(); } catch (_) {}
            }
            const files = needsListing ? await listingPromise : [];
            const seen = new Set(ids);
            for (const file of files) {
              if (!seen.has(file.id)) {
                seen.add(file.id);
                ids.push(file.id);
              }
            }
            if (ids.length) {
              fileUrls = await chatGPTFileUrls(fetchImpl, pageUrl, id, ids.slice(0, 30), headers);
              const byName = {};
              for (const file of files) {
                if (fileUrls[file.id]) {
                  byName[file.name] = { ...fileUrls[file.id], mime: file.mime, size: file.size };
                }
              }
              if (Object.keys(byName).length) fileUrls.sandbox = byName;
              // Embed referenced text files so the export stays readable after
              // the signed download URLs expire. Binaries and oversized files
              // stay links; any failure keeps the link.
              try {
                const refs = chatGPTSandboxRefs(data);
                const resolve = adapters.chatGPTResolveSandboxFile
                  ? (target) => adapters.chatGPTResolveSandboxFile(target, fileUrls) : () => null;
                const queue = [];
                const queued = new Set();
                for (const target of refs) {
                  if (queue.length >= CHATGPT_MAX_EMBED_FILES) break;
                  const entry = resolve(target);
                  if (!entry || entry.content != null || queued.has(entry.url)) continue;
                  if (!chatGPTEmbeddableFile(entry.name, entry.mime, entry.size)) continue;
                  queued.add(entry.url);
                  queue.push(entry);
                }
                await Promise.all(queue.map(async (entry) => {
                  const fetched = await fetchTextForEmbed(fetchImpl, entry.url);
                  if (fetched) {
                    entry.content = fetched.text;
                    entry.truncated = fetched.truncated;
                    entry.total = fetched.total;
                  }
                }));
              } catch (_) {}
            }
          } catch (_) {
            fileUrls = null;
          }
        }
      }
    } else if (platform === 'grok') {
      const route = grokRoute(pageUrl);
      if (route && route.kind === 'share') {
        data = await fetchJson(fetchImpl, pageUrl,
          `/rest/app-chat/share_links/${encodeURIComponent(route.id)}?useChunk=true`);
      } else if (route) {
        const base = `/rest/app-chat/conversations/${encodeURIComponent(route.id)}`;
        const turnList = await fetchJson(fetchImpl, pageUrl, `${base}/response-node`);
        const nodes = Array.isArray(turnList.responseNodes) ? turnList.responseNodes : [];
        const ids = nodes.map((node) => node && (node.responseId || node.id)).filter(Boolean).map(String);
        if (!ids.length) throw new Error(t('errorGrokEmpty'));
        // Batches are independent: load them together instead of one round
        // trip at a time. Promise.all preserves batch order for the merge.
        const batches = [];
        for (let start = 0; start < ids.length; start += 100) {
          batches.push(ids.slice(start, start + 100));
        }
        const responses = [];
        const loadedBatches = await Promise.all(batches.map((batch) => fetchJson(fetchImpl, pageUrl, `${base}/load-responses`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ responseIds: batch })
        })));
        for (const loaded of loadedBatches) {
          if (loaded && Array.isArray(loaded.responses)) responses.push(...loaded.responses);
        }
        data = { conversation: { title: doc.title || 'Grok Conversation' }, responses };
        // Embed text files (uploads, render-file cards) so the export stays
        // readable: asset URLs are public, so one bounded parallel pass
        // fetches them. Anything unfetchable stays a download link.
        try {
          const candidates = [];
          const queued = new Set();
          if (adapters.grokEmbeddableFiles) {
            for (const response of responses) {
              for (const file of adapters.grokEmbeddableFiles(response)) {
                if (!queued.has(file.url) && candidates.length < 10) {
                  queued.add(file.url);
                  candidates.push(file);
                }
              }
            }
          }
          if (candidates.length) {
            const fetched = {};
            await Promise.all(candidates.map(async (file) => {
              const text = await fetchTextForEmbed(fetchImpl, file.url);
              if (text) {
                fetched[file.url] = { content: text.text, truncated: text.truncated, total: text.total, name: file.name };
              }
            }));
            if (Object.keys(fetched).length) embeddedFiles = fetched;
          }
        } catch (_) {}
      }
    } else if (platform === 'claude') {
      const id = claudeChatId(pageUrl);
      if (id) {
        try {
          data = await claudeConversation(fetchImpl, pageUrl, id);
        } catch (_) {
          // The API may be unreachable (signed out, endpoint change): fall
          // back to whatever the page carries rather than failing outright.
          // resolveExportData still picks whichever source holds more turns.
          data = embeddedPayload(adapters, doc, platform);
        }
      } else {
        data = embeddedPayload(adapters, doc, platform);
      }
    } else {
      data = embeddedPayload(adapters, doc, platform);
    }

    const domData = adapters.extractConversation(doc, platform, pageUrl);
    const structured = data ? { platform, data, capturedAt: new Date().toISOString(), fileUrls, embeddedFiles } : null;
    const resolved = adapters.resolveExportData({ structured, doc, platform, pageUrl, domData });
    if (!resolved || !resolved.data || !resolved.data.messages.length) {
      throw new Error(t('errorNoMessages'));
    }
    const markdown = adapters.toMarkdown(resolved.data);
    return {
      platform,
      platformName: resolved.data.platformName || platform,
      title: resolved.data.title || doc.title || 'Conversation',
      messages: resolved.data.messages.length,
      searches: resolved.data.searches.length,
      bytes: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }).size,
      source: resolved.source,
      markdown
    };
  }

  const api = { collect, chatGPTId, claudeChatId, grokRoute, fetchJson, chatGPTFileUrls, chatGPTConversationFiles };
  root.ChatExportCollector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
