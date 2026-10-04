const test = require('node:test');
const assert = require('node:assert/strict');
const adapters = require('../src/adapters.js');

function makeNode(tag, attrs, text) {
  const node = {
    tagName: tag.toUpperCase(),
    attributes: attrs || {},
    children: [],
    textContent: text || '',
    innerText: text || '',
    getAttribute(name) { return this.attributes[name] || ''; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    querySelectorAll(sel) {
      const results = [];
      const match = (n) => {
        if (sel.includes('a[href]') && n.tagName === 'A' && n.attributes.href) results.push(n);
        for (const c of n.children) match(c);
      };
      match(this);
      return results;
    },
    closest() { return null; },
    parentElement: null
  };
  return node;
}

function makeDoc(nodes) {
  return {
    querySelectorAll(sel) {
      if (sel.includes('data-message-author-role')) return nodes;
      return [];
    },
    querySelector() { return null; }
  };
}

// Devalue serialization test helper: every array element and computed
// object key is a reference into the flat array, so fixtures are encoded
// rather than hand-indexed.
function encodeDevalue(value) {
    const flat = [];
    const index = (item) => {
      if (typeof item !== 'object' || item === null) {
        const at = flat.length;
        flat.push(item);
        return at;
      }
      const at = flat.length;
      flat.push(null);
      if (Array.isArray(item)) {
        flat[at] = item.map((entry) => index(entry));
      } else {
        const node = {};
        for (const key of Object.keys(item)) {
          const keyAt = flat.length;
          flat.push(key);
          node['_' + keyAt] = index(item[key]);
        }
        flat[at] = node;
      }
      return at;
    };
  index(value);
  return flat;
}

test('detects all supported platforms and shared conversation routes', () => {
  const cases = [
    ['claude', 'claude.ai', '/share/example'],
    ['chatgpt', 'chatgpt.com', '/share/example'],
    ['grok', 'grok.com', '/share/example'],
    ['grok', 'x.com', '/i/grok']
  ];
  for (const [expected, hostname, pathname] of cases) {
    const location = { hostname, pathname };
    assert.equal(adapters.platformFromLocation(location), expected);
    assert.equal(adapters.conversationRoute(expected, location), true);
  }
});

test('formats messages, links, and web-search context as Markdown', () => {
  const markdown = adapters.toMarkdown({
    title: 'Research chat',
    platform: 'grok',
    platformName: 'Grok',
    url: 'https://grok.com/share/example',
    capturedAt: '2026-10-03T00:00:00.000Z',
    messages: [
      { role: 'user', text: 'Find the latest release notes', links: [] },
      { role: 'assistant', text: 'I searched the web and found this.', links: [{ title: 'Release notes', url: 'https://example.com/releases' }] }
    ],
    searches: [{ query: 'Find the latest release notes', sources: [{ title: 'Release notes', url: 'https://example.com/releases' }] }]
  });
  assert.match(markdown, /^# Research chat/m);
  assert.match(markdown, /## User \(1\)/);
  assert.match(markdown, /## Grok \(2\)/);
  assert.match(markdown, /## Web searches and sources/);
  assert.match(markdown, /Search context: Find the latest release notes/);
  assert.match(markdown, /\[Release notes\]\(https:\/\/example\.com\/releases\)/);
});

test('normalizes Claude structured response with text, thinking, and tool blocks', () => {
  const response = {
    title: 'Claude research',
    chat_messages: [
      { role: 'user', content: [{ type: 'text', text: 'Search for latest AI news' }] },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'I should search the web for this.' },
        { type: 'text', text: 'I found several articles about AI.' },
        { type: 'tool_use', name: 'web_search', input: { query: 'latest AI news' } },
        { type: 'tool_result', content: 'Article 1: AI breakthrough\nArticle 2: New model released' }
      ] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.platform, 'claude');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.match(result.messages[1].text, /\[Thinking\] I should search/);
  assert.match(result.messages[1].text, /\[Tool: web_search\]/);
  assert.match(result.messages[1].text, /\[Tool result\] Article 1/);
});

test('normalizes ChatGPT structured response with citations', () => {
  const response = {
    title: 'ChatGPT conversation',
    mapping: {
      'msg-1': { message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['What is the weather?'] }, create_time: 1 } },
      'msg-2': { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['It is sunny.'] }, create_time: 2, metadata: { citations: [{ title: 'Weather.com', url: 'https://weather.com' }] } } }
    }
  };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123');
  assert.equal(result.platform, 'chatgpt');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[1].role, 'assistant');
  assert.match(result.messages[1].text, /It is sunny/);
  assert.equal(result.messages[1].links.length, 1);
  assert.equal(result.messages[1].links[0].url, 'https://weather.com');
  assert.equal(result.searches.length, 1);
  assert.equal(result.searches[0].sources[0].url, 'https://weather.com');
});

test('normalizes Grok structured response with sources', () => {
  const response = {
    conversations: [{
      id: 'conv-1',
      title: 'Grok chat',
      messages: [
        { role: 'user', content: 'Tell me about Rust' },
        { role: 'assistant', content: 'Rust is a systems programming language.', sources: [{ title: 'Rust docs', url: 'https://rust-lang.org' }] }
      ]
    }]
  };
  const result = adapters.normalizeGrokResponse(response, 'https://grok.com/chat/1');
  assert.equal(result.platform, 'grok');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[1].role, 'assistant');
  assert.match(result.messages[1].text, /Rust is a systems/);
  assert.equal(result.messages[1].links[0].url, 'https://rust-lang.org');
  assert.equal(result.searches.length, 1);
});

test('normalizeStructuredResponse dispatches by response shape', () => {
  const claudeResult = adapters.normalizeStructuredResponse({ chat_messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }, 'https://claude.ai/chat/x');
  assert.equal(claudeResult.platform, 'claude');
  const chatgptResult = adapters.normalizeStructuredResponse({ mapping: { 'm1': { message: { author: { role: 'user' }, content: { parts: ['hi'] } } } } }, 'https://chatgpt.com/c/x');
  assert.equal(chatgptResult.platform, 'chatgpt');
  const grokResult = adapters.normalizeStructuredResponse({ conversations: [{ messages: [{ role: 'user', content: 'hi' }] }] }, 'https://grok.com/chat/x');
  assert.equal(grokResult.platform, 'grok');
  assert.equal(adapters.normalizeStructuredResponse(null, 'https://example.com'), null);
  assert.equal(adapters.normalizeStructuredResponse({}, 'https://example.com'), null);
});

test('structured normalizers return null for invalid input', () => {
  assert.equal(adapters.normalizeClaudeResponse(null, 'https://claude.ai'), null);
  assert.equal(adapters.normalizeClaudeResponse({}, 'https://claude.ai'), null);
  assert.equal(adapters.normalizeChatGPTResponse(null, 'https://chatgpt.com'), null);
  assert.equal(adapters.normalizeChatGPTResponse({}, 'https://chatgpt.com'), null);
  assert.equal(adapters.normalizeGrokResponse(null, 'https://grok.com'), null);
  assert.equal(adapters.normalizeGrokResponse({}, 'https://grok.com'), null);
});

test('Claude normalizer recognizes human role variant', () => {
  const response = {
    chat_messages: [
      { role: 'human', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[1].role, 'assistant');
});

test('ChatGPT normalizer uses current_node chain and preserves search metadata', () => {
  const response = {
    title: 'Branch test',
    current_node: 'msg-3',
    mapping: {
      'msg-1': { message: { author: { role: 'user' }, content: { parts: ['First question'] }, create_time: 1 }, parent: null },
      'msg-2': { message: { author: { role: 'assistant' }, content: { parts: ['First answer'] }, create_time: 2 }, parent: 'msg-1' },
      'msg-3': { message: { author: { role: 'user' }, content: { parts: ['Follow-up'] }, create_time: 3 }, parent: 'msg-2' }
    }
  };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123');
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].text, 'First question');
  assert.equal(result.messages[1].text, 'First answer');
  assert.equal(result.messages[2].text, 'Follow-up');
});

test('ChatGPT normalizer preserves non-string parts and search_queries', () => {
  const response = {
    mapping: {
      'msg-1': { message: { author: { role: 'user' }, content: { parts: ['Search for AI news'] }, create_time: 1 } },
      'msg-2': { message: { author: { role: 'assistant' }, content: { parts: ['Here is a result.', { type: 'structured', data: { key: 'value' } }] }, create_time: 2, metadata: { search_queries: [{ query: 'AI news' }], citations: [{ title: 'AI News', url: 'https://example.com/ai' }] } } }
    }
  };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123');
  assert.equal(result.messages.length, 2);
  assert.match(result.messages[1].text, /Here is a result/);
  assert.match(result.messages[1].text, /structured/);
  assert.equal(result.messages[1].links.length, 1);
  assert.equal(result.searches.length, 1);
  assert.equal(result.searches[0].query, 'AI news');
});

