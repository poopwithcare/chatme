const test = require('node:test');
const assert = require('node:assert/strict');
const adapters = require('../src/adapters.js');
const collector = require('../src/collector.js');

function emptyDocument(title = 'Conversation') {
  return {
    title,
    documentElement: { innerHTML: '' },
    scripts: [],
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

test('ChatGPT private export requests the current conversation only on collection', async () => {
  const requests = [];
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Private Chat'),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/api/auth/session')) return jsonResponse({ accessToken: 'test-token' });
      return jsonResponse({
        conversation_id: 'conversation-123',
        title: 'Private Chat',
        messages: [
          { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['Question'] } },
          { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Answer'] }, channel: 'final' }
        ]
      });
    }
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/api\/auth\/session$/);
  assert.match(requests[1].url, /\/backend-api\/conversations\/conversation-123$/);
  assert.equal(requests[1].init.credentials, 'include');
  assert.equal(requests[1].init.headers.authorization, 'Bearer test-token');
  assert.match(result.markdown, /Question/);
  assert.match(result.markdown, /Answer/);
  assert.equal(result.messages, 2);
  assert.equal(result.platform, 'chatgpt');
});

test('Grok private export requests one ordered node list and its response batches', async () => {
  const requests = [];
  const ids = ['u-1', 'a-1'];
  const responses = [
    { responseId: 'u-1', sender: 'human', message: 'Question' },
    { responseId: 'a-1', sender: 'assistant', message: 'Answer' }
  ];
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Grok Chat'),
    pageUrl: 'https://grok.com/c/conversation-456',
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/response-node')) {
        return jsonResponse({ responseNodes: ids.map((responseId) => ({ responseId })) });
      }
      return jsonResponse({ responses });
    }
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/response-node$/);
  assert.match(requests[1].url, /\/load-responses$/);
  assert.deepEqual(JSON.parse(requests[1].init.body).responseIds, ids);
  assert.match(result.markdown, /Question/);
  assert.match(result.markdown, /Answer/);
  assert.equal(result.messages, 2);
});

test('ChatGPT share collection reads the inline serialized conversation without fetching', async () => {
  const requests = [];
  const shareData = {
    mapping: {
      u1: { id: 'u1', message: { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['Shared question'] } } },
      a1: { id: 'a1', parent: 'u1', message: { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Shared answer'] } } }
    },
    current_node: 'a1',
    title: 'Shared chat'
  };
  const mockAdapters = {
    ...adapters,
    extractChatGPTShareConversation() { return shareData; }
  };
  const doc = emptyDocument('Shared chat');
  doc.scripts = [{ textContent: 'streamController.enqueue("fixture")' }];
  const result = await collector.collect({
    adapters: mockAdapters,
    document: doc,
    pageUrl: 'https://chatgpt.com/share/share-token',
    fetch: async (...args) => { requests.push(args); return jsonResponse({}); }
  });

  assert.equal(requests.length, 0);
  assert.match(result.markdown, /Shared question/);
  assert.match(result.markdown, /Shared answer/);
  assert.equal(result.messages, 2);
});

test('Claude private export requests the full conversation on collection', async () => {
  const requests = [];
  const result = await collector.collect({
    adapters,
    document: claudeDocument({ title: 'Claude Chat' }),
    pageUrl: 'https://claude.ai/chat/18e53c0b-53d6-4483-b3f1-3a1cbefdb1a8',
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/api/organizations')) return jsonResponse([{ uuid: 'org-1', name: 'Personal' }]);
      return jsonResponse({
        uuid: '18e53c0b-53d6-4483-b3f1-3a1cbefdb1a8',
        name: 'Private Claude chat',
        chat_messages: [
          { uuid: 'm-1', sender: 'human', content: [{ type: 'text', text: 'Full API question' }] },
          { uuid: 'm-2', sender: 'assistant', content: [{ type: 'text', text: 'Full API answer' }] }
        ]
      });
    }
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/api\/organizations$/);
  assert.match(requests[1].url, /\/api\/organizations\/org-1\/chat_conversations\/18e53c0b-53d6-4483-b3f1-3a1cbefdb1a8$/);
  assert.equal(requests[1].init.credentials, 'include');
  assert.equal(result.platform, 'claude');
  assert.equal(result.platformName, 'Claude');
  assert.equal(result.title, 'Private Claude chat');
  assert.equal(result.messages, 2);
  assert.match(result.markdown, /Full API question/);
  assert.match(result.markdown, /Full API answer/);
});

test('Claude chat ids ignore share links', () => {
  assert.equal(collector.claudeChatId('https://claude.ai/chat/abc-123'), 'abc-123');
  assert.equal(collector.claudeChatId('https://claude.ai/share/public-token'), null);
});

test('Claude image-only turn survives the full private export', async () => {
  const result = await collector.collect({
    adapters,
    document: claudeDocument({ title: 'Claude Chat' }),
    pageUrl: 'https://claude.ai/chat/eba6c807-e8ff-4dda-94af-b1fe39dec9c3',
    fetch: async (url) => {
      if (url.endsWith('/api/organizations')) return jsonResponse([{ uuid: 'org-1' }]);
      return jsonResponse({
        uuid: 'eba6c807-e8ff-4dda-94af-b1fe39dec9c3',
        name: 'Image chat',
        chat_messages: [
          { uuid: 'm-1', sender: 'human', text: 'What is in this image?', files: [] },
          { uuid: 'm-2', sender: 'assistant', text: 'It shows a diagram.', files: [] },
          { uuid: 'm-3', sender: 'human', text: '', files: [{ file_kind: 'image', file_name: '1791114930888_image.png', file_uuid: 'f-9', preview_url: '/api/organizations/org-1/files/f-9/contents' }] }
        ]
      });
    }
  });

  assert.equal(result.messages, 3);
  assert.match(result.markdown, /!\[1791114930888_image\.png\]\(https:\/\/claude\.ai\/api\/organizations\/org-1\/files\/f-9\/contents\)/);
});

test('an API error does not silently export a partial empty conversation', async () => {
  await assert.rejects(collector.collect({
    adapters,
    document: emptyDocument(),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async () => jsonResponse({}, 401)
  }), /Conversation request failed \(401\)/);
});

test('a stalled conversation request fails fast instead of hanging the popup', async () => {
  await assert.rejects(collector.fetchJson((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  }), 'https://chatgpt.com/c/123', '/backend-api/conversations/123', { timeoutMs: 5 }), /Conversation request timed out/);
});

