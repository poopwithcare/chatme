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

test('ChatGPT normalizer terminates on a cyclic parent chain instead of hanging', () => {
  const response = {
    title: 'Cycle test',
    current_node: 'msg-2',
    mapping: {
      'msg-1': { message: { author: { role: 'user' }, content: { parts: ['Cyclic question'] }, create_time: 1 }, parent: 'msg-2' },
      'msg-2': { message: { author: { role: 'assistant' }, content: { parts: ['Cyclic answer'] }, create_time: 2 }, parent: 'msg-1' }
    }
  };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].text, 'Cyclic question');
  assert.equal(result.messages[1].text, 'Cyclic answer');
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

test('Claude image-only turn exports its file instead of vanishing', () => {
  const response = {
    name: 'Image chat',
    chat_messages: [
      { sender: 'human', text: '', files: [{ file_kind: 'image', file_name: 'photo.png', file_uuid: 'f-1', preview_url: '/api/organizations/o-1/files/f-1/contents' }] },
      { sender: 'assistant', text: 'Nice photo.', files: [] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].role, 'user');
  assert.match(result.messages[0].text, /!\[photo\.png\]\(https:\/\/claude\.ai\/api\/organizations\/o-1\/files\/f-1\/contents\)/);
  assert.equal(result.messages[0].links[0].url, 'https://claude.ai/api/organizations/o-1/files/f-1/contents');
  assert.match(adapters.toMarkdown(result), /!\[photo\.png\]/);
});

test('Claude document upload exports as a named file reference', () => {
  const response = {
    chat_messages: [
      { sender: 'human', text: 'See attached', files: [{ file_kind: 'document', file_name: 'notes.pdf', preview_url: 'https://claude.ai/api/files/f-2' }] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /See attached/);
  assert.match(result.messages[0].text, /> File: \[notes\.pdf\]\(https:\/\/claude\.ai\/api\/files\/f-2\)/);
  assert.equal(result.messages[0].links[0].url, 'https://claude.ai/api/files/f-2');
});

test('Claude file without a preview URL still keeps its turn', () => {
  const response = {
    chat_messages: [
      { sender: 'human', text: '', files: [{ file_kind: 'image', file_name: 'photo.png' }] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /\[image: photo\.png\]/);
  assert.equal(result.messages[0].links.length, 0);
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

test('ChatGPT selectors keep stable hooks primary and testids as fallback', () => {
  const selector = adapters.getCandidateSelector('chatgpt');
  assert.match(selector, /data-message-author-role/);
  assert.doesNotMatch(selector, /data-testid/);
  assert.match(adapters.getFallbackSelector('chatgpt'), /conversation-turn/);
});

test('testid-only pages still export via the fallback selector', () => {
  const userDiv = makeNode('div', { 'data-testid': 'user-message' }, 'Fallback question');
  const assistantDiv = makeNode('div', { 'data-testid': 'assistant-message' }, 'Fallback answer');
  const doc = {
    querySelectorAll(sel) {
      if (sel.includes('data-message-author-role')) return [];
      return [userDiv, assistantDiv];
    },
    querySelector() { return null; }
  };
  const result = adapters.extractConversation(doc, 'chatgpt', 'https://chatgpt.com/c/test');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].text, 'Fallback question');
  assert.equal(result.messages[1].text, 'Fallback answer');
});

test('stable matches keep testid-only noise out of the export', () => {
  const userDiv = makeNode('div', { 'data-message-author-role': 'user' }, 'Stable question');
  const noise = makeNode('div', { 'data-testid': 'user-message' }, 'Testid noise');
  const assistantDiv = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Stable answer');
  const doc = {
    querySelectorAll(sel) {
      if (sel.includes('data-message-author-role')) return [userDiv, assistantDiv];
      return [noise];
    },
    querySelector() { return null; }
  };
  const result = adapters.extractConversation(doc, 'chatgpt', 'https://chatgpt.com/c/test');
  assert.equal(result.messages.length, 2);
  assert.doesNotMatch(adapters.toMarkdown(result), /Testid noise/);
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

test('Grok repeated identical turns survive extraction', () => {
  const first = makeNode('div', { 'data-message-author-role': 'user' }, 'Same question');
  const answer = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Answer one');
  const second = makeNode('div', { 'data-message-author-role': 'user' }, 'Same question');
  const doc = makeDoc([first, answer, second]);
  const result = adapters.extractConversation(doc, 'grok', 'https://grok.com/chat/1');
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].text, 'Same question');
  assert.equal(result.messages[1].text, 'Answer one');
  assert.equal(result.messages[2].text, 'Same question');
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

test('one-shot collection targets the private conversation id, never a share token', () => {
  const collector = require('../src/collector.js');
  assert.equal(collector.chatGPTId('https://chatgpt.com/c/6ac073ef-2f00-83ec-9610-d731f0ea90d9'), '6ac073ef-2f00-83ec-9610-d731f0ea90d9');
  // A share page is served whole; its token must never become a request id.
  assert.equal(collector.chatGPTId('https://chatgpt.com/share/6ac0a6c1-9700-83ec-8be5-429188517ebe'), null);
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
  assert.match(payload.text, /\*\*/);
  assert.match(rendered.text, /^Worked for 45s/);
});

test('genuinely different turns are still distinguished after normalisation', () => {
  const a = { role: 'user', text: 'what is the minimum budget for refterm on a mac', links: [] };
  const b = { role: 'user', text: 'what is the minimum budget for refterm on a macbook', links: [] };
  assert.notEqual(adapters.comparisonText(a.text), adapters.comparisonText(b.text));
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

test('ChatGPT sediment image pointer keeps its turn with a labelled placeholder', () => {
  const response = {
    title: 'Image chat',
    mapping: {
      'm1': { message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
        'What is in this image?',
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-abc123', width: 1024, height: 768 }
      ] }, create_time: 1 } },
      'm2': { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['It shows a diagram.'] }, create_time: 2 } }
    }
  };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123');
  assert.equal(result.messages.length, 2);
  assert.match(result.messages[0].text, /What is in this image\?/);
  assert.match(result.messages[0].text, /\[image: file-abc123\]/);
  assert.doesNotMatch(result.messages[0].text, /sediment/);
});

test('ChatGPT http image pointer exports as a Markdown image with a source', () => {
  const response = {
    mapping: {
      'm1': { message: { author: { role: 'assistant' }, content: { content_type: 'multimodal_text', parts: [
        'Here is the chart.',
        { content_type: 'image_asset_pointer', asset_pointer: 'https://files.oaiusercontent.com/chart.png?sig=x' }
      ] }, create_time: 1 } }
    }
  };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /!\[.*\]\(https:\/\/files\.oaiusercontent\.com\/chart\.png\?sig=x\)/);
  assert.equal(result.messages[0].links[0].url, 'https://files.oaiusercontent.com/chart.png?sig=x');
  assert.equal(result.searches.length, 1);
});

test('ChatGPT resolved file URLs turn sediment pointers into images', () => {
  const response = {
    mapping: {
      'm1': { message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-abc123' }
      ] }, create_time: 1, metadata: {} } }
    }
  };
  const fileUrls = { 'file-abc123': { url: 'https://files.oaiusercontent.com/file-abc123/photo.png?sig=y', name: 'photo.png' } };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123', fileUrls);
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /!\[photo\.png\]\(https:\/\/files\.oaiusercontent\.com\/file-abc123\/photo\.png\?sig=y\)/);
  assert.equal(result.messages[0].links[0].url, 'https://files.oaiusercontent.com/file-abc123/photo.png?sig=y');
});

