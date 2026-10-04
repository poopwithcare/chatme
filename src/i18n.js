(function (root) {
  'use strict';

  // English fallback mirroring _locales/en/messages.json in full, so behavior
  // is identical with or without chrome.i18n (unit tests, and any key the
  // browser catalog lacks). Production code always prefers the catalog.
  const FALLBACK = {
    appName: 'Chat Export: Claude, ChatGPT & Grok',
    appDescription: 'Copy or download the current AI conversation and its visible web sources as Markdown.',
    appTitle: 'Save full chat',
    titleOnSite: 'Save full chat on $1',
    siteNameDefault: 'Current tab',
    noActiveTab: 'No active tab',
    copyTitle: 'Copy chat',
    copyHint: 'Copy Markdown to clipboard',
    downloadTitle: 'Download chat',
    downloadHint: 'Save a Markdown file',
    actionsLabel: 'Export actions',
    feedbackLink: 'Report an issue',
    statusReading: 'Getting messages…',
    statusCopiedOne: 'Copied 1 message.',
    statusCopiedMany: 'Copied $1 messages.',
    statusDownloadedOne: 'Downloaded 1 message.',
    statusDownloadedMany: 'Downloaded $1 messages.',
    statusNoTab: 'Open a supported site.',
    statusUnsupported: 'Open a Claude, ChatGPT, or Grok conversation.',
    errorTabAccess: 'Could not access the active tab.',
    errorGeneric: 'Could not export this conversation.',
    errorCollectorMissing: 'Could not start the conversation collector',
    errorNoMarkdown: 'No conversation Markdown was produced',
    errorPageUnavailable: 'Conversation page is unavailable',
    errorOpenConversation: 'Open a Claude, ChatGPT, or Grok conversation first',
    errorNoMessages: 'No conversation messages were available to export',
    errorGrokEmpty: 'Grok returned no conversation turns',
    errorRequestFailed: 'Conversation request failed ($1)',
    errorNoResponse: 'no response',
    errorTimedOut: 'Conversation request timed out',
    shortcutDescription: 'Open Chat Export'
  };

  function substitute(message, substitutions) {
    let out = String(message);
    for (const [index, value] of (substitutions || []).entries()) {
      out = out.split(`$${index + 1}`).join(String(value));
    }
    return out;
  }

  function t(key, substitutions) {
    try {
      const i18n = root.chrome && root.chrome.i18n;
      if (i18n) {
        const message = i18n.getMessage(key, substitutions || []);
        if (message) return message;
      }
    } catch (_) {}
    const fallback = FALLBACK[key];
    if (typeof fallback !== 'string') return key;
    return substitute(fallback, substitutions);
  }

  const api = { t, FALLBACK };
  root.ChatExportI18n = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // NOTE: this file must load before adapters.js, collector.js, and popup.js,
  // which bind to ChatExportI18n at load time (see the files lists in
  // popup.js, scripts/release.js, scripts/live-e2e.js, and test/popup.test.js).
})(typeof globalThis !== 'undefined' ? globalThis : this);