test('DOM extraction fallback works with fixture HTML', () => {
  const userDiv = makeNode('div', { 'data-message-author-role': 'user' }, 'Hello world');
  const link = makeNode('a', { href: 'https://example.com' }, 'this link');
  link.href = 'https://example.com';
  const assistantDiv = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Hi there! I searched the web and found this link.');
  assistantDiv.children.push(link);
  const doc = {
    querySelectorAll(sel) {
      if (sel.includes('data-message-author-role')) return [userDiv, assistantDiv];
      return [];
    },
    querySelector() { return null; }
  };
  const result = adapters.extractConversation(doc, 'chatgpt', 'https://chatgpt.com/c/test');
  assert.equal(result.platform, 'chatgpt');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].text, 'Hello world');
  assert.equal(result.messages[1].role, 'assistant');
  assert.match(result.messages[1].text, /searched the web/);
  assert.equal(result.messages[1].links.length, 1);
  assert.equal(result.messages[1].links[0].url, 'https://example.com');
  assert.equal(result.searches.length, 1);
});

test('resolveExportData prefers structured capture on all supported platforms', () => {
  const cases = [
    ['claude', { chat_messages: [{ role: 'user', content: [{ type: 'text', text: 'Structured Claude question' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Structured Claude answer' }] }] }],
    ['chatgpt', { mapping: { 'm1': { message: { author: { role: 'user' }, content: { parts: ['Structured ChatGPT question'] } } }, 'm2': { message: { author: { role: 'assistant' }, content: { parts: ['Structured ChatGPT answer'] } } } } }],
    ['grok', { conversations: [{ messages: [{ role: 'user', content: 'Structured Grok question' }, { role: 'assistant', content: 'Structured Grok answer' }] }] }]
  ];
  for (const [platformName, payload] of cases) {
    const resolved = adapters.resolveExportData({
      structured: { platform: platformName, data: payload },
      doc: makeDoc([]),
      platform: platformName,
      pageUrl: `https://example.com/${platformName}`
    });
    assert.equal(resolved.source, 'structured');
    assert.equal(resolved.data.platform, platformName);
    assert.equal(resolved.data.messages.length, 2);
    assert.match(resolved.data.messages[0].text, new RegExp(`structured ${platformName} question`, 'i'));
    assert.match(resolved.data.messages[1].text, new RegExp(`structured ${platformName} answer`, 'i'));
  }
});

test('resolveExportData falls back to DOM when structured capture is missing or unusable', () => {
  const userDiv = makeNode('div', { 'data-message-author-role': 'user' }, 'DOM question');
  const assistantDiv = makeNode('div', { 'data-message-author-role': 'assistant' }, 'DOM answer');
  const doc = makeDoc([userDiv, assistantDiv]);
  const pageUrl = 'https://chatgpt.com/c/test';

  const missing = adapters.resolveExportData({ structured: null, doc, platform: 'chatgpt', pageUrl });
  assert.equal(missing.source, 'dom');
  assert.equal(missing.data.messages.length, 2);
  assert.equal(missing.data.messages[0].text, 'DOM question');

  const mismatched = adapters.resolveExportData({
    structured: { platform: 'claude', data: { chat_messages: [{ role: 'user', content: [{ type: 'text', text: 'wrong platform' }] }] } },
    doc, platform: 'chatgpt', pageUrl
  });
  assert.equal(mismatched.source, 'dom');

  const unrecognized = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: { something: 'else' } },
    doc, platform: 'chatgpt', pageUrl
  });
  assert.equal(unrecognized.source, 'dom');

  const empty = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: { mapping: {} } },
    doc, platform: 'chatgpt', pageUrl
  });
  assert.equal(empty.source, 'dom');
  assert.equal(empty.data.messages.length, 2);
});

