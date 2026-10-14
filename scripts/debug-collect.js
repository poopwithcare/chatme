/**
 * Debug collector: run the real popup flow (inject + collect) against a live
 * conversation and print a full diagnostic report.
 *
 * Uses a filesystem COPY of the local signed-in profile, so the real profile
 * is never touched. Prints per-request timings, payload shape, resolve
 * source, message count, and the full error stack on failure.
 *
 *   node scripts/debug-collect.js https://chatgpt.com/c/<id>
 *   node scripts/debug-collect.js <url> --out /tmp/export.md
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
const DEBUG_PORT = Number(process.env.CHAT_EXPORT_DEBUG_PORT || 9360);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findProfile(hostname) {
  const name = hostname === 'claude.ai' ? 'claude.ai'
    : hostname === 'grok.com' ? 'grok.com'
    : hostname.endsWith('chatgpt.com') || hostname === 'chat.openai.com' ? 'chatgpt.com'
    : hostname;
  for (const base of PROFILE_CANDIDATES) {
    const candidate = path.join(base, name);
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch (_) {}
  }
  return null;
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

(async () => {
  const url = process.argv[2];
  if (!url || !/^https?:\/\//.test(url)) {
    console.error('usage: node scripts/debug-collect.js <conversation-url> [--out file.md]');
    process.exitCode = 2;
    return;
  }
  const outIndex = process.argv.indexOf('--out');
  const outFile = outIndex !== -1 ? process.argv[outIndex + 1] : null;
  const hostname = new URL(url).hostname;
  const source = findProfile(hostname);
  if (!source) throw new Error(`no local signed-in profile for ${hostname}`);
  if (!fs.existsSync(CHROME)) throw new Error('real Chrome is not installed');

  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-export-debug-'));
  fs.cpSync(source, path.join(copy, 'profile'), { recursive: true });
  const child = spawn(CHROME, [
    `--user-data-dir=${path.join(copy, 'profile')}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-default-apps',
    '--window-position=-32000,-32000',
    '--window-size=1400,1000',
    'about:blank'
  ], { stdio: 'ignore' });
  try {
    await waitForPort(DEBUG_PORT);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    try {
      const page = await browser.contexts()[0].newPage();
      const tNav = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(8000);
      console.log(`navigated in ${Date.now() - tNav}ms -> ${page.url()}`);
      for (const file of ['src/i18n.js', 'src/adapters.js', 'src/collector.js']) {
        await page.evaluate((src) => { (0, eval)(src); }, fs.readFileSync(path.join(ROOT, file), 'utf8'));
      }
      const report = await page.evaluate(async () => {
        const requests = [];
        const origFetch = window.fetch.bind(window);
        const timed = async (reqUrl, init) => {
          const start = performance.now();
          try {
            const res = await origFetch(reqUrl, init);
            requests.push({ url: String(reqUrl).split('?')[0].slice(-80), ms: Math.round(performance.now() - start), status: res.status });
            return res;
          } catch (error) {
            requests.push({ url: String(reqUrl).split('?')[0].slice(-80), ms: Math.round(performance.now() - start), error: String((error && error.name) || error) });
            throw error;
          }
        };
        const phases = {};
        let mark = performance.now();
        let result = null;
        let failure = null;
        try {
          result = await window.ChatExportCollector.collect({ fetch: timed });
        } catch (error) {
          failure = { message: String((error && error.message) || error), stack: String((error && error.stack) || '') };
        } finally {
          delete window.ChatExportCollector;
          delete window.ChatExportAdapters;
          delete window.ChatExportI18n;
        }
        phases.total = Math.round(performance.now() - mark);
        return { requests, phases, failure, result };
      });
      console.log('--- requests ---');
      for (const entry of report.requests) console.log(JSON.stringify(entry));
      console.log('--- result ---');
      const { markdown, ...summary } = report.result || {};
      console.log(JSON.stringify(summary, null, 1));
      console.log(`total collect ms: ${report.phases.total}`);
      if (report.failure) {
        console.log('--- FAILURE ---');
        console.log(report.failure.message);
        console.log(report.failure.stack.split('\n').slice(0, 8).join('\n'));
        process.exitCode = 1;
        return;
      }
      if (outFile && markdown) {
        fs.writeFileSync(outFile, markdown);
        console.log(`wrote ${markdown.length} chars to ${outFile}`);
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    child.kill();
    await sleep(1000);
    fs.rmSync(copy, { recursive: true, force: true });
  }
})().catch((error) => { console.error(`ERR ${error.message}`); process.exitCode = 1; });
