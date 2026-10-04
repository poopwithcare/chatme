'use strict';

const siteName = document.getElementById('site-name');
const status = document.getElementById('status');
const copyButton = document.getElementById('copy');
const downloadButton = document.getElementById('download');
const t = (globalThis.ChatExportI18n && globalThis.ChatExportI18n.t) || ((key) => key);

let activeTab = null;
let cachedExport = null;
let collectPromise = null;

function supportedConversation(urlString) {
  if (!urlString) return false;
  try {
    const url = new URL(urlString);
    const path = url.pathname;
    if (url.hostname === 'claude.ai') return /^\/(?:chat(?:_|\/)|share\/)/i.test(path);
    if (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com') return /^\/(?:c|g|share)\//i.test(path);
    if (url.hostname === 'grok.com' || url.hostname.endsWith('.grok.com')) return /^\/(?:c|chat|share)\//i.test(path);
    return false;
  } catch (_) {
    return false;
  }
}

function setStatus(message, state) {
  status.textContent = message;
  status.dataset.state = state || '';
}

function localizeDocument() {
  for (const element of document.querySelectorAll('[data-i18n]')) {
    const key = element.getAttribute('data-i18n');
    if (key) element.textContent = t(key);
  }
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) {
    const key = element.getAttribute('data-i18n-aria-label');
    if (key) element.setAttribute('aria-label', t(key));
  }
}

async function collectFromTab() {
  if (cachedExport) return cachedExport;
  if (!activeTab || !Number.isInteger(activeTab.id)) throw new Error('No active browser tab');
  if (collectPromise) return collectPromise;

  collectPromise = (async () => {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['src/i18n.js', 'src/adapters.js', 'src/collector.js'],
      world: 'ISOLATED'
    });
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      world: 'ISOLATED',
      func: async () => {
        const t = (globalThis.ChatExportI18n && globalThis.ChatExportI18n.t) || ((key) => key);
        const collector = globalThis.ChatExportCollector;
        if (!collector) throw new Error(t('errorCollectorMissing'));
        try {
          return await collector.collect();
        } finally {
          // Keep no conversation data or collector state in the tab after this
          // one action. The next popup action injects a fresh collector.
          delete globalThis.ChatExportCollector;
          delete globalThis.ChatExportAdapters;
          delete globalThis.ChatExportI18n;
        }
      }
    });
    if (!execution || !execution.result || !execution.result.markdown) {
      throw new Error(t('errorNoMarkdown'));
    }
    cachedExport = execution.result;
    return cachedExport;
  })();

  try {
    return await collectPromise;
  } finally {
    collectPromise = null;
  }
}

async function runAction(action) {
  copyButton.disabled = true;
  downloadButton.disabled = true;
  setStatus(t('statusReading'));
  try {
    const result = await collectFromTab();
    const count = result.messages.toLocaleString();
    if (action === 'copy') {
      await navigator.clipboard.writeText(result.markdown);
      setStatus(result.messages === 1 ? t('statusCopiedOne') : t('statusCopiedMany', [count]), 'success');
    } else {
      const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename(result);
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      setStatus(result.messages === 1 ? t('statusDownloadedOne') : t('statusDownloadedMany', [count]), 'success');
    }
    return true;
  } catch (error) {
    setStatus(error && error.message ? error.message : t('errorGeneric'), 'error');
    return false;
  } finally {
    copyButton.disabled = false;
    downloadButton.disabled = false;
  }
}

function filename(result) {
  const clean = String(result.title || 'conversation')
    .normalize('NFKD')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 72);
  return `${result.platform}-${clean || 'conversation'}.md`;
}

async function initialize() {
  copyButton.disabled = true;
  downloadButton.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    activeTab = tab || null;
    if (!activeTab || !activeTab.url) {
      siteName.textContent = t('noActiveTab');
      setStatus(t('statusNoTab'));
      return;
    }
    const hostname = new URL(activeTab.url).hostname;
    siteName.textContent = hostname;
    document.title = t('titleOnSite', [hostname]);
    if (!supportedConversation(activeTab.url)) {
      setStatus(t('statusUnsupported'));
      return;
    }
    copyButton.disabled = false;
    downloadButton.disabled = false;
  } catch (_) {
    setStatus(t('errorTabAccess'), 'error');
  }
}

copyButton.addEventListener('click', () => runAction('copy'));
downloadButton.addEventListener('click', () => runAction('download'));
localizeDocument();
initialize();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { supportedConversation, filename };
}