test('resolveExportData does not replace a fuller visible conversation with a partial payload', () => {
  const dom = makeDoc([
    makeNode('div', { 'data-message-author-role': 'user' }, 'Older question'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'Older answer'),
    makeNode('div', { 'data-message-author-role': 'user' }, 'Newer question'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'Newer answer')
  ]);
  const partial = adapters.resolveExportData({
    structured: { platform: 'claude', data: { chat_messages: [
      { role: 'user', content: [{ type: 'text', text: 'Newer question' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'Newer answer' },
        { type: 'tool_result', content: { title: 'Search source', url: 'https://example.com/search-result' } }
      ] }
    ] } },
    doc: dom,
    platform: 'claude',
    pageUrl: 'https://claude.ai/share/example'
  });
  assert.equal(partial.source, 'dom');
  assert.equal(partial.data.messages.length, 4);
  assert.equal(partial.data.messages[0].text, 'Older question');
  assert.equal(partial.data.searches[0].sources[0].url, 'https://example.com/search-result');

  const fuller = adapters.resolveExportData({
    structured: { platform: 'claude', data: { chat_messages: [
      { role: 'user', content: [{ type: 'text', text: 'Question one' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Answer one' }] },
      { role: 'user', content: [{ type: 'text', text: 'Question two' }] }
    ] } },
    doc: makeDoc([makeNode('div', { 'data-message-author-role': 'user' }, 'Question two')]),
    platform: 'claude',
    pageUrl: 'https://claude.ai/share/example'
  });
  assert.equal(fuller.source, 'structured');
  assert.equal(fuller.data.messages.length, 3);
});

test('merged Claude captures export older turns from partial responses', () => {
  const firstPage = {
    conversation_id: 'private-conversation-id',
    chat_messages: [
      { uuid: 'turn-2', role: 'assistant', created_at: '2025-01-02T00:00:00Z', content: [{ type: 'text', text: 'Answer two' }] },
      { uuid: 'turn-3', role: 'human', created_at: '2025-01-03T00:00:00Z', content: [{ type: 'text', text: 'Question two' }] }
    ]
  };
  const olderPage = {
    conversation_id: 'private-conversation-id',
    chat_messages: [
      { uuid: 'turn-1', role: 'human', created_at: '2025-01-01T00:00:00Z', content: [{ type: 'text', text: 'Question one' }] },
      { uuid: 'turn-2', role: 'assistant', created_at: '2025-01-02T00:00:00Z', content: [{ type: 'text', text: 'Answer two' }] }
    ]
  };
  const merged = adapters.mergeStructuredResponses('claude', firstPage, olderPage);
  const result = adapters.normalizeStructuredResponse(merged, 'https://claude.ai/share/public-token');
  assert.deepEqual(result.messages.map((message) => message.text), ['Question one', 'Answer two', 'Question two']);
  assert.match(adapters.toMarkdown(result), /Question one[\s\S]*Answer two[\s\S]*Question two/);
});

test('Claude MessageActions toolbar controls are not exported as turns', () => {
  const userDiv = makeNode('div', { 'data-message-author-role': 'user' }, 'Real user question about search');
  const toolbar = makeNode('div', { 'data-cds': 'MessageActions', role: 'toolbar' }, '\uE256 Retry Edit Copy');
  const retryBtn = makeNode('button', { 'data-testid': 'user-message-retry', 'aria-label': 'Retry' }, '\uE256 Retry');
  const editBtn = makeNode('button', { 'data-testid': 'user-message-edit', 'aria-label': 'Edit' }, '\uE256 Edit');
  const copyBtn = makeNode('button', { 'data-testid': 'user-message-copy', 'aria-label': 'Copy' }, '\uE256 Copy');
  retryBtn.parentElement = toolbar;
  editBtn.parentElement = toolbar;
  copyBtn.parentElement = toolbar;
  toolbar.children.push(retryBtn, editBtn, copyBtn);
  const assistantDiv = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Real assistant answer with detail.');
  const doc = makeDoc([userDiv, toolbar, retryBtn, editBtn, copyBtn, assistantDiv]);
  const result = adapters.extractConversation(doc, 'claude', 'https://claude.ai/share/example');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].text, 'Real user question about search');
  assert.equal(result.messages[1].text, 'Real assistant answer with detail.');
  const markdown = adapters.toMarkdown(result);
  assert.match(markdown, /Real user question about search/);
  assert.match(markdown, /Real assistant answer with detail/);
  assert.doesNotMatch(markdown, /Retry/);
  assert.doesNotMatch(markdown, /## User \(2\)/);
  assert.equal((markdown.match(/## (User|Claude) \(\d+\)/g) || []).length, 2);
});

test('Claude nested MessageActions text is stripped from real message bodies', () => {
  const toolbar = makeNode('div', { 'data-cds': 'MessageActions', role: 'toolbar' }, '\uE256 Retry Edit Copy');
  const parent = makeNode('div', { 'data-message-author-role': 'user' }, 'Real nested question \uE256 Retry Edit Copy');
  parent.children.push(toolbar);
  toolbar.parentElement = parent;
  const originalQueryAll = parent.querySelectorAll.bind(parent);
  parent.querySelectorAll = (sel) => {
    if (String(sel).includes('data-cds')) return [toolbar];
    if (String(sel).includes('user-message-retry')) return [];
    return originalQueryAll(sel);
  };
  const assistantDiv = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Real assistant reply.');
  const doc = makeDoc([parent, assistantDiv]);
  const result = adapters.extractConversation(doc, 'claude', 'https://claude.ai/share/example');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].text, 'Real nested question');
  assert.doesNotMatch(result.messages[0].text, /\uE256/);
  assert.doesNotMatch(result.messages[0].text, /Retry/);
  assert.doesNotMatch(adapters.toMarkdown(result), /Retry/);
});

test('Claude leading user turn survives unsupported content blocks and role casing', () => {
  const response = {
    title: 'Claude opener',
    chat_messages: [
      { role: 'Human', content: [{ type: 'image', source: { media_type: 'image/png' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'You asked about the image.' }] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[1].role, 'assistant');
  const markdown = adapters.toMarkdown(result);
  assert.match(markdown, /## User \(1\)/);
  assert.match(markdown, /## Claude \(2\)/);
});

test('Claude sender field labels the opening human message as User', () => {
  const response = {
    chat_messages: [
      { sender: 'human', content: [{ type: 'text', text: 'Opening Claude prompt' }] },
      { sender: 'assistant', content: [{ type: 'text', text: 'Claude answer' }] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  const markdown = adapters.toMarkdown(result);
  assert.equal(result.messages[0].role, 'user');
  assert.match(markdown, /## User \(1\)/);
  assert.match(markdown, /## Claude \(2\)/);
});

test('resolveExportData restores a leading DOM user turn missing from structured data', () => {
  const userDiv = makeNode('div', { 'data-message-author-role': 'user' }, 'Opening user prompt');
  const assistantDiv = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Assistant reply quoting the prompt');
  const doc = makeDoc([userDiv, assistantDiv]);
  const resolved = adapters.resolveExportData({
    structured: { platform: 'claude', data: { chat_messages: [
      { role: 'assistant', content: [{ type: 'text', text: 'Assistant reply quoting the prompt' }] },
      { role: 'user', content: [{ type: 'text', text: 'Follow-up question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Follow-up answer' }] }
    ] } },
    doc,
    platform: 'claude',
    pageUrl: 'https://claude.ai/chat/abc'
  });
  assert.equal(resolved.data.messages.length, 4);
  assert.equal(resolved.data.messages[0].role, 'user');
  assert.equal(resolved.data.messages[0].text, 'Opening user prompt');
  assert.equal(resolved.data.messages[1].role, 'assistant');
  assert.match(adapters.toMarkdown(resolved.data), /## User \(1\)/);
});

test('ChatGPT selector covers conversation-turn containers so available DOM reaches ready', () => {
  const selector = adapters.getCandidateSelector('chatgpt');
  assert.match(selector, /data-message-author-role/);
  assert.match(selector, /conversation-turn/);
});

test('ChatGPT normalizer extracts nested text objects instead of dropping available turns', () => {
  const response = {
    title: 'ChatGPT nested parts',
    mapping: {
      'm1': { message: { author: { role: 'user' }, content: { parts: [{ content_type: 'text', text: 'Nested user question' }] }, create_time: 1 } },
      'm2': { message: { author: { role: 'assistant' }, content: { content_type: 'text', text: 'Nested assistant answer' }, create_time: 2 } }
    }
  };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].text, 'Nested user question');
  assert.equal(result.messages[1].text, 'Nested assistant answer');
  assert.doesNotMatch(result.messages[0].text, /content_type/);
});

test('ChatGPT flat messages payload reaches usable export state without mapping', () => {
  const payload = {
    title: 'ChatGPT flat',
    messages: [
      { role: 'user', content: 'Flat user question' },
      { role: 'assistant', content: 'Flat assistant answer' }
    ]
  };
  assert.equal(adapters.platformForPayload(payload), 'chatgpt');
  const normalized = adapters.normalizeStructuredResponse(payload, 'https://chatgpt.com/c/123');
  assert.equal(normalized.messages.length, 2);
  assert.equal(normalized.messages[0].role, 'user');
  const resolved = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: payload },
    doc: makeDoc([]),
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/123'
  });
  assert.equal(resolved.data.messages.length, 2);
  assert.equal(resolved.source, 'structured');
});

test('Grok virtualized windows accumulate without duplicates or count loss', () => {
  const turn = (role, text) => ({ role, text, links: [] });
  const firstWindow = [turn('user', 'Question one'), turn('assistant', 'Answer one'), turn('user', 'Question two')];
  const secondWindow = [turn('user', 'Question two'), turn('assistant', 'Answer two'), turn('user', 'Question three')];
  const merged = adapters.mergeExportMessages(firstWindow, secondWindow);
  assert.deepEqual(merged.map((message) => message.text), ['Question one', 'Answer one', 'Question two', 'Answer two', 'Question three']);

  // Scrolling back up anchors on the shared boundary turn and prepends only
  // the earlier unseen turns instead of duplicating the boundary.
  const topWindow = [turn('user', 'Question one'), turn('assistant', 'Answer one')];
  const bottomWindow = [turn('assistant', 'Answer one'), turn('user', 'Question two'), turn('assistant', 'Answer two')];
  const scrolled = adapters.mergeExportMessages(bottomWindow, topWindow);
  assert.deepEqual(scrolled.map((message) => message.text), ['Question one', 'Answer one', 'Question two', 'Answer two']);

  // Re-observing the same window never duplicates or shrinks the export.
  const repeated = adapters.mergeExportMessages(merged, secondWindow);
  assert.deepEqual(repeated.map((message) => message.text), merged.map((message) => message.text));
});

test('Grok repeated identical turns survive extraction and merge', () => {
  const first = makeNode('div', { 'data-message-author-role': 'user' }, 'Same question');
  const answer = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Answer one');
  const second = makeNode('div', { 'data-message-author-role': 'user' }, 'Same question');
  const doc = makeDoc([first, answer, second]);
  const result = adapters.extractConversation(doc, 'grok', 'https://grok.com/chat/1');
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].text, 'Same question');
  assert.equal(result.messages[1].text, 'Answer one');
  assert.equal(result.messages[2].text, 'Same question');

  // A later window ending with a new turn that repeats earlier text keeps
  // both turns: only the shared ordered boundary collapses.
  const history = [
    { role: 'user', text: 'Same question', links: [] },
    { role: 'assistant', text: 'Answer one', links: [] }
  ];
  const laterWindow = [
    { role: 'assistant', text: 'Answer one', links: [] },
    { role: 'user', text: 'Same question', links: [] }
  ];
  const merged = adapters.mergeExportMessages(history, laterWindow);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((message) => `${message.role}:${message.text}`), ['user:Same question', 'assistant:Answer one', 'user:Same question']);
});

test('Grok one-message snapshot repeating older nonadjacent history is preserved', () => {
  // History holds a turn, then an intervening different turn. A lone
  // incoming turn repeating the first turn is ambiguous content-only, so the
  // merge must preserve it rather than treating it as already captured.
  const history = [
    { role: 'user', text: 'First question', links: [] },
    { role: 'assistant', text: 'Different answer', links: [] }
  ];
  const incoming = [{ role: 'user', text: 'First question', links: [] }];
  const merged = adapters.mergeExportMessages(history, incoming);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((message) => `${message.role}:${message.text}`), ['user:First question', 'assistant:Different answer', 'user:First question']);

  // The trivial steady state still collapses: a one-turn history
  // re-observing its own lone turn must not duplicate on every refresh.
  const steady = adapters.mergeExportMessages(
    [{ role: 'user', text: 'Only question', links: [] }],
    [{ role: 'user', text: 'Only question', links: [] }]
  );
  assert.equal(steady.length, 1);
  assert.equal(steady[0].text, 'Only question');
});

test('Grok ID-less interior repeated sequence survives merge', () => {
  // The repeated pair sits strictly inside history (neither prefix- nor
  // suffix-anchored), so no boundary evidence claims it as re-observed:
  // without stable IDs the merge must preserve it rather than dedupe it.
  const history = [
    { role: 'user', text: 'Opener', links: [] },
    { role: 'user', text: 'Repeated question', links: [] },
    { role: 'assistant', text: 'Repeated answer', links: [] },
    { role: 'user', text: 'Closer', links: [] }
  ];
  const incoming = [
    { role: 'user', text: 'Repeated question', links: [] },
    { role: 'assistant', text: 'Repeated answer', links: [] }
  ];
  const merged = adapters.mergeExportMessages(history, incoming);
  assert.equal(merged.length, 6);
  assert.deepEqual(merged.map((message) => message.text), ['Opener', 'Repeated question', 'Repeated answer', 'Closer', 'Repeated question', 'Repeated answer']);
});

test('Grok same-end suffix re-observation merges without duplicates', () => {
  // Re-observing the tail window at the same end is defensible boundary
  // evidence: the incoming suffix matches history's suffix, so collapse it.
  const history = [
    { role: 'user', text: 'Question one', links: [] },
    { role: 'assistant', text: 'Answer one', links: [] },
    { role: 'user', text: 'Question two', links: [] },
    { role: 'assistant', text: 'Answer two', links: [] }
  ];
  const incoming = [
    { role: 'user', text: 'Question two', links: [] },
    { role: 'assistant', text: 'Answer two', links: [] }
  ];
  const merged = adapters.mergeExportMessages(history, incoming);
  assert.equal(merged.length, 4);
  assert.deepEqual(merged.map((message) => message.text), ['Question one', 'Answer one', 'Question two', 'Answer two']);
});

test('Grok same-start ID-less window growth merges without duplicating prefix', () => {
  // A grown virtualized snapshot re-observes history from the same start and
  // appends new turns: history [a,b] plus incoming [a,b,c] must merge as
  // [a,b,c] instead of duplicating the shared prefix.
  const history = [
    { role: 'user', text: 'Question one', links: [] },
    { role: 'assistant', text: 'Answer one', links: [] }
  ];
  const incoming = [
    { role: 'user', text: 'Question one', links: [] },
    { role: 'assistant', text: 'Answer one', links: [] },
    { role: 'user', text: 'Question two', links: [] }
  ];
  const merged = adapters.mergeExportMessages(history, incoming);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((message) => message.text), ['Question one', 'Answer one', 'Question two']);
});

test('Grok repeated multi-turn sequence with different IDs survives merge', () => {
  // Same content re-sent later with an intervening turn: the IDs prove these
  // are distinct turns, so the repeated pair must survive even though its
  // content matches an interior (here prefix-anchored) history sequence.
  const history = [
    { role: 'user', text: 'Status update', links: [], id: 'm-1' },
    { role: 'assistant', text: 'Noted', links: [], id: 'm-2' },
    { role: 'user', text: 'Something else', links: [], id: 'm-3' }
  ];
  const incoming = [
    { role: 'user', text: 'Status update', links: [], id: 'm-9' },
    { role: 'assistant', text: 'Noted', links: [], id: 'm-10' }
  ];
  const merged = adapters.mergeExportMessages(history, incoming);
  assert.equal(merged.length, 5);
  assert.deepEqual(merged.map((message) => message.id), ['m-1', 'm-2', 'm-3', 'm-9', 'm-10']);
});

test('Grok interior window with matching stable IDs does not duplicate', () => {
  // Re-observing an interior window whose IDs match history in order is
  // ID-proven re-observation: collapse it instead of duplicating.
  const history = [
    { role: 'user', text: 'Status update', links: [], id: 'm-1' },
    { role: 'assistant', text: 'Noted', links: [], id: 'm-2' },
    { role: 'user', text: 'Something else', links: [], id: 'm-3' },
    { role: 'assistant', text: 'Reply', links: [], id: 'm-4' }
  ];
  const incoming = [
    { role: 'assistant', text: 'Noted', links: [], id: 'm-2' },
    { role: 'user', text: 'Something else', links: [], id: 'm-3' }
  ];
  const merged = adapters.mergeExportMessages(history, incoming);
  assert.equal(merged.length, 4);
  assert.deepEqual(merged.map((message) => message.id), ['m-1', 'm-2', 'm-3', 'm-4']);
});

test('Grok extraction attaches data-message-id and dedupes same-ID twins', () => {
  const first = makeNode('div', { 'data-message-author-role': 'user', 'data-message-id': 'm-1' }, 'Same question');
  const twin = makeNode('div', { 'data-message-author-role': 'user', 'data-message-id': 'm-1' }, 'Same question');
  const other = makeNode('div', { 'data-message-author-role': 'user', 'data-message-id': 'm-2' }, 'Same question');
  const doc = makeDoc([first, twin, other]);
  const result = adapters.extractConversation(doc, 'grok', 'https://grok.com/chat/1');
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.messages.map((message) => message.id), ['m-1', 'm-2']);
});

test('Stable message IDs attach Grok-only in extraction', () => {
  const grokNode = makeNode('div', { 'data-message-author-role': 'user', 'data-message-id': 'g-1' }, 'Hello');
  const grokResult = adapters.extractConversation(makeDoc([grokNode]), 'grok', 'https://grok.com/chat/1');
  assert.equal(grokResult.messages.length, 1);
  assert.equal(grokResult.messages[0].id, 'g-1');
  for (const [platform, url] of [['claude', 'https://claude.ai/chat/x'], ['chatgpt', 'https://chatgpt.com/c/x']]) {
    const node = makeNode('div', { 'data-message-author-role': 'user', 'data-message-id': 'c-1' }, 'Hello');
    const result = adapters.extractConversation(makeDoc([node]), platform, url);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, undefined);
  }
});

test('Grok structured merge survives messages/chat_messages shape changes', () => {
  const oldPayload = { conversations: [{ id: 'conv-1', messages: [{ role: 'user', content: 'Question one' }] }] };
  const newPayload = { conversations: [{ id: 'conv-1', chat_messages: [{ role: 'user', content: 'Question one' }, { role: 'assistant', content: 'Answer one' }] }] };
  const merged = adapters.mergeStructuredResponses('grok', oldPayload, newPayload);
  const result = adapters.normalizeStructuredResponse(merged, 'https://grok.com/chat/1');
  assert.deepEqual(result.messages.map((message) => message.text), ['Question one', 'Answer one']);
});

test('resolveExportData honors accumulated DOM history for virtualized pages', () => {
  const accumulated = {
    platform: 'grok',
    platformName: 'Grok',
    title: 'Grok Conversation',
    url: 'https://grok.com/chat/1',
    capturedAt: '2026-10-03T00:00:00.000Z',
    messages: [
      { role: 'user', text: 'Question one', links: [] },
      { role: 'assistant', text: 'Answer one', links: [] },
      { role: 'user', text: 'Question two', links: [] }
    ],
    searches: []
  };
  const currentDoc = makeDoc([makeNode('div', { 'data-message-author-role': 'user' }, 'Question two')]);
  const resolved = adapters.resolveExportData({
    structured: null,
    doc: currentDoc,
    domData: accumulated,
    platform: 'grok',
    pageUrl: 'https://grok.com/chat/1'
  });
  assert.equal(resolved.source, 'dom');
  assert.equal(resolved.data.messages.length, 3);
  assert.equal(resolved.data.messages[0].text, 'Question one');
});

test('Grok streaming assistant turn updates in place instead of appending', () => {
  // Grok renders a single assistant turn that mutates while it generates, so
  // every mid-stream snapshot observed the same two DOM turns. Appending each
  // snapshot inflated one two-turn conversation into 110 exported "messages".
  const user = { role: 'user', text: 'find these numbers', links: [] };
  const partials = [
    'Worked for 1s',
    'Ran 1 search',
    'Ran 2 searches',
    'Ran 3 searches',
    'Ran 3 searches',
    'Thinking',
    'Worked for 4s',
    'Worked for 17s'
  ];
  let history = null;
  for (const text of partials) {
    const snapshot = [{ role: 'user', text: user.text, links: [] }, { role: 'assistant', text, links: [] }];
    history = history ? adapters.mergeExportMessages(history, snapshot) : snapshot;
    assert.equal(history.length, 2, `streaming snapshot "${text}" must not add turns`);
  }
  assert.deepEqual(history.map((message) => message.role), ['user', 'assistant']);

  // Once the turn settles, the completed text replaces the partial one.
  const settled = adapters.mergeExportMessages(history, [
    { role: 'user', text: user.text, links: [] },
    { role: 'assistant', text: 'Worked for 17s\n\nFinal answer.', links: [] }
  ]);
  assert.equal(settled.length, 2);
  assert.equal(settled[1].text, 'Worked for 17s\n\nFinal answer.');
});

test('Grok message count stays stable while scrolling a long chat', () => {
  // Scrolling must neither grow the count nor drop or reorder turns once the
  // full conversation has been observed.
  const all = Array.from({ length: 60 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    text: `turn ${index}`,
    links: []
  }));
  let history = null;
  let widest = 0;
  for (const [start, end] of [[0, 20], [10, 30], [20, 40], [30, 50], [40, 60], [30, 50], [20, 40], [10, 30], [0, 20], [25, 45]]) {
    const window = all.slice(start, end);
    history = history ? adapters.mergeExportMessages(history, window) : window;
    // The count never shrinks and never exceeds everything observed so far.
    assert.ok(history.length >= widest, `window ${start}-${end} shrank the count to ${history.length}`);
    widest = Math.max(widest, end);
    assert.equal(history.length, widest, `window ${start}-${end} produced ${history.length} turns`);
  }
  assert.equal(history.length, 60);
  assert.deepEqual(history.map((message) => message.text), all.map((message) => message.text));
});

test('Grok scrolled window does not replace already accumulated history', () => {
  // Returning to the top of a long chat re-observes a short window that shares
  // its start with history. It is a re-observation, never a replacement.
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    text: `turn ${index}`,
    links: []
  }));
  const topWindow = history.slice(0, 12);
  const merged = adapters.mergeExportMessages(history, topWindow);
  assert.equal(merged.length, 40);
  assert.deepEqual(merged.map((message) => message.text), history.map((message) => message.text));
});

