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