test('chatGPTImageFileIds collects pointer, attachment, and execution image ids', () => {
  const response = {
    mapping: {
      'm1': { message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-aaa' }
      ] }, metadata: { attachments: [{ id: 'file-bbb', name: 'scan.png', mime_type: 'image/png' }] } } },
      'm2': { message: { author: { role: 'tool' }, content: { content_type: 'execution_output', text: '' },
        metadata: { aggregate_result: { messages: [{ message_type: 'image', image_url: 'sediment://file-ccc' }] } } } }
    },
    messages: [
      { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'file-service://file-ddd?x=1' }
      ] } }
    ]
  };
  assert.deepEqual(adapters.chatGPTImageFileIds(response), ['file-aaa', 'file-bbb', 'file-ccc', 'file-ddd']);
  assert.deepEqual(adapters.chatGPTImageFileIds(null), []);
});

test('ChatGPT upload attachments and code-execution images export by kind', () => {
  const response = {
    mapping: {
      'm1': { message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['See attached'] },
        create_time: 1, metadata: { attachments: [
          { id: 'file-img', name: 'scan.png', mime_type: 'image/png' },
          { id: 'file-doc', name: 'notes.pdf', mime_type: 'application/pdf' }
        ] } } },
      'm2': { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Ran the code.'] },
        create_time: 2, metadata: { aggregate_result: { messages: [
          { message_type: 'image', image_url: 'https://files.oaiusercontent.com/plot.png' }
        ] } } } }
    }
  };
  const result = adapters.normalizeChatGPTResponse(response, 'https://chatgpt.com/c/123');
  assert.match(result.messages[0].text, /\[image: scan\.png\]/);
  assert.match(result.messages[0].text, /\[file: notes\.pdf\]/);
  assert.match(result.messages[1].text, /!\[generated image 1\]\(https:\/\/files\.oaiusercontent\.com\/plot\.png\)/);
});