test('fetchJson keeps credentials, merged headers, and hides its timeout option', async () => {
  const requests = [];
  const data = await collector.fetchJson(async (url, init) => {
    requests.push({ url, init });
    return jsonResponse({ ok: true });
  }, 'https://grok.com/c/1', '/rest/app-chat/conversations/1/response-node', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    timeoutMs: 50
  });

  assert.deepEqual(data, { ok: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.credentials, 'include');
  assert.equal(requests[0].init.headers.accept, 'application/json');
  assert.equal(requests[0].init.headers['content-type'], 'application/json');
  assert.ok(requests[0].init.signal);
  assert.ok(!('timeoutMs' in requests[0].init));
});

test('a non-timeout fetch failure passes through unchanged', async () => {
  await assert.rejects(collector.fetchJson(async () => { throw new TypeError('boom'); },
    'https://chatgpt.com/c/123', '/api/auth/session', { timeoutMs: 50 }), /boom/);
});

function claudeMessageNode(role, text) {
  return {
    getAttribute(name) { return name === 'data-message-author-role' ? role : ''; },
    hasAttribute() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    parentElement: null,
    innerText: text,
    textContent: text
  };
}

function claudeDocument({ title = 'Claude Chat', embedded = null, messages = [] } = {}) {
  const scripts = embedded === null ? [] : [{ textContent: JSON.stringify(embedded) }];
  return {
    title,
    scripts,
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (String(selector).includes('script[type')) return scripts;
      if (String(selector).includes('data-message-author-role')) return messages;
      return [];
    }
  };
}

test('Claude share export reads the embedded payload and makes no requests', async () => {
  const embedded = {
    title: 'Shared Claude chat',
    chat_messages: [
      { role: 'human', content: [{ type: 'text', text: 'Shared Claude question' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Shared Claude answer' }] }
    ]
  };
  let fetched = false;
  const result = await collector.collect({
    adapters,
    document: claudeDocument({ embedded }),
    pageUrl: 'https://claude.ai/share/public-token',
    fetch: async () => { fetched = true; throw new Error('should not fetch'); }
  });

  assert.equal(fetched, false);
  assert.equal(result.platform, 'claude');
  assert.equal(result.platformName, 'Claude');
  assert.equal(result.messages, 2);
  assert.match(result.markdown, /Shared Claude question/);
  assert.match(result.markdown, /Shared Claude answer/);
});

test('Claude private export falls back to the rendered DOM when the API is unavailable', async () => {
  const doc = claudeDocument({
    messages: [
      claudeMessageNode('user', 'Private Claude question'),
      claudeMessageNode('assistant', 'Private Claude answer')
    ]
  });
  const result = await collector.collect({
    adapters,
    document: doc,
    pageUrl: 'https://claude.ai/chat/chat-id',
    fetch: async () => jsonResponse({}, 401)
  });

  assert.equal(result.platform, 'claude');
  assert.equal(result.messages, 2);
  assert.match(result.markdown, /Private Claude question/);
  assert.match(result.markdown, /Private Claude answer/);
  assert.doesNotMatch(result.markdown, /## (User|Claude) \(3\)/);
});

test('Claude share ignores a malformed embedded payload and exports the DOM', async () => {
  const doc = claudeDocument({
    embedded: { title: 'Not a conversation', foo: 1 },
    messages: [
      claudeMessageNode('user', 'Visible Claude question'),
      claudeMessageNode('assistant', 'Visible Claude answer')
    ]
  });
  let fetched = false;
  const result = await collector.collect({
    adapters,
    document: doc,
    pageUrl: 'https://claude.ai/share/public-token',
    fetch: async () => { fetched = true; throw new Error('should not fetch'); }
  });

  assert.equal(fetched, false);
  assert.equal(result.messages, 2);
  assert.match(result.markdown, /Visible Claude question/);
  assert.match(result.markdown, /Visible Claude answer/);
});

test('Claude collection with no messages rejects instead of exporting empty Markdown', async () => {
  await assert.rejects(collector.collect({
    adapters,
    document: claudeDocument(),
    pageUrl: 'https://claude.ai/chat/empty-chat',
    fetch: async () => { throw new Error('should not fetch'); }
  }), /No conversation messages were available to export/);
});
