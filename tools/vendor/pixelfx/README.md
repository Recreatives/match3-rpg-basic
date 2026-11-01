# pixelfx (vendored)

https://github.com/patch-gg/pixelfx at commit `a84159688af3ca37a4be05a0d422b94451b2e24e`
(2026-10-31): only `src/`, `LICENSE` and `NOTICE.md`, unchanged. MIT, Copyright (c) 2026 Patch
and Hugo Duprez; parts adapt Sprite Fusion (Hugo Duprez, MIT) and Hollow Crown (rehan-remade,
MIT) - see NOTICE.md. The gallery font is not included.

Used by `tools/make_pixelfx.mjs` (bakes the game's sprite sheets, `assets/fx/`) and the dev page
`tools/pixelfx-study.html` (`docs/ROADMAP-effects.md`). The game itself never loads this code. To update: copy a newer `src/` over this one, change the commit above, and
re-check the study page.
