---
name: share-files-in-side-panel
description: "When handing the user a project file to look at or copy from, open it in the app's side panel, not as a URL"
metadata:
  node_type: memory
  pinned: false
  originSessionId: 7e77f707-f488-433d-911f-a873e0af7c02
  modified: 2026-09-27T23:05:45.867Z
---

On the match3-rpg-basic (Pixel Dungeon) project, when the user needs to see or copy a local file (for example `supabase/schema.sql` before running it in Supabase), they want it opened in the desktop app's side panel (SendUserFile with display "render"), not given as a GitHub/raw URL. They corrected a raw.githubusercontent.com link for exactly this. Links are still what they want for external destinations they must visit themselves, such as the Supabase SQL Editor or the GitHub Pages test build — so read carefully which one they are asking for: "the place where I run the SQL" means the Supabase SQL Editor URL, not the file.
