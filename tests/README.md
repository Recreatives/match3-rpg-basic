# Pixel Dungeon tests

Zero-dependency, in-browser test harness. It runs against the **real** game
(`index.html` and every script it loads), not a copy.

## Running

- **Locally:** serve the repo root (the `static-server` config in
  `.claude/launch.json`, or `python3 -m http.server 8262`) and open
  <http://localhost:8262/tests/index.html>. A full run takes about 35 seconds.
- **Only some tests:** `?grep=text` (case-insensitive, matches `suite + test name`).
  Each suite heading also has a ▶ link that reruns just that suite.
- **Different randomness:** `?seed=N` overrides every world's RNG seed.
- **CI:** `.github/workflows/ci.yml` runs the same page headlessly through
  `tests/run-ci.mjs` (Playwright). Its `sql` job runs `tests/sql/`, described below.

The runner cache-busts every script it loads, so an edit never tests stale code.

## Worlds

A *world* is an iframe running the real `index.html`, lightly rewritten by
`harness.js`:

| Real page | In a world |
|---|---|
| Supabase CDN client | `tests/supabase-stub.js` (in-memory tables, RPC handlers, call log, fake realtime bus) |
| Cloudflare Turnstile, service worker | removed |
| `Math.random` | seeded PRNG (`world.win.__setSeed(n)`) |
| `setTimeout` / `setInterval` / `Date.now` | fake clock (`world.clock`) |
| `localStorage` | in-memory, starts with the tutorial marked as seen |
| uncaught errors / rejections | fail the test that caused them |

```js
describe('Suite name', { isolate: 'each', world: { seed: 7, pixi: false, viewport: { width: 360, height: 640 } } }, function () {
    beforeEach(async function (ctx) { await startSolo(ctx.world, 'MAGE', { level: 3, immortal: true }); });
    it('does a thing', async function (ctx) {
        var w = ctx.world;
        w.g('ultCharge = 100; useUltimate()');   // any global, even let/const
        await w.settle(5000);                    // run fake timers until nothing one-shot is pending
        expect(w.g('enemyHP')).toBeLessThan(500);
        expect(w.$('ult-btn').disabled).toBe(true);   // getElementById in the world
    });
});
```

- `isolate: 'each'` gives every test a fresh world. By default one world is
  shared by the suite, and the clock and error list are reset between tests.
- `world: false` means the suite creates its own worlds. Multiplayer tests do this.
- `world.tick(ms)` advances fake time. `world.settle(maxMs)` advances until no
  one-shot timer is left; intervals such as the speed-bonus ticker don't count.
- `world.stub.calls` lists every RPC, table op and broadcast.
  `world.stub.rpc.name = fn` overrides one server function.
- `awaitInWorld(world, promise)` awaits something the page does that needs
  both fake timers and real time, e.g. PixiJS init or texture loads.

Helpers are in `helpers.js`: `noMatchBoard`, `setBoard`, `boardTypes`,
`startSolo`, `freezeEnemyTurn`, `scriptRandom`, `makeBus`, `awaitInWorld`.

## Multiplayer

Create two worlds with the same `realtimeBus: makeBus()` and different `userId`s.
Join them the way the UI does, e.g. `pvpJoinRoom()` / `coopJoinRoom()`, then use
`settleAll([A, B], bus)` to deliver broadcasts and run both clocks until quiet.
See `specs/multiplayer.spec.js` (`joinPvp`, `joinCoop`).

## Golden master

`specs/combat.spec.js` plays a seeded 40-move solo run and compares a
fingerprint. If you change combat, AI, board or reward behavior **on purpose**,
the failure message prints the new fingerprint. Paste it into `EXPECTED` and say
why in the commit message.

## Adding a spec file

Create `specs/name.spec.js` and add it to the `files` list in `tests/index.html`.

## SQL (`tests/sql/`, CI only)

1. `00_supabase_shim.sql` creates what Supabase normally provides: the `auth`
   schema, `auth.users`, `auth.uid()` (reads `request.jwt.claim.sub`), the three
   roles and the default grants.
2. `supabase/schema.sql` is applied **twice**, which proves it can be safely re-run.
3. `10_rls_and_rpcs.sql` impersonates players and checks the security rules:
   `earn_currency` bounds, no direct wallet writes, item-insert validation and
   RLS, and `purchase_item` price and rarity rules.

To add a check, write a `do $$ ... raise exception 'FAIL: ...' $$` block or use
`tst.expect_error(sql, 'message fragment')`.
