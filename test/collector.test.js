const test = require('node:test');
const assert = require('node:assert/strict');
// i18n first: collector binds its translator at load time.
require('../src/i18n.js');
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

  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /\/api\/auth\/session$/);
  assert.match(requests[1].url, /\/backend-api\/conversations\/conversation-123$/);
  assert.match(requests[2].url, /\/backend-api\/conversations\/conversation-123\/files$/);
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

test('ChatGPT private export resolves image pointers into Markdown images', async () => {
  const requests = [];
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Image Chat'),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/api/auth/session')) return jsonResponse({ accessToken: 'test-token' });
      if (url.includes('/backend-api/files/download/')) {
        return jsonResponse({ download_url: 'https://files.oaiusercontent.com/file-abc123/photo.png?sig=z', file_name: 'photo.png' });
      }
      return jsonResponse({
        conversation_id: 'conversation-123',
        title: 'Image Chat',
        mapping: {
          'm1': { message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
            'What is this?',
            { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-abc123', width: 512, height: 512 }
          ] }, create_time: 1 }, parent: null },
          'm2': { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['A photo.'] }, create_time: 2 }, parent: 'm1' }
        },
        current_node: 'm2'
      });
    }
  });

  assert.ok(requests.some((entry) => entry.url.includes('/backend-api/files/download/file-abc123')), 'image id is resolved');
  assert.ok(requests.find((entry) => entry.url.includes('/files/download/')).url.includes('conversation_id=conversation-123'));
  assert.match(result.markdown, /!\[photo\.png\]\(https:\/\/files\.oaiusercontent\.com\/file-abc123\/photo\.png\?sig=z\)/);
  assert.equal(result.messages, 2);
});

test('ChatGPT export keeps image turns when file resolution fails', async () => {
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Image Chat'),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async (url) => {
      if (url.endsWith('/api/auth/session')) return jsonResponse({ accessToken: 'test-token' });
      if (url.includes('/backend-api/files/download/')) return jsonResponse({}, 404);
      return jsonResponse({
        conversation_id: 'conversation-123',
        title: 'Image Chat',
        mapping: {
          'm1': { message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [
            { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file-missing' }
          ] }, create_time: 1 }, parent: null }
        },
        current_node: 'm1'
      });
    }
  });

  assert.equal(result.messages, 1);
  assert.match(result.markdown, /\[image: file-missing\]/);
});

test('ChatGPT private export resolves sandbox files into download links', async () => {
  const requests = [];
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Files Chat'),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async (url) => {
      requests.push(url);
      if (url.endsWith('/api/auth/session')) return jsonResponse({ accessToken: 'test-token' });
      if (url.includes('/backend-api/files/download/')) {
        return jsonResponse({ download_url: 'https://estuary.example.com/content?sig=z', file_name: 'card.html' });
      }
      if (url.endsWith('/conversations/conversation-123/files')) {
        return jsonResponse({ items: [{ file_id: 'file-card1', file_name: 'card.html', mime_type: 'text/html' }] });
      }
      return jsonResponse({
        conversation_id: 'conversation-123',
        title: 'Files Chat',
        messages: [
          { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Open [the demo](sandbox:/mnt/data/card.html).'] }, create_time: 1 }
        ],
        page_info: { has_previous_page: false, has_next_page: false }
      });
    }
  });

  assert.ok(requests.some((u) => u.endsWith('/conversations/conversation-123/files')), 'file listing is requested');
  assert.ok(requests.some((u) => u.includes('/backend-api/files/download/file-card1')), 'listing id is resolved');
  assert.match(result.markdown, /\[the demo\]\(https:\/\/estuary\.example\.com\/content\?sig=z\)/);
  assert.doesNotMatch(result.markdown, /sandbox:/);
});

test('ChatGPT export works when the files listing is unavailable', async () => {
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Files Chat'),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async (url) => {
      if (url.endsWith('/api/auth/session')) return jsonResponse({ accessToken: 'test-token' });
      if (url.includes('/files')) return jsonResponse({}, 500);
      return jsonResponse({
        conversation_id: 'conversation-123',
        title: 'Files Chat',
        messages: [
          { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Open [the demo](sandbox:/mnt/data/card.html).'] }, create_time: 1 }
        ],
        page_info: { has_previous_page: false, has_next_page: false }
      });
    }
  });

  assert.equal(result.messages, 1);
  assert.match(result.markdown, /\(sandbox:\/mnt\/data\/card\.html\)/);
});