test('Claude image content blocks export as images or labelled placeholders', () => {
  const response = {
    chat_messages: [
      { role: 'user', content: [
        { type: 'text', text: 'Describe this' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/garden.png' } }
      ] },
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } }] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 2);
  assert.match(result.messages[0].text, /!\[image\]\(https:\/\/example\.com\/garden\.png\)/);
  assert.equal(result.messages[0].links[0].url, 'https://example.com/garden.png');
  assert.match(result.messages[1].text, /\[image: image\/png\]/);
});

test('Claude files_v2 image uploads export like files entries', () => {
  const response = {
    chat_messages: [
      { sender: 'human', text: '', files_v2: [{ file_kind: 'image', file_name: 'sketch.webp', preview_url: '/api/organizations/o-1/files/f-3/contents' }] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /!\[sketch\.webp\]\(https:\/\/claude\.ai\/api\/organizations\/o-1\/files\/f-3\/contents\)/);
});

test('Grok uploaded image metadata exports as an assets-host Markdown image', () => {
  const batch = {
    responses: [{
      responseId: 'r1',
      sender: 'human',
      message: 'can you calculate the memory? ignore the os stuff',
      fileAttachmentsMetadata: [{
        fileMetadataId: '5804b7bb-3584-434a-b029-05acf291a5cd',
        fileMimeType: 'image/png',
        fileName: 'image.png',
        fileUri: 'users/u-1/5804b7bb-3584-434a-b029-05acf291a5cd/content'
      }]
    }]
  };
  const result = adapters.normalizeStructuredResponse(batch, 'https://grok.com/c/1');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /can you calculate the memory/);
  assert.match(result.messages[0].text, /!\[image\.png\]\(https:\/\/assets\.grok\.com\/users\/u-1\/5804b7bb-3584-434a-b029-05acf291a5cd\/content\)/);
});

test('Grok generated images and file cards export with links', () => {
  const batch = {
    responses: [{
      responseId: 'r1',
      sender: 'assistant',
      message: 'Here it is.',
      generatedImageUrls: ['https://assets.grok.com/users/u-1/gen/img1.png'],
      cardAttachmentsJson: [JSON.stringify({
        id: 'mLjs9', type: 'render_file', file_name: 'notes.txt', mime_type: 'text/plain',
        url: 'users/u-1/generated/aaa/notes.txt'
      })]
    }]
  };
  const result = adapters.normalizeStructuredResponse(batch, 'https://grok.com/c/1');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /!\[generated image 1\]\(https:\/\/assets\.grok\.com\/users\/u-1\/gen\/img1\.png\)/);
  assert.match(result.messages[0].text, /> File: \[notes\.txt\]\(https:\/\/assets\.grok\.com\/users\/u-1\/generated\/aaa\/notes\.txt\)/);
  assert.equal(result.messages[0].links.length, 2);
});

test('DOM extraction keeps content images and skips avatar chrome', () => {
  const photo = {
    getAttribute(name) { return name === 'alt' ? 'whiteboard photo' : name === 'src' ? 'https://files.example.com/whiteboard.png' : ''; },
    alt: 'whiteboard photo',
    src: 'https://files.example.com/whiteboard.png',
    closest() { return null; },
    parentElement: null
  };
  const avatar = {
    getAttribute(name) { return name === 'alt' ? 'User avatar' : ''; },
    alt: 'User avatar',
    src: 'https://example.com/avatar.png',
    width: 24,
    height: 24,
    closest() { return null; },
    parentElement: null
  };
  const userDiv = {
    getAttribute(name) { return name === 'data-message-author-role' ? 'user' : ''; },
    hasAttribute() { return false; },
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (String(sel).includes('a[href]')) return [];
      if (String(sel).includes('img')) return [photo, avatar];
      return [];
    },
    closest() { return null; },
    parentElement: null,
    innerText: 'Look at this board',
    textContent: 'Look at this board'
  };
  const doc = {
    querySelectorAll(sel) {
      if (String(sel).includes('data-message-author-role')) return [userDiv];
      return [];
    },
    querySelector() { return null; }
  };
  const result = adapters.extractConversation(doc, 'chatgpt', 'https://chatgpt.com/c/test');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /Look at this board/);
  assert.match(result.messages[0].text, /!\[whiteboard photo\]\(https:\/\/files\.example\.com\/whiteboard\.png\)/);
  assert.doesNotMatch(result.messages[0].text, /avatar/);
});

