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
    querySelectorAll() { return []; },
    createElement(name) {
      const node = element();
      node.tagName = name;
      node.click = () => { node.clicked = true; };
      createdAnchors.push(node);
      return node;
    }
  };
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales', 'en', 'messages.json'), 'utf8'));
  const chrome = {
    tabs: { async query(query) { events.push(['tabs.query', query]); return tab ? [tab] : []; } },
    scripting: {
      async executeScript(details) {
        events.push(['executeScript', details]);
        if (details.files) return [];
        return [{ result: { platform: 'grok', platformName: 'Grok', title: 'Test Chat', messages: 2, bytes: 44, markdown: '# Conversation\n' } }];
      }
    },
    i18n: {
      getMessage(key, substitutions) {
        const entry = catalog[key];
        if (!entry) return '';
        let out = entry.message;
        for (const [index, value] of (substitutions || []).entries()) {
          out = out.split(`$${index + 1}`).join(String(value));
        }
        return out;
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
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8'), context);
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

test('singular and plural counts read correctly without browser i18n', () => {
  const i18n = require('../src/i18n.js');
  assert.equal(i18n.t('statusCopiedOne'), 'Copied 1 message.');
  assert.equal(i18n.t('statusCopiedMany', [7]), 'Copied 7 messages.');
  assert.equal(i18n.t('titleOnSite', ['example.com']), 'Save full chat on example.com');
});

test('every localized string exists in the English catalog and fallback', () => {
  // A missing key renders as the raw key or empty text, so pin the full set:
  // every t('…') call, data-i18n attribute, and manifest __MSG__ reference.
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '_locales', 'en', 'messages.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
  const used = new Set();
  for (const file of ['popup.js', 'src/collector.js', 'src/i18n.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const match of source.matchAll(/(?:^|[^\w$])t\(['"]([^'"]+)['"]/g)) used.add(match[1]);
  }
  for (const match of html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)) used.add(match[1]);
  for (const match of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9@_]+)__/g)) used.add(match[1]);
  assert.ok(used.size > 10);
  const i18n = require('../src/i18n.js');
  for (const key of used) {
    assert.ok(catalog[key], `missing locale key: ${key}`);
    assert.equal(typeof i18n.FALLBACK[key], 'string', `missing fallback: ${key}`);
  }
});