function textResponse(text, headers) {
  return {
    ok: true,
    status: 200,
    headers: { get(name) { return (headers || {})[String(name).toLowerCase()] || null; } },
    async text() { return text; },
    async json() { return JSON.parse(text); }
  };
}

test('ChatGPT private export embeds referenced text files', async () => {
  const fetched = [];
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Files Chat'),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async (url) => {
      fetched.push(url);
      if (url.endsWith('/api/auth/session')) return jsonResponse({ accessToken: 'test-token' });
      if (url.includes('/backend-api/files/download/')) {
        return jsonResponse({ download_url: 'https://estuary.example.com/card.html?sig=z', file_name: 'card.html' });
      }
      if (url.endsWith('/conversations/conversation-123/files')) {
        return jsonResponse({ items: [{ file_id: 'file-card1', file_name: 'card.html', mime_type: 'text/html', file_size_bytes: 100 }] });
      }
      if (url.startsWith('https://estuary.example.com/')) {
        return textResponse('<h1>Hi</h1>', { 'content-length': '12', 'content-type': 'text/html' });
      }
      return jsonResponse({
        conversation_id: 'conversation-123',
        title: 'Files Chat',
        messages: [
          { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Open [the demo](sandbox:/mnt/data/card.html).'] }, create_time: 1 }
        ],
        page_info: { has_previous_page: false, has_next_page: false }
      });
    }
  });

  assert.ok(fetched.some((u) => u.startsWith('https://estuary.example.com/')), 'file text is fetched');
  assert.match(result.markdown, /<details><summary>card\.html<\/summary>/);
  assert.match(result.markdown, /```html\n<h1>Hi<\/h1>\n```/);
});

test('ChatGPT binary and oversized files stay links without fetching text', async () => {
  const fetched = [];
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Files Chat'),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async (url) => {
      fetched.push(url);
      if (url.endsWith('/api/auth/session')) return jsonResponse({ accessToken: 'test-token' });
      if (url.includes('/backend-api/files/download/')) {
        const name = url.includes('file-img') ? 'shot.png' : 'big.zip';
        return jsonResponse({ download_url: `https://estuary.example.com/${name}?sig=z`, file_name: name });
      }
      if (url.endsWith('/conversations/conversation-123/files')) {
        return jsonResponse({ items: [
          { file_id: 'file-img', file_name: 'shot.png', mime_type: 'image/png', file_size_bytes: 100 },
          { file_id: 'file-big', file_name: 'big.zip', mime_type: 'application/zip', file_size_bytes: 500 * 1024 }
        ] });
      }
      if (url.startsWith('https://estuary.example.com/')) {
        return textResponse('BINARY', { 'content-length': '6', 'content-type': 'application/octet-stream' });
      }
      return jsonResponse({
        conversation_id: 'conversation-123',
        title: 'Files Chat',
        messages: [
          { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['See [shot](sandbox:/mnt/data/shot.png) and [big](sandbox:/mnt/data/big.zip).'] }, create_time: 1 }
        ],
        page_info: { has_previous_page: false, has_next_page: false }
      });
    }
  });

  assert.ok(!fetched.some((u) => u.startsWith('https://estuary.example.com/')), 'no file text is fetched');
  assert.match(result.markdown, /\[shot\]\(https:\/\/estuary\.example\.com\/shot\.png\?sig=z\)/);
  assert.match(result.markdown, /\[big\]\(https:\/\/estuary\.example\.com\/big\.zip\?sig=z\)/);
  assert.doesNotMatch(result.markdown, /<details>/);
});

test('fetchJson joins an external abort signal with its timeout', async () => {
  const requests = [];
  const external = new AbortController();
  const data = await collector.fetchJson(async (url, init) => {
    requests.push({ url, init });
    return jsonResponse({ ok: true });
  }, 'https://chatgpt.com/c/123', '/api/auth/session', { timeoutMs: 5000, externalSignal: external.signal });
  assert.deepEqual(data, { ok: true });
  assert.ok(requests[0].init.signal);
  assert.ok(!('timeoutMs' in requests[0].init));
  assert.ok(!('externalSignal' in requests[0].init));
});

