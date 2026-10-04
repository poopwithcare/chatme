/**
 * Live check for the toolbar-popup, click-to-export flow.
 *
 * Mirrors exactly what popup.js does on Copy/Download: with the page already
 * open and idle, inject src/adapters.js + src/collector.js, run one
 * ChatExportCollector.collect(), then verify the Markdown declares N messages
 * with headings numbered 1..N. No widget, no observers, no request wrapping.
 *
 * Uses the existing signed-in Chrome profiles without touching them: each run
 * works on a filesystem copy, and real Chrome owns the copy so the session
 * survives (Playwright launching the profile itself clears the cookies).
 * CHAT_EXPORT_VISIBLE=1 keeps the window on screen; hidden off-screen by
 * default. Unsigned-in targets are reported as SKIP, not failure.
 *
 *   node scripts/live-e2e.js            # grok + chatgpt + claude
 *   node scripts/live-e2e.js grok       # one platform
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PROFILE_CANDIDATES = [
  '/Users/e/dev/network-capture/data/profiles',
  path.join(ROOT, '.profiles')
];
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.CHAT_EXPORT_DEBUG_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CLAUDE_SHARE_URL = '';

const TARGETS = [
  { platform: 'grok', profile: 'grok.com', kind: 'share', url: 'https://grok.com/share/c2hhcmQtMw_a76ca920-7cb9-4919-a0a5-2f91c618609e' },
  { platform: 'grok', profile: 'grok.com', kind: 'chat', url: 'https://grok.com/c/1ebe773e-0a4c-46d7-a3d0-9044b22fc4da' },
  { platform: 'chatgpt', profile: 'chatgpt.com', kind: 'share', url: 'https://chatgpt.com/share/6ac0a6c1-9700-83ec-8be5-429188517ebe' },
  { platform: 'chatgpt', profile: 'chatgpt.com', kind: 'chat', url: 'https://chatgpt.com/c/6ac073ef-2f00-83ec-9610-d731f0ea90d9' },
  { platform: 'claude', profile: 'claude.ai', kind: 'chat', url: 'https://claude.ai/chat/18e53c0b-53d6-4483-b3f1-3a1cbefdb1a8' },
  // Paste a claude.ai/share/... link here to also cover the share path; the
  // target is skipped while this stays empty.
  ...(CLAUDE_SHARE_URL
    ? [{ platform: 'claude', profile: 'claude.ai', kind: 'share', url: CLAUDE_SHARE_URL }]
    : []),
];

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

function parseTurns(markdown) {
  const declared = /^- Messages: (\d+)$/m.exec(markdown);
  const indices = [...String(markdown).matchAll(/^## .+?\((\d+)\)$/gm)].map((m) => Number(m[1]));
  return { declared: declared ? Number(declared[1]) : null, indices };
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

async function checkTarget(browser, target) {
  const result = { ...target, status: 'FAIL' };
  const page = await browser.contexts()[0].newPage();
  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(6000);
    if (signedOut(await page.evaluate(() => document.body.innerText))) {
      result.status = 'SKIP';
      result.reason = 'profile is not signed in';
      return result;
    }
    // Idle assertion: opening the page performed no extension page work.
    const idle = await page.evaluate(() => ({
      widget: !!document.querySelector('[data-chat-export-root]'),
      captureElement: !!document.querySelector('[data-chat-export-capture]'),
      globals: !!(window.ChatExportCollector || window.ChatExportAdapters || window.__chatExport)
    }));
    if (idle.widget || idle.captureElement || idle.globals) {
      result.reason = `page was touched before any click: ${JSON.stringify(idle)}`;
      return result;
    }
    // The popup action: inject the two files, collect once, discard globals.
    // CDP evaluation (like chrome.scripting.executeScript files) is exempt
    // from the page's Content-Security-Policy; addScriptTag is not, and
    // ChatGPT's script-src-elem blocks it.
    for (const file of ['src/i18n.js', 'src/adapters.js', 'src/collector.js']) {
      await page.evaluate((source) => { (0, eval)(source); }, fs.readFileSync(path.join(ROOT, file), 'utf8'));
    }
    const collected = await page.evaluate(async () => {
      try {
        return await window.ChatExportCollector.collect();
      } finally {
        delete window.ChatExportCollector;
        delete window.ChatExportAdapters;
      }
    });
    const { declared, indices } = parseTurns(collected.markdown);
    result.exported = declared;
    result.bytes = collected.markdown.length;
    result.contiguous = indices.length > 0 && indices.every((n, i) => n === i + 1);
    if (declared !== null && declared === indices.length && result.contiguous) {
      result.status = 'PASS';
    } else {
      result.reason = `header says ${declared}, headings found ${indices.length}`;
    }
  } catch (error) {
    result.reason = String((error && error.message) || error).split('\n')[0];
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

(async () => {
  const only = process.argv[2];
  const targets = only ? TARGETS.filter((t) => t.platform === only) : TARGETS;
  if (!targets.length) throw new Error(`unknown platform: ${only}`);
  if (!fs.existsSync(CHROME)) {
    console.log('SKIP: real Chrome is not installed; live check needs it for the signed-in profiles.');
    return;
  }

  const results = [];
  for (const target of targets) {
    const source = findProfile(target.profile);
    if (!source) {
      results.push({ ...target, status: 'SKIP', reason: 'no local signed-in profile' });
      continue;
    }
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-export-live-'));
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
        results.push(await checkTarget(browser, target));
      } finally {
        await browser.close().catch(() => {});
      }
    } catch (error) {
      results.push({ ...target, status: 'FAIL', reason: String(error.message).split('\n')[0] });
    } finally {
      child.kill();
      await sleep(1000);
      fs.rmSync(copy, { recursive: true, force: true });
    }
  }

  let failed = 0;
  for (const r of results) {
    const extra = r.status === 'PASS'
      ? `${r.exported} turns, ${r.bytes}B`
      : (r.reason || '');
    console.log(`${r.status} ${r.platform}/${r.kind} ${extra}`);
    if (r.status === 'FAIL') failed++;
  }
  console.log(failed ? `${results.length - failed}/${results.length} passed` : 'all live targets passed');
  if (failed) process.exitCode = 1;
})().catch((error) => { console.error(String(error.message || error)); process.exitCode = 1; });
