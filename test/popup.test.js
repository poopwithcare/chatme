const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function popupHarness(tab) {
  const elements = new Map();
  const events = [];
  let copied = '';
  const createdAnchors = [];
  const element = (id = '') => {
    const listeners = {};
    const value = {
      id, disabled: false, textContent: '', dataset: {}, style: {},
      addEventListener(name, callback) { listeners[name] = callback; },
      async click() { return listeners.click && listeners.click({}); },
      remove() { this.removed = true; }
    };
    if (id) elements.set(id, value);
    return value;
  };
  const document = {
    body: { appendChild(node) { node.appended = true; } },
    getElementById(id) { return elements.get(id) || element(id); },
    createElement(name) {
      const node = element();
      node.tagName = name;
      node.click = () => { node.clicked = true; };
      createdAnchors.push(node);
      return node;
    }
  };
  const chrome = {
    tabs: { async query(query) { events.push(['tabs.query', query]); return tab ? [tab] : []; } },
    scripting: {
      async executeScript(details) {
        events.push(['executeScript', details]);
        if (details.files) return [];
        return [{ result: { platform: 'grok', platformName: 'Grok', title: 'Test Chat', messages: 2, bytes: 44, markdown: '# Conversation\n' } }];
      }
    }
  };
  const context = {
    document, chrome,
    navigator: { clipboard: { async writeText(value) { copied = value; } } },
    Blob,
    URL,
    window: { setTimeout(callback) { callback(); return 1; } },
    console
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), context);
  return { document, elements, events, createdAnchors, copied: () => copied, wait: () => new Promise((resolve) => setImmediate(resolve)) };
}

test('opening the toolbar popup does not inject or read anything', async () => {
  const h = popupHarness({ id: 5, url: 'https://chatgpt.com/c/chat-id' });
  await h.wait();
  assert.equal(h.events.filter(([name]) => name === 'executeScript').length, 0);
  assert.equal(h.elements.get('copy').disabled, false);
  assert.equal(h.elements.get('download').disabled, false);
});

test('Copy collects once on demand; Download reuses only popup-lifetime Markdown', async () => {
  const h = popupHarness({ id: 5, url: 'https://grok.com/c/chat-id' });
  await h.wait();
  await h.elements.get('copy').click();
  assert.match(h.copied(), /# Conversation/);
  assert.equal(h.events.filter(([name]) => name === 'executeScript').length, 2);
  assert.match(h.elements.get('status').textContent, /Copied 2 messages/);

  await h.elements.get('download').click();
  assert.equal(h.events.filter(([name]) => name === 'executeScript').length, 2);
  assert.equal(h.createdAnchors.length, 1);
  assert.equal(h.createdAnchors[0].download, 'grok-Test-Chat.md');
  assert.equal(h.createdAnchors[0].clicked, true);
  assert.match(h.elements.get('status').textContent, /Downloaded 2 messages/);
});

test('unsupported tabs leave both actions disabled without injecting scripts', async () => {
  const h = popupHarness({ id: 5, url: 'https://example.com/' });
  await h.wait();
  assert.equal(h.elements.get('copy').disabled, true);
  assert.equal(h.elements.get('download').disabled, true);
  assert.match(h.elements.get('status').textContent, /Open a Claude/);
  assert.equal(h.events.filter(([name]) => name === 'executeScript').length, 0);
});

test('opening the popup on a Claude conversation enables actions without reading', async () => {
  const h = popupHarness({ id: 5, url: 'https://claude.ai/chat/chat-id' });
  await h.wait();
  assert.equal(h.events.filter(([name]) => name === 'executeScript').length, 0);
  assert.equal(h.elements.get('copy').disabled, false);
  assert.equal(h.elements.get('download').disabled, false);
});

test('every element the popup script uses exists in the popup markup', () => {
  // The harness auto-creates missing elements, so a removed id would
  // otherwise pass unit tests and then throw in the real popup.
  const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const usedIds = new Set([...source.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]));
  assert.ok(usedIds.size > 0);
  for (const id of usedIds) {
    assert.ok(htmlIds.has(id), `popup.js uses #${id} but popup.html has no such element`);
  }
});

test('the popup title names the tab it exports from', async () => {
  const h = popupHarness({ id: 5, url: 'https://claude.ai/chat/chat-id' });
  await h.wait();
  assert.equal(h.document.title, 'Save full chat on claude.ai');
});
