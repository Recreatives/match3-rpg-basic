// Board rules shared by all three modes (findMatchGroups/getMatchShapeInfo/
// boardHasValidMove/reshuffleBoard live in game.js and pvp.js/coop.js call
// them directly) plus solo's live resolution loop.

function fakeTiles(types) { return types.map(function (ty) { return { dataset: { type: ty }, innerHTML: '' }; }); }

describe('Match detection', function () {
    it('detects a horizontal 3-match', function (ctx) {
        var b = noMatchBoard(); b[10] = b[11] = b[12] = 'sword';
        var groups = ctx.world.g('findMatchGroups')(fakeTiles(b), 8);
        expect(groups).toHaveLength(1);
        expect(groups[0].type).toBe('sword');
        expect(groups[0].indices.slice().sort(function (a, c) { return a - c; })).toEqual([10, 11, 12]);
        expect(groups[0].subShape).toBe('line');
    });

    it('detects a vertical 4-match', function (ctx) {
        var b = noMatchBoard(); [3, 11, 19, 27].forEach(function (i) { b[i] = 'heart'; });
        var groups = ctx.world.g('findMatchGroups')(fakeTiles(b), 8);
        expect(groups).toHaveLength(1);
        expect(groups[0].indices).toHaveLength(4);
    });

    it('a run touching the right edge is not wrapped into the next row', function (ctx) {
        var b = noMatchBoard(); b[6] = b[7] = 'skull'; b[8] = 'skull';
        // 6,7 end row 0 and 8 starts row 1 - consecutive indices, NOT a match
        var groups = ctx.world.g('findMatchGroups')(fakeTiles(b), 8);
        expect(groups.filter(function (g) { return g.type === 'skull'; })).toHaveLength(0);
    });

    it('merges an intersecting horizontal + vertical run into one cross group', function (ctx) {
        var b = noMatchBoard();
        [16, 17, 18].forEach(function (i) { b[i] = 'energy'; });   // row 2, cols 0-2
        [2, 10, 18].forEach(function (i) { b[i] = 'energy'; });    // col 2, rows 0-2 (corner 18 shared) -> L
        var groups = ctx.world.g('findMatchGroups')(fakeTiles(b), 8);
        var cross = groups.filter(function (g) { return g.subShape === 'cross'; });
        expect(cross).toHaveLength(1);
        expect(cross[0].indices).toHaveLength(5);
    });

    it('empty cells never match each other', function (ctx) {
        var b = noMatchBoard(); b[0] = b[1] = b[2] = '';
        expect(ctx.world.g('findMatchGroups')(fakeTiles(b), 8)).toHaveLength(0);
    });

    it('noMatchBoard helper really has no match (guards the other tests)', function (ctx) {
        expect(ctx.world.g('findMatchGroups')(fakeTiles(noMatchBoard()), 8)).toHaveLength(0);
    });
});

describe('Match shape multipliers', function () {
    var cases = [
        [3, false, { multiplier: 1, extraTurn: false, ultBonus: 0 }],
        [4, false, { multiplier: 2, extraTurn: true, ultBonus: 0 }],
        [5, false, { multiplier: 3, extraTurn: true, ultBonus: 30 }],
        [5, true, { multiplier: 2.5, extraTurn: true, ultBonus: 0 }],
        [6, true, { multiplier: 3.5, extraTurn: true, ultBonus: 60 }],
        [7, false, { multiplier: 4, extraTurn: true, ultBonus: 90 }],
        [9, true, { multiplier: 4, extraTurn: true, ultBonus: 90 }]
    ];
    cases.forEach(function (c) {
        it(c[0] + '-match' + (c[1] ? ' (cross)' : '') + ' -> x' + c[2].multiplier, function (ctx) {
            var info = ctx.world.g('getMatchShapeInfo')(c[0], c[1]);
            expect({ multiplier: info.multiplier, extraTurn: info.extraTurn, ultBonus: info.ultBonus }).toEqual(c[2]);
        });
    });
    it('multiplier never decreases as a match grows', function (ctx) {
        var f = ctx.world.g('getMatchShapeInfo'), prev = 0;
        for (var n = 3; n <= 10; n++) { var m = f(n, false).multiplier; expect(m).toBeGreaterThanOrEqual(prev); prev = m; }
    });
});

