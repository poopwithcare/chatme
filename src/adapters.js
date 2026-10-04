(function (root) {
  'use strict';

  const PLATFORM_NAMES = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    grok: 'Grok'
  };

  function platformFromLocation(locationLike) {
    const host = String(locationLike && locationLike.hostname || '').toLowerCase();
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
    if (host === 'chatgpt.com' || host === 'chat.openai.com' || host.endsWith('.chatgpt.com')) return 'chatgpt';
    if (host === 'grok.com' || host.endsWith('.grok.com') || ((host === 'x.com' || host === 'twitter.com') && String(locationLike.pathname || '').startsWith('/i/grok'))) return 'grok';
    return null;
  }

  function conversationRoute(platform, locationLike) {
    const path = String(locationLike && locationLike.pathname || '/');
    if (platform === 'claude') return /^\/(chat|chat_|share\/)/i.test(path);
    if (platform === 'chatgpt') return /\/(c|g|share)\//i.test(path);
    if (platform === 'grok') return /\/(c|chat|conversations?|share)\//i.test(path) || /^\/i\/grok(?:\/|$)/i.test(path) || path === '/';
    return false;
  }

  // Stable hooks owned by the product markup. Test IDs belong to the site's
  // own test suite and churn without notice, so they are only a fallback
  // when nothing stable matches (see getFallbackSelector).
  function getCandidateSelector(platform) {
    const base = [
      '[data-message-author-role]',
      '[data-message-id][data-role]',
      '[data-message-id]'
    ];
    if (platform === 'chatgpt') {
      return [
        '[data-message-author-role]',
        'article[data-message-author-role]',
        '[data-message-id]',
        '[data-user-message-bubble]',
        '[data-markdown-copy]'
      ].join(',');
    }
    return base.join(',');
  }

  function getFallbackSelector(platform) {
    const testids = [
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
      '[data-testid^="user-message-"]',
      '[data-testid^="assistant-message-"]'
    ];
    if (platform === 'chatgpt') return ['[data-testid*="conversation-turn"]', ...testids].join(',');
    if (platform === 'claude') {
      return [
        ...testids,
        '[data-testid*="human-turn"]',
        '[data-testid*="assistant-turn"]',
        '[data-testid*="chat-message"]'
      ].join(',');
    }
    return [
      ...testids,
      '[data-testid="message"]',
      '[data-testid^="message-"]',
      '[data-testid^="conversation-turn-"]'
    ].join(',');
  }

  function normalizedText(node) {
    if (!node) return '';
    return String(node.innerText || node.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const MESSAGE_ACTION_CONTROLS = new Set([
    'user-message-retry',
    'user-message-edit',
    'user-message-copy',
    'assistant-message-retry',
    'assistant-message-edit',
    'assistant-message-copy'
  ]);

  function isMessageActionsElement(element) {
    try {
      return Boolean(element && typeof element.getAttribute === 'function' &&
        element.getAttribute('data-cds') === 'MessageActions');
    } catch (_) {
      return false;
    }
  }

  function isToolbarControlElement(element) {
    try {
      const testid = element && typeof element.getAttribute === 'function'
        ? String(element.getAttribute('data-testid') || '') : '';
      return MESSAGE_ACTION_CONTROLS.has(testid);
    } catch (_) {
      return false;
    }
  }

  function isInsideMessageActions(node) {
    try {
      if (node && typeof node.closest === 'function') {
        try {
          if (node.closest('[data-cds="MessageActions"]')) return true;
        } catch (_) {}
      }
    } catch (_) {}
    for (let parent = node && node.parentElement; parent; parent = parent.parentElement) {
      if (isMessageActionsElement(parent) || isToolbarControlElement(parent)) return true;
      try {
        if (parent.getAttribute && parent.getAttribute('role') === 'toolbar' &&
          parent.querySelector &&
          parent.querySelector('[data-testid="user-message-retry"],[data-testid="user-message-edit"],[data-testid="user-message-copy"]')) return true;
      } catch (_) {}
    }
    return false;
  }

  function isExcludedMessageCandidate(node) {
    if (!node) return true;
    try {
      if (node.matches) {
        try {
          if (node.matches('[data-cds="MessageActions"]')) return true;
        } catch (_) {}
      }
    } catch (_) {}
    if (isMessageActionsElement(node) || isToolbarControlElement(node)) return true;
    try {
      const role = node.getAttribute && node.getAttribute('role');
      if (role === 'toolbar') return true;
    } catch (_) {}
    if (isInsideMessageActions(node)) return true;
    return false;
  }

  function textExcludingToolbar(node) {
    try {
      if (node && typeof node.cloneNode === 'function' && node.querySelectorAll) {
        const clone = node.cloneNode(true);
        let doomed = [];
        try {
          doomed = Array.from(clone.querySelectorAll(
            '[data-cds="MessageActions"],[data-testid="user-message-retry"],[data-testid="user-message-edit"],[data-testid="user-message-copy"],[data-testid="assistant-message-retry"],[data-testid="assistant-message-edit"],[data-testid="assistant-message-copy"]'
          ) || []);
        } catch (_) {
          doomed = [];
        }
        for (const element of doomed) {
          try {
            if (element.remove) element.remove();
            else if (element.parentNode) element.parentNode.removeChild(element);
          } catch (_) {}
        }
        const cleaned = normalizedText(clone);
        if (cleaned) return cleaned;
      }
    } catch (_) {}
    let text = normalizedText(node);
    try {
      const bars = node.querySelectorAll ? Array.from(node.querySelectorAll('[data-cds="MessageActions"]') || []) : [];
      for (const bar of bars) {
        const barText = normalizedText(bar);
        if (barText && text.includes(barText)) text = text.split(barText).join(' ');
      }
    } catch (_) {}
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function roleFor(node, platform) {
    const role = (node.getAttribute('data-message-author-role') || node.getAttribute('data-role') || '').toLowerCase();
    if (role === 'user' || role === 'human') return 'user';
    if (role === 'assistant' || role === 'model' || role === 'system') return role === 'model' ? 'assistant' : role;

    // The current ChatGPT share/chat markup carries no role attribute: user
    // turns are bubbles, assistant turns are markdown containers.
    try {
      if (node.hasAttribute && node.hasAttribute('data-user-message-bubble')) return 'user';
      if (node.hasAttribute && node.hasAttribute('data-markdown-copy')) return 'assistant';
    } catch (_) {}

    const labels = [
      node.getAttribute('data-testid'),
      node.getAttribute('aria-label'),
      node.className && typeof node.className === 'string' ? node.className : ''
    ].join(' ').toLowerCase();
    if (/user|human|you\b/.test(labels)) return 'user';
    if (/assistant|claude|chatgpt|grok|model|response/.test(labels)) return 'assistant';

    const nested = node.querySelector('[data-message-author-role], [data-role], [aria-label*="Assistant"], [aria-label*="User"]');
    if (nested && nested !== node) {
      const nestedRole = (nested.getAttribute('data-message-author-role') || nested.getAttribute('data-role') || nested.getAttribute('aria-label') || '').toLowerCase();
      if (/user|human/.test(nestedRole)) return 'user';
      if (/assistant|model|claude|grok/.test(nestedRole)) return 'assistant';
    }

    // Grok renders some message cards without a role attribute; keep them when
    // they are in the conversation feed and let their accessible label decide.
    return platform === 'grok' ? 'assistant' : null;
  }

  function safeLinks(node, pageUrl) {
    const base = new URL(pageUrl);
    const seen = new Set();
    const result = [];
    for (const anchor of node.querySelectorAll('a[href]')) {
      try {
        if (isInsideMessageActions(anchor) || isMessageActionsElement(anchor) || isToolbarControlElement(anchor)) continue;
      } catch (_) {}
      const href = anchor.href;
      if (!/^https?:/i.test(href) || href === base.href || seen.has(href)) continue;
      seen.add(href);
      const title = normalizedText(anchor) || href;
      result.push({ title: title.slice(0, 500), url: href });
    }
    return result;
  }

  function dedupeCandidates(nodes) {
    const unique = [];
    const seen = new Set();
    for (const node of nodes) {
      if (!node || isExcludedMessageCandidate(node)) continue;
      try {
        if (seen.has(node) || (node.closest && node.closest('[data-chat-export-root]'))) continue;
      } catch (_) {
        if (seen.has(node)) continue;
      }
      seen.add(node);
      unique.push(node);
    }
    return unique.filter((node) => {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (seen.has(parent) && roleFor(parent, 'chatgpt') === roleFor(node, 'chatgpt')) return false;
      }
      return true;
    });
  }

  // Stable DOM identity: Grok message candidates may carry data-message-id
  // (either on the matched node or on the message element inside it). When
  // present it identifies the turn across virtualized snapshots; when absent
  // the turn keeps no id and merging must not assume identity from content.
  function stableMessageId(node) {
    try {
      const own = node && typeof node.getAttribute === 'function' ? node.getAttribute('data-message-id') : '';
      if (own) return String(own);
      const inner = node && typeof node.querySelector === 'function' ? node.querySelector('[data-message-id]') : null;
      const nested = inner && typeof inner.getAttribute === 'function' ? inner.getAttribute('data-message-id') : '';
      if (nested) return String(nested);
    } catch (_) {}
    return null;
  }

  // Text reduced to what identifies a turn, ignoring how the page happens to
  // render it. The same turn is seen as raw markdown from the conversation
  // payload and as rendered text from the page, with a "Worked for 44s" status
  // prefix and a trailing sources list, so neither is a prefix of the other and
  // exact or prefix comparison cannot match them. Normalising for comparison
  // only keeps one turn from being counted twice; the exported text is never
  // altered.
  function comparisonText(value) {
    let text = String(value || '');
    text = text.replace(/^\s*(?:Worked|Thinking|Thought)\s+(?:for|about)\s+[^\n]*?\d+\s*s\b/i, '');
    text = text.replace(/^\s*Worked for \d+\s*s/i, '');
    text = text.replace(/\n{2,}\s*Sources:\s*[\s\S]*$/, '');
    text = text.replace(/\n{2,}\s*-\s*\[[^\]]*\]\([^)]*\)/g, '');
    text = text.replace(/[*_~`]+/g, '');
    text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    text = text.replace(/^\s{0,3}[-*+]\s+/gm, '');
    return text.replace(/\s+/g, ' ').trim();
  }

  // Sequence identity for aligning virtualized windows: role + text only.
  // Links may load lazily between snapshots, so they must not affect overlap
  // alignment; they are unioned after the overlap is established.
  function exportSequenceKey(message) {
    if (!message || typeof message !== 'object') return '';
    return `${String(message.role || '')}\n${comparisonText(message.text)}`;
  }

  function unionExportLinks(into, from) {
    try {
      const known = new Set((into.links || []).map((link) => link && link.url));
      for (const link of (from && from.links) || []) {
        if (link && link.url && !known.has(link.url)) {
          known.add(link.url);
          into.links.push(link);
        }
      }
    } catch (_) {}
    return into;
  }

  function extractConversation(doc, platform, pageUrl) {
    let nodes = [];
    try {
      nodes = Array.from(doc.querySelectorAll(getCandidateSelector(platform)));
    } catch (_) {
      nodes = [];
    }
    if (!nodes.length) {
      try {
        nodes = Array.from(doc.querySelectorAll(getFallbackSelector(platform)));
      } catch (_) {
        nodes = [];
      }
    }
    nodes = dedupeCandidates(nodes);
    const messages = [];
    const seenStableIds = new Set();
    for (const node of nodes) {
      if (isExcludedMessageCandidate(node)) continue;
      const role = roleFor(node, platform);
      const text = textExcludingToolbar(node);
      if (!role || !text) continue;
      const links = safeLinks(node, pageUrl);
      // Stable DOM identity is Grok-only: only Grok candidates carry
      // data-message-id, and only Grok feeds merge DOM snapshots across
      // virtualized scrolls. Other platforms keep their original ID-less
      // extraction behavior untouched.
      const stableId = platform === 'grok' ? stableMessageId(node) : null;
      if (stableId != null) {
        // Same stable ID twice in one snapshot is the same turn observed
        // through nested selectors: keep it once (ID-proven). Turns without
        // IDs are always preserved, since identical text may be a legitimate
        // repeat rather than a duplicate.
        if (seenStableIds.has(stableId)) {
          const prior = messages.find((item) => item.id === stableId);
          if (prior) unionExportLinks(prior, { links });
          continue;
        }
        seenStableIds.add(stableId);
        messages.push({ role, text, links, id: stableId });
        continue;
      }
      messages.push({ role, text, links });
    }

    const searches = [];
    let previousUser = '';
    for (const message of messages) {
      if (message.role === 'user') {
        previousUser = message.text;
        continue;
      }
      const isSearch = /search(?:ed|ing)? (?:the )?web|web search|search results|sources|browse(?:d|ing)? the web/i.test(message.text) || message.links.length > 0;
      if (!isSearch) continue;
      const links = message.links.filter((link) => !isLikelyInternal(link.url, pageUrl));
      if (!links.length && !/search(?:ed|ing)? (?:the )?web|web search|search results/i.test(message.text)) continue;
      const queryNode = doc.querySelector('[data-search-query], [data-testid*="search-query"], [aria-label*="Search query" i]');
      const query = (queryNode && (queryNode.getAttribute('data-search-query') || normalizedText(queryNode))) || previousUser;
      searches.push({ query, sources: links });
    }

    const title = normalizedText(doc.querySelector('h1')) || normalizedText(doc.querySelector('title')) || 'Conversation';
    return {
      platform,
      platformName: PLATFORM_NAMES[platform] || platform,
      title: title.replace(/\s*[|–-]\s*(Claude|ChatGPT|Grok).*$/i, '').trim() || 'Conversation',
      url: pageUrl,
      capturedAt: new Date().toISOString(),
      messages,
      searches
    };
  }

  function isLikelyInternal(href, pageUrl) {
    try {
      const linkHost = new URL(href).hostname;
      const baseHost = new URL(pageUrl).hostname;
      return linkHost === baseHost || linkHost.endsWith('.' + baseHost);
    } catch (_) {
      return true;
    }
  }

  function escapeMarkdownTable(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
  }

  function toMarkdown(data) {
    const lines = [
      `# ${data.title || 'Conversation'}`,
      '',
      `- Platform: ${data.platformName || data.platform}`,
      `- Source: ${data.url}`,
      `- Captured: ${data.capturedAt}`,
      `- Messages: ${data.messages.length}`,
      '',
      '---',
      ''
    ];
    for (const [index, message] of data.messages.entries()) {
      const label = message.role === 'user' ? 'User' : message.role === 'assistant' ? (data.platformName || 'Assistant') : message.role;
      lines.push(`## ${label} (${index + 1})`, '', message.text || '', '');
      if (message.links && message.links.length) {
        lines.push('Sources:', '');
        for (const link of message.links) lines.push(`- [${escapeMarkdownTable(link.title)}](${link.url})`);
        lines.push('');
      }
    }
    if (data.searches && data.searches.length) {
      lines.push('---', '', '## Web searches and sources', '');
      for (const [index, search] of data.searches.entries()) {
        lines.push(`### Search ${index + 1}`, '', `- Search context: ${escapeMarkdownTable(search.query || 'Not shown')}`);
        if (search.sources.length) {
          lines.push('- Sources:');
          for (const link of search.sources) lines.push(`  - [${escapeMarkdownTable(link.title)}](${link.url})`);
        } else {
          lines.push('- Sources: none visible in the captured message');
        }
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  function platformForPayload(data) {
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data.chat_messages) && data.chat_messages.length) return 'claude';
    if (data.mapping && typeof data.mapping === 'object' && !Array.isArray(data.mapping) && Object.keys(data.mapping).length) return 'chatgpt';
    if (Array.isArray(data.messages) && data.messages.length && data.messages.some((m) => m && typeof m === 'object' && (m.author || m.role || m.content || m.text))) return 'chatgpt';
    if (Array.isArray(data.conversations) && data.conversations.length) return 'grok';
    // Grok's own conversation payload: { conversation, responses }, or a bare
    // { responses } batch loaded for a private conversation page. Both carry
    // real turns, not just the rendered window.
    if (Array.isArray(data.responses) && data.responses.length &&
      data.responses.some((entry) => entry && typeof entry === 'object' && (entry.sender || entry.responseId))) return 'grok';
    if (Array.isArray(data) && data.length && data[0] && typeof data[0] === 'object' && (Array.isArray(data[0].messages) || Array.isArray(data[0].chat_messages))) return 'grok';
    return null;
  }

  function structuredMessageTime(message) {
    const value = message && (message.create_time || message.created_at || message.createdAt || message.timestamp || message.updated_at || message.updatedAt);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const time = Date.parse(value);
      if (Number.isFinite(time)) return time;
    }
    return null;
  }

  function mergeSearches(primary, additional) {
    const merged = (Array.isArray(primary) ? primary : []).map((search) => ({
      ...search,
      sources: Array.isArray(search.sources) ? search.sources.slice() : []
    }));
    for (const search of Array.isArray(additional) ? additional : []) {
      const query = String(search.query || '').trim();
      let current = merged.find((item) => item.query === query);
      if (!current) {
        current = { ...search, query, sources: [] };
        merged.push(current);
      }
      const seen = new Set(current.sources.map((source) => source.url));
      for (const source of Array.isArray(search.sources) ? search.sources : []) {
        if (!source.url || seen.has(source.url)) continue;
        seen.add(source.url);
        current.sources.push(source);
      }
    }
    return merged;
  }

  // How many different turns a list actually contains. Repeated observations
  // of the same turn are what make an accumulated DOM view look larger than the
  // conversation it came from.
  function distinctTurnCount(messages) {
    const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
    const seen = new Set();
    for (const message of list) {
      // Must use the same normalised key the merge compares with, or repeated
      // observations of one turn in different renderings still count as
      // distinct and an inflated view wins the comparison it was meant to fix.
      const key = exportSequenceKey(message);
      seen.add(key);
      const links = Array.isArray(message.links) ? message.links : [];
      for (const link of links) {
        if (link && link.url) seen.add(`${key}\n${link.url}`);
      }
    }
    return seen.size;
  }

  function resolveExportData(options) {
    const dom = options.domData || extractConversation(options.doc, options.platform, options.pageUrl);
    const structured = options.structured;
    if (structured && structured.platform === options.platform && structured.data) {
      const normalized = normalizeStructuredResponse(structured.data, options.pageUrl);
      if (normalized && normalized.messages && normalized.messages.length) {
        // Compare how many distinct turns each source really exposes, not how
        // many entries it holds. The DOM view of a virtualized chat is re-read
        // on every scroll and accumulates, so its raw length grows well past
        // the number of turns that exist; counting raw entries let that
        // inflated length displace a complete payload and export the
        // conversation dozens of times over.
        let picked;
        let source;
        if (normalized.messages.length >= distinctTurnCount(dom.messages)) {
          picked = { ...normalized, searches: mergeSearches(normalized.searches, dom.searches) };
          source = 'structured';
        } else {
          picked = { ...dom, searches: mergeSearches(dom.searches, normalized.searches) };
          source = 'dom';
        }
        // Never silently drop the opening User turn: if the picked source starts
        // with an assistant turn while the other source opens with a user turn,
        // prepend the missing leading user turns (e.g. a structured payload that
        // omitted the opener while the visible page still shows it).
        const other = source === 'structured' ? dom : normalized;
        if (picked.messages.length && picked.messages[0].role !== 'user' &&
          other.messages && other.messages.length && other.messages[0].role === 'user') {
          const leading = [];
          for (const message of other.messages) {
            if (message.role !== 'user') break;
            leading.push(message);
          }
          const present = new Set(picked.messages.map((message) => `${message.role}\n${message.text}`));
          const missing = leading.filter((message) => !present.has(`${message.role}\n${message.text}`));
          if (missing.length) {
            picked = { ...picked, messages: [...missing, ...picked.messages] };
            source = 'merged';
          }
        }
        return { data: picked, source };
      }
    }
    return { data: dom, source: 'dom' };
  }

  function normalizeClaudeResponse(response, pageUrl) {
    if (!response || !Array.isArray(response.chat_messages)) return null;
    const messages = [];
    const searches = [];
    for (const msg of response.chat_messages) {
      const author = msg && msg.author;
      const nestedMessage = msg && msg.message;
      const roleFields = [
        msg && msg.role,
        msg && msg.sender,
        typeof author === 'string' ? author : author && (author.role || author.type),
        nestedMessage && (nestedMessage.role || nestedMessage.sender)
      ];
      const hasUserRole = roleFields.some((value) => typeof value === 'string' &&
        /^(user|human)(?:[ _-].*)?$/.test(value.trim().toLowerCase()));
      const role = hasUserRole ? 'user' : 'assistant';
      const parts = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }];
      const textParts = [];
      const links = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          if (part.trim()) textParts.push(part);
          continue;
        }
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'text') {
          const text = typeof part.text === 'string' ? part.text
            : typeof part.content === 'string' ? part.content : '';
          if (text) textParts.push(text);
          else if (part.text) textParts.push(JSON.stringify(part.text));
        }
        else if (part.type === 'thinking' && part.thinking) textParts.push(`[Thinking] ${part.thinking}`);
        else if (part.type === 'tool_use') textParts.push(`[Tool: ${part.name || 'unknown'}] ${JSON.stringify(part.input || {})}`);
        else if (part.type === 'tool_result') {
          const resultText = typeof part.content === 'string' ? part.content : JSON.stringify(part.content || '');
          textParts.push(`[Tool result] ${resultText}`);
          if (part.content && typeof part.content === 'object' && part.content.url) {
            links.push({ title: part.content.title || part.content.url, url: part.content.url });
          }
        } else if (typeof part.text === 'string' && part.text) {
          textParts.push(part.text);
        } else if (typeof part.content === 'string' && part.content) {
          textParts.push(part.content);
        } else if (part.type) {
          // Preserve the turn for unrecognized block shapes (images, documents,
          // attachments) instead of silently dropping the message: without this
          // a leading user turn with only such blocks vanishes from the export.
          textParts.push(`[${part.type}]`);
        }
      }
      // The API carries the turn text in `text` when there is no `content`
      // array; prefer it before file lines so a captioned upload keeps both.
      if (!textParts.length && msg && typeof msg.text === 'string' && msg.text.trim()) {
        textParts.push(msg.text.trim());
      }
      // Uploaded files ride alongside the turn in `files`, not in `content`:
      // an image-only turn has no text at all, so without this it is dropped.
      // Images export as Markdown with the page's own preview URL; anything
      // else becomes a named file reference carrying the same link.
      for (const file of Array.isArray(msg.files) ? msg.files : []) {
        if (!file || typeof file !== 'object') continue;
        const name = typeof file.file_name === 'string' && file.file_name ? file.file_name : 'file';
        let url = typeof file.preview_url === 'string' && file.preview_url ? file.preview_url
          : typeof file.thumbnail_url === 'string' && file.thumbnail_url ? file.thumbnail_url : '';
        if (url.startsWith('/')) {
          try { url = new URL(url, pageUrl).href; } catch (_) {}
        }
        const kind = typeof file.file_kind === 'string' ? file.file_kind.toLowerCase() : '';
        const looksImage = kind === 'image' || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name);
        if (url && looksImage) {
          textParts.push(`![${name}](${url})`);
          links.push({ title: name, url });
        } else if (url) {
          textParts.push(`> File: [${name}](${url})`);
          links.push({ title: name, url });
        } else {
          textParts.push(looksImage ? `[image: ${name}]` : `[file: ${name}]`);
        }
      }
      let text = textParts.join('\n\n').trim();
      if (!text && !links.length) continue;
      messages.push({ role, text, links });
      if (role === 'assistant' && links.length) {
        const prevUser = messages.filter((m) => m.role === 'user').pop();
        searches.push({ query: prevUser ? prevUser.text.slice(0, 200) : '', sources: links });
      }
    }
    if (!messages.length) return null;
    return {
      platform: 'claude',
      platformName: 'Claude',
      title: response.title || response.name || 'Claude Conversation',
      url: pageUrl,
      capturedAt: new Date().toISOString(),
      messages,
      searches
    };
  }

  function chatGPTTextFromParts(parts) {
    const textParts = [];
    for (const part of parts) {
      if (typeof part === 'string') {
        if (part) textParts.push(part);
      } else if (part && typeof part === 'object') {
        // Newer payloads nest text as { text: '...' } or { content: '...' }.
        // Prefer the human-readable field so available turns are not dropped
        // (or exported as raw JSON) when conversation data exists.
        if (typeof part.text === 'string' && part.text) textParts.push(part.text);
        else if (typeof part.content === 'string' && part.content) textParts.push(part.content);
        else textParts.push(JSON.stringify(part));
      }
    }
    return textParts.join('\n\n').trim();
  }

  // The web queries a turn actually ran, used to label its search entry.
  function chatGPTSearchQueries(msg) {
    const meta = (msg && msg.metadata) || {};
    const queries = [];
    if (Array.isArray(meta.search_model_queries && meta.search_model_queries.queries)) {
      for (const query of meta.search_model_queries.queries) if (typeof query === 'string' && query) queries.push(query);
    }
    if (Array.isArray(meta.search_queries)) {
      for (const entry of meta.search_queries) {
        const query = entry && (entry.query || entry.search_query);
        if (typeof query === 'string' && query) queries.push(query);
      }
    }
    return queries;
  }

  // Content types that carry no reader-visible answer. A private /c/ payload
  // interleaves these with real turns: model reasoning ("thoughts"), the
  // "Worked for 7s" recap, and commentary preambles. Reading their text would
  // reintroduce exactly the streaming noise the DOM path used to pick up.
  const CHATGPT_NON_ANSWER_CONTENT = new Set(['thoughts', 'reasoning_recap', 'tethering', 'code_interpreter_call']);

  // Answers embed citation markers as private-use glyphs (cite...).
  // Each one is described by a content_reference carrying the marker text and
  // an `alt` rendering, so the marker is swapped for readable link text
  // instead of being exported as invisible control characters.
  function chatGPTRenderCitations(text, msg) {
    if (!text || typeof text !== 'string') return text;
    const meta = (msg && msg.metadata) || {};
    const references = Array.isArray(meta.content_references) ? meta.content_references : [];
    let out = text;
    for (const reference of references) {
      if (!reference) continue;
      const marker = typeof reference.matched_text === 'string' ? reference.matched_text : '';
      const alt = typeof reference.alt === 'string' ? reference.alt : '';
      if (marker && alt) out = out.split(marker).join(alt);
    }
    // A marker with no description is dropped rather than exported raw. The
    // private-use glyphs are optional so a marker still strips when the page
    // emits the plain `cite...` form. The bounded run keeps ordinary prose
    // that happens to contain the word "cite" intact.
    // Marker form: U+E200 "cite" U+E202 <reference ids> U+E201.
    return out
      .replace(/\uE200cite\uE202[\s\S]*?\uE201/g, '')
      .replace(/[\uE200-\uE2FF]/g, '')
      .trim();
  }

  function chatGPTTextFromMessage(msg) {
    if (!msg || typeof msg !== 'object') return '';
    const content = msg.content;
    if (content && typeof content === 'object' && CHATGPT_NON_ANSWER_CONTENT.has(content.content_type)) return '';
    if (content && Array.isArray(content.parts)) return chatGPTRenderCitations(chatGPTTextFromParts(content.parts), msg);
    if (typeof content === 'string') return content.trim();
    if (content && typeof content === 'object') {
      if (typeof content.text === 'string' && content.text.trim()) return content.text.trim();
      if (typeof content.content === 'string' && content.content.trim()) return content.content.trim();
    }
    if (typeof msg.text === 'string' && msg.text.trim()) return msg.text.trim();
    return '';
  }

  function chatGPTLinksFromMessage(msg) {
    const links = [];
    if (msg.metadata && msg.metadata.citations) {
      for (const cite of msg.metadata.citations) {
        if (cite.url) links.push({ title: cite.title || cite.url, url: cite.url });
      }
    }
    if (msg.metadata && Array.isArray(msg.metadata.search_result_groups)) {
      // Current shape nests results under `entries`; older payloads used
      // `sources`. Both appear in the same conversation.
      for (const group of msg.metadata.search_result_groups) {
        for (const entry of Array.isArray(group.entries) ? group.entries : []) {
          if (entry && entry.url) links.push({ title: entry.title || entry.url, url: entry.url });
        }
        for (const src of Array.isArray(group.sources) ? group.sources : []) {
          if (src && src.url) links.push({ title: src.title || src.url, url: src.url });
        }
      }
    }
    // The sources an answer actually cites live in content_references.
    if (msg.metadata && Array.isArray(msg.metadata.content_references)) {
      for (const reference of msg.metadata.content_references) {
        for (const key of ['items', 'sources']) {
          for (const item of Array.isArray(reference && reference[key]) ? reference[key] : []) {
            if (item && item.url) links.push({ title: item.title || item.url, url: item.url });
          }
        }
        for (const segment of Array.isArray(reference && reference.supporting_websites) ? reference.supporting_websites : []) {
          if (segment && segment.url) links.push({ title: segment.title || segment.url, url: segment.url });
        }
      }
    }

    if (Array.isArray(msg.sources)) {
      for (const src of msg.sources) {
        if (src && src.url) links.push({ title: src.title || src.url, url: src.url });
      }
    }
    return links;
  }

  function chatGPTRoleFromMessage(msg) {
    const raw = (msg.author && msg.author.role) || msg.role || msg.sender || '';
    const role = String(raw).trim().toLowerCase();
    if (role === 'user' || role === 'human') return 'user';
    if (role === 'assistant' || role === 'model' || role === 'system' || role === 'tool') return role === 'model' ? 'assistant' : role;
    return 'assistant';
  }

  // Order turns by their own timestamp when the payload provides one for
  // every turn. Falls back to the given order if any timestamp is missing.
  function sortMessagesByTime(list) {
    const messages = Array.isArray(list) ? list : [];
    const times = messages.map(structuredMessageTime);
    if (!times.length || times.some((time) => time == null)) return messages.slice();
    return messages
      .map((message, index) => ({ message, index, time: times[index] }))
      .sort((a, b) => a.time - b.time || a.index - b.index)
      .map((entry) => entry.message);
  }

  function normalizeChatGPTMessagesList(rawMessages) {
    const messages = [];
    const searches = [];
    // Web-search results arrive on their own tool turn with no text. They
    // belong to the answer the reader actually sees, so they are carried
    // forward and merged into that turn instead of becoming an empty message.
    let pendingLinks = [];
    let pendingQueries = [];
    for (const msg of Array.isArray(rawMessages) ? rawMessages : []) {
      if (!msg || typeof msg !== 'object') continue;
      const role = chatGPTRoleFromMessage(msg);
      // Same visibility rules as the mapping graph: the flat /c/ payload
      // interleaves system prompts, tool turns, redacted placeholders and
      // thinking preambles with the turns the reader actually sees.
      const meta = msg.metadata || {};
      if (meta.is_visually_hidden_from_conversation) continue;
      if (meta.is_redacted) continue;
      if (meta.is_thinking_preamble_message) continue;
      const text = chatGPTTextFromMessage(msg);
      const found = chatGPTLinksFromMessage(msg);
      if (role === 'system' || role === 'tool') {
        // A hidden turn may still carry the sources and the queries for the
        // next answer the reader sees.
        for (const link of found) if (link.url) pendingLinks.push(link);
        for (const query of chatGPTSearchQueries(msg)) pendingQueries.push(query);
        continue;
      }
      if (!text) {
        // Reasoning recaps and empty tool requests carry no answer. Keep any
        // sources they hold for the next turn that does have text.
        for (const link of found) if (link.url) pendingLinks.push(link);
        continue;
      }
      const links = [];
      const seen = new Set();
      for (const link of pendingLinks.concat(found)) {
        if (!link.url || seen.has(link.url)) continue;
        seen.add(link.url);
        links.push(link);
      }
      pendingLinks = [];
      const turn = { role, text, links };
      if (pendingQueries.length && links.length) {
        turn.searchQueries = pendingQueries.slice();
        pendingQueries = [];
      }
      messages.push(turn);
      if (messages[messages.length - 1].role === 'assistant' && links.length) {
        const prevUser = messages.filter((m) => m.role === 'user').pop();
        const ran = chatGPTSearchQueries(msg).concat(messages[messages.length - 1].searchQueries || []);
        const query = ran.length ? ran.join('; ').slice(0, 200) : (prevUser ? prevUser.text.slice(0, 200) : '');
        searches.push({ query, sources: links });
        delete messages[messages.length - 1].searchQueries;
      }
    }
    return { messages, searches };
  }

  function normalizeChatGPTResponse(response, pageUrl) {
    if (!response || typeof response !== 'object') return null;
    if (!response.mapping || typeof response.mapping !== 'object') {
      // Some ChatGPT payloads expose a plain messages array instead of the
      // mapping graph. Normalize it so available turns still reach a usable
      // export state instead of waiting indefinitely.
      if (Array.isArray(response.messages) && response.messages.length) {
        // A long conversation arrives as successive pages, so the array order
        // is not the conversation order. Sort by turn time when every turn
        // carries one, otherwise keep the order the payload gave.
        const list = sortMessagesByTime(response.messages);
        const flat = normalizeChatGPTMessagesList(list);
        if (!flat.messages.length) return null;
        return {
          platform: 'chatgpt',
          platformName: 'ChatGPT',
          title: response.title || 'ChatGPT Conversation',
          url: pageUrl,
          capturedAt: new Date().toISOString(),
          messages: flat.messages,
          searches: flat.searches
        };
      }
      return null;
    }
    const messages = [];
    const searches = [];
    const mapping = response.mapping;
    const currentNode = response.current_node;
    let orderedIds = [];
    if (currentNode && mapping[currentNode]) {
      let node = currentNode;
      const chain = [];
      // A malformed mapping can link parents in a cycle; without a visited
      // set the walk below never terminates and the popup hangs silently.
      const seen = new Set();
      while (node && mapping[node] && !seen.has(node)) {
        seen.add(node);
        chain.unshift(node);
        const entry = mapping[node];
        const parentId = entry && entry.parent;
        node = parentId && mapping[parentId] ? parentId : null;
      }
      orderedIds = chain;
    } else {
      orderedIds = Object.keys(mapping).sort((a, b) => {
        const ta = mapping[a] && mapping[a].message && mapping[a].message.create_time || 0;
        const tb = mapping[b] && mapping[b].message && mapping[b].message.create_time || 0;
        return ta - tb;
      });
    }
    for (const id of orderedIds) {
      const entry = mapping[id];
      if (!entry || !entry.message) continue;
      const msg = entry.message;
      const rawRole = chatGPTRoleFromMessage(msg);
      // Turn metadata marks turns the conversation never shows the reader:
      // system and tool turns, developer prompts, redacted placeholders, and
      // thinking preambles. Exporting them adds noise the user never saw, so
      // they are dropped rather than folded into the assistant's answer.
      const meta = msg.metadata || {};
      if (meta.is_visually_hidden_from_conversation) continue;
      if (meta.is_redacted) continue;
      if (meta.is_thinking_preamble_message) continue;
      const text = chatGPTTextFromMessage(msg);
      const links = chatGPTLinksFromMessage(msg);
      if ((rawRole === 'system' || rawRole === 'tool') && !text && !links.length) continue;
      if (!text && !links.length) continue;
      const role = rawRole === 'system' || rawRole === 'tool' ? 'assistant' : rawRole;
      messages.push({ role, text, links });
      if (role === 'assistant' && links.length) {
        const prevUser = messages.filter((m) => m.role === 'user').pop();
        const ran = chatGPTSearchQueries(msg);
        const query = ran.length ? ran.join('; ').slice(0, 200) : (prevUser ? prevUser.text.slice(0, 200) : '');
        searches.push({ query, sources: links });
      }
    }
    if (!messages.length) return null;
    return {
      platform: 'chatgpt',
      platformName: 'ChatGPT',
      title: response.title || 'ChatGPT Conversation',
      url: pageUrl,
      capturedAt: new Date().toISOString(),
      messages,
      searches
    };
  }

  function normalizeGrokResponse(response, pageUrl) {
    if (!response) return null;
    const conversations = Array.isArray(response.conversations) ? response.conversations : Array.isArray(response) ? response : null;
    if (!conversations || !conversations.length) return null;
    const conv = conversations[0];
    const messageLists = [conv.messages, conv.chat_messages].filter(Array.isArray);
    const rawMessages = messageLists.length
      ? messageLists.reduce((longest, list) => (list.length > longest.length ? list : longest))
      : [];
    const messages = [];
    const searches = [];
    for (const msg of rawMessages) {
      const role = msg.role === 'user' || msg.role === 'human' ? 'user' : 'assistant';
      const text = String(msg.content || msg.text || '').trim();
      const links = [];
      if (msg.sources) {
        for (const src of msg.sources) {
          if (src.url) links.push({ title: src.title || src.url, url: src.url });
        }
      }
      if (!text && !links.length) continue;
      messages.push({ role, text, links });
      if (role === 'assistant' && links.length) {
        const prevUser = messages.filter((m) => m.role === 'user').pop();
        searches.push({ query: prevUser ? prevUser.text.slice(0, 200) : '', sources: links });
      }
    }
    if (!messages.length) return null;
    return {
      platform: 'grok',
      platformName: 'Grok',
      title: conv.title || 'Grok Conversation',
      url: pageUrl,
      capturedAt: new Date().toISOString(),
      messages,
      searches
    };
  }

  // Grok's own conversation payload: { conversation: {...}, responses: [...] }.