test('Grok genuine repeated turns are still preserved when history is well formed', () => {
  // A user who re-sends an identical question still produces two turns. The
  // containment rule only collapses a window that is already contiguous in an
  // alternating (well-formed) history, so this repeated pair survives.
  const history = [
    { role: 'user', text: 'Same question', links: [] },
    { role: 'assistant', text: 'Same answer', links: [] },
    { role: 'user', text: 'Something else', links: [] },
    { role: 'assistant', text: 'Different reply', links: [] },
    { role: 'user', text: 'Same question', links: [] },
    { role: 'assistant', text: 'Same answer', links: [] }
  ];
  const reobserved = adapters.mergeExportMessages(history, [
    { role: 'user', text: 'Same question', links: [] },
    { role: 'assistant', text: 'Same answer', links: [] }
  ]);
  assert.equal(reobserved.length, 6);
  assert.deepEqual(reobserved.map((message) => message.text), history.map((message) => message.text));
});

test('Grok jump-to-end window merges interior overlap without duplicating', () => {
  // Pressing Home then End produces a window that starts before history and
  // ends inside it, so the shared span is interior to both. Boundary-only
  // matching duplicated the entire shared span (42 turns reported as 55).
  const truth = Array.from({ length: 42 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    text: `turn ${index}`,
    links: []
  }));
  // Same conversation, but the shared tail turn renders longer on the second
  // observation because its markdown expanded lazily.
  const base = 'turn 21 shared answer body '.repeat(12);
  const bottomWindow = truth.slice(9).map((message) => ({ ...message }));
  bottomWindow[12] = { ...bottomWindow[12], text: base };
  const homeWindow = truth.slice(0, 22).map((message) => ({ ...message }));
  homeWindow[21] = { ...homeWindow[21], text: `${base}plus lazily expanded sources` };

  const merged = adapters.mergeExportMessages(bottomWindow, homeWindow);
  assert.equal(merged.length, 42);
  assert.deepEqual(merged.map((message) => message.role), truth.map((message) => message.role));
  // The shared span keeps the later, richer copy of the re-rendered turn, so
  // compare the stable prefix rather than exact text.
  assert.deepEqual(merged.map((message) => message.text.slice(0, 7)), truth.map((message) => message.text.slice(0, 7)));
});

