---
name: turkish-language-responses
description: "User expects all conversational replies in Turkish for the Pixel Dungeon project, never English"
metadata: 
  node_type: memory
  pinned: true
  originSessionId: 1ee30ca3-c7ee-47b0-ab83-76c565e70e0d
  modified: 2026-09-05T20:48:34.129Z
---

On the match3-rpg-basic (Pixel Dungeon) project, the user communicates in Turkish and expects every conversational reply — explanations, status updates, questions, summaries, error walkthroughs — to be written in Turkish, never English. Code, code comments, identifiers, and commit messages can stay in English as the codebase already does; only the text addressed directly to the user must be Turkish. This applies throughout an entire session, including after a long technical detour done in English (for example, researching Supabase's own documentation, which is English-only) — the reply that follows such a detour still has to come back to Turkish. The user has explicitly corrected a drift into English more than once, so any lapse should be treated as a mistake to catch and fix immediately, not something to wait for a prompt about.
