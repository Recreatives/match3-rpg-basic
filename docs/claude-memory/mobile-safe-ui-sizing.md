---
name: mobile-safe-ui-sizing
description: Any UI/layout size increase in match3-rpg-basic must stay overflow-safe and fully visible on mobile
metadata: 
  node_type: memory
  pinned: false
  originSessionId: 5b4e4ca8-e4dc-465c-b725-88262d6fef84
  modified: 2026-09-16T13:21:35.167Z
---

For the match3-rpg-basic ("Pixel Dungeon") project, whenever a change makes any UI element bigger — the board, combat portraits, HUD boxes, modals, or any other visual piece — the user has explicitly required that it must not cause the layout to overflow the screen on mobile devices, and every important element must stay fully visible without needing to scroll to see it. This was stated as a direct constraint before starting a multi-phase graphics/effects revision roadmap, specifically because the user cautioned that enlarging things (starting with combat portrait canvases) needs care since the game is played on mobile.

In practice this means: before treating any size-increasing UI change as done, check it against the smallest realistic phone viewport (both portrait and landscape orientation, since the project's own CSS ties board size to `min(viewport width, viewport height)` via `vmin`/`dvmin`), and prefer sizing that is tied to the same responsive mechanism the rest of the UI already uses (e.g. deriving from `--tile-size`/`--board-size`, which are already viewport-clamped) rather than picking a single larger fixed pixel value that could be safe on desktop but cause overflow or a squeezed/clipped layout on a small phone.