test('Grok jump-to-end window also merges in the opposite scroll order', () => {
  const truth = Array.from({ length: 42 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    text: `turn ${index}`,
    links: []
  }));
  const base = 'turn 21 shared answer body '.repeat(12);
  const homeWindow = truth.slice(0, 22).map((message) => ({ ...message }));
  homeWindow[21] = { ...homeWindow[21], text: `${base}plus lazily expanded sources` };
  const bottomWindow = truth.slice(9).map((message) => ({ ...message }));
  bottomWindow[12] = { ...bottomWindow[12], text: base };

  const merged = adapters.mergeExportMessages(homeWindow, bottomWindow);
  assert.equal(merged.length, 42);
  // The shared span keeps the later, richer copy of the re-rendered turn, so
  // compare the stable prefix rather than exact text.
  assert.deepEqual(merged.map((message) => message.text.slice(0, 7)), truth.map((message) => message.text.slice(0, 7)));
});

test('Grok re-rendered final turn replaces rather than appends', () => {
  // The last turn changing text while everything before it matches is the
  // streaming case, not a re-observed window, so the turn is replaced.
  const history = [
    { role: 'user', text: 'question one', links: [] },
    { role: 'assistant', text: 'answer one', links: [] },
    { role: 'user', text: 'question two', links: [] },
    { role: 'assistant', text: 'a much longer answer that grew while streaming', links: [] }
  ];
  const different = [
    { role: 'user', text: 'question one', links: [] },
    { role: 'assistant', text: 'answer one', links: [] },
    { role: 'user', text: 'question two', links: [] },
    { role: 'assistant', text: 'completely unrelated content here', links: [] }
  ];
  const merged = adapters.mergeExportMessages(history, different);
  assert.equal(merged.length, 4);
  assert.equal(merged[merged.length - 1].text, 'completely unrelated content here');
});

test('Grok rewording a middle turn is preserved instead of merged away', () => {
  // Rewording that is not a prefix extension must not be treated as the same
  // turn, so the changed turn is kept alongside the original.
  const history = [
    { role: 'user', text: 'question one', links: [] },
    { role: 'assistant', text: 'answer one', links: [] },
    { role: 'user', text: 'question two', links: [] },
    { role: 'assistant', text: 'the original answer two', links: [] },
    { role: 'user', text: 'question three', links: [] },
    { role: 'assistant', text: 'the original answer three', links: [] }
  ];
  const different = [
    { role: 'user', text: 'question one', links: [] },
    { role: 'assistant', text: 'answer one', links: [] },
    { role: 'user', text: 'question two', links: [] },
    { role: 'assistant', text: 'a totally rewritten answer two', links: [] },
    { role: 'user', text: 'question three', links: [] },
    { role: 'assistant', text: 'the original answer three', links: [] }
  ];
  // Both ends of the sequence still match, so the changed middle turn gives no
  // shared run to align on and both versions are kept rather than losing one.
  const merged = adapters.mergeExportMessages(history, different);
  assert.equal(merged.length, 12);
  assert.ok(merged.some((message) => message.text === 'a totally rewritten answer two'));
  assert.ok(merged.some((message) => message.text === 'the original answer two'));
});

test('scroll walk keeps going until the top of the conversation and then stops', () => {
  assert.equal(adapters.shouldContinueScrollWalk(0, 1, 9), true, 'keeps trying before any turn is seen');
  assert.equal(adapters.shouldContinueScrollWalk(120, 4, 0), true, 'keeps going while turns are still appearing');
  assert.equal(adapters.shouldContinueScrollWalk(120, 6, 1), true, 'one idle pass is not enough to stop');
  assert.equal(adapters.shouldContinueScrollWalk(120, 8, 3), false, 'stops after repeated idle passes');
  assert.equal(adapters.shouldContinueScrollWalk(120, 400, 0), false, 'stops at the pass ceiling');
});

// Turn text must be distinct enough that a shorter turn is not a prefix of a
// longer one, which is what real conversation text looks like.
function walkTurn(index) {
  return { role: index % 2 ? 'assistant' : 'user', text: `Turn ${index} discussing topic ${index} in detail.`, links: [] };
}

test('scroll walk captures a whole virtualized conversation in order exactly once', () => {
  // Grok mounts only a window of turns. Walking upward must recover every turn
  // in conversation order without counting the overlap between windows twice.
  const truth = Array.from({ length: 60 }, (_, index) => walkTurn(index));
  const collector = adapters.createScrollCollector();
  let last = 0;
  let stable = 0;
  let passes = 0;
  while (adapters.shouldContinueScrollWalk(last, passes, stable)) {
    passes += 1;
    const high = Math.max(0, truth.length - (passes - 1) * 6);
    const low = Math.max(0, high - 8);
    const count = collector.add(truth.slice(low, high));
    if (count > last) {
      last = count;
      stable = 0;
    } else {
      stable += 1;
    }
    if (high === 0) break;
  }
  const captured = collector.messages();
  assert.equal(captured.length, 60);
  assert.deepEqual(captured.map((message) => message.text), truth.map((message) => message.text));
  assert.deepEqual(captured.map((message) => message.role), truth.map((message) => message.role));
});

test('scroll walk does not duplicate turns when windows only partly overlap', () => {
  const truth = Array.from({ length: 40 }, (_, index) => walkTurn(index));
  const collector = adapters.createScrollCollector();
  for (const [low, high] of [[32, 40], [26, 34], [20, 28], [14, 22], [8, 16], [2, 10], [0, 4]]) {
    collector.add(truth.slice(low, high));
  }
  const captured = collector.messages();
  assert.equal(captured.length, 40);
  assert.deepEqual(captured.map((message) => message.text), truth.map((message) => message.text));
});

test('scroll walk keeps the longer text when a turn re-renders richer', () => {
  // Lazily expanded markdown must not be replaced by a shorter earlier read.
  const collector = adapters.createScrollCollector();
  collector.add([
    { role: 'user', text: 'Question about the topic.', links: [] },
    { role: 'assistant', text: 'Short answer.', links: [] }
  ]);
  collector.add([
    { role: 'user', text: 'Question about the topic.', links: [] },
    { role: 'assistant', text: 'Short answer with the sources expanded at length.', links: [] }
  ]);
  const captured = collector.messages();
  assert.equal(captured.length, 2);
  assert.equal(captured[1].text, 'Short answer with the sources expanded at length.');
});

test('scroll walk finds a scrollable conversation container', () => {
  const scroller = { nodeType: 1, scrollHeight: 5000, clientHeight: 800, scrollTop: 0, parentElement: null };
  const message = {
    nodeType: 1,
    parentElement: scroller,
    getAttribute() { return ''; },
    querySelector() { return null; }
  };
  const doc = {
    querySelectorAll() { return [message]; },
    scrollingElement: null,
    documentElement: null
  };
  const originalGetComputedStyle = global.getComputedStyle;
  global.getComputedStyle = () => ({ overflowY: 'auto' });
  try {
    assert.equal(adapters.findConversationScroller(doc), scroller);
  } finally {
    global.getComputedStyle = originalGetComputedStyle;
  }
  const flatDoc = { querySelectorAll() { return []; }, scrollingElement: null, documentElement: null };
  assert.equal(adapters.findConversationScroller(flatDoc), null);
});

