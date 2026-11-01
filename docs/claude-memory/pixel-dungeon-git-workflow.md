---
name: pixel-dungeon-git-workflow
description: Standing git/deployment workflow the user expects for the match3-rpg-basic (Pixel Dungeon) project
metadata: 
  node_type: memory
  pinned: false
  originSessionId: 1ee30ca3-c7ee-47b0-ab83-76c565e70e0d
  modified: 2026-09-04T23:35:23.940Z
---

For the match3-rpg-basic ("Pixel Dungeon") project, the user has repeatedly reinforced a strict rule: never merge or push a feature branch to `main` until the user has personally tested it in the browser and given explicit approval (a direct "birleştir"/"merge it", or an unambiguous confirmation like "testler tamam" made right after being offered exactly that choice). Never merge on your own initiative just because local testing passed.

The user periodically asks for a large batch of features to be built fully autonomously, explicitly saying they are going offline for several hours and do not want to be asked further questions before then. When this happens, the correct workflow is: create a new feature branch off `main` for the batch, implement and thoroughly test everything in the local browser dev server (never against a modal/click-driven check alone - use real interaction like mouse hover where relevant, and verify computed layout/screenshots since headless computed-style APIs have occasionally reported an incorrect value that visual screenshots disproved), commit with a detailed message, push the branch, and repoint GitHub Pages at that branch (via `gh api repos/.../pages -X PUT` then a manual `pages/builds` POST to force a rebuild) so a live link is ready the moment the user wakes up - but do not merge to `main` even after this thorough autonomous testing. Wait for the user's own follow-up test and explicit go-ahead first.

Also project-specific: `supabase/schema.sql` is written as full `drop table ... cascade; create table ...` replacements rather than incremental migrations, and the user must manually re-run the whole file in the Supabase SQL Editor for any schema change to take effect - always call this out clearly and explain exactly what will break (and that existing rows in that table get wiped) until they do.
