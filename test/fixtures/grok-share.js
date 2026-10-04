const GROK_SHARE_FIXTURE = {
  "conversation": {
    "conversationId": "1ebe773e-0a4c-46d7-a3d0-9044b22fc4da",
    "title": "How Much Memory in refterm GitHub Repo"
  },
  "responses": [
    {
      "responseId": "99882973-02f4-4535-bd8c-11c2e1406000",
      "sender": "human",
      "createTime": "2026-10-02T09:03:10.302Z",
      "parentResponseId": "12766d5b-ac20-5cd1-b386-7ca08f4249f4",
      "query": "",
      "inputChunks": [
        {
          "text": {
            "text": "how much memory did https://github.com/cmuratori/refterm use"
          }
        }
      ],
      "webSearchResults": [],
      "outputChunks": []
    },
    {
      "responseId": "87479f85-ee26-4cdd-acba-584c558d79fe",
      "sender": "assistant",
      "createTime": "2026-10-02T09:03:10.312Z",
      "parentResponseId": "99882973-02f4-4535-bd8c-11c2e1406000",
      "query": "",
      "inputChunks": [],
      "webSearchResults": [
        {
          "url": "https://github.com/cmuratori/refterm/blob/main/README.md",
          "title": "refterm/README.md at main · cmuratori/refterm · GitHub",
          "preview": "* Fork\n69\nStar\n1.8k\n## Files\nmain\n# README.md\nBlame\nBlame\n## Latest commit\n## History\nHistory\n41…"
        },
        {
          "url": "https://github.com/cmuratori/refterm/blob/main/refterm_glyph_cache.h",
          "title": "refterm/refterm_glyph_cache.h at main · cmuratori/refterm · GitHub",
          "preview": "typedef struct glyph_table glyph_table ;\ntypedef struct glyph_entry glyph_entry ;\n/* NOTE(casey):…"
        }
      ],
      "outputChunks": [
        {
          "metadata": {
            "stepId": 0,
            "phaseIndex": 0
          },
          "text": {
            "text": "Thinking about your request",
            "channel": "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
          }
        },
        {
          "metadata": {
            "stepId": 1,
            "phaseIndex": 3
          },
          "text": {
            "text": "Estimating refterm memory usage",
            "channel": "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
          }
        },
        {
          "metadata": {
            "stepId": 3,
            "phaseIndex": 5
          },
          "text": {
            "text": "**Around 44 MB of physical memory when idle (as measured by Casey Muratori in his Refterm v2 video), with a fixed ~16 MB scrollback buffer making up a substantial portion of that.**",
            "channel": "CHANNEL_ASSISTANT_RESPONSE"
          }
        },
        {
          "metadata": {
            "stepId": 2,
            "phaseIndex": 4
          },
          "text": {
            "text": "Estimating refterm memory usage",
            "channel": "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
          }
        },
        {
          "metadata": {
            "stepId": 3,
            "phaseIndex": 5
          },
          "text": {
            "text": "\n\nIn the \"Refterm v2 - Resource usage...\" video, Casey shows Task Manager numbers:\n- Fresh Windows Terminal Preview: ~23.4 MB physical memory.\n- Refterm (release Clang build): ~44.3 MB physical memory.\n\nHe notes that idle comparisons aren't very meaningful and demonstrates actual usage by dumping a 1 GB file (\"splat\"). Windows Terminal spikes to ~280–300 MB and later settles around ~150 MB permanently. Refterm stays essentially flat (no ongoing allocations after startup), with only a brief initial spike that Casey attributes to DirectWrite glyph generation/caching on first use. After that, it does not keep growing. He states that Windows Terminal ends up at roughly 3–4× Refterm’s memory usage, which is consistent with the ~44 MB baseline.",
            "channel": "CHANNEL_ASSISTANT_RESPONSE"
          }
        },
        {
          "metadata": {
            "stepId": 3,
            "phaseIndex": 5
          },
          "text": {
            "text": "\n\nKey points from the video and code:\n- Scrollback is a fixed 16 MB circular buffer (double-mapped for efficient wrap-around).\n- Glyph cache and other structures are sized for practical use (not giant test allocations); parameters are tunable.\n- Most of the remaining footprint comes from DirectX/DirectWrite overhead that the app does not fully control.\n- Memory usage is designed to be stable: allocate once at startup, then no further heap allocations during normal operation.\n\nA third-party measurement (Nibble Stew blog) reported ~351 MB idle on a 4K monitor. That figure is substantially higher than Casey’s Task Manager numbers and may reflect different measurement methodology (e.g., private bytes vs. working set), larger window/glyph cache settings, GPU-related reservations, or a different build. Casey’s own figures and the explicit 16 MB scrollback are the primary reference from the project author.",
            "channel": "CHANNEL_ASSISTANT_RESPONSE"
          }
        },
        {
          "metadata": {
            "stepId": 3,
            "phaseIndex": 5
          },
          "text": {
            "text": "\n\nIn short, the intended/practical memory usage demonstrated by the author is on the order of tens of megabytes (roughly 40–50 MB range after warm-up), dominated by the fixed scrollback plus DirectX overhead, and it stays flat under load.",
            "channel": "CHANNEL_ASSISTANT_RESPONSE"
          }
        },
        {
          "metadata": {
            "stepId": 3,
            "phaseIndex": 4
          },
          "text": {
            "text": "Estimating refterm memory usage",
            "channel": "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
          }
        }
      ]
    },
    {
      "responseId": "b9bb1e30-a6c9-4203-b6c1-12d04773a92c",
      "sender": "human",
      "createTime": "2026-10-02T09:06:03.544Z",
      "parentResponseId": "87479f85-ee26-4cdd-acba-584c558d79fe",
      "query": "",
      "inputChunks": [
        {
          "text": {
            "text": "if you were to run it on apple silicon what would you need to change"
          }
        }
      ],
      "webSearchResults": [],
      "outputChunks": []
    },
    {
      "responseId": "c5d58429-503f-4502-9513-fe0f981a9c70",
      "sender": "assistant",
      "createTime": "2026-10-02T09:06:03.557Z",
      "parentResponseId": "b9bb1e30-a6c9-4203-b6c1-12d04773a92c",
      "query": "",
      "inputChunks": [],
      "webSearchResults": [
        {
          "url": "https://github.com/cmuratori/refterm",
          "title": "GitHub - cmuratori/refterm: Reference monospace terminal renderer · GitHub",
          "preview": "refterm_glyph_cache.h |  |  |\n| refterm_ps.h | refterm_ps.h |  |  |\n| refterm_vs.h | refterm_vs.h |…"
        },
        {
          "url": "https://github.com/cmuratori/refterm/releases",
          "title": "Releases · cmuratori/refterm · GitHub",
          "preview": "# Releases · cmuratori/refterm · GitHub\nSkip to content\n## Navigation Menu\nSign in\n```\nAppearance…"
        }
      ],
      "outputChunks": [
        {
          "metadata": {
            "stepId": 0,
            "phaseIndex": 0
          },
          "text": {
            "text": "Thinking about your request",
            "channel": "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
          }
        },
        {
          "metadata": {
            "stepId": 1,
            "phaseIndex": 1
          },
          "text": {
            "text": "Analyzing porting requirements for Apple Silicon",
            "channel": "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
          }
        },
        {
          "metadata": {
            "stepId": 2,
            "phaseIndex": 1
          },
          "text": {
            "text": "Evaluating porting requirements for Apple Silicon",
            "channel": "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
          }
        },
        {
          "metadata": {
            "stepId": 1,
            "phaseIndex": 3
          },
          "text": {
            "text": "**Almost everything platform-specific would need to be rewritten.** Refterm is a deliberately Windows-centric reference implementation. The core ideas (simple LRU glyph cache + tile-based GPU renderer) are portable, but the actual code leans heavily on Win32, Direct3D 11, DirectWrite, and Uniscribe.\n\nHere’s what would need to change for Apple Silicon (macOS / arm64):\n\n### 1. Graphics / Rendering (biggest piece)\n- **Current**: Direct3D 11 + HLSL shaders (`refterm.hlsl`, vertex/pixel/compute paths) + DXGI swap chain.\n- **Needed**: Metal (preferred and native on Apple Silicon).  \n  - Rewrite the shaders in Metal Shading Language (MSL).  \n  - Replace the D3D11 device, context, textures, buffers, and swap-chain logic with `MTLDevice`, `MTLCommandQueue`, `MTLRenderPipelineState` / compute pipelines, `MTLTexture`, etc.  \n  - The cell-based tile renderer maps cleanly to a Metal compute or fragment shader that samples a glyph atlas.\n\nVulkan via MoltenVK is possible but adds complexity and is less idiomatic on macOS.\n\n### 2. Glyph Generation & Unicode\n- **Current**: DirectWrite + Uniscribe (slow by design, to prove the point).\n- **Needed**: Core Text (`CTFont`, `CTLine`, `CTRun`) + Core Graphics for rasterizing glyphs into the atlas texture.  \n  HarfBuzz + FreeType is a solid cross-platform alternative if you want to stay closer to the original “use the system’s slow Unicode/font stack” philosophy.\n\nYou would keep the same glyph-cache design (`refterm_glyph_cache.h/c`); only the “miss → generate glyph” backend changes.\n\n### 3. Windowing, Input, Event Loop\n- **Current**: Win32 (`CreateWindowEx`, message pump, `WM_*` messages, DPI handling).\n- **Needed**: AppKit / Cocoa (`NSWindow`, `NSView` with a Metal layer, or `MTKView`).  \n  Or use a thin cross-platform layer (GLFW, SDL2/3) if you want less pure-Cocoa code.  \n  Handle keyboard, mouse, resize, and high-DPI (Retina) scaling yourself.\n\n### 4. Threading & Synchronization\n- **Current**: `CreateThread`, Win32 critical sections / events.\n- **Needed**: pthreads or Grand Central Dispatch (GCD). The dual-thread design (one thread for terminal/pipe processing, one for rendering) ports directly.\n\n### 5. Memory Mapping (Scrollback Buffer)\n- **Current**: Windows-specific double-mapping trick with `CreateFileMapping` + `MapViewOfFileEx` / `VirtualAlloc2` + placeholders so the circular buffer appears contiguous.\n- **Needed**: `mmap` (with careful use of `MAP_FIXED` or probing) or Mach VM APIs (`mach_vm_allocate` + remapping). The same “two consecutive virtual mappings of the same physical pages” technique is possible on macOS but the code has to be rewritten.\n\n### 6. Process / PTY / Pipe Handling\n- **Current**: Windows console pipes, conhost interaction, and the “fast pipe” named-pipe bypass.\n- **Needed**: Standard Unix pseudo-terminals (`openpty` / `forkpty` / `posix_openpt`). The terminal becomes a proper PTY master. No equivalent of conhost exists, so the “fast pipe” demonstration becomes unnecessary.\n\n### 7. Build System & Toolchain\n- Drop the `.bat` / MSVC-oriented build.  \n- Use Xcode, CMake, or a simple Makefile targeting `arm64-apple-macosx`.  \n- Link against Metal, Core Text, AppKit, etc.  \n- Remove the `#error` for non-x64 and any x86 intrinsics (replace with NEON if any remain).\n\n### 8. Minor / Supporting Pieces\n- String handling, path APIs, DPI scaling, high-resolution timing, etc. all need the macOS equivalents.\n- The example source-buffer, terminal, and DWrite glue files are essentially throw-away platform code; only the glyph-cache and shader logic are the “reference” parts worth preserving closely.\n\n### Practical Path\n1. Keep `refterm_glyph_cache.*` almost unchanged.  \n2. Port the shader to Metal and get a static atlas + cell renderer drawing.  \n3. Swap in Core Text for glyph rasterization.  \n4. Add a minimal Cocoa + Metal view and PTY support.  \n5. Re-implement the circular scrollback with `mmap`.\n\nThe result would still be a relatively small codebase demonstrating the same point (a simple tile renderer + cache is fast even with a non-optimal text stack), just running natively on Apple Silicon. No public port currently exists; it would be a from-scratch platform layer on top of the reusable core ideas.",
            "channel": "CHANNEL_ASSISTANT_RESPONSE"
          }
        },
        {
          "metadata": {
            "stepId": 3,
            "phaseIndex": 2
          },
          "text": {
            "text": "Evaluating porting requirements for Apple Silicon",
            "channel": "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
          }
        }
      ]
    }
  ]
};

module.exports = { GROK_SHARE_FIXTURE };