describe('Valid moves & reshuffle', function () {
    it('boardHasValidMove finds a one-swap match', function (ctx) {
        var b = noMatchBoard(); b[0] = b[1] = 'sword'; b[3] = 'sword'; // swap 2<->3 completes it
        expect(ctx.world.g('boardHasValidMove')(fakeTiles(b), 8)).toBe(true);
    });

    it('boardHasValidMove leaves the board untouched', function (ctx) {
        var b = noMatchBoard(), tiles = fakeTiles(b);
        ctx.world.g('boardHasValidMove')(tiles, 8);
        expect(tiles.map(function (t) { return t.dataset.type; })).toEqual(b);
    });

    it('reshuffleBoard always produces a valid move (200 seeded trials)', function (ctx) {
        var reshuffle = ctx.world.g('reshuffleBoard'), valid = ctx.world.g('boardHasValidMove'), pool = ctx.world.g('tileTypes');
        for (var trial = 0; trial < 200; trial++) {
            var tiles = fakeTiles(noMatchBoard());
            reshuffle(tiles, 8, pool);
            expect(valid(tiles, 8), 'trial ' + trial).toBe(true);
        }
    });

    it('reshuffleBoard only deals types from the given pool', function (ctx) {
        var tiles = fakeTiles(noMatchBoard());
        ctx.world.g('reshuffleBoard')(tiles, 8, [{ type: 'heart', symbol: 'h' }, { type: 'skull', symbol: 's' }]);
        tiles.forEach(function (t) { expect(['heart', 'skull']).toContain(t.dataset.type); });
    });
});

describe('Solo board resolution (live board, fake clock)', { isolate: 'each' }, function () {
    beforeEach(async function (ctx) { await startSolo(ctx.world, 'WARRIOR', { immortal: true }); freezeEnemyTurn(ctx.world); });

    // Regression: missing 'matched-big' removal in the gravity refill left a
    // 4+ match's tiles at scale(0)/opacity:0 forever (the user-reported
    // "column completely disappeared" bug).
    it('regression: 4+ match tiles are visible again after gravity refill', async function (ctx) {
        var w = ctx.world, b = noMatchBoard();
        [0, 1, 2, 3].forEach(function (i) { b[i] = 'energy'; });
        setBoard(w, b);
        w.g('checkForMatches(false)');
        expect(await w.settle(10000), 'board settled').toBe(true);
        var tiles = w.g('tiles');
        [0, 1, 2, 3].forEach(function (i) {
            expect(tiles[i].classList.contains('matched-big'), 'tile ' + i + ' matched-big').toBe(false);
            expect(tiles[i].classList.contains('matched'), 'tile ' + i + ' matched').toBe(false);
            expect(tiles[i].dataset.type, 'tile ' + i + ' type').not.toBe('');
        });
    });

    // Was flaky in the old harness (timers from the previous test leaked in);
    // deterministic now that every test gets a fresh world + fake clock.
    it('regression: a 2-group match step settles with every tile filled', async function (ctx) {
        var w = ctx.world, b = noMatchBoard();
        [0, 1, 2].forEach(function (i) { b[i] = 'sword'; });
        [13, 14, 15].forEach(function (i) { b[i] = 'heart'; });
        setBoard(w, b);
        w.g('checkForMatches(false)');
        expect(await w.settle(10000)).toBe(true);
        expect(boardTypes(w).filter(function (t) { return t === ''; })).toHaveLength(0);
        expect(w.g('findMatchGroups(tiles, width)')).toHaveLength(0);
    });

    it('a settled board always has a valid move for the next turn', async function (ctx) {
        var w = ctx.world;
        for (var s = 0; s < 5; s++) {
            var b = noMatchBoard(); b[40] = b[41] = b[42] = 'skull';
            setBoard(w, b);
            w.win.__setSeed(1000 + s);
            w.g('checkForMatches(false)');
            await w.settle(10000);
            expect(w.g('boardHasValidMove(tiles, width)'), 'seed ' + (1000 + s)).toBe(true);
        }
    });

    it('the turn ends exactly once per player move (no double enemy turn)', async function (ctx) {
        var w = ctx.world, ends = 0;
        w.win.endTurnLogic = function () { ends++; };
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'shield';
        setBoard(w, b);
        w.g('checkForMatches(false)');
        await w.settle(10000);
        expect(ends).toBe(1);
    });

    it('an invalid swap reverts and does not end the turn', async function (ctx) {
        var w = ctx.world, b = noMatchBoard();
        setBoard(w, b);
        var tiles = w.g('tiles');
        w.g('attemptSwap')(tiles[0], tiles[1]);
        await w.settle(5000);
        expect(boardTypes(w)).toEqual(b);
        expect(w.g('isProcessing')).toBe(false);
        expect(w.win.__turnEnded).toBeFalsy();
    });

    it('a valid swap via real input handlers resolves the match', async function (ctx) {
        var w = ctx.world, b = noMatchBoard();
        b[0] = b[1] = 'sword'; b[3] = 'sword'; b[2] = 'heart';
        setBoard(w, b);
        var tiles = w.g('tiles');
        w.g('handleInputStart')(tiles[2]);
        w.g('handleInputStart')(tiles[3]);
        await w.settle(10000);
        expect(w.win.__turnEnded).toBe(true);
        expect(boardTypes(w).filter(function (t) { return t === ''; })).toHaveLength(0);
    });

    it('regression: a new level never inherits a cut-short cascade count', async function (ctx) {
        var w = ctx.world;
        w.g('soloBoard.cascadeDepth = 3; startLevel()');
        await w.settle(5000);
        expect(w.g('soloBoard.cascadeDepth')).toBe(0);
    });

    it('cascade counter resets after the chain ends', async function (ctx) {
        var w = ctx.world, b = noMatchBoard(); b[0] = b[1] = b[2] = 'sword';
        setBoard(w, b);
        w.g('checkForMatches(false)');
        await w.settle(10000);
        expect(w.g('soloBoard.cascadeDepth')).toBe(0);
    });
});