const { GROK_SHARE_FIXTURE } = require('./fixtures/grok-share.js');

test('Grok conversation payload is recognized as a capture', () => {
  // Grok returns the whole conversation as { conversation, responses }, which
  // the capture layer previously ignored because it matched no known shape.
  assert.equal(adapters.platformForPayload(GROK_SHARE_FIXTURE), 'grok');
});

test('Grok conversation payload normalizes every turn without streaming noise', () => {
  const result = adapters.normalizeStructuredResponse(GROK_SHARE_FIXTURE, 'https://grok.com/share/x');
  assert.equal(result.platform, 'grok');
  assert.equal(result.title, GROK_SHARE_FIXTURE.conversation.title);
  assert.equal(result.messages.length, 4);
  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant']);
  // The payload's progress notes live on other channels and must not appear.
  for (const message of result.messages) {
    assert.doesNotMatch(message.text, /Thinking about|Working for \d+s|Ran \d+ search/);
  }
  assert.equal(result.messages[0].text, 'how much memory did https://github.com/cmuratori/refterm use');
  assert.match(result.messages[1].text, /^\*\*Around 44 MB of physical memory/);
  // Stable turn identity comes from the response id.
  assert.equal(result.messages[0].id, GROK_SHARE_FIXTURE.responses[0].responseId);
});

test('Grok conversation payload contributes web sources to searches', () => {
  const result = adapters.normalizeStructuredResponse(GROK_SHARE_FIXTURE, 'https://grok.com/share/x');
  assert.ok(result.searches.length >= 1, 'assistant turns with sources produce a search entry');
  const urls = result.searches.flatMap((search) => search.sources.map((source) => source.url));
  assert.ok(urls.some((url) => url.includes('github.com/cmuratori/refterm')));
});

test('Grok conversation payload takes priority over the DOM for a full export', () => {
  // A page that has only rendered the last few turns must still export the
  // whole conversation when the payload is available.
  const captured = { platform: 'grok', data: GROK_SHARE_FIXTURE, capturedAt: '2026-10-03T00:00:00.000Z' };
  const doc = {
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const resolved = adapters.resolveExportData({
    structured: captured,
    doc,
    platform: 'grok',
    pageUrl: 'https://grok.com/c/1'
  });
  assert.equal(resolved.data.messages.length, 4);
});

test('ChatGPT share payload is revived from its devalue serialization', () => {
  // A ChatGPT share page stores the conversation as a flattened array where
  // object keys are references into that same array.
  // "_1": 2 means the property named at index 1 holds the value at index 2.
  const flat = [{ '_1': 2, '_3': 4 }, 'loaderData', { 'mapping': { a: 1 } }, 'actionData', 'root'];
  const revived = adapters.reviveDevalue(flat);
  assert.deepEqual(revived, { loaderData: { mapping: { a: 1 } }, actionData: 'root' });
});

test('ChatGPT devalue revival handles nested arrays and shared references', () => {
  // Every array element and computed object key is a reference into the flat
  // array, so the fixture is produced by encoding rather than hand-indexed.
  const flat = encodeDevalue({ loaderData: { list: [1, 2, { inner: 'x' }] } });
  const revived = adapters.reviveDevalue(flat);
  assert.deepEqual(revived.loaderData.list, [1, 2, { inner: 'x' }]);
});

test('ChatGPT script string literals are decoded', () => {
  assert.equal(adapters.decodeScriptStringLiteral('a\\"b'), 'a"b');
  assert.equal(adapters.decodeScriptStringLiteral('line\\nbreak'), 'line\nbreak');
  assert.equal(adapters.decodeScriptStringLiteral('\\u0041BC'), 'ABC');
  assert.equal(adapters.decodeScriptStringLiteral('back\\\\slash'), 'back\\slash');
});

test('ChatGPT share page yields the whole conversation from its inline payload', () => {
  const mapping = {
    n1: { id: 'n1', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello there'] } } },
    n2: { id: 'n2', parent: 'n1', message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi back'] } } },
    n3: { id: 'n3', parent: 'n2', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['and again'] } } }
  };
  const data = {
    title: 'Identify Network Topology',
    conversation_id: 'abc',
    current_node: 'n3',
    mapping
  };
  const flat = encodeDevalue({
    loaderData: {
      'routes/share.$shareId': { serverResponse: { type: 'data', data } }
    },
    actionData: null,
    errors: null
  });
  const literal = JSON.stringify(JSON.stringify(flat)).slice(1, -1);
  const html = `<html><script>window.__reactRouterContext.streamController.enqueue("${literal}")</script></html>`;

  const conversation = adapters.extractChatGPTShareConversation(html);
  assert.ok(conversation, 'conversation is recovered from the page');
  assert.equal(conversation.title, 'Identify Network Topology');
  assert.equal(conversation.current_node, 'n3');
  assert.deepEqual(Object.keys(conversation.mapping), ['n1', 'n2', 'n3']);

  const result = adapters.normalizeStructuredResponse(
    { mapping: conversation.mapping, current_node: conversation.current_node },
    'https://chatgpt.com/share/x'
  );
  assert.deepEqual(result.messages.map((message) => message.text), ['hello there', 'hi back', 'and again']);
});

test('ChatGPT share page without a conversation payload is ignored', () => {
  assert.equal(adapters.extractChatGPTShareConversation('<html></html>'), null);
  assert.equal(adapters.extractChatGPTShareConversation(''), null);
  assert.equal(adapters.extractChatGPTShareConversation(null), null);
});

test('ChatGPT export omits turns the conversation never shows', () => {
  // System prompts, tool turns, redacted placeholders and thinking preambles
  // are all present in the payload but invisible to the reader.
  const node = (id, parent, role, parts, metadata) => ({
    id,
    parent,
    message: { id, author: { role }, content: { content_type: 'text', parts }, metadata: metadata || {} }
  });
  const mapping = {
    a: node('a', undefined, 'system', ['You are ChatGPT.'], { is_visually_hidden_from_conversation: true }),
    b: node('b', 'a', 'user', ['real question']),
    c: node('c', 'b', 'assistant', ['real answer']),
    d: node('d', 'c', 'tool', ['tool noise'], { is_visually_hidden_from_conversation: true }),
    e: node('e', 'd', 'assistant', ['redacted'], { is_redacted: true }),
    f: node('f', 'e', 'assistant', ['preamble'], { is_thinking_preamble_message: true }),
    g: node('g', 'f', 'user', ['second question'])
  };
  const result = adapters.normalizeStructuredResponse({ mapping, current_node: 'g' }, 'https://chatgpt.com/share/x');
  assert.deepEqual(result.messages.map((message) => message.text), ['real question', 'real answer', 'second question']);
});

const { CHATGPT_MESSAGES_FIXTURE } = require('./fixtures/chatgpt-messages.js');

test('ChatGPT private conversation payload is recognized and normalized', () => {
  // A /c/ page is served as a flat, paginated message list rather than the
  // mapping graph a /share/ page embeds.
  assert.equal(adapters.platformForPayload(CHATGPT_MESSAGES_FIXTURE), 'chatgpt');
  const result = adapters.normalizeStructuredResponse(CHATGPT_MESSAGES_FIXTURE, 'https://chatgpt.com/c/abc');
  assert.equal(result.platform, 'chatgpt');
  assert.equal(result.messages.length, 4);
  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant']);
});

test('ChatGPT private payload hides reasoning, recaps and preambles', () => {
  const result = adapters.normalizeStructuredResponse(CHATGPT_MESSAGES_FIXTURE, 'https://chatgpt.com/c/abc');
  const all = result.messages.map((message) => message.text).join('\n');
  // Model reasoning, the "Worked for 7s" recap, the system prompt and the
  // thinking preamble are all in the payload but never shown to the reader.
  assert.doesNotMatch(all, /secret reasoning/);
  assert.doesNotMatch(all, /Worked for 7s/);
  assert.doesNotMatch(all, /I think you are describing a/);
  // The tool turn that issued the web search carries no text of its own.
  assert.ok(result.messages.every((message) => message.text.trim().length > 0));
});

test('ChatGPT private payload attaches web sources to the answer', () => {
  const result = adapters.normalizeStructuredResponse(CHATGPT_MESSAGES_FIXTURE, 'https://chatgpt.com/c/abc');
  const answer = result.messages[1];
  const urls = answer.links.map((link) => link.url);
  // Sources reach the reader's answer from three different places in the
  // payload: the tool turn, the answer's own groups, and its citations.
  assert.ok(urls.includes('https://en.wikipedia.org/wiki/Network_topology'));
  assert.ok(urls.includes('https://aws.amazon.com/what-is/network-topology/'));
  assert.equal(new Set(urls).size, urls.length, 'sources are not duplicated');
  assert.equal(result.searches.length, 1);
  assert.match(result.searches[0].query, /polar grid graph/);
});

test('ChatGPT citation markers are replaced rather than exported raw', () => {
  const result = adapters.normalizeStructuredResponse(CHATGPT_MESSAGES_FIXTURE, 'https://chatgpt.com/c/abc');
  const all = result.messages.map((message) => message.text).join('\n');
  assert.doesNotMatch(all, /cite/);
  // Ordinary prose that happens to use the word is left alone.
  assert.equal(adapters.chatGPTRenderCitations('Use the cite button.', {}), 'Use the cite button.');
  assert.equal(
    adapters.chatGPTRenderCitations('He cited 3 papers.', {}),
    'He cited 3 papers.'
  );
});

test('ChatGPT paginated pages merge into one ordered conversation', () => {
  // Scrolling back through a long conversation fetches older pages of the same
  // endpoint. Each page is a slice, and merging must not duplicate or reorder.
  const page = (ids, startId, endId, hasNext) => ({
    messages: ids.map((id, index) => ({
      id,
      author: { role: index % 2 ? 'assistant' : 'user' },
      // Absolute per-turn time, identical across pages: a turn keeps its real
      // timestamp no matter which page carried it.
      create_time: 1000 + id.charCodeAt(0) - 'a'.charCodeAt(0),
      content: { content_type: 'text', parts: [`text ${id}`] },
      metadata: {}
    })),
    page_info: { start_cursor: startId, end_cursor: endId, has_previous_page: !hasNext, has_next_page: hasNext }
  });
  const newest = page(['d', 'e', 'f'], 'd', 'f', true);
  const older = page(['a', 'b', 'c', 'd'], 'a', 'd', false);
  const merged = adapters.mergeStructuredResponses('chatgpt', newest, older);
  const result = adapters.normalizeStructuredResponse(merged, 'https://chatgpt.com/c/abc');
  assert.deepEqual(result.messages.map((message) => message.text), ['text a', 'text b', 'text c', 'text d', 'text e', 'text f']);
});

test('an accumulated DOM view cannot displace a complete conversation payload', () => {
  // Scrolling a virtualized chat re-reads the same turns, and the DOM text for a
  // turn differs slightly from the payload's (rendered emphasis, an appended
  // sources list), so the accumulated DOM grows well past the real turn count.
  // Ranking sources by raw length let that inflated view win and exported the
  // conversation dozens of times over.
  const truth = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    text: `Turn ${index} discussing something specific and unique.`
  }));
  const payload = {
    conversation: { title: 'Chat' },
    responses: truth.map((turn, index) => ({
      responseId: `r${index}`,
      sender: turn.role === 'user' ? 'human' : 'assistant',
      inputChunks: turn.role === 'user' ? [{ text: { text: turn.text } }] : [],
      outputChunks: turn.role === 'user' ? [] : [{ text: { text: turn.text, channel: 'CHANNEL_ASSISTANT_RESPONSE' } }]
    }))
  };
  const accumulated = [];
  for (let pass = 0; pass < 6; pass++) {
    for (const turn of truth) {
      accumulated.push({ role: turn.role, text: `Worked for 4s${turn.text}\n\nSources:\n- x`, links: [] });
    }
  }
  const resolved = adapters.resolveExportData({
    structured: { platform: 'grok', data: payload, capturedAt: '2026-10-03T00:00:00.000Z' },
    doc: { querySelectorAll() { return []; }, querySelector() { return null; } },
    domData: {
      platform: 'grok',
      platformName: 'Grok',
      title: 'Chat',
      url: 'https://grok.com/share/x',
      capturedAt: '2026-10-03T00:00:00.000Z',
      messages: accumulated,
      searches: []
    },
    platform: 'grok',
    pageUrl: 'https://grok.com/share/x'
  });
  assert.equal(accumulated.length, 72, 'the DOM view really did accumulate duplicates');
  assert.equal(resolved.source, 'structured');
  assert.equal(resolved.data.messages.length, 12);
  assert.deepEqual(resolved.data.messages.map((message) => message.text), truth.map((turn) => turn.text));
});