test('ChatGPT skips the files listing for conversations without files', async () => {
  let listingSignal = null;
  const result = await collector.collect({
    adapters,
    document: emptyDocument('Plain Chat'),
    pageUrl: 'https://chatgpt.com/c/conversation-123',
    fetch: async (url, init) => {
      if (url.endsWith('/api/auth/session')) return jsonResponse({ accessToken: 'test-token' });
      if (url.endsWith('/conversations/conversation-123/files')) {
        listingSignal = init.signal;
        await new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      return jsonResponse({
        conversation_id: 'conversation-123',
        title: 'Plain Chat',
        messages: [
          { id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['Question'] } },
          { id: 'a1', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Answer'] }, channel: 'final' }
        ]
      });
    }
  });

  assert.equal(result.messages, 2);
  assert.ok(listingSignal && listingSignal.aborted, 'unneeded listing is aborted, not awaited');
});

test('Grok loads response batches in parallel while preserving order', async () => {
  const requests = [];
  const ids = Array.from({ length: 250 }, (_, i) => `r-${i}`);
  const result = await collector.collect({
    adapters,
    document: { title: 'Grok Chat', scripts: [], querySelector() { return null; }, querySelectorAll() { return []; } },
    pageUrl: 'https://grok.com/c/conversation-456',
    fetch: async (url, init) => {
      requests.push(url);
      if (url.endsWith('/response-node')) {
        return jsonResponse({ responseNodes: ids.map((responseId) => ({ responseId })) });
      }
      const batch = JSON.parse(init.body).responseIds;
      return jsonResponse({ responses: batch.map((responseId) => ({ responseId, sender: 'human', message: `Q ${responseId}` })) });
    }
  });

  const posts = requests.filter((u) => u.endsWith('/load-responses'));
  assert.equal(posts.length, 3);
  assert.equal(result.messages, 250);
  assert.match(result.markdown, /Q r-0/);
  assert.match(result.markdown, /Q r-249/);
});

test('Grok private export embeds text attachments and skips binaries', async () => {
  const fetched = [];
  const result = await collector.collect({
    adapters,
    document: { title: 'Grok Chat', scripts: [], querySelector() { return null; }, querySelectorAll() { return []; } },
    pageUrl: 'https://grok.com/c/conversation-456',
    fetch: async (url, init) => {
      fetched.push(url);
      if (url.endsWith('/response-node')) return jsonResponse({ responseNodes: [{ responseId: 'u-1' }, { responseId: 'a-1' }] });
      if (url.endsWith('/load-responses')) {
        return jsonResponse({ responses: [
          { responseId: 'u-1', sender: 'human', message: 'See attached',
            fileAttachmentsMetadata: [
              { fileName: 'notes.txt', fileMimeType: 'text/plain', fileUri: 'users/u-1/aaa/content' },
              { fileName: 'shot.png', fileMimeType: 'image/png', fileUri: 'users/u-1/bbb/content' }
            ] },
          { responseId: 'a-1', sender: 'assistant', message: 'Got it.' }
        ] });
      }
      if (url.startsWith('https://assets.grok.com/')) {
        return textResponse('hello file', { 'content-length': '10', 'content-type': 'text/plain' });
      }
      throw new Error(`unexpected fetch ${url}`);
    }
  });

  assert.deepEqual(fetched.filter((u) => u.startsWith('https://assets.grok.com/')),
    ['https://assets.grok.com/users/u-1/aaa/content']);
  assert.match(result.markdown, /<details><summary>notes\.txt<\/summary>/);
  assert.match(result.markdown, /```txt\nhello file\n```/);
  assert.match(result.markdown, /!\[shot\.png\]\(https:\/\/assets\.grok\.com\/users\/u-1\/bbb\/content\)/);
});

test('Grok embed fetch accepts octet-stream but rejects served binaries', async () => {
  const runWithType = async (contentType) => collector.collect({
    adapters,
    document: { title: 'Grok Chat', scripts: [], querySelector() { return null; }, querySelectorAll() { return []; } },
    pageUrl: 'https://grok.com/c/conversation-456',
    fetch: async (url) => {
      if (url.endsWith('/response-node')) return jsonResponse({ responseNodes: [{ responseId: 'u-1' }] });
      if (url.endsWith('/load-responses')) {
        return jsonResponse({ responses: [
          { responseId: 'u-1', sender: 'human', message: 'Run it',
            fileAttachmentsMetadata: [{ fileName: 'run.py', fileMimeType: '', fileUri: 'users/u-1/ccc/content' }] }
        ] });
      }
      if (url.startsWith('https://assets.grok.com/')) {
        return textResponse('print(1)', { 'content-length': '8', 'content-type': contentType });
      }
      throw new Error(`unexpected fetch ${url}`);
    }
  });
  const octet = await runWithType('application/octet-stream');
  assert.match(octet.markdown, /<details><summary>run\.py<\/summary>/);
  const image = await runWithType('image/png');
  assert.doesNotMatch(image.markdown, /<details>/);
});
