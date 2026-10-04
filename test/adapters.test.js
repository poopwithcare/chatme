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