describe('Enemy AI', { isolate: 'each' }, function () {
    beforeEach(async function (ctx) { await startSolo(ctx.world, 'WARRIOR'); });

    it('findBestMove returns an adjacent swap that really makes a match', function (ctx) {
        var w = ctx.world, b = noMatchBoard(); b[0] = b[1] = 'skull'; b[3] = 'skull';
        setBoard(w, b);
        var move = w.g('findBestMove()');
        expect(move).toBeTruthy();
        var d = Math.abs(move.index - move.target);
        expect(d === 1 || d === 8, 'adjacent').toBe(true);
        var after = b.slice(); after[move.index] = b[move.target]; after[move.target] = b[move.index];
        expect(w.g('findMatchGroups')(fakeTiles(after), 8).length).toBeGreaterThan(0);
    });

    it('a full enemy turn hands control back to the player', async function (ctx) {
        var w = ctx.world;
        w.g('isPlayerTurn = false; enemyPlayTurn()');
        await w.settle(20000);
        var state = w.g('currentState'), STATE = w.g('STATE');
        if (state === STATE.PLAYING) expect(w.g('isPlayerTurn')).toBe(true);
        expect(w.g('isProcessing') && state === STATE.PLAYING).toBe(false);
    });
});

describe('Seeded determinism', { world: false }, function () {
    it('the same seed deals the same opening board', async function () {
        var a = await createWorld({ seed: 42 }), b = await createWorld({ seed: 42 }), c = await createWorld({ seed: 43 });
        try {
            for (var w of [a, b, c]) { await startSolo(w, 'MAGE'); w.win.__setSeed(7); w.g('createBoard()'); }
            expect(boardTypes(a)).toEqual(boardTypes(b));
            c.win.__setSeed(8); c.g('createBoard()');
            expect(JSON.stringify(boardTypes(a)) === JSON.stringify(boardTypes(c))).toBe(false);
        } finally { a.destroy(); b.destroy(); c.destroy(); }
    });
});

describe('Level start (regressions)', { isolate: 'each', world: { pixi: false } }, function () {
    // The opening board's own cleanup cascade used to leave
    // extraTurnTriggered=true whenever it happened to land a 4+ match,
    // giving the first player move of the level a free extra turn.
    it('the setup cascade never grants an extra turn or ult charge', async function (ctx) {
        var w = ctx.world, leaks = [];
        for (var seed = 1; seed <= 40; seed++) {
            w.win.__setSeed(seed);
            await startSolo(w, 'WARRIOR');
            if (w.g('extraTurnTriggered') || w.g('ultCharge') !== 0) leaks.push(seed);
        }
        expect(leaks, 'seeds that leaked').toEqual([]);
    });

    it('ult charge from big matches is capped at 100', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        w.g('ultCharge = 90');
        var b = noMatchBoard(); [0, 1, 2, 3, 4, 5, 6].forEach(function (i) { b[i] = 'sword'; });
        setBoard(w, b);
        w.g('checkForMatches(false)');
        await w.settle(10000);
        expect(w.g('ultCharge')).toBeLessThanOrEqual(100);
    });
});

