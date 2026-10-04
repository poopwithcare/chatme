# Chrome Web Store listing — Chat Export

Fill the dashboard fields from this file so a resubmit never drifts.

## Name

Chat Export: Claude, ChatGPT & Grok

## Short description (max 132 chars)

Copy or download Claude, ChatGPT, and Grok conversations as clean Markdown — on click only, nothing stored.

## Detailed description

Chat Export saves the conversation you are reading as Markdown.

- Open a Claude, ChatGPT, or Grok conversation, click the toolbar button, then **Copy chat** or **Download chat**.
- Exports every turn in order, with titles, web sources, and a web-search appendix where the page shows them.
- Nothing is read until you choose an action. There is no background tracking, no account, and no analytics.

Privacy: the extension runs entirely in your browser. When you click, it asks the site you are already signed into for the current conversation (the same data the page already shows you) and turns it into a file. Conversations are never stored, transmitted anywhere else, or used for any other purpose. Works with Claude, ChatGPT, and Grok private chats and share links.

## Category / language

Productivity / English

## Single purpose (privacy tab)

Export the current AI chat conversation as Markdown.

## Permission justifications (privacy tab)

- `activeTab`: the only access the extension has. Clicking the button grants one-time access to that tab, which covers injecting the on-demand collector and reading the conversation there. There are deliberately no `host_permissions`: nothing is readable until you click, and access lapses on its own.
- `scripting`: inject the on-demand collector into that tab only.
- `clipboardWrite`: Copy chat writes the Markdown to your clipboard.

## Data usage (privacy tab)

Does not collect, store, or transmit user data. No remote code: every file ships in the package.

## Support URL

`https://github.com/poopwithcare/chatme/issues` — also linked from the popup footer.

## Graphic assets (in this folder)

- Screenshots: `screenshots/popup-chatgpt-1280x800.png`, `screenshots/popup-grok-1280x800.png` (1280x800, no alpha). Regenerate with `npm run assets`: every personal string is swapped for generic placeholder content before capture, and the build fails the shot if any known-original text remains — still eyeball the result before uploading.
- Small promo tile: `tiles/promo-small-440x280.png` (440x280)
- Marquee: `tiles/promo-marquee-1400x560.png` (1400x560, optional)
- Store icon: upload `icons/icon128.png` (128x128)