test('resolveExportData threads resolved ChatGPT file URLs into the export', () => {
  const payload = {
    mapping: {
      'm1': { message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-abc123' }
      ] } } }
    }
  };
  const resolved = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: payload, fileUrls: { 'file-abc123': { url: 'https://files.oaiusercontent.com/x.png', name: 'x.png' } } },
    doc: { querySelectorAll() { return []; }, querySelector() { return null; } },
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/123'
  });
  assert.equal(resolved.source, 'structured');
  assert.match(resolved.data.messages[0].text, /!\[x\.png\]\(https:\/\/files\.oaiusercontent\.com\/x\.png\)/);
});

test('DOM extraction skips turns from a hidden previous conversation', () => {
  // After client-side navigation to a new chat the old thread can stay
  // mounted but hidden; its turns must not leak into the export.
  const hidden = makeNode('div', { 'data-message-author-role': 'user', 'aria-hidden': 'true' }, 'Old chat question');
  const visible = makeNode('div', { 'data-message-author-role': 'user' }, 'New chat question');
  const result = adapters.extractConversation(makeDoc([hidden, visible]), 'chatgpt', 'https://chatgpt.com/c/new');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text, 'New chat question');
});

test('ChatGPT rendered chrome is not exported as turns', () => {
  const disclaimer = makeNode('div', { 'data-message-author-role': 'assistant' }, 'ChatGPT can make mistakes. Check important info.');
  const stamp = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Today 1:08 PM');
  const real = makeNode('div', { 'data-message-author-role': 'assistant' }, 'Test received.\nChatGPT can make mistakes. Check important info.');
  const result = adapters.extractConversation(makeDoc([disclaimer, stamp, real]), 'chatgpt', 'https://chatgpt.com/c/new');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text, 'Test received.');
  assert.doesNotMatch(adapters.toMarkdown(result), /make mistakes|Today 1:08 PM/);
});

test('a foreign DOM never displaces its structured conversation', () => {
  // New chat fetched fine, but the DOM still shows another conversation:
  // zero shared turns means the DOM is foreign and must be ignored.
  const payload = { mapping: {
    m1: { message: { author: { role: 'user' }, content: { parts: ['new chat question'] } }, parent: null },
    m2: { message: { author: { role: 'assistant' }, content: { parts: ['new chat answer'] } }, parent: 'm1' }
  }, current_node: 'm2' };
  const foreign = {
    platform: 'chatgpt', platformName: 'ChatGPT', title: 'x', url: 'https://chatgpt.com/c/new',
    capturedAt: '2026-10-14T00:00:00.000Z',
    messages: [
      { role: 'user', text: 'old peugeot question', links: [] },
      { role: 'assistant', text: 'old answer', links: [] },
      { role: 'user', text: 'old email question', links: [] },
      { role: 'assistant', text: 'old answer two', links: [] }
    ],
    searches: []
  };
  const resolved = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: payload },
    doc: { querySelectorAll() { return []; }, querySelector() { return null; } },
    domData: foreign,
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/new'
  });
  assert.equal(resolved.source, 'structured');
  assert.equal(resolved.data.messages.length, 2);
  assert.doesNotMatch(adapters.toMarkdown(resolved.data), /peugeot|old email/);
});

