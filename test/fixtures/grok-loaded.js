// Shapes taken from a captured private Grok conversation: the ordered turn list
// the page reads up front, and the loaded response batch it asks for by id.
// A loaded response carries its finished text on `message` with no chunks.
const GROK_RESPONSE_NODES = {
  "responseNodes": [
    {
      "responseId": "99882973-02f4-4535-bd8c-11c2e1406000",
      "sender": "human",
      "parentResponseId": "12766d5b-ac20-5cd1-b386-7ca08f4249f4"
    },
    {
      "responseId": "87479f85-ee26-4cdd-acba-584c558d79fe",
      "sender": "assistant",
      "parentResponseId": "99882973-02f4-4535-bd8c-11c2e1406000"
    },
    {
      "responseId": "b9bb1e30-a6c9-4203-b6c1-12d04773a92c",
      "sender": "human",
      "parentResponseId": "87479f85-ee26-4cdd-acba-584c558d79fe"
    },
    {
      "responseId": "c5d58429-503f-4502-9513-fe0f981a9c70",
      "sender": "assistant",
      "parentResponseId": "b9bb1e30-a6c9-4203-b6c1-12d04773a92c"
    },
    {
      "responseId": "8beeb8ac-1b9a-4d50-b85b-5eb5862969f3",
      "sender": "human",
      "parentResponseId": "c5d58429-503f-4502-9513-fe0f981a9c70"
    },
    {
      "responseId": "d223790d-e16e-4918-b54a-f3c950ec981e",
      "sender": "assistant",
      "parentResponseId": "8beeb8ac-1b9a-4d50-b85b-5eb5862969f3"
    },
    {
      "responseId": "29665f0d-d57f-411c-8ade-eabb2cd64d69",
      "sender": "human",
      "parentResponseId": "d223790d-e16e-4918-b54a-f3c950ec981e"
    },
    {
      "responseId": "b9fa5d5e-3d30-4a20-8e2f-15c80f66397b",
      "sender": "assistant",
      "parentResponseId": "29665f0d-d57f-411c-8ade-eabb2cd64d69"
    },
    {
      "responseId": "0d10696b-e9da-4b56-8ae4-fd4bbbb76ce0",
      "sender": "human",
      "parentResponseId": "b9fa5d5e-3d30-4a20-8e2f-15c80f66397b"
    },
    {
      "responseId": "2610b519-ecdd-4d28-8ccf-7b53990aa2ee",
      "sender": "assistant",
      "parentResponseId": "0d10696b-e9da-4b56-8ae4-fd4bbbb76ce0"
    },
    {
      "responseId": "d967436f-9574-4dba-b76a-212dfdb098ce",
      "sender": "human",
      "parentResponseId": "2610b519-ecdd-4d28-8ccf-7b53990aa2ee"
    },
    {
      "responseId": "5e239a3a-3715-4a48-9cc8-fc2f269a21df",
      "sender": "assistant",
      "parentResponseId": "d967436f-9574-4dba-b76a-212dfdb098ce"
    },
    {
      "responseId": "09641a53-3e71-48ae-b352-fbae3cdc8471",
      "sender": "human",
      "parentResponseId": "5e239a3a-3715-4a48-9cc8-fc2f269a21df"
    },
    {
      "responseId": "c3f76b7a-aa38-4395-b6f4-68cf90dfdba9",
      "sender": "assistant",
      "parentResponseId": "09641a53-3e71-48ae-b352-fbae3cdc8471"
    },
    {
      "responseId": "f1a8d7f9-3868-4a4a-9e18-1e15c9838b63",
      "sender": "human",
      "parentResponseId": "c3f76b7a-aa38-4395-b6f4-68cf90dfdba9"
    },
    {
      "responseId": "a1979c54-e927-44ae-95dd-9a9628844940",
      "sender": "assistant",
      "parentResponseId": "f1a8d7f9-3868-4a4a-9e18-1e15c9838b63"
    },
    {
      "responseId": "99558c71-e05f-4357-9ced-d4be40e02c79",
      "sender": "human",
      "parentResponseId": "a1979c54-e927-44ae-95dd-9a9628844940"
    },
    {
      "responseId": "81d872db-c661-42a2-a36e-516d82d935dc",
      "sender": "assistant",
      "parentResponseId": "99558c71-e05f-4357-9ced-d4be40e02c79"
    },
    {
      "responseId": "cffe0ae3-ced3-4a5a-9bf3-1eb4c7d29e5f",
      "sender": "human",
      "parentResponseId": "81d872db-c661-42a2-a36e-516d82d935dc"
    },
    {
      "responseId": "d2a91b45-f5e4-40f2-bd72-8f02040c7ecb",
      "sender": "assistant",
      "parentResponseId": "cffe0ae3-ced3-4a5a-9bf3-1eb4c7d29e5f"
    },
    {
      "responseId": "85d92e50-fab0-4b04-a0e5-a007a5eab27a",
      "sender": "human",
      "parentResponseId": "d2a91b45-f5e4-40f2-bd72-8f02040c7ecb"
    },
    {
      "responseId": "9ffbc54c-01e0-4541-a935-309a6281501d",
      "sender": "assistant",
      "parentResponseId": "85d92e50-fab0-4b04-a0e5-a007a5eab27a"
    },
    {
      "responseId": "d4c2ca96-6b18-4db5-9e00-8a058cbabc82",
      "sender": "human",
      "parentResponseId": "9ffbc54c-01e0-4541-a935-309a6281501d"
    },
    {
      "responseId": "b2923138-130b-4c0b-b753-499e561ccb7a",
      "sender": "assistant",
      "parentResponseId": "d4c2ca96-6b18-4db5-9e00-8a058cbabc82"
    },
    {
      "responseId": "6d632070-ffb3-4408-91b1-27b0ffaa73c2",
      "sender": "human",
      "parentResponseId": "b2923138-130b-4c0b-b753-499e561ccb7a"
    },
    {
      "responseId": "6fa7f719-567d-42a9-a2dd-b1a513fe843c",
      "sender": "assistant",
      "parentResponseId": "6d632070-ffb3-4408-91b1-27b0ffaa73c2"
    },
    {
      "responseId": "4f07361e-9061-4b49-9687-c15efbf55999",
      "sender": "human",
      "parentResponseId": "6fa7f719-567d-42a9-a2dd-b1a513fe843c"
    },
    {
      "responseId": "45766ef6-3879-4e4d-8528-b51259ad01e5",
      "sender": "assistant",
      "parentResponseId": "4f07361e-9061-4b49-9687-c15efbf55999"
    },
    {
      "responseId": "119a1511-8af9-4f96-bd20-3a89902f016e",
      "sender": "human",
      "parentResponseId": "45766ef6-3879-4e4d-8528-b51259ad01e5"
    },
    {
      "responseId": "ad4d8365-e7cd-41c0-bde9-3672cf4d3d37",
      "sender": "assistant",
      "parentResponseId": "119a1511-8af9-4f96-bd20-3a89902f016e"
    },
    {
      "responseId": "a5820b45-5feb-4d3d-a3c0-3f48cef44274",
      "sender": "human",
      "parentResponseId": "ad4d8365-e7cd-41c0-bde9-3672cf4d3d37"
    },
    {
      "responseId": "52049aa0-2938-4b0d-8e9d-00dbe4edfd76",
      "sender": "assistant",
      "parentResponseId": "a5820b45-5feb-4d3d-a3c0-3f48cef44274"
    },
    {
      "responseId": "557f65c9-3c55-4b9f-a649-65241ba1b9db",
      "sender": "human",
      "parentResponseId": "52049aa0-2938-4b0d-8e9d-00dbe4edfd76"
    },
    {
      "responseId": "bbb81df7-0a7d-43eb-8db4-e035eceed4fa",
      "sender": "assistant",
      "parentResponseId": "557f65c9-3c55-4b9f-a649-65241ba1b9db"
    },
    {
      "responseId": "8e1e5aab-5042-4e64-8d63-ee10ba7f0ae7",
      "sender": "human",
      "parentResponseId": "bbb81df7-0a7d-43eb-8db4-e035eceed4fa"
    },
    {
      "responseId": "ddcb463c-ca2a-4722-b8be-39d9d9129987",
      "sender": "assistant",
      "parentResponseId": "8e1e5aab-5042-4e64-8d63-ee10ba7f0ae7"
    },
    {
      "responseId": "57522afb-3b71-4bcc-9390-c04d77402ee6",
      "sender": "human",
      "parentResponseId": "ddcb463c-ca2a-4722-b8be-39d9d9129987"
    },
    {
      "responseId": "c6217973-3457-4ef9-bc9f-52b7c866a8f0",
      "sender": "assistant",
      "parentResponseId": "57522afb-3b71-4bcc-9390-c04d77402ee6"
    },
    {
      "responseId": "54db331d-ebd0-4315-a442-9bb9a22414bc",
      "sender": "human",
      "parentResponseId": "c6217973-3457-4ef9-bc9f-52b7c866a8f0"
    },
    {
      "responseId": "d04c5282-bf75-427b-93e2-6c4d22e2d8b6",
      "sender": "assistant",
      "parentResponseId": "54db331d-ebd0-4315-a442-9bb9a22414bc"
    },
    {
      "responseId": "8e6d8946-cf00-420b-9dd5-e931014d505a",
      "sender": "human",
      "parentResponseId": "d04c5282-bf75-427b-93e2-6c4d22e2d8b6"
    },
    {
      "responseId": "baa1f288-f604-4ac7-9db3-0227e64f51e6",
      "sender": "assistant",
      "parentResponseId": "8e6d8946-cf00-420b-9dd5-e931014d505a"
    }
  ],
  "inflightResponses": []
};

