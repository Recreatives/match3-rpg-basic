# Characters, visible gear & inventory - roadmap

Status: phases 0-10 implemented on `feature/characters-gear` (v1.37), waiting for the user's own test and the production schema run. Work happens on a feature branch;
nothing merges to `main` without the user's own test and explicit go-ahead.

## Decisions (from the user)

| Topic | Decision |
|---|---|
| Art style | **Style C** - head ~1/5 of body height, between "epic realistic" (1/6) and "epic stylized" (1/4). See `tools/character-study.html`. |
| Characters | Pick a class on first login and keep developing that character. New characters start from zero. |
| Gold | **Per character**, not shared. |
| Shared stash | Yes, but every item has a **level requirement** and characters have levels, so a fresh character can't wear end-game gear. |
| Item count | Raise substantially: unique-feeling items for every level band. |
| Weapons | **Class-restricted** weapon (and off-hand) types. |
| Body variants | **Male and female** bodies. |
| PvP | Anyone can match anyone for now. Matchmaking is a much later, separate design. |

## Architecture

Characters are layered, procedurally painted rigs (`avatar.js`): a body type
(heavy / agile / robed x male / female) + appearance (skin, hair, hair
color, beard) + equipped items. Every item is data (slot, material, tier,
palette, effects) painted onto the same jointed skeleton the combat arena
already animates, so any combination works without hand-drawing it, and
the inventory icon is drawn from the same painter as the worn piece.

## Phases

0. Style C final, skeletons for 6 bodies, appearance options, live preview (character creator prototype).
1. Layered avatar engine in the game (bake layers per part into one texture on equip; "try-on" preview).
2. Item catalog redesign: 13 slots (helmet, shoulders, amulet, chest, gloves, belt, legs, boots, 2 rings, weapon, off-hand), class weapon/off-hand types, item level + level requirement, bag size, visual descriptors; many more bases per level band.
3. Data model + server: `characters` (class, level, xp, gold, appearance), per-character items/equipment/talents, level-gated shared stash; RPCs `create_character`, `delete_character`, `equip_item` (class/level/slot checks), `award_run_xp` (bounded), stash moves; migration of existing players into a first character. Tables touched move to non-destructive migrations (today `player_items` is dropped on every schema re-run).
4. Character create/select screens (first-login flow, appearance, per-character play; PvP/co-op use the active character and show its gear).
5. Inventory UI inspired by Diablo 3: live character in the middle, slots around it, bag grid, compare tooltip with deltas and try-on, stats panel, sort/filter/lock, stash tab; mobile-first interactions.
6. Item art production: all bases x bodies x ornament tiers, set looks + full-set aura, hand-designed uniques with idle effects, drawn icons.
7. Item animation: equip flourish, weapon-type move sets, rarity trails, visible legendary procs, loot beams.
8. Progression: levels 1-50 + mastery points, class stat growth, talents per character, item level scaling, loot by level/floor, balance + golden master.
9. Whole roster (7 classes, 5 monsters + gear variants) in style C.
10. Tests (every item on every body, inventory flows, RPC bounds), performance on weak phones, rollout.