test('leading turns from another conversation are not prepended', () => {
  // Structured wins on length, but the DOM head belongs to a previous chat:
  // it does not continue into the picked opener, so nothing is prepended.
  const node = (id, parent, role, text) => ({
    id, parent, message: { id, author: { role }, content: { content_type: 'text', parts: [text] } }
  });
  const payload = { mapping: {
    a: node('a', undefined, 'user', 'current question'),
    b: node('b', 'a', 'assistant', 'current answer'),
    c: node('c', 'b', 'user', 'current follow-up'),
    d: node('d', 'c', 'assistant', 'current follow-up answer')
  }, current_node: 'd' };
  const mixed = {
    platform: 'chatgpt', platformName: 'ChatGPT', title: 'x', url: 'https://chatgpt.com/c/new',
    capturedAt: '2026-10-14T00:00:00.000Z',
    messages: [
      { role: 'user', text: 'previous chat question', links: [] },
      { role: 'user', text: 'current question', links: [] },
      { role: 'assistant', text: 'current answer', links: [] }
    ],
    searches: []
  };
  const resolved = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: payload },
    doc: { querySelectorAll() { return []; }, querySelector() { return null; } },
    domData: mixed,
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/new'
  });
  assert.equal(resolved.source, 'structured');
  assert.equal(resolved.data.messages.length, 4);
  assert.doesNotMatch(adapters.toMarkdown(resolved.data), /previous chat question/);
});

test('DOM extraction prefers main content over side-rail matches', () => {
  const rail = makeNode('div', { 'data-message-author-role': 'user' }, 'Rail snippet');
  rail.closest = (sel) => String(sel).includes('aside') ? {} : null;
  const thread = makeNode('div', { 'data-message-author-role': 'user' }, 'Thread question');
  const result = adapters.extractConversation(makeDoc([rail, thread]), 'chatgpt', 'https://chatgpt.com/c/new');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text, 'Thread question');
});

test('a complete ChatGPT payload ignores visible stale turns from another chat', () => {
  // The flat payload is the whole conversation (no adjacent pages), so a
  // previous chat's bubble still mounted in the DOM must not leak in, even
  // when it is fully visible and would outscore the payload by count.
  const payload = {
    title: 'Find cat photo',
    conversation_id: '6acee45a',
    messages: [
      { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['find a photo of a cat'] }, create_time: 1791943773.556 },
      { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['cat photo answer'] }, create_time: 1791943776.59 }
    ],
    page_info: { has_previous_page: false, has_next_page: false }
  };
  const stale = makeDoc([
    makeNode('div', { 'data-message-author-role': 'user' }, 'find a photo of a cat'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'cat photo answer'),
    makeNode('div', { 'data-message-author-role': 'user' }, 'can you find some images of a peugot 309 on line')
  ]);
  const resolved = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: payload },
    doc: stale,
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/6acee45a-1e2c-83ec-b704-2b4b0709da7a'
  });
  assert.equal(resolved.source, 'structured');
  assert.equal(resolved.data.messages.length, 2);
  assert.doesNotMatch(adapters.toMarkdown(resolved.data), /peugot/);
});

test('an incomplete ChatGPT payload still yields to a fuller visible conversation', () => {
  // More pages exist beyond this one, so the DOM may hold turns the payload
  // lacks and the count comparison still decides.
  const payload = {
    messages: [
      { id: 'u2', author: { role: 'user' }, content: { content_type: 'text', parts: ['Newer question'] }, create_time: 2 },
      { id: 'a2', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Newer answer'] }, create_time: 3 }
    ],
    page_info: { has_previous_page: false, has_next_page: true }
  };
  const fuller = makeDoc([
    makeNode('div', { 'data-message-author-role': 'user' }, 'Older question'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'Older answer'),
    makeNode('div', { 'data-message-author-role': 'user' }, 'Newer question'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'Newer answer')
  ]);
  const resolved = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: payload },
    doc: fuller,
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/abc'
  });
  assert.equal(resolved.source, 'dom');
  assert.equal(resolved.data.messages.length, 4);
  assert.equal(resolved.data.messages[0].text, 'Older question');
});

test('a complete ChatGPT mapping ignores a foreign DOM', () => {
  const node = (id, parent, role, text) => ({
    id, parent, message: { id, author: { role }, content: { content_type: 'text', parts: [text] } }
  });
  const payload = { mapping: {
    a: node('a', undefined, 'user', 'current question'),
    b: node('b', 'a', 'assistant', 'current answer')
  }, current_node: 'b' };
  const foreign = makeDoc([
    makeNode('div', { 'data-message-author-role': 'user' }, 'previous chat question'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'previous chat answer'),
    makeNode('div', { 'data-message-author-role': 'user' }, 'current question'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'current answer')
  ]);
  const resolved = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: payload },
    doc: foreign,
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/new'
  });
  assert.equal(resolved.source, 'structured');
  assert.equal(resolved.data.messages.length, 2);
  assert.doesNotMatch(adapters.toMarkdown(resolved.data), /previous chat/);
});

