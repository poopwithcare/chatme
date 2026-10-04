/**
 * Builds the Chrome Web Store graphic assets (`npm run assets`):
 *   store/tiles/promo-small-440x280.png
 *   store/tiles/promo-marquee-1400x560.png
 *   store/screenshots/popup-<target>-1280x800.png  (real page + real popup UI)
 *
 * Screenshots reuse the live-e2e approach (filesystem copy of a signed-in
 * profile, real Chrome owning the copy) and then redact before capturing:
 * every personal string on the page — sidebar titles, account name, the
 * conversation itself — is swapped for generic placeholder content, so no
 * private data ever reaches the image files. Verify by eye after running.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'store');
const PROFILE_CANDIDATES = [
  '/Users/e/dev/network-capture/data/profiles',
  path.join(ROOT, '.profiles')
];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.STORE_DEBUG_PORT || 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  { name: 'popup-chatgpt', clean: true, url: 'https://chatgpt.com/share/6ac0a6c1-9700-83ec-8be5-429188517ebe', topic: 'Theaetetus', titleSuffix: '', messages: 'role',
    markers: ['Identify Network Topology', 'OpenCode', 'AGENTS.md', 'Direct3D', 'Metal', 'compacted'] },
  { name: 'popup-grok', profile: 'grok.com', url: 'https://grok.com/share/c2hhcmQtMw_a76ca920-7cb9-4919-a0a5-2f91c618609e', topic: 'Theaetetus', titleSuffix: ' | Shared Grok Conversation', messages: 'testids',
    markers: ['refterm', 'cmuratori', '44 MB', 'what about instead of a terminal', 'How Much Memory'] }
];

// Generic sidebar titles replacing the real conversation/project names.
const SIDEBAR_TITLES = [
  'Weekend hiking trip', 'Q3 planning notes', 'Sourdough starter guide', 'Books to read',
  'Garden layout ideas', 'Bike route map', 'Birthday party menu', 'Learn basic Spanish',
  'Home office setup', 'Photography tips', 'Pasta recipes', 'Morning routine',
  'Travel packing list', 'Plant care schedule', 'Car maintenance log'
];

// Generic conversation replacing the real turns (cycled per role):
// Socrates asks, Theaetetus answers — short famous passages.
const TURNS = [
  ['Tell me, what do you think knowledge is?',
    'It seems to me that knowledge is simply perception.'],
  ['Protagoras says that Man is the measure of all things. You have read this, of course?',
    'Yes, often.'],
  ['Suppose we have in our souls a block of wax, larger in one person, smaller in another.',
    'All right, I am supposing that.'],
  ['My business is to attend you in your labor. Answer whatever appears to you about the things I ask.',
    'All right, go on with the questions.']
];

// Sidebar and account UI chrome that is not personal and stays untouched.
const KEEP = new Set(['new', 'projects', 'artifacts', 'code', 'customize', 'pinned',
  'chats and tasks', 'chats', 'tasks', 'search', 'search chats', 'upgrade',
  'free plan', 'free', 'claude', 'shift', 'command', 'show more', 'try again',
  'write a message', 'plus', 'models', 'profile', 'settings', 'help',
  'chat', 'imagine', 'library', 'automations', 'add project', 'plugins',
  'continue conversation', 'grok', 'socrates', 'athens', 'so']);

// Account names mapped to a placeholder. A node changed by this mapping is
// personal by definition, so it is kept as-is and never cycled.
const ACCOUNT_NAMES = [['felix', 'Socrates'], ['shore', 'Athens']];

function findProfile(name) {
  for (const base of PROFILE_CANDIDATES) {
    const candidate = path.join(base, name);
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch (_) {}
  }
  return null;
}

function signedOut(text) {
  return /\bsign in\b|\blog in\b|\bsign up\b|create an account/i.test(String(text || '').slice(0, 600));
}

async function waitForPort(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error(`Chrome did not open its debugging port (${port})`);
}

// Popup styles are written against bare elements (main, footer), so scope
// every rule under the overlay host to leave the underlying page untouched.
function scopedCss(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((rule) => {
    const at = rule.indexOf('{');
    if (at < 0) return '';
    const selector = rule.slice(0, at).split(',')
      .map((part) => `#chat-export-shot ${part.trim()}`).join(', ');
    return `${selector} {${rule.slice(at + 1)}}`;
  }).join('\n');
}

function popupOverlay() {
  const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script')).replace(/ disabled(?=[> ])/g, '');
  return { css: scopedCss(fs.readFileSync(path.join(ROOT, 'popup.css'), 'utf8')), body };
}

async function screenshotShot(browser, shot, overlay) {
  const context = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  try {
    await page.goto(shot.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(6000);
    // Public share links render signed-out chrome by design; only profile
    // shots can meaningfully fail the sign-in check.
    if (!shot.clean && signedOut(await page.evaluate(() => document.body.innerText))) {
      return { ...shot, status: 'SKIP', reason: 'profile is not signed in' };
    }
    await page.evaluate(({ topic, titleSuffix, sidebarTitles, turns, keep, accountNames, mode }) => {
      const keepSet = new Set(keep);
      const locked = new Set([topic]);
      const textsOf = (root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        return nodes;
      };
      const scrubAccount = (value) => {
        let out = value;
        for (const [from, to] of accountNames) out = out.replace(new RegExp(from, 'gi'), to).replace(/\bFC\b/g, 'SO');
        return out;
      };
      // The conversation title, wherever it appears (tab, header, sidebar).
      const oldTitle = document.title.split(' - ')[0].split(' | ')[0].trim();
      document.title = `${topic}${titleSuffix}`;
      if (oldTitle) {
        for (const text of textsOf(document.body)) {
          if (text.nodeValue.trim() === oldTitle) text.nodeValue = topic;
        }
      }
      // Sidebar: swap every other substantial string for a generic title.
      // Single-glyph icon nodes are too short to match, so icons survive.
      const rail = document.querySelector('aside') || document.querySelector('div[class*="--sidebar-width"]');
      if (rail) {
        let index = 0;
        for (const text of textsOf(rail)) {
          const scrubbed = scrubAccount(text.nodeValue);
          if (scrubbed !== text.nodeValue) {
            text.nodeValue = scrubbed;
            continue;
          }
          const words = scrubbed.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
          if (words.length >= 4 && !keepSet.has(words) && !locked.has(text.nodeValue.trim())) {
            text.nodeValue = sidebarTitles[index++ % sidebarTitles.length];
          }
        }
        // Photo avatar becomes neutral initials.
        const pfp = rail.querySelector('img[alt="pfp"]');
        if (pfp) {
          const box = pfp.getBoundingClientRect();
          const size = Math.round(Math.min(box.width, box.height) || 28);
          const dot = document.createElement('span');
          dot.textContent = 'SO';
          dot.setAttribute('style', `display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:#30323d;color:#e8e9ee;font:600 ${Math.round(size * 0.38)}px system-ui,sans-serif;flex:none;`);
          pfp.replaceWith(dot);
        }
      }
      // The conversation itself: generic turns, layout untouched. A watcher
      // keeps redacting turns that mount late, up to the screenshot. Pairing
      // is by visible index from zero on every sweep, so re-renders converge
      // on the same assignment instead of drifting with a cumulative counter.
      // Mode "role" reads the role off each node (ChatGPT share markup).
      const sweep = () => {
        let fresh = 0;
        const visible = (el) => el.getClientRects().length > 0;
        const paint = (nodes, pick) => {
          nodes.filter(visible).forEach((el, k) => {
            // Only touch changed nodes: an unconditional write fires the
            // watcher again and the sweep never quiesces.
            const text = pick(k);
            if (el.textContent !== text) el.textContent = text;
            el.setAttribute('data-shot-redacted', '1');
            fresh++;
          });
        };
        if (mode === 'role') {
          // Walk the turns in document order as one sequence: a user turn
          // takes the current pair's question, an assistant turn its answer
          // and then advances. Alternating threads pair up exactly; leading
          // or trailing orphans keep their own side's text.
          const nodes = Array.from(document.querySelectorAll('[data-message-author-role]')).filter(visible);
          let pair = 0;
          for (const el of nodes) {
            const text = (el.getAttribute('data-message-author-role') || '').toLowerCase() === 'user'
              ? turns[pair % turns.length][0]
              : turns[pair % turns.length][1];
            if (el.textContent !== text) el.textContent = text;
            el.setAttribute('data-shot-redacted', '1');
            if ((el.getAttribute('data-message-author-role') || '').toLowerCase() !== 'user') pair++;
            fresh++;
          }
          return fresh;
        }
        paint(Array.from(document.querySelectorAll('[data-testid="user-message"]')), (k) => turns[k % turns.length][0]);
        paint(Array.from(document.querySelectorAll('[data-testid="assistant-message"]')), (k) => turns[k % turns.length][1]);
        return fresh;
      };
      sweep();
      window.__shotWatcher = new MutationObserver(() => sweep());
      window.__shotWatcher.observe(document.body, { childList: true, subtree: true });
    }, { topic: shot.topic, titleSuffix: shot.titleSuffix, sidebarTitles: SIDEBAR_TITLES, turns: TURNS, keep: Array.from(KEEP), accountNames: ACCOUNT_NAMES, mode: shot.messages || 'testids' });
    await page.waitForTimeout(2500);
    await page.evaluate(({ css, body }) => {
      const host = document.createElement('div');
      host.id = 'chat-export-shot';
      host.setAttribute('style', 'position:fixed;top:16px;right:16px;z-index:2147483647;width:245px;background:#1b1c23;border:1px solid #41434d;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.55);overflow:hidden;font:13px/1.35 system-ui,sans-serif;color:#f2f2f5;');
      const style = document.createElement('style');
      style.textContent = css;
      host.appendChild(style);
      const wrap = document.createElement('div');
      wrap.innerHTML = body;
      host.appendChild(wrap);
      document.documentElement.appendChild(host);
      const name = host.querySelector('#site-name');
      if (name) name.textContent = new URL(window.location.href).hostname;
    }, overlay);
    await page.waitForTimeout(800);
    const out = path.join(STORE, 'screenshots', `${shot.name}-1280x800.png`);
    await page.screenshot({ path: out });
    // Gate: the page must not still contain any known-original string.
    const leaked = await page.evaluate((markers) => {
      const text = `${document.title}\n${document.body.innerText}`;
      return (markers || []).filter((m) => text.includes(m));
    }, shot.markers || []);
    if (leaked.length) return { ...shot, status: 'FAIL', reason: `original text remains: ${leaked.join(', ')}`, file: out };
    return { ...shot, status: 'PASS', file: out };
  } catch (error) {
    return { ...shot, status: 'FAIL', reason: String(error.message).split('\n')[0] };
  } finally {
    await page.close().catch(() => {});
  }
}

function tileHtml(size, iconPx, titlePx, subPx, padPx) {
  const icon = fs.readFileSync(path.join(ROOT, 'icons', 'icon128.png')).toString('base64');
  return `<html><body style="margin:0"><div style="width:${size[0]}px;height:${size[1]}px;background:#1b1c23;display:flex;align-items:center;gap:${Math.round(padPx / 1.6)}px;padding:0 ${padPx}px;box-sizing:border-box;">` +
    `<img src="data:image/png;base64,${icon}" style="width:${iconPx}px;height:${iconPx}px">` +
    `<div><div style="font:700 ${titlePx}px system-ui,-apple-system,sans-serif;color:#f2f2f5;line-height:1.1">Chat Export</div>` +
    `<div style="font:${subPx}px system-ui,-apple-system,sans-serif;color:#b9bbc5;margin-top:${Math.round(subPx / 3)}px">Claude &middot; ChatGPT &middot; Grok &rarr; Markdown</div></div></div></body></html>`;
}

async function buildTiles() {
  const browser = await chromium.launch();
  try {
    const specs = [
      { file: path.join(STORE, 'tiles', 'promo-small-440x280.png'), size: [440, 280], html: tileHtml([440, 280], 104, 40, 19, 36) },
      { file: path.join(STORE, 'tiles', 'promo-marquee-1400x560.png'), size: [1400, 560], html: tileHtml([1400, 560], 220, 92, 40, 110) }
    ];
    for (const spec of specs) {
      const page = await browser.newPage({ viewport: { width: spec.size[0], height: spec.size[1] } });
      await page.setContent(spec.html);
      await page.waitForTimeout(300);
      await page.screenshot({ path: spec.file, clip: { x: 0, y: 0, width: spec.size[0], height: spec.size[1] } });
      await page.close();
      console.log(`PASS tile ${spec.file}`);
    }
  } finally {
    await browser.close();
  }
}

(async () => {
  if (!fs.existsSync(CHROME)) {
    console.log('SKIP: real Chrome is not installed; screenshots need it for the signed-in profiles.');
    return;
  }
  fs.mkdirSync(path.join(STORE, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(STORE, 'tiles'), { recursive: true });

  await buildTiles();

  const overlay = popupOverlay();
  for (const shot of SHOTS) {
    // Public share links need no signed-in profile: a clean browser shows no
    // sidebar or account, so there is less to redact.
    if (shot.clean) {
      const browser = await chromium.launch();
      try {
        const result = await screenshotShot(browser, shot, overlay);
        console.log(`${result.status} screenshot ${shot.name}${result.file ? ` ${result.file}` : ''}${result.reason ? ` ${result.reason}` : ''}`);
      } finally {
        await browser.close().catch(() => {});
      }
      continue;
    }
    const source = findProfile(shot.profile);
    if (!source) {
      console.log(`SKIP screenshot ${shot.name}: no local signed-in profile`);
      continue;
    }
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-export-store-'));
    fs.cpSync(path.join(source), path.join(copy, 'profile'), { recursive: true });
    const hidden = process.env.CHAT_EXPORT_VISIBLE !== '1';
    const child = spawn(CHROME, [
      `--user-data-dir=${path.join(copy, 'profile')}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--no-default-apps',
      ...(hidden ? ['--window-position=-32000,-32000', '--window-size=1400,1000'] : []),
      'about:blank'
    ], { stdio: 'ignore' });
    try {
      await waitForPort(DEBUG_PORT);
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
      try {
        const result = await screenshotShot(browser, shot, overlay);
        console.log(`${result.status} screenshot ${shot.name}${result.file ? ` ${result.file}` : ''}${result.reason ? ` ${result.reason}` : ''}`);
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (error) {
      console.log(`FAIL screenshot ${shot.name} ${String(error.message).split('\n')[0]}`);
    } finally {
      child.kill();
      await sleep(1000);
      fs.rmSync(copy, { recursive: true, force: true });
    }
  }
})().catch((error) => { console.error(String(error.message || error)); process.exitCode = 1; });
