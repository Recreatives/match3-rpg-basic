// Shared test helpers - thin wrappers over the REAL game functions (reached
// through world.g, see harness.js), never reimplementations of game rules.

var TILE_SYMBOLS = { sword: '⚔️', heart: '💖', shield: '🛡️', energy: '⚡', skull: '💀' };
var CYCLE_TYPES = ['sword', 'heart', 'shield', 'energy', 'skull'];

// An 8x8 board with no match anywhere: type = (index % 5) never repeats
// horizontally (consecutive indices differ) or vertically (i and i+8 differ
// by 3 mod 5). Callers overwrite a few cells to plant the exact match a
// test needs.
function noMatchBoard(width) {
    var w = width || 8, out = [];
    for (var i = 0; i < w * w; i++) out.push(CYCLE_TYPES[i % 5]);
    return out;
}

// Writes a type layout onto a live tiles array (solo's `tiles`, pvpTiles,
// coopTiles) exactly the way the game's own refill does: type + symbol +
// a clean class list.
function setBoard(world, types, tilesExpr) {
    var tiles = world.g(tilesExpr || 'tiles');
    types.forEach(function (ty, i) {
        tiles[i].dataset.type = ty;
        tiles[i].innerHTML = ty ? TILE_SYMBOLS[ty] : '';
        tiles[i].className = 'tile';
    });
    return tiles;
}

function boardTypes(world, tilesExpr) {
    return world.g(tilesExpr || 'tiles').map(function (t) { return t.dataset.type; });
}

// Class pick + solo start through the real functions the class/mode buttons
// call (renderClassButtons/renderModeButtons onclick bodies), minus the
// clicks. Leaves the world at the given level, player's turn, settled
// board (createBoard's own initial-match cleanup runs on a 400ms timer).
// opts.immortal: gives both sides a huge HP pool - board tests care about
// resolution mechanics, and a reshuffle's free matches can otherwise kill a
// level-1 monster mid-test and flip the game into REWARD state.
async function startSolo(world, classKey, opts) {
    opts = opts || {};
    world.g('selectedClass = CLASSES.' + (classKey || 'WARRIOR'));
    world.g('rebuildTileStats(); resetGame();');
    if (opts.level) world.g('level = ' + opts.level);
    world.g('startLevel()');
    await world.settle(5000);
    if (opts.immortal) world.g('enemyHP = maxEnemyHP = 1e9; playerHP = maxPlayerHP = 1e9;');
}

// Stops the solo turn cycle at the end of the player's own resolution, so a
// board test can inspect the settled result without the enemy AI then
// taking its turn on the same board.
function freezeEnemyTurn(world) {
    world.win.endTurnLogic = function () { world.win.__turnEnded = true; };
}

function makeBus() { return { channels: {}, queue: [] }; }

// Replaces a world's Math.random with a fixed cycle - used right before a
// scripted move so gravity's refill can't randomly chain into extra matches
// and blur what the test is measuring. [0.05, 0.45, 0.85] deals
// sword, shield, skull, sword, ... (tileTypes order).
function scriptRandom(world, values) {
    var i = 0;
    world.win.Math.random = function () { return values[i++ % values.length]; };
}

// Awaits a promise from inside a world while also advancing that world's
// fake clock - anything the page awaits that internally waits on
// setTimeout (PixiJS's renderer init does, sometimes) would otherwise
// never resolve under fake timers.
async function awaitInWorld(world, promise, maxMs) {
    var done = false, value, error;
    Promise.resolve(promise).then(function (v) { done = true; value = v; }, function (e) { done = true; error = e; });
    // Real time has to pass too (image fetch/decode), so each step also
    // yields ~10ms of wall clock.
    for (var waited = 0; !done && waited < (maxMs || 10000); waited += 50) {
        await world.tick(50);
        if (!done) await new Promise(function (r) { setTimeout(r, 10); });
    }
    if (error) throw error;
    if (!done) throw new Error('awaitInWorld: still pending after ' + (maxMs || 10000) + 'ms of fake time');
    return value;
}
