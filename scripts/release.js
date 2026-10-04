/**
 * One-command store upload build: `npm run release`
 *
 * Bumps the version (patch by default; `--minor` or `--major`), keeping
 * manifest.json and package.json in lockstep so they can never drift, then
 * runs the unit suite and zips exactly the files the extension needs with
 * manifest.json at the archive root. Prints the upload-ready path.
 * Everything else (tests, scripts, profiles, captures) stays out.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const BUMP = process.argv.includes('--major') ? 'major'
  : process.argv.includes('--minor') ? 'minor' : 'patch';
const FILES = [
  'manifest.json',
  'popup.html',
  'popup.css',
  'popup.js',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'src/i18n.js',
  'src/adapters.js',
  'src/collector.js',
  '_locales/en/messages.json'
];

function fail(message) {
  console.error(`release: ${message}`);
  process.exitCode = 1;
}

function bumped(version, kind) {
  const parts = String(version).split('.').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    fail(`cannot bump non-semver version: ${version}`);
    return version;
  }
  if (kind === 'major') return `${parts[0] + 1}.0.0`;
  if (kind === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function setVersion(file, next) {
  const raw = fs.readFileSync(file, 'utf8');
  const updated = raw.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`);
  if (updated === raw) fail(`no version field in ${file}`);
  else fs.writeFileSync(file, updated);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
for (const file of [...FILES, ...Object.values(manifest.icons || {}), ...Object.values((manifest.action || {}).default_icon || {})]) {
  if (!fs.existsSync(path.join(ROOT, file))) fail(`missing file: ${file}`);
}
if (process.exitCode) return;

const tests = spawnSync('npm', ['test'], { cwd: ROOT, stdio: 'inherit' });
if (tests.status !== 0) fail('unit tests failed; not building');
if (process.exitCode) return;

// Bump only once the suite is green, so a failed run never moves versions.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.version !== manifest.version) fail(`version drift: package.json ${pkg.version} vs manifest.json ${manifest.version}`);
if (process.exitCode) return;
const next = bumped(manifest.version, BUMP);
if (process.exitCode) return;
manifest.version = next;
pkg.version = next;
setVersion(path.join(ROOT, 'manifest.json'), next);
setVersion(path.join(ROOT, 'package.json'), next);
console.log(`release: ${BUMP} bump -> ${next}`);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', `chat-export-${manifest.version}.zip`);
try { fs.unlinkSync(out); } catch (_) {}
const zip = spawnSync('zip', ['-X', '-r', out, ...FILES], { cwd: ROOT, stdio: 'inherit' });
if (zip.status !== 0) fail('zip failed');
if (process.exitCode) return;

const list = spawnSync('unzip', ['-l', out], { encoding: 'utf8' });
console.log(list.stdout);
console.log(`release: upload-ready ${out}`);