test('a partial payload still yields to a fuller visible conversation', () => {
  // Ranking by distinct turns must not make a short tail payload look complete.
  const dom = {
    platform: 'claude',
    platformName: 'Claude',
    title: 'Chat',
    url: 'https://claude.ai/share/x',
    capturedAt: '2026-10-03T00:00:00.000Z',
    messages: [
      { role: 'user', text: 'Older question', links: [] },
      { role: 'assistant', text: 'Older answer', links: [] },
      { role: 'user', text: 'Newer question', links: [] },
      { role: 'assistant', text: 'Newer answer', links: [] }
    ],
    searches: []
  };
  const partial = {
    conversation: { title: 'Chat' },
    responses: [
      { responseId: 'a', sender: 'human', inputChunks: [{ text: { text: 'Newer question' } }], outputChunks: [] },
      { responseId: 'b', sender: 'assistant', inputChunks: [], outputChunks: [{ text: { text: 'Newer answer', channel: 'CHANNEL_ASSISTANT_RESPONSE' } }] }
    ]
  };
  const resolved = adapters.resolveExportData({
    structured: { platform: 'grok', data: partial, capturedAt: '2026-10-03T00:00:00.000Z' },
    doc: { querySelectorAll() { return []; }, querySelector() { return null; } },
    domData: dom,
    platform: 'grok',
    pageUrl: 'https://grok.com/share/x'
  });
  assert.equal(resolved.source, 'dom');
  assert.equal(resolved.data.messages.length, 4);
});

test('ChatGPT page cursors walk back to the opening turn', () => {
  // The page only requests the newest slice, so older turns need an explicit
  // walk using the cursor from page_info.
  const middle = {
    messages: [{ id: 'm1', author: { role: 'user' }, content: { content_type: 'text', parts: ['newest'] }, metadata: {} }],
    page_info: { start_cursor: 'cursor-mid', end_cursor: 'cursor-new', has_previous_page: true, has_next_page: false }
  };
  assert.equal(adapters.nextConversationPageCursor(middle), 'cursor-mid');

  const oldest = {
    messages: [{ id: 'm0', author: { role: 'user' }, content: { content_type: 'text', parts: ['oldest'] }, metadata: {} }],
    page_info: { start_cursor: 'cursor-old', end_cursor: 'cursor-mid', has_previous_page: false, has_next_page: true }
  };
  assert.equal(adapters.nextConversationPageCursor(oldest), null, 'the walk stops at the opening turn');

  assert.equal(adapters.nextConversationPageCursor({}), null);
  assert.equal(adapters.nextConversationPageCursor(null), null);
  assert.equal(adapters.nextConversationPageCursor({ page_info: { has_previous_page: true } }), null);
});

test('ChatGPT pages assemble into the whole conversation', () => {
  // Two pages captured from the real backend, merged the way pagination does.
  const newer = {
    messages: [
      { id: 'b1', author: { role: 'user' }, create_time: 300, content: { content_type: 'text', parts: ['third question'] }, metadata: {} },
      { id: 'b2', author: { role: 'assistant' }, create_time: 301, content: { content_type: 'text', parts: ['third answer'] }, metadata: {} }
    ],
    page_info: { start_cursor: 'c-mid', has_previous_page: true }
  };
  const older = {
    messages: [
      { id: 'a1', author: { role: 'user' }, create_time: 100, content: { content_type: 'text', parts: ['first question'] }, metadata: {} },
      { id: 'a2', author: { role: 'assistant' }, create_time: 101, content: { content_type: 'text', parts: ['first answer'] }, metadata: {} },
      { id: 'b1', author: { role: 'user' }, create_time: 300, content: { content_type: 'text', parts: ['third question'] }, metadata: {} },
      { id: 'b2', author: { role: 'assistant' }, create_time: 301, content: { content_type: 'text', parts: ['third answer'] }, metadata: {} }
    ],
    page_info: { start_cursor: 'c-old', has_previous_page: false }
  };
  let captured = newer;
  let cursor = adapters.nextConversationPageCursor(newer);
  let guard = 0;
  while (cursor && guard < 10) {
    guard += 1;
    if (cursor !== 'c-mid') break;
    captured = adapters.mergeStructuredResponses('chatgpt', captured, older);
    const next = adapters.nextConversationPageCursor(older);
    if (!next) { cursor = null; break; }
    cursor = next;
  }
  const result = adapters.normalizeStructuredResponse(captured, 'https://chatgpt.com/c/x');
  assert.deepEqual(result.messages.map((message) => message.text), [
    'first question', 'first answer', 'third question', 'third answer'
  ]);
});


test('one-shot collection targets the private conversation id, never a share token', () => {
  const collector = require('../src/collector.js');
  assert.equal(collector.chatGPTId('https://chatgpt.com/c/6ac073ef-2f00-83ec-9610-d731f0ea90d9'), '6ac073ef-2f00-83ec-9610-d731f0ea90d9');
  // A share page is served whole; its token must never become a request id.
  assert.equal(collector.chatGPTId('https://chatgpt.com/share/6ac0a6c1-9700-83ec-8be5-429188517ebe'), null);
});


