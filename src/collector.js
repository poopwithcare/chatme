(function (root) {
  'use strict';

  function endpoint(path, pageUrl) {
    return new URL(path, pageUrl).href;
  }

  // A stalled request must fail fast with a readable error instead of hanging
  // the popup indefinitely. Callers never pass their own signal, so the
  // timeout owns it; init.timeoutMs exists only so tests can use a short fuse.
  const FETCH_TIMEOUT_MS = 30000;

  async function fetchJson(fetchImpl, pageUrl, path, init) {
    const { timeoutMs, headers: extraHeaders, ...restInit } = init || {};
    const timeout = typeof timeoutMs === 'number' ? timeoutMs : FETCH_TIMEOUT_MS;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    let response;
    try {
      response = await fetchImpl(endpoint(path, pageUrl), {
        credentials: 'include',
        ...restInit,
        headers: { accept: 'application/json', ...(extraHeaders || {}) },
        ...(controller ? { signal: controller.signal } : {})
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Conversation request timed out');
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response || !response.ok) {
      throw new Error(`Conversation request failed (${response ? response.status : 'no response'})`);
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
    if (!org) throw new Error('Conversation request failed (no response)');
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

  async function collect(options = {}) {
    const root = options.root || globalThis;
    const adapters = options.adapters || root.ChatExportAdapters;
    const doc = options.document || root.document;
    const pageUrl = options.pageUrl || (root.location && root.location.href);
    const fetchImpl = options.fetch || root.fetch.bind(root);
    if (!adapters || !doc || !pageUrl) throw new Error('Conversation page is unavailable');

    const location = new URL(pageUrl);
    const platform = adapters.platformFromLocation(location);
    if (!platform || !adapters.conversationRoute(platform, location)) {
      throw new Error('Open a Claude, ChatGPT, or Grok conversation first');
    }

    let data = null;
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
        if (!ids.length) throw new Error('Grok returned no conversation turns');
        const responses = [];
        for (let start = 0; start < ids.length; start += 100) {
          const batch = ids.slice(start, start + 100);
          const loaded = await fetchJson(fetchImpl, pageUrl, `${base}/load-responses`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ responseIds: batch })
          });
          if (Array.isArray(loaded.responses)) responses.push(...loaded.responses);
        }
        data = { conversation: { title: doc.title || 'Grok Conversation' }, responses };
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
    const structured = data ? { platform, data, capturedAt: new Date().toISOString() } : null;
    const resolved = adapters.resolveExportData({ structured, doc, platform, pageUrl, domData });
    if (!resolved || !resolved.data || !resolved.data.messages.length) {
      throw new Error('No conversation messages were available to export');
    }
    const markdown = adapters.toMarkdown(resolved.data);
    return {
      platform,
      platformName: resolved.data.platformName || platform,
      title: resolved.data.title || doc.title || 'Conversation',
      messages: resolved.data.messages.length,
      searches: resolved.data.searches.length,
      bytes: new Blob([markdown], { type: 'text/markdown;charset=utf-8' }).size,
      markdown
    };
  }

  const api = { collect, chatGPTId, claudeChatId, grokRoute, fetchJson };
  root.ChatExportCollector = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
