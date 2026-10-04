/**
 * One-command store upload build: `npm run release`
 *
 * Runs the unit suite, then zips exactly the files the extension needs with
 * manifest.json at the archive root. Prints the upload-ready path.
 * Everything else (tests, scripts, profiles, captures) stays out.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'src/adapters.js',
  'src/collector.js'
];

function fail(message) {
  console.error(`release: ${message}`);
  process.exitCode = 1;
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
for (const file of [...FILES, ...Object.values(manifest.icons || {}), ...Object.values((manifest.action || {}).default_icon || {})]) {
  if (!fs.existsSync(path.join(ROOT, file))) fail(`missing file: ${file}`);
}
if (process.exitCode) return;

const tests = spawnSync('npm', ['test'], { cwd: ROOT, stdio: 'inherit' });
if (tests.status !== 0) fail('unit tests failed; not building');
if (process.exitCode) return;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', `chat-export-${manifest.version}.zip`);
try { fs.unlinkSync(out); } catch (_) {}
const zip = spawnSync('zip', ['-X', '-r', out, ...FILES], { cwd: ROOT, stdio: 'inherit' });
if (zip.status !== 0) fail('zip failed');
if (process.exitCode) return;

const list = spawnSync('unzip', ['-l', out], { encoding: 'utf8' });
console.log(list.stdout);
console.log(`release: upload-ready ${out}`);
