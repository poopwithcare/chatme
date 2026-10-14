# Chat Export

A local-first Chrome Manifest V3 extension for exporting Claude, ChatGPT, and Grok conversations to Markdown, including attached and generated images. Code-interpreter and sandbox files resolve to download URLs with text files embedded collapsibly, executed code exports fenced, and terminal output rides along collapsed.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open a supported conversation, click the Chat Export toolbar icon, then choose **Copy conversation** or **Download full chat**.

## Idle behaviour and privacy

The manifest registers no page content scripts and no background worker. Opening a supported site or opening the popup does not inspect the DOM, observe mutations, wrap network APIs, or allocate conversation data. The popup reads only the active tab's URL to decide whether the actions are available.

Only after Copy or Download is clicked does the extension inject a short-lived isolated-world collector for that tab. It uses the site's conversation endpoint where available, otherwise reads the current rendered page or its embedded share payload. The collector returns Markdown and a count, then removes its temporary global references. The popup keeps that Markdown only while it is open, so Copy then Download can reuse one collection. No conversation data is sent to a server or saved by the extension.

## Development

```sh
npm test
npm run test:e2e
npm run test:live
```

Debug a real conversation (uses a throwaway copy of your local signed-in
profile; prints per-request timings, resolve source, and full error stacks):

```sh
npm run debug:collect -- https://chatgpt.com/c/<id> [--out /tmp/export.md]
```

Unit tests cover payload normalization, one-shot requests, popup actions, and malformed/unavailable responses. Extension E2E tests verify the loaded MV3 extension adds no page scripts while idle. The live check uses local authenticated profiles and exercises the one-shot collector against the sites.