describe('Board feel (G1)', { isolate: 'each', world: { pixi: false } }, function () {
    it('refilled tiles fall exactly as many rows as they dropped', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        var b = noMatchBoard(); [0, 8, 16].forEach(function (i) { b[i] = 'energy'; }); // column 0, rows 0-2
        setBoard(w, b);
        scriptRandom(w, [0.05, 0.45, 0.85]);
        w.g('checkForMatches(false)');
        await w.tick(450); // clear delay -> gravity
        var tiles = w.g('tiles');
        [0, 8, 16].forEach(function (i) {
            expect(tiles[i].classList.contains('falling'), 'tile ' + i).toBe(true);
            expect(tiles[i].style.getPropertyValue('--fall-rows'), 'tile ' + i).toBe('3');
            expect(tiles[i].style.getPropertyValue('--fall-col')).toBe('0');
        });
        expect(tiles[24].classList.contains('falling'), 'untouched tile below').toBe(false);
    });

    it('a tile above a hole falls by the hole size', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        var b = noMatchBoard(); [16, 17, 18].forEach(function (i) { b[i] = 'sword'; }); // row 2
        setBoard(w, b);
        scriptRandom(w, [0.05, 0.45, 0.85]);
        w.g('checkForMatches(false)');
        await w.tick(450);
        var tiles = w.g('tiles');
        // column 1: rows 0,1 shift down one row, row 0 gets a new tile from 1 row up
        expect(tiles[9].style.getPropertyValue('--fall-rows')).toBe('1');
        expect(tiles[17].style.getPropertyValue('--fall-rows')).toBe('1');
        expect(tiles[17].style.getPropertyValue('--fall-col')).toBe('1');
    });

    it('an idle player gets a hint after 6s, not before, on a real valid move', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        w.g('startPlayerTimer()');
        await w.tick(5000);
        expect(w.doc.querySelectorAll('#grid .tile.hint').length).toBe(0);
        await w.tick(1500);
        var hinted = w.g('tiles').map(function (t, i) { return t.classList.contains('hint') ? i : -1; }).filter(function (i) { return i >= 0; });
        expect(hinted).toHaveLength(2);
        var d = Math.abs(hinted[0] - hinted[1]);
        expect(d === 1 || d === 8, 'adjacent').toBe(true);
        var types = boardTypes(w), h = types[hinted[0]]; types[hinted[0]] = types[hinted[1]]; types[hinted[1]] = h;
        expect(w.g('findMatchGroups')(fakeTiles(types), 8).length).toBeGreaterThan(0);
    });

    it('any input or the turn ending clears the hint', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        w.g('startPlayerTimer()');
        await w.tick(6500);
        expect(w.doc.querySelectorAll('#grid .tile.hint').length).toBe(2);
        w.g('handleInputStart(tiles[0])');
        expect(w.doc.querySelectorAll('#grid .tile.hint').length).toBe(0);
        w.g('handleInputStart(tiles[0])'); // deselect
        w.g('startPlayerTimer()');
        await w.tick(6500);
        w.g('stopPlayerTimer()');
        expect(w.doc.querySelectorAll('#grid .tile.hint').length).toBe(0);
    });

    it('an invalid swap slides, shakes and slides back', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        var b = noMatchBoard();
        setBoard(w, b);
        var tiles = w.g('tiles');
        w.g('attemptSwap')(tiles[0], tiles[1]);
        await w.tick(150);
        expect(tiles[0].classList.contains('invalid-swap')).toBe(true);
        expect(w.g('isProcessing'), 'input locked during the bounce').toBe(true);
        await w.settle(2000);
        expect(tiles[0].classList.contains('invalid-swap')).toBe(false);
        expect(boardTypes(w)).toEqual(b);
        expect(w.g('isProcessing')).toBe(false);
    });

    it('reduced motion / low graphics skip the swap slide entirely', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        w.g('cgToggleLowGraphics()');
        expect(w.g('sbMotionMs(140)')).toBe(0);
        w.g('cgToggleLowGraphics()');
        expect(w.g('sbMotionMs(140)')).toBe(140);
    });
});
