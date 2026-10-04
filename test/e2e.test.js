const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const project = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(project, 'manifest.json'), 'utf8'));
let context;
let profile;

test.before(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-export-extension-e2e-'));
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: [
      `--disable-extensions-except=${project}`,
      `--load-extension=${project}`
    ]
  });
});

test.after(async () => {
  if (context) await context.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});

test('the extension exposes only a toolbar popup and registers no page scripts', async () => {
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.content_scripts, undefined);
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(fs.existsSync(path.join(project, manifest.action.default_popup)));

  const page = await context.newPage();
  await page.route('https://chatgpt.com/c/fixture', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body><main><p>Conversation fixture</p></main></body></html>'
  }));
  await page.goto('https://chatgpt.com/c/fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(150);

  const pageState = await page.evaluate(() => ({
    widget: !!document.querySelector('[data-chat-export-root]'),
    captureElement: !!document.querySelector('[data-chat-export-capture]'),
    captureLog: !!window.__chatExport,
    fetchWrapped: !!window.fetch.__chatExportWrapped,
    observer: !!window.__chatExportObserver
  }));
  assert.deepEqual(pageState, {
    widget: false,
    captureElement: false,
    captureLog: false,
    fetchWrapped: false,
    observer: false
  });
  await page.close();
});

test('clicking a popup action collects exactly one conversation on demand', async () => {
  // Mirrors popup.js collectFromTab: inject the two files into the isolated
  // world, then run one collection and discard the globals.
  const page = await context.newPage();
  const shareId = 'c2hhcmQtMw_fixture';
  await page.route(`**/rest/app-chat/share_links/${shareId}?useChunk=true`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      conversation: { conversationId: shareId, title: 'Grok share fixture' },
      responses: [
        { responseId: 'u-1', sender: 'human', message: 'Fixture question' },
        { responseId: 'a-1', sender: 'assistant', message: 'Fixture answer' }
      ]
    })
  }));
  await page.route(`https://grok.com/share/${shareId}`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><head><title>Grok share fixture</title></head><body><main><p>shared conversation</p></main></body></html>'
  }));
  await page.goto(`https://grok.com/share/${shareId}`, { waitUntil: 'domcontentloaded' });

  // Idle before the click: one DOM read would find no turn markers, and no
  // network call has happened yet.
  const before = await page.evaluate(() => ({
    globals: !!(window.ChatExportCollector || window.ChatExportAdapters),
    markers: document.querySelectorAll('[data-message-author-role],[data-testid="message"]').length
  }));
  assert.equal(before.globals, false);

  await page.addScriptTag({ path: path.join(project, 'src/adapters.js') });
  await page.addScriptTag({ path: path.join(project, 'src/collector.js') });
  const result = await page.evaluate(async () => {
    try {
      return await window.ChatExportCollector.collect();
    } finally {
      delete window.ChatExportCollector;
      delete window.ChatExportAdapters;
    }
  });

  assert.equal(result.platform, 'grok');
  assert.equal(result.messages, 2);
  assert.match(result.markdown, /Fixture question/);
  assert.match(result.markdown, /Fixture answer/);
  const indices = [...result.markdown.matchAll(/^## .+?\((\d+)\)$/gm)].map((m) => Number(m[1]));
  assert.deepEqual(indices, [1, 2]);
  const after = await page.evaluate(() => ({
    globals: !!(window.ChatExportCollector || window.ChatExportAdapters)
  }));
  assert.equal(after.globals, false);
  await page.close();
});

test('popup files contain the two explicit export actions and no settings or page control', () => {
  const html = fs.readFileSync(path.join(project, 'popup.html'), 'utf8');
  assert.match(html, /Copy chat/);
  assert.match(html, /Download chat/);
  assert.match(html, /id="status"/);
  assert.match(html, /github\.com\/poopwithcare\/chatme\/issues/);
  assert.doesNotMatch(html, /data-action="open"|settings|Load full conversation/i);
});