const GROK_LOADED_RESPONSES = {
  "responses": [
    {
      "responseId": "09641a53-3e71-48ae-b352-fbae3cdc8471",
      "sender": "human",
      "parentResponseId": "5e239a3a-3715-4a48-9cc8-fc2f269a21df",
      "createTime": "2026-10-02T09:18:44.843Z",
      "message": "why though? can you do the calculation for memory required?",
      "webSearchResults": []
    },
    {
      "responseId": "c3f76b7a-aa38-4395-b6f4-68cf90dfdba9",
      "sender": "assistant",
      "parentResponseId": "09641a53-3e71-48ae-b352-fbae3cdc8471",
      "createTime": "2026-10-02T09:18:44.854Z",
      "message": "Here’s a concrete, itemized calculation for a **minimal native “just text” ChatGPT-style app** on Apple Silicon (sidebar + chat area + input box + button).\n\n### Memory Breakdown (Aggressive Lean Target)\n\n| Component | Estimated Size | Explanation |\n|-----------|----------------|-----------|\n| **Process + dyld + basic system libraries** | 8–12 MB | Unavoidable baseline for any native macOS app |\n| **AppKit / SwiftUI window + view hierarchy** | 4–8 MB | Window, split view, scroll view, text field, button |\n| **Core Text / font system** | 3–6 MB | Font loading, glyph caches, layout engine (even for plain text) |\n| **Your code + static data** | 1–3 MB | Binary + any embedded resources |\n| **Message storage (history)** | 1–5 MB | 100–500 messages of plain text is tiny; attributed strings cost more |\n| **Text layout / rendered lines cache** | 2–6 MB | Word-wrapping, line breaking, and any view recycling overhead |\n| **Networking + JSON buffers** | 0.5–2 MB | URLSession, small streaming buffers |\n| **Misc (autorelease pools, small allocations, Metal if used)** | 1–3 MB | Always some waste |\n| **Total** | **≈ 20–45 MB** | |\n\n### Why it’s higher than a pure terminal\n\nA terminal (like refterm / Alacritty) can do this:\n\n- Fixed monospace grid → extremely compact cell array\n- Single glyph atlas (one big texture)\n- Almost no per-line layout cost\n- Very little UI framework surface\n\nA chat app, even when “just text,” still needs:\n\n1. **Variable-width text + word wrapping**  \n   Core Text has to measure and break lines dynamically. Terminals skip almost all of this.\n\n2. **Scrolling list of arbitrary-length messages**  \n   You need a proper scroll view + view recycling (or a custom text view). This costs more than a fixed screen buffer.\n\n3. **UI controls**  \n   Text field, button, sidebar list — each brings AppKit/SwiftUI objects.\n\n4. **Slightly richer string representation**  \n   Even plain `String` / `NSAttributedString` has more overhead per message than a terminal’s packed cell.\n\n### Can you actually hit ~25 MB?\n\nYes, but only with aggressive choices:\n\n- Pure AppKit (or very thin SwiftUI)\n- Plain text only (no markdown, no syntax highlighting)\n- Small conversation history or aggressive unloading\n- Minimal view hierarchy\n- No images, no WebView, no extra frameworks\n\nIn practice:\n\n- **25–35 MB** → possible with serious effort (reference-implementation level)\n- **35–50 MB** → comfortable and still extremely lean\n- Under 20 MB while remaining a usable chat app is unrealistic on modern macOS\n\n### Short version of the math\n- Terminal baseline (Alacritty-style): ~14–20 MB  \n- Extra cost of flexible text + UI controls + message list: roughly **+10–25 MB**  \n- Resulting realistic floor for a minimal chat app: **~25–40 MB**\n\nSo your intuition is right that it *should* be close to terminal numbers — the calculation shows the gap is real but not huge, as long as you refuse Electron and keep the design extremely simple.",
      "webSearchResults": [
        {
          "url": "https://zenn.dev/mizugeeks/articles/1019cf2353d343?locale=en",
          "title": "Memory Usage Benchmark of 15 Desktop UI Frameworks",
          "preview": "3) **Split-Screen Test** : Running Gallery, Editor, Grid, and Form simultaneously in a 4-way split…"
        },
        {
          "url": "https://x.com/jamonholmgren/status/2101211924436484479",
          "title": "https://x.com/jamonholmgren/status/2101211886754894187",
          "preview": "Author: Jamon (@jamonholmgren)\nPosted: 2026-09-19 01:54:59 UTC\n  Language: en (0.09)\n## Text\n  I…"
        }
      ]
    },
    {
      "responseId": "f1a8d7f9-3868-4a4a-9e18-1e15c9838b63",
      "sender": "human",
      "parentResponseId": "c3f76b7a-aa38-4395-b6f4-68cf90dfdba9",
      "createTime": "2026-10-02T09:20:39.023Z",
      "message": "i want to see the math",
      "webSearchResults": []
    },
    {
      "responseId": "a1979c54-e927-44ae-95dd-9a9628844940",
      "sender": "assistant",
      "parentResponseId": "f1a8d7f9-3868-4a4a-9e18-1e15c9838b63",
      "createTime": "2026-10-02T09:20:39.034Z",
      "message": "Here’s the actual math, broken down as concretely as possible.\n\n### 1. Unavoidable Process Baseline\nAny native macOS app pays this cost just to exist:\n\n| Item                        | Approx. Size     | Notes |\n|----------------------------|------------------|-------|\n| dyld + shared cache mapping | 4–7 MB          | System libraries mapped into the process |\n| Objective-C / Swift runtime | 1.5–3 MB        | Even a tiny Swift or Obj-C binary |\n| Basic heap + stacks         | 1–2 MB          | Main thread + a couple of secondary threads |\n| **Subtotal**                | **≈ 8–12 MB**   | This is why almost nothing starts under ~10 MB |\n\n### 2. Window + Basic UI (AppKit)\nMinimal structure: one window, split view (sidebar + chat), scroll view, text field, button.\n\n| Item                              | Approx. Size    | Calculation / Reasoning |\n|-----------------------------------|-----------------|--------------------------|\n| NSWindow + backing store          | 1.5–3 MB       | Window server resources + layer |\n| View hierarchy (split, scroll, etc.) | 1–2.5 MB     | Each NSView has non-trivial overhead |\n| NSTextField + NSButton            | 0.3–0.8 MB     | Controls + their cells |\n| Layer / compositing overhead      | 0.5–1.5 MB     | Even without Metal |\n| **Subtotal**                      | **≈ 4–8 MB**   | |\n\n### 3. Text System (Core Text / Fonts)\nThis is the biggest difference from a pure terminal.\n\n| Item                              | Approx. Size    | Calculation / Reasoning |\n|-----------------------------------|-----------------|--------------------------|\n| System font loading + descriptors | 1–2 MB         | CTFont + cascade lists |\n| Glyph cache (even modest)         | 1.5–4 MB       | Glyphs are cached as bitmaps or outlines |\n| Layout / line-breaking structures | 0.5–1.5 MB     | Typesetter state, line caches |\n| **Subtotal**                      | **≈ 3–7 MB**   | Terminals avoid most of this by using a fixed grid |\n\n### 4. Your Data (the actual chat content)\nAssume a modest but usable history:\n\n- Average message: 200 characters ≈ 400 bytes (UTF-16) or ~200–250 bytes (UTF-8 + overhead)\n- 300 messages (reasonable short-term history)\n\n| Item                              | Calculation                          | Size |\n|-----------------------------------|--------------------------------------|------|\n| Raw text storage                  | 300 × 250 bytes                      | ~75 KB |\n| Message metadata (timestamps, roles, IDs) | 300 × ~100 bytes               | ~30 KB |\n| Attributed string overhead (if used) | 1.5–3× the raw text               | 100–200 KB |\n| View models / Swift objects       | 300 × ~200–400 bytes                 | 60–120 KB |\n| **Subtotal for history**          |                                      | **≈ 0.3–0.6 MB** |\n\nEven with 2,000 messages it would still only be a few megabytes. Text itself is cheap.\n\n### 5. Rendering / Layout Caches\n| Item                              | Approx. Size    | Notes |\n|-----------------------------------|-----------------|-------|\n| Visible line layout cache         | 0.5–2 MB       | Only visible + nearby messages |\n| Scroll view / recycled views      | 0.5–1.5 MB     | View recycling pool |\n| **Subtotal**                      | **≈ 1–3.5 MB** | |\n\n### 6. Networking + Runtime Odds and Ends\n| Item                              | Approx. Size    |\n|-----------------------------------|-----------------|\n| URLSession + small buffers        | 0.5–1.5 MB     |\n| JSON decoder / temporary objects  | 0.3–1 MB       |\n| Autorelease pools + fragmentation | 1–2 MB         |\n| **Subtotal**                      | **≈ 2–4.5 MB** |\n\n### Putting It All Together\n\n**Aggressive lean version** (plain text only, small history, pure AppKit, very careful):\n\n```\n8–12 MB   (process baseline)\n+ 4–6 MB  (minimal UI)\n+ 3–5 MB  (Core Text / fonts)\n+ 0.5 MB  (history)\n+ 1–2 MB  (layout caches)\n+ 2–3 MB  (network + misc)\n────────────────────────────\n≈ 18.5 – 28.5 MB\n```\n\n**Practical clean version** (still minimal, but not heroic):\n\n```\n≈ 30 – 45 MB\n```\n\n### Why the Terminal Is Lower\nA pure terminal can replace large parts of the above with:\n\n- Fixed cell grid → almost no Core Text layout cost\n- Single glyph atlas instead of general font system\n- No NSTextField / complex controls\n- No per-message objects\n\nThat’s why Alacritty can sit around 14 MB while a chat app struggles to go under ~25 MB without extreme measures.\n\n---\n\n**Bottom line from the math**:  \n25 MB is theoretically reachable if you are extremely disciplined. 30–40 MB is the more honest “this is still very lean” target for a real usable chat UI that is still “just text on a screen.”",
      "webSearchResults": []
    },
    {
      "responseId": "99558c71-e05f-4357-9ced-d4be40e02c79",
      "sender": "human",
      "parentResponseId": "a1979c54-e927-44ae-95dd-9a9628844940",
      "createTime": "2026-10-02T09:23:38.089Z",
      "message": "how did they make visual studio 6 run on 32mb of ram?",
      "webSearchResults": []
    },
    {
      "responseId": "81d872db-c661-42a2-a36e-516d82d935dc",
      "sender": "assistant",
      "parentResponseId": "99558c71-e05f-4357-9ced-d4be40e02c79",
      "createTime": "2026-10-02T09:23:38.102Z",
      "message": "**They designed the entire stack for severe memory constraints.**\n\nOfficial system requirements for Visual Studio 6.0 (1998):\n\n- **Minimum**: 24–32 MB RAM  \n- **Recommended**: 48 MB RAM  \n\nIt genuinely ran (and was usable) on machines with 32 MB.\n\n### How they made it work\n\n1. **The operating system itself was tiny**\n   - Windows 95/98 typically used 8–16 MB just to run.\n   - Windows NT 4.0 was a bit heavier but still far lighter than modern Windows.\n   - Today Windows 11 + basic services easily eats 3–6 GB before you open anything.\n\n2. **Extremely lean application architecture**\n   - Written in native C++ with MFC.\n   - No garbage-collected runtimes, no Electron, no .NET, no JavaScript engine, no Chromium.\n   - Very little dynamic allocation compared to modern apps.\n   - Most code and resources were demand-paged from disk. Only the parts you were actively using stayed in RAM.\n\n3. **Much simpler feature set**\n   - No modern IntelliSense / Roslyn-style language services.\n   - No live analysis, no heavy background compilers, no AI, no web views.\n   - UI was classic Win32 + MFC — simple, not GPU-composited, not animated, not high-DPI.\n   - Editors and designers were far less sophisticated.\n\n4. **Aggressive use of virtual memory**\n   - 32 MB physical RAM + a large page file was normal.\n   - The OS and VS6 were written assuming that a lot of the working set would be swapped to disk when needed.\n   - Developers accepted some disk thrashing as the price of running on low-RAM machines.\n\n5. **Different engineering culture**\n   - Memory was expensive and scarce, so every allocation was scrutinized.\n   - Tools and libraries were built with “this must run in 16–32 MB” as a hard constraint.\n   - Bloat was actively fought because machines simply could not handle it.\n\n### Comparison to today\n\n| Era              | Typical usable IDE memory | OS baseline | Notes |\n|------------------|---------------------------|-------------|-------|\n| VS6 (1998)       | 15–40 MB working set     | 8–16 MB    | Designed for 32 MB machines |\n| Modern VS / VS Code | 500 MB – several GB    | 3–6+ GB    | Completely different constraints |\n\n### Relevance to our earlier discussion\n\nVS6 is proof that a complex, real-world application (full IDE with editor, debugger, form designer, compilers, etc.) **can** run in tens of megabytes when every layer is written with that goal.\n\nThe reason modern chat apps or terminals often use more is not that “text on a screen” inherently requires hundreds of megabytes — it’s that we stopped optimizing for low memory and started stacking heavy frameworks, runtimes, and convenience features on top of each other.\n\nA carefully written native chat app today could still get into the 25–40 MB range. VS6 shows that even much more ambitious software once lived in that territory.",
      "webSearchResults": [
        {
          "url": "https://learn.microsoft.com/en-us/previous-versions/aa700918(v=msdn.10)",
          "title": "System Requirements | Microsoft Learn",
          "preview": "# System Requirements | Microsoft Learn\nTable of contents Exit editor mode\nReading mode Table of…"
        },
        {
          "url": "https://learn-microsoft-com.translate.goog/en-us/visualstudio/releases/2026/vs-system-requirements?_x_tr_sl=en&_x_tr_tl=id&_x_tr_hl=id&_x_tr_pto=tc",
          "title": "Visual Studio 2026 System Requirements | Microsoft Learn",
          "preview": "For older versions of Visual Studio, see the system requirements for Visual Studio 2022 , Visual…"
        }
      ]
    }
  ]
};

module.exports = { GROK_RESPONSE_NODES, GROK_LOADED_RESPONSES };