test('a truncated ChatGPT mapping still compares against the DOM', () => {
  // The chain stops at a parent the payload does not include, so the payload
  // may be a partial tail and the fuller DOM still wins.
  const node = (id, parent, role, text) => ({
    id, parent, message: { id, author: { role }, content: { content_type: 'text', parts: [text] } }
  });
  const payload = { mapping: {
    b: node('b', 'missing-parent', 'user', 'Newer question'),
    c: node('c', 'b', 'assistant', 'Newer answer')
  }, current_node: 'c' };
  const fuller = makeDoc([
    makeNode('div', { 'data-message-author-role': 'user' }, 'Older question'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'Older answer'),
    makeNode('div', { 'data-message-author-role': 'user' }, 'Newer question'),
    makeNode('div', { 'data-message-author-role': 'assistant' }, 'Newer answer')
  ]);
  const resolved = adapters.resolveExportData({
    structured: { platform: 'chatgpt', data: payload },
    doc: fuller,
    platform: 'chatgpt',
    pageUrl: 'https://chatgpt.com/c/abc'
  });
  assert.equal(resolved.source, 'dom');
  assert.equal(resolved.data.messages.length, 4);
});

test('ChatGPT tool-addressed turns are skipped but sandbox code is kept fenced', () => {
  const msg = (role, recipient, content) => ({ author: { role }, recipient, content, create_time: 1 });
  const list = [
    msg('user', 'all', { content_type: 'text', parts: ['Run it'] }),
    msg('assistant', 't2uay3k.sj1i4kz', { content_type: 'code', language: 'json', text: '{"size":"1024x1024","prompt":"a cat"}' }),
    msg('assistant', 'container.exec', { content_type: 'code', language: 'unknown', text: 'ls -la /mnt/data' })
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123');
  assert.equal(flat.messages.length, 2);
  assert.doesNotMatch(flat.messages.map((m) => m.text).join('\n'), /1024x1024/);
  assert.match(flat.messages[1].text, /```\nls -la \/mnt\/data\n```/);
});

test('ChatGPT code content is fenced with its language', () => {
  const list = [
    { author: { role: 'assistant' }, recipient: 'container.exec', content: { content_type: 'code', language: 'python', text: 'print("hi")' }, create_time: 1 }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123');
  assert.match(flat.messages[0].text, /```python\nprint\("hi"\)\n```/);
});

test('ChatGPT execution output and generated images ride into the next answer', () => {
  const fileUrls = { 'file-gen1': { url: 'https://files.example.com/gen1.png', name: 'Design System.png' } };
  const list = [
    { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['Make it'] }, create_time: 1 },
    { id: 't1', author: { role: 'tool' }, content: { content_type: 'execution_output', text: 'total 4\n-rw-r--r-- 1 root root 20K out.png' }, create_time: 2 },
    { id: 't2', author: { role: 'tool' }, content: { content_type: 'multimodal_text', parts: [
      { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-gen1' }
    ] }, metadata: { image_gen_title: 'Design System' }, create_time: 3 },
    { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Done.'] }, create_time: 4 }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123', fileUrls);
  assert.equal(flat.messages.length, 2);
  const answer = flat.messages[1].text;
  assert.match(answer, /^Done\./);
  assert.match(answer, /!\[Design System\]\(https:\/\/files\.example\.com\/gen1\.png\)/);
  assert.match(answer, /<details><summary>Terminal output<\/summary>/);
  assert.match(answer, /total 4/);
});

test('ChatGPT long execution output is capped', () => {
  const big = `x\n`.repeat(2000);
  const list = [
    { id: 't1', author: { role: 'tool' }, content: { content_type: 'execution_output', text: big }, create_time: 1 },
    { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Done.'] }, create_time: 2 }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123');
  assert.match(flat.messages[0].text, /output truncated/);
  assert.ok(flat.messages[0].text.length < big.length);
});

test('ChatGPT sandbox file links resolve to download URLs', () => {
  const fileUrls = { sandbox: { 'card.html': { url: 'https://dl.example.com/card.html?sig=z', name: 'card.html' } } };
  const list = [
    { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['See [Open the demo](sandbox:/mnt/data/card.html) please.'] }, create_time: 1 }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123', fileUrls);
  assert.match(flat.messages[0].text, /\[Open the demo\]\(https:\/\/dl\.example\.com\/card\.html\?sig=z\)/);
  assert.doesNotMatch(flat.messages[0].text, /sandbox:/);
  assert.equal(flat.messages[0].links[0].url, 'https://dl.example.com/card.html?sig=z');
});

test('ChatGPT unresolvable sandbox links stay untouched', () => {
  const list = [
    { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['See [Open the demo](sandbox:/mnt/data/card.html).'] }, create_time: 1 }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123');
  assert.match(flat.messages[0].text, /\(sandbox:\/mnt\/data\/card\.html\)/);
});

test('ChatGPT upload attachments resolve by file name from the listing', () => {
  const fileUrls = { sandbox: { 'notes.pdf': { url: 'https://dl.example.com/notes.pdf?sig=q', name: 'notes.pdf' } } };
  const list = [
    { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['See attached'] }, create_time: 1,
      metadata: { attachments: [{ id: 'att-1', name: 'notes.pdf', mime_type: 'application/pdf' }] } }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123', fileUrls);
  assert.match(flat.messages[0].text, /> File: \[notes\.pdf\]\(https:\/\/dl\.example\.com\/notes\.pdf\?sig=q\)/);
  assert.equal(flat.messages[0].links[0].url, 'https://dl.example.com/notes.pdf?sig=q');
});

test('ChatGPT mapping branch gates recipients and rewrites sandbox links', () => {
  const node = (id, parent, role, recipient, content) => ({ id, parent, message: { id, author: { role }, recipient, content } });
  const fileUrls = { sandbox: { 'card.html': { url: 'https://dl.example.com/card.html', name: 'card.html' } } };
  const payload = { mapping: {
    a: node('a', undefined, 'user', 'all', { content_type: 'text', parts: ['Build it'] }),
    b: node('b', 'a', 'assistant', 't2uay3k.sj1i4kz', { content_type: 'code', language: 'json', text: '{"prompt":"x"}' }),
    c: node('c', 'b', 'assistant', 'all', { content_type: 'text', parts: ['Get [it](sandbox:/mnt/data/card.html).'] })
  }, current_node: 'c' };
  const result = adapters.normalizeChatGPTResponse(payload, 'https://chatgpt.com/c/123', fileUrls);
  assert.equal(result.messages.length, 2);
  assert.doesNotMatch(result.messages.map((m) => m.text).join('\n'), /"prompt"/);
  assert.match(result.messages[1].text, /\[it\]\(https:\/\/dl\.example\.com\/card\.html\)/);
});

test('ChatGPT sandbox links embed fetched file text', () => {
  const fileUrls = { sandbox: {
    'card.html': { url: 'https://dl.example.com/card.html', name: 'card.html', content: '<h1>Hi</h1>', truncated: false, total: 12 }
  } };
  const list = [
    { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Open [the demo](sandbox:/mnt/data/card.html).'] }, create_time: 1 }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123', fileUrls);
  assert.match(flat.messages[0].text, /\[the demo\]\(https:\/\/dl\.example\.com\/card\.html\)/);
  assert.match(flat.messages[0].text, /<details><summary>card\.html<\/summary>/);
  assert.match(flat.messages[0].text, /```html\n<h1>Hi<\/h1>\n```/);
});

test('ChatGPT embedded files note truncation and dedupe repeats', () => {
  const fileUrls = { sandbox: {
    'big.css': { url: 'https://dl.example.com/big.css', name: 'big.css', content: 'a{color:red}', truncated: true, total: 99999 }
  } };
  const list = [
    { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['See [a](sandbox:/mnt/data/big.css) and [b](sandbox:/mnt/data/big.css).'] }, create_time: 1 }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123', fileUrls);
  assert.equal((flat.messages[0].text.match(/<details><summary>big\.css \(truncated\)/g) || []).length, 1);
  assert.match(flat.messages[0].text, /showing 12 of 99999 chars/);
});

test('ChatGPT links without fetched text embed nothing', () => {
  const fileUrls = { sandbox: { 'card.html': { url: 'https://dl.example.com/card.html', name: 'card.html' } } };
  const list = [
    { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Open [the demo](sandbox:/mnt/data/card.html).'] }, create_time: 1 }
  ];
  const flat = adapters.normalizeChatGPTResponse({ messages: list }, 'https://chatgpt.com/c/123', fileUrls);
  assert.doesNotMatch(flat.messages[0].text, /<details>/);
});

test('Claude upload attachments export with embedded text', () => {
  const response = {
    chat_messages: [
      { sender: 'human', text: 'Reorganize this', attachments: [
        { id: 'a-1', file_name: '', file_size: 48, file_type: 'txt', extracted_content: 'body { color: red; }' }
      ] },
      { sender: 'assistant', text: 'Done.', attachments: [] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 2);
  assert.match(result.messages[0].text, /Reorganize this/);
  assert.match(result.messages[0].text, /\[file: file\.txt\]/);
  assert.match(result.messages[0].text, /<details><summary>file\.txt<\/summary>/);
  assert.match(result.messages[0].text, /```txt\nbody \{ color: red; \}\n```/);
});

test('Claude attachment-only turn survives with truncation noted', () => {
  const big = `${'x'},\n`.repeat(12000);
  const response = {
    chat_messages: [
      { sender: 'human', text: '', attachments: [
        { id: 'a-2', file_name: 'data.csv', file_size: big.length, file_type: 'csv', extracted_content: big }
      ] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /<details><summary>data\.csv \(truncated\)<\/summary>/);
  assert.match(result.messages[0].text, /showing \d+ of \d+ chars/);
});

test('Claude image attachments stay placeholders without embedding', () => {
  const response = {
    chat_messages: [
      { sender: 'human', text: '', attachments: [
        { id: 'a-3', file_name: 'shot.png', file_size: 99, file_type: 'png', extracted_content: 'not text' }
      ] }
    ]
  };
  const result = adapters.normalizeClaudeResponse(response, 'https://claude.ai/chat/abc');
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].text, /\[image: shot\.png\]/);
  assert.doesNotMatch(result.messages[0].text, /<details>/);
});

test('grokEmbeddableFiles lists text files once and skips images', () => {
  const response = {
    fileAttachmentsMetadata: [
      { fileName: 'notes.txt', fileMimeType: 'text/plain', fileUri: 'users/u-1/aaa/content' },
      { fileName: 'photo.png', fileMimeType: 'image/png', fileUri: 'users/u-1/bbb/content' }
    ],
    fileAttachmentAssetMetadata: [
      { assetId: 'aaa', name: 'notes.txt', mimeType: 'text/plain', key: 'users/u-1/aaa/content' }
    ],
    cardAttachmentsJson: [JSON.stringify({ file_name: 'data.csv', mime_type: 'text/csv', url: 'users/u-1/gen/data.csv' })]
  };
  const files = adapters.grokEmbeddableFiles(response);
  assert.deepEqual(files.map((f) => f.url), [
    'https://assets.grok.com/users/u-1/aaa/content',
    'https://assets.grok.com/users/u-1/gen/data.csv'
  ]);
});

test('Grok turns embed fetched file text after the file line', () => {
  const batch = {
    responses: [{
      responseId: 'r1',
      sender: 'assistant',
      message: 'Wrote it.',
      cardAttachmentsJson: [JSON.stringify({
        id: 'c1', type: 'render_file', file_name: 'notes.txt', mime_type: 'text/plain',
        url: 'users/u-1/generated/aaa/notes.txt'
      })]
    }]
  };
  const embeddedFiles = {
    'https://assets.grok.com/users/u-1/generated/aaa/notes.txt': { content: 'hello file', truncated: false, total: 10 }
  };
  const result = adapters.normalizeStructuredResponse(batch, 'https://grok.com/c/1', null, embeddedFiles);
  assert.match(result.messages[0].text, /> File: \[notes\.txt\]\(https:\/\/assets\.grok\.com\/users\/u-1\/generated\/aaa\/notes\.txt\)/);
  assert.match(result.messages[0].text, /<details><summary>notes\.txt<\/summary>/);
  assert.match(result.messages[0].text, /```txt\nhello file\n```/);
});

test('resolveExportData threads embedded Grok files into the export', () => {
  const batch = { responses: [{ responseId: 'r1', sender: 'human', message: 'see attached',
    fileAttachmentsMetadata: [{ fileName: 'a.txt', fileMimeType: 'text/plain', fileUri: 'users/u-1/a/content' }] }] };
  const resolved = adapters.resolveExportData({
    structured: { platform: 'grok', data: batch,
      embeddedFiles: { 'https://assets.grok.com/users/u-1/a/content': { content: 'file body', truncated: false, total: 9 } } },
    doc: { querySelectorAll() { return []; }, querySelector() { return null; } },
    platform: 'grok',
    pageUrl: 'https://grok.com/c/1'
  });
  assert.match(adapters.toMarkdown(resolved.data), /<details><summary>a\.txt<\/summary>/);
});