// Every turn of the conversation is present here regardless of what the page
// has rendered, so this is the authoritative source. Text arrives in chunks:
// a human turn in inputChunks, an assistant turn in the outputChunks whose
// channel is CHANNEL_ASSISTANT_RESPONSE. The other channels are transient
// progress notes ("Thinking about...", "Working for 4s") which must be left
// out, otherwise the export repeats the noise the page shows while streaming.
  const GROK_RESPONSE_CHANNEL = 'CHANNEL_ASSISTANT_RESPONSE';

  function grokChunkText(chunk) {
    if (!chunk || typeof chunk !== 'object') return '';
    if (typeof chunk.text === 'string') return chunk.text;
    if (chunk.text && typeof chunk.text.text === 'string') return chunk.text.text;
    return '';
  }

  function grokWebSources(response) {
    const links = [];
    const seen = new Set();
    const add = (url, title) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      links.push({ title: title || url, url });
    };
    for (const result of Array.isArray(response.webSearchResults) ? response.webSearchResults : []) {
      if (result && result.url) add(result.url, result.title);
    }
    for (const chunk of Array.isArray(response.outputChunks) ? response.outputChunks : []) {
      const search = chunk && chunk.toolResult && chunk.toolResult.webSearch;
      const webpages = search && Array.isArray(search.webpages) ? search.webpages : [];
      for (const page of webpages) if (page && page.url) add(page.url, page.title);
    }
    return links;
  }

  // Grok's payloads embed custom elements such as <grok:render> as internal
  // placeholders for rendered artifacts. They are markup for the app, not text
  // the reader sees, and a whole element including its contents is not content.
  function stripGrokMarkup(text) {
    if (typeof text !== 'string' || text.indexOf('<') === -1) return text;
    return text
      .replace(/<[a-z]+:[a-zA-Z]+\b[^>]*>[\s\S]*?<\/[a-z]+:[a-zA-Z]+>/g, '')
      .replace(/<\/?[a-z]+:[a-zA-Z]+\b[^>]*\/?>/g, '')
      // Removing an element can leave the emphasis that wrapped it behind.
      .replace(/\*{2,}/g, '')
      .replace(/_{2,}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function grokTurnFromResponse(response) {
    if (!response || typeof response !== 'object') return null;
    const role = response.sender === 'human' ? 'user' : 'assistant';
    let text = '';
    if (role === 'user') {
      for (const chunk of Array.isArray(response.inputChunks) ? response.inputChunks : []) {
        text += grokChunkText(chunk);
      }
      if (!text && typeof response.message === 'string') text = response.message;
    } else {
      for (const chunk of Array.isArray(response.outputChunks) ? response.outputChunks : []) {
        if (!chunk || !chunk.text) continue;
        const channel = chunk.text.channel;
        if (channel && channel !== GROK_RESPONSE_CHANNEL) continue;
        text += grokChunkText(chunk);
      }
      // A loaded response carries its finished text on `message` with no
      // chunks at all. This is the shape the private conversation page uses.
      if (!text && typeof response.message === 'string') text = response.message;
    }
    text = stripGrokMarkup(text);
    const links = role === 'assistant' ? grokWebSources(response) : [];
    if (!text && !links.length) return null;
    const turn = { role, text, links };
    if (response.responseId) turn.id = String(response.responseId);
    return turn;
  }

  function normalizeGrokShareResponse(response, pageUrl) {
    if (!response || typeof response !== 'object') return null;
    const conversation = response.conversation || {};
    const list = Array.isArray(response.responses) ? response.responses : null;
    if (!list) return null;
    // The shared payload carries a conversation object for its title; a loaded
    // response batch does not, so the title falls back." 
    const messages = [];
    const searches = [];
    for (const entry of list) {
      const turn = grokTurnFromResponse(entry);
      if (!turn) continue;
      messages.push(turn);
      if (turn.role === 'assistant' && turn.links.length) {
        const query = entry && (entry.query || entry.queryType);
        const previousUser = messages.slice().reverse().find((item) => item.role === 'user');
        searches.push({
          query: previousUser ? String(previousUser.text).slice(0, 200) : '',
          sources: turn.links
        });
      }
    }
    if (!messages.length) return null;
    return {
      platform: 'grok',
      platformName: 'Grok',
      title: conversation.title || 'Grok Conversation',
      url: pageUrl,
      capturedAt: new Date().toISOString(),
      messages,
      searches
    };
  }

  function normalizeStructuredResponse(response, pageUrl) {
    if (!response || typeof response !== 'object') return null;
    if (response.chat_messages) return normalizeClaudeResponse(response, pageUrl);
    if (response.mapping || Array.isArray(response.messages)) return normalizeChatGPTResponse(response, pageUrl);
    // Grok's own conversation payload carries every turn, so prefer it over the
    // older `conversations` shape and over anything read from the DOM. The
    // shared payload pairs it with a conversation object; the private page loads
    // responses in batches that carry no such object.
    if (Array.isArray(response.responses) && response.responses.some((entry) => entry && (entry.sender || entry.responseId))) {
      return normalizeGrokShareResponse(response, pageUrl);
    }
    if (response.conversations || Array.isArray(response)) return normalizeGrokResponse(response, pageUrl);
    return null;
  }


  // ChatGPT share pages are server rendered and carry the whole conversation
  // in a devalue-serialized payload inside an inline script, rather than in an
  // API response the extension can observe. These two functions recover the
  // conversation from that payload; both are pure so they can be tested
  // without a browser.

  // Revive devalue's flattened array. Each entry is a value; an object whose
  // keys look like "_12" stores the property NAME at index 12 rather than
  // inlining it, and negative indices are devalue's special values.
  function reviveDevalue(flat) {
    if (!Array.isArray(flat) || !flat.length) return null;
    const SPECIAL = { '-1': undefined, '-2': undefined, '-3': NaN, '-4': Infinity, '-5': -Infinity, '-6': -0 };
    const hydrated = new Array(flat.length);
    const resolved = new Array(flat.length).fill(false);
    function hydrate(index) {
      if (typeof index === 'string' && Object.prototype.hasOwnProperty.call(SPECIAL, index)) return SPECIAL[index];
      if (typeof index !== 'number') return index;
      if (index < 0 || index >= flat.length) return undefined;
      if (resolved[index]) return hydrated[index];
      const value = flat[index];
      if (value === null || typeof value !== 'object') {
        hydrated[index] = value;
        resolved[index] = true;
        return value;
      }
      if (Array.isArray(value)) {
        const list = [];
        hydrated[index] = list;
        resolved[index] = true;
        for (let i = 0; i < value.length; i++) list[i] = hydrate(value[i]);
        return list;
      }
      const object = {};
      hydrated[index] = object;
      resolved[index] = true;
      for (const key of Object.keys(value)) {
        const ref = /^_(-?\d+)$/.exec(key);
        if (ref) object[String(hydrate(Number(ref[1])))] = hydrate(value[key]);
        else object[key] = value[key];
      }
      return object;
    }
    try {
      return hydrate(0);
    } catch (_) {
      return null;
    }
  }

  // Decode a JavaScript string literal (as embedded in a <script>) into text.
  function decodeScriptStringLiteral(literal) {
    let out = '';
    for (let index = 0; index < literal.length; index++) {
      const char = literal[index];
      if (char !== '\\') {
        out += char;
        continue;
      }
      const next = literal[index + 1];
      index += 1;
      if (next === 'u') {
        const hex = literal.slice(index + 1, index + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          index += 4;
        }
        continue;
      }
      if (next === 'n') { out += '\n'; continue; }
      if (next === 'r') { out += '\r'; continue; }
      if (next === 't') { out += '\t'; continue; }
      if (next === 'b') { out += '\b'; continue; }
      if (next === 'f') { out += '\f'; continue; }
      if (next === 'v') { out += '\v'; continue; }
      if (next === 'x') {
        const hex = literal.slice(index + 1, index + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          index += 2;
        }
        continue;
      }
      if (next === '0' && !/\d/.test(literal[index + 1] || '')) continue;
      out += next;
    }
    return out;
  }

  // Pull the conversation out of a ChatGPT share page's HTML.
  function extractChatGPTShareConversation(html) {
    if (typeof html !== 'string' || !html) return null;
    const marker = /streamController\.enqueue\((\"(?:[^\"\\]|\\[\s\S])*\")\)/g;
    let match;
    while ((match = marker.exec(html)) !== null) {
      // match[1] still carries the string literal's own quotes.
      const literal = match[1].slice(1, -1);
      let parsed;
      try {
        parsed = JSON.parse(decodeScriptStringLiteral(literal));
      } catch (_) {
        continue;
      }
      const revived = reviveDevalue(parsed);
      if (!revived || typeof revived !== 'object') continue;
      const loaderData = revived.loaderData;
      if (!loaderData || typeof loaderData !== 'object') continue;
      for (const key of Object.keys(loaderData)) {
        const route = loaderData[key];
        const serverResponse = route && route.serverResponse;
        const data = serverResponse && serverResponse.data;
        if (!data || typeof data !== 'object') continue;
        if (!data.mapping || typeof data.mapping !== 'object') continue;
        return {
          mapping: data.mapping,
          current_node: data.current_node,
          linear_conversation: data.linear_conversation,
          title: data.title,
          conversation_id: data.conversation_id
        };
      }
    }
    return null;
  }

  const api = { platformFromLocation, conversationRoute, extractConversation, toMarkdown, getCandidateSelector, normalizeClaudeResponse, normalizeChatGPTResponse, chatGPTSearchQueries, chatGPTRenderCitations, normalizeGrokResponse, normalizeGrokShareResponse, grokTurnFromResponse, distinctTurnCount, comparisonText, reviveDevalue, decodeScriptStringLiteral, extractChatGPTShareConversation, normalizeStructuredResponse, platformForPayload, resolveExportData, mergeSearches, getFallbackSelector };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ChatExportAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