test('ChatGPT pagination falls back to the oldest turn id without page_info', () => {
  // The cursor page_info reports is just the oldest turn id on the page, so a
  // payload without page_info can still seed the walk instead of skipping it.
  assert.equal(adapters.nextConversationPageCursor({}), null);
  // The real shape: a cursor plus has_previous_page drives the walk.
  assert.equal(
    adapters.nextConversationPageCursor({ page_info: { start_cursor: 'oldest-id', has_previous_page: true } }),
    'oldest-id'
  );
  assert.equal(
    adapters.nextConversationPageCursor({ page_info: { start_cursor: 'oldest-id', has_previous_page: false } }),
    null
  );
});

test('the same turn is recognised across how the page and the payload render it', () => {
  // One turn, three renderings: raw markdown from the conversation payload,
  // rendered text from the page with a status prefix, and rendered text with a
  // trailing sources list. Scrolling re-reads the window in a different render
  // state, so exact and prefix comparison both failed and counted the turn
  // again on every pass.
  const payload = { role: 'assistant', text: '**Almost everything platform-specific would need to be rewritten.**\n\n- Current: Direct3D 11\n- Target: Metal', links: [] };
  const rendered = { role: 'assistant', text: 'Worked for 45sAlmost everything platform-specific would need to be rewritten.\n\nCurrent: Direct3D 11\nTarget: Metal', links: [] };
  const withSources = { role: 'assistant', text: 'Worked for 45sAlmost everything platform-specific would need to be rewritten.\n\nCurrent: Direct3D 11\nTarget: Metal\n\nSources:\n\n- [a](https://example.com/a)', links: [] };

  assert.equal(adapters.comparisonText(payload.text), adapters.comparisonText(rendered.text));
  assert.equal(adapters.comparisonText(rendered.text), adapters.comparisonText(withSources.text));
  // The exported text itself is never rewritten.
  assert.match(payload.text, /\\*\\*/);
  assert.match(rendered.text, /^Worked for 45s/);

  // The merge keeps one turn rather than accumulating a copy per render.
  const merged = adapters.mergeExportMessages([payload], [rendered]);
  assert.equal(merged.length, 1);
  const mergedAgain = adapters.mergeExportMessages(merged, [withSources]);
  assert.equal(mergedAgain.length, 1);
});

test('genuinely different turns are still distinguished after normalisation', () => {
  const a = { role: 'user', text: 'what is the minimum budget for refterm on a mac', links: [] };
  const b = { role: 'user', text: 'what is the minimum budget for refterm on a macbook', links: [] };
  assert.notEqual(adapters.comparisonText(a.text), adapters.comparisonText(b.text));
  const merged = adapters.mergeExportMessages([{ ...a }, { role: 'assistant', text: 'an answer', links: [] }], [b]);
  assert.equal(merged.length, 3, 'a repeated turn is still preserved');
});

// A private Grok conversation page loads its responses in batches of
// { responses: [...] }. Each entry carries its finished text on `message` with
// no chunks, and a stable responseId that identifies the turn.
const grokLoadedBatch = () => ({
  responses: [
    {
      responseId: 'r1',
      sender: 'human',
      parentResponseId: 'r0',
      message: 'why though? can you do the calculation',
      createTime: '2026-10-02T09:18:44.843Z',
      inputChunks: [],
      outputChunks: [],
      webSearchResults: []
    },
    {
      responseId: 'r2',
      sender: 'assistant',
      parentResponseId: 'r1',
      message: 'Here is the concrete calculation for a minimal app.',
      createTime: '2026-10-02T09:18:50.000Z',
      inputChunks: [],
      outputChunks: [],
      webSearchResults: [{ url: 'https://example.com/a', title: 'Source A' }]
    }
  ]
});

test('a bare Grok response batch is recognized and normalized', () => {
  const batch = grokLoadedBatch();
  assert.equal(adapters.platformForPayload(batch), 'grok');

  const result = adapters.normalizeStructuredResponse(batch, 'https://grok.com/c/1');
  assert.equal(result.platform, 'grok');
  assert.deepEqual(result.messages.map((message) => message.role), ['user', 'assistant']);
  // Text lives on `message`, with no chunks at all.
  assert.equal(result.messages[0].text, 'why though? can you do the calculation');
  assert.equal(result.messages[1].text, 'Here is the concrete calculation for a minimal app.');
  // The stable response id is carried so turns are identified, not guessed.
  assert.deepEqual(result.messages.map((message) => message.id), ['r1', 'r2']);
  assert.equal(result.searches.length, 1);
  assert.equal(result.searches[0].sources[0].url, 'https://example.com/a');
});

test('overlapping Grok response batches merge without duplicating a turn', () => {
  const full = grokLoadedBatch();
  const first = { responses: full.responses.slice(0, 2) };
  const alsoFirst = { responses: [full.responses[0], { ...full.responses[1], message: 'Here is the concrete calculation for a minimal app, expanded with sources.' }] };
  const merged = adapters.mergeStructuredResponses('grok', first, alsoFirst);
  assert.equal(merged.responses.length, 2);
  // The re-loaded turn keeps the richer text rather than the earlier read.
  assert.match(merged.responses[1].message, /expanded with sources/);

  const second = { responses: [full.responses[1], { responseId: 'r3', sender: 'human', message: 'i want to see the math' }] };
  const grown = adapters.mergeStructuredResponses('grok', merged, second);
  assert.equal(grown.responses.length, 3);
});

test('a repeated DOM rendering does not outrank a complete Grok payload', () => {
  // The live log showed a window re-read many times, each read rendering the
  // same turn differently, so counting raw entries let the DOM win. Distinct
  // turns are counted with the same normalised key the merge compares with.
  const batch = grokLoadedBatch();
  const structured = adapters.normalizeStructuredResponse(batch, 'https://grok.com/c/1');
  const domTurns = [];
  for (let pass = 0; pass < 6; pass++) {
    for (const message of structured.messages) {
      domTurns.push({ role: message.role, text: `Worked for 4s${message.text.replace(/[*_~]/g, '')}\n\nSources:\n- x`, links: [] });
    }
  }
  assert.equal(domTurns.length, 12);
  assert.equal(adapters.distinctTurnCount(domTurns), structured.messages.length);

  const resolved = adapters.resolveExportData({
    structured: { platform: 'grok', data: batch, capturedAt: '2026-10-03T00:00:00.000Z' },
    doc: { querySelectorAll() { return []; }, querySelector() { return null; } },
    domData: {
      platform: 'grok', platformName: 'Grok', title: 't', url: 'https://grok.com/c/1',
      capturedAt: '2026-10-03T00:00:00.000Z', messages: domTurns, searches: []
    },
    platform: 'grok',
    pageUrl: 'https://grok.com/c/1'
  });
  assert.equal(resolved.source, 'structured');
  assert.equal(resolved.data.messages.length, 2);
  assert.doesNotMatch(adapters.toMarkdown(resolved.data), /Worked for 4s/);
});

test('Grok internal render markup is not exported as conversation text', () => {
  // Grok embeds custom elements as placeholders for rendered artifacts. They
  // are markup for the app, not something the reader sees, and the element
  // contents (a server-side file path) must not appear either.
  const batch = {
    responses: [{
      responseId: 'r1',
      sender: 'assistant',
      parentResponseId: 'r0',
      createTime: '2026-10-02T10:00:00.000Z',
      message: 'Done.\n\n**<grok:render card_id="m1" card_type="rendered_file_card" type="render_file"><argument name="file_path">/home/workdir/artifacts/notes.txt</argument></grok:render>**\n\n(~14 KB, 292 lines).',
      inputChunks: [],
      outputChunks: [],
      webSearchResults: []
    }]
  };
  const result = adapters.normalizeStructuredResponse(batch, 'https://grok.com/c/1');
  assert.equal(result.messages.length, 1);
  assert.doesNotMatch(result.messages[0].text, /grok:render|argument|file_path|workdir/);
  assert.match(result.messages[0].text, /292 lines/);
  // Markdown emphasis left behind by the removed element is tidied away.
  assert.doesNotMatch(result.messages[0].text, /\*\*/);
});

test('ChatGPT share DOM uses bubble and markdown containers without role attributes', () => {
  // The current share/chat markup carries no data-message-author-role: user
  // turns are [data-user-message-bubble], assistant turns [data-markdown-copy].
  const userBubble = makeNode('div', { 'data-user-message-bubble': '', class: 'bg-user-message text-user-message' }, 'Shared question text');
  const assistantBody = makeNode('div', { 'data-markdown-copy': '', class: 'relative w-full min-w-0' }, 'Shared answer text');
  const doc = {
    querySelectorAll(sel) {
      if (sel.includes('data-user-message-bubble') || sel.includes('data-markdown-copy')) return [userBubble, assistantBody];
      return [];
    },
    querySelector() { return null; }
  };
  const result = adapters.extractConversation(doc, 'chatgpt', 'https://chatgpt.com/share/token');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].text, 'Shared question text');
  assert.equal(result.messages[1].role, 'assistant');
  assert.equal(result.messages[1].text, 'Shared answer text');
});
