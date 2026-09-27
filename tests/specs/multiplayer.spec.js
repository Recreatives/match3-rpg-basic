// PvP and co-op, end to end: two REAL game worlds (two iframes running
// index.html) talking through one in-memory realtime bus (supabase-stub.js).
// Every broadcast, presence sync and turn handoff goes through the same
// code paths a live match uses - only the transport is fake.

// Finds any adjacent swap on a world's board that produces a match of
// `wantType` (or any type when omitted). Returns [i, j] or null.
function findMoveOn(world, tilesExpr, wantType) {
    var types = boardTypes(world, tilesExpr), find = world.g('findMatchGroups');
    for (var i = 0; i < 64; i++) {
        var nbrs = [];
        if (i % 8 < 7) nbrs.push(i + 1);
        if (i < 56) nbrs.push(i + 8);
        for (var k = 0; k < nbrs.length; k++) {
            var j = nbrs[k], t = types.slice(), h = t[i]; t[i] = t[j]; t[j] = h;
            var groups = find(t.map(function (ty) { return { dataset: { type: ty } }; }), 8);
            if (groups.length && (!wantType || groups.some(function (g) { return g.type === wantType; }))) return [i, j];
        }
    }
    return null;
}

// Plants the same board on both clients (the shared board is the same
// board everywhere - see sharedboard.js).
function setSharedBoard(worlds, types, tilesExpr) { worlds.forEach(function (w) { setBoard(w, types, tilesExpr); }); }

async function joinPvp(bus, classA, classB, opts) {
    opts = opts || {};
    var A = await createWorld({ userId: 'alice', realtimeBus: bus, seed: 11, pixi: false });
    var B = await createWorld({ userId: 'bob', realtimeBus: bus, seed: 22, pixi: false });
    A.g('selectedClass = CLASSES.' + classA + '; rebuildTileStats()');
    B.g('selectedClass = CLASSES.' + classB + '; rebuildTileStats()');
    if (opts.beforeJoin) opts.beforeJoin(A, B);
    A.$('pvp-room-input').value = 'TESTROOM';
    B.$('pvp-room-input').value = 'TESTROOM';
    A.g(opts.joinA || 'pvpJoinRoom()');
    await settleAll([A, B], bus);
    B.g(opts.joinB || 'pvpJoinRoom()');
    await settleAll([A, B], bus);
    return { A: A, B: B };
}

async function joinCoop(bus, classA, classB, opts) {
    opts = opts || {};
    var H = await createWorld({ userId: 'hana', realtimeBus: bus, seed: 33, pixi: false });
    var G = await createWorld({ userId: 'gus', realtimeBus: bus, seed: 44, pixi: false });
    H.g('selectedClass = CLASSES.' + classA + '; rebuildTileStats()');
    G.g('selectedClass = CLASSES.' + classB + '; rebuildTileStats()');
    if (opts.beforeJoin) opts.beforeJoin(H, G);
    H.$('coop-room-input').value = 'COOPROOM';
    G.$('coop-room-input').value = 'COOPROOM';
    H.g('coopJoinRoom()');
    await settleAll([H, G], bus);
    G.g('coopJoinRoom()');
    await settleAll([H, G], bus);
    return { H: H, G: G };
}

function tap(world, handler, tilesExpr, i) { world.g(handler)(world.g(tilesExpr)[i]); }

var CALM_REFILL = [0.05, 0.45, 0.85];

describe('PvP (two live clients)', { world: false }, function () {
    // M = whoever moves first (earliest presence join), W = the one waiting.
    var bus, A, B, M, W;
    beforeEach(async function () {
        bus = makeBus();
        var p = await joinPvp(bus, 'WARRIOR', 'WARRIOR');
        A = p.A; B = p.B;
        M = A.g('pvpMyTurn') ? A : B;
        W = M === A ? B : A;
    });
    afterEach(function () { A.destroy(); B.destroy(); });

    it('both clients start the match and exactly one moves first', function () {
        expect(A.g('pvpStarted') && B.g('pvpStarted')).toBe(true);
        expect(A.g('pvpMyTurn') !== B.g('pvpMyTurn')).toBe(true);
        expect(A.g('pvpOpponentId')).toBe('bob');
        expect(B.g('pvpOpponentId')).toBe('alice');
    });

    it('both clients see the same opening board, and it has a valid move', function () {
        expect(boardTypes(B, 'pvpTiles')).toEqual(boardTypes(A, 'pvpTiles'));
        expect(boardTypes(A, 'pvpTiles').indexOf('')).toBe(-1);
        expect(A.g('boardHasValidMove(pvpTiles, 8)')).toBe(true);
    });

    it('a sword match damages the opponent by stat x speed bonus', async function () {
        var b = noMatchBoard(); b[0] = b[1] = 'sword'; b[3] = 'sword'; b[2] = 'heart';
        setSharedBoard([A, B], b, 'pvpTiles');
        scriptRandom(M, CALM_REFILL);
        var mult = M.g('pvpGetTimeMultiplier()');
        tap(M, 'pvpHandleTap', 'pvpTiles', 2); tap(M, 'pvpHandleTap', 'pvpTiles', 3);
        await settleAll([A, B], bus);
        expect(W.g('pvpMyHP')).toBe(100 - Math.floor(6 * mult));
        expect(boardTypes(W, 'pvpTiles')).toEqual(boardTypes(M, 'pvpTiles'));
    });

    it('a heal/shield-only turn still hands the turn over (deadlock regression)', async function () {
        var b = noMatchBoard(); b[0] = b[1] = 'shield'; b[3] = 'shield'; b[2] = 'heart';
        setSharedBoard([A, B], b, 'pvpTiles');
        scriptRandom(M, CALM_REFILL);
        tap(M, 'pvpHandleTap', 'pvpTiles', 2); tap(M, 'pvpHandleTap', 'pvpTiles', 3);
        await settleAll([A, B], bus);
        expect(M.g('pvpMyTurn')).toBe(false);
        expect(W.g('pvpMyTurn')).toBe(true);
        expect(M.g('pvpMyArmor')).toBeGreaterThan(0);
    });

    it('a 4-match keeps the turn (extra turn)', async function () {
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'energy'; b[4] = 'energy'; b[3] = 'heart';
        setSharedBoard([A, B], b, 'pvpTiles');
        scriptRandom(M, CALM_REFILL);
        tap(M, 'pvpHandleTap', 'pvpTiles', 3); tap(M, 'pvpHandleTap', 'pvpTiles', 4);
        await settleAll([A, B], bus);
        expect(M.g('pvpMyTurn')).toBe(true);
        expect(W.g('pvpMyTurn')).toBe(false);
    });

    it('the waiting side cannot move', async function () {
        var before = boardTypes(W, 'pvpTiles');
        var m = findMoveOn(W, 'pvpTiles');
        tap(W, 'pvpHandleTap', 'pvpTiles', m[0]); tap(W, 'pvpHandleTap', 'pvpTiles', m[1]);
        await settleAll([A, B], bus);
        expect(boardTypes(W, 'pvpTiles')).toEqual(before);
    });

    it('an ultimate hits the opponent and passes the turn', async function () {
        M.g('pvpUltCharge = 100; pvpMyArmor = 10; pvpUseUltimate()');
        await settleAll([A, B], bus);
        expect(W.g('pvpMyHP')).toBe(100 - (35 + 10));
        expect(W.g('pvpMyTurn')).toBe(true);
    });

    it('the opponent only ever sees a coarse health tier, never the number', async function () {
        W.g('pvpMyHP = 30; pvpUpdateUI()');
        await settleAll([A, B], bus);
        expect(M.$('pvp-opp-status-text').textContent).toBe('YARALI');
        var sent = W.stub.calls.filter(function (c) { return c.event === 'status-update'; }).pop();
        expect(JSON.stringify(sent.payload).indexOf('30')).toBe(-1);
    });

    it('a killing blow ends the match on both sides; only the winner reports the result', async function () {
        W.g('pvpMyHP = 3');
        var b = noMatchBoard(); b[0] = b[1] = 'sword'; b[3] = 'sword'; b[2] = 'heart';
        setSharedBoard([A, B], b, 'pvpTiles');
        scriptRandom(M, CALM_REFILL);
        tap(M, 'pvpHandleTap', 'pvpTiles', 2); tap(M, 'pvpHandleTap', 'pvpTiles', 3);
        await settleAll([A, B], bus);
        expect(A.g('pvpMatchOver') && B.g('pvpMatchOver')).toBe(true);
        expect(M.$('pvp-status').textContent).toContain('KAZANDIN');
        var winnerCalls = M.stub.calls.filter(function (c) { return c.fn === 'resolve_pvp_match'; });
        var loserCalls = W.stub.calls.filter(function (c) { return c.fn === 'resolve_pvp_match'; });
        expect(winnerCalls.length).toBe(1);
        expect(winnerCalls[0].args).toEqual({ p_loser_id: W.stub.userId });
        expect(loserCalls.length).toBe(0);
    });
});

describe('PvP opening board (regressions)', { world: false }, function () {
    // The first mover used to broadcast the opening board ONLY as a side
    // effect of resolving initial matches - a random board that happened to
    // have none was never sent, leaving the other player looking at an empty
    // grid until the first swap. It also never checked for a valid move.
    it('a match-free opening board still reaches the opponent and is playable', async function () {
        var bus = makeBus();
        var p = await joinPvp(bus, 'MAGE', 'ROGUE', {
            beforeJoin: function (A, B) {
                A.win.sbRandomizeBoard = function () { setBoard(A, noMatchBoard(), 'pvpTiles'); };
                B.win.sbRandomizeBoard = function () { setBoard(B, noMatchBoard(), 'pvpTiles'); };
            }
        });
        try {
            expect(boardTypes(p.B, 'pvpTiles')).toEqual(boardTypes(p.A, 'pvpTiles'));
            expect(boardTypes(p.B, 'pvpTiles').indexOf('')).toBe(-1);
            expect(p.A.g('boardHasValidMove(pvpTiles, 8)'), 'opening board has a move').toBe(true);
            expect(p.A.g('findMatchGroups(pvpTiles, 8)').length, 'no leftover matches').toBe(0);
        } finally { p.A.destroy(); p.B.destroy(); }
    });
});

describe('PvP betrayal duel (Kibir Laneti)', { world: false }, function () {
    it('the betrayer takes escalating armor-ignoring curse damage from their 2nd turn', async function () {
        var bus = makeBus();
        // The same entry point coop.js's betrayal vote uses.
        var p = await joinPvp(bus, 'WARRIOR', 'WARRIOR', {
            joinA: "pvpJoinBetrayalRoom('TESTROOM', { isBetrayer: true, firstMoverId: 'alice' })",
            joinB: "pvpJoinBetrayalRoom('TESTROOM', { isBetrayer: false, firstMoverId: 'alice' })"
        });
        var A = p.A, B = p.B;
        try {
            A.g('pvpMyArmor = 50');
            A.g('pvpReceiveTurnEnd()'); // A's 2nd turn begins
            expect(A.g('pvpMyHP')).toBe(100 - 3);
            expect(A.g('pvpMyArmor'), 'curse ignores armor').toBe(50);
            A.g('pvpReceiveTurnEnd()');
            expect(A.g('pvpMyHP')).toBe(100 - 3 - 5);
        } finally { A.destroy(); B.destroy(); }
    });
});

describe('Co-op (two live clients)', { world: false }, function () {
    var bus, H, G;
    beforeEach(async function () {
        bus = makeBus();
        var p = await joinCoop(bus, 'WARRIOR', 'PALADIN');
        H = p.H; G = p.G;
    });
    afterEach(function () { H.destroy(); G.destroy(); });

    it('first to join hosts; both start level 1 with the same enemy', function () {
        expect(H.g('coopIsHost')).toBe(true);
        expect(G.g('coopIsHost')).toBe(false);
        expect(H.g('coopLevel')).toBe(1);
        expect(G.g('coopLevel')).toBe(1);
        expect(G.g('coopEnemyHP')).toBe(H.g('coopEnemyHP'));
        expect(H.g('coopEnemyMaxHP')).toBe(Math.round(50 * 1.5));
    });

    it('both see the same opening board, and it has a valid move', function () {
        expect(boardTypes(G, 'coopTiles')).toEqual(boardTypes(H, 'coopTiles'));
        expect(boardTypes(H, 'coopTiles').indexOf('')).toBe(-1);
        expect(H.g('boardHasValidMove(coopTiles, 8)')).toBe(true);
    });

    it('host move damages the enemy on both screens, enemy strikes back, turn goes to guest', async function () {
        expect(H.g('coopMyTurn')).toBe(true);
        var b = noMatchBoard(); b[0] = b[1] = 'sword'; b[3] = 'sword'; b[2] = 'heart';
        setSharedBoard([H, G], b, 'coopTiles');
        scriptRandom(H, CALM_REFILL);
        var hpBefore = H.g('coopEnemyHP');
        tap(H, 'coopHandleTap', 'coopTiles', 2); tap(H, 'coopHandleTap', 'coopTiles', 3);
        await settleAll([H, G], bus);
        expect(H.g('coopEnemyHP')).toBeLessThan(hpBefore);
        expect(G.g('coopEnemyHP')).toBe(H.g('coopEnemyHP'));
        expect(H.g('coopMyHP') + H.g('coopMyArmor'), 'enemy hit the mover').toBeLessThan(100);
        expect(G.g('coopAllyHP')).toBe(H.g('coopMyHP'));
        expect(G.g('coopMyTurn')).toBe(true);
        expect(H.g('coopMyTurn')).toBe(false);
    });

    it('a guest move routes enemy damage through the host', async function () {
        H.g("coopApplyTurnSet('guest')"); G.g("coopApplyTurnSet('guest')");
        var b = noMatchBoard(); b[0] = b[1] = 'skull'; b[3] = 'skull'; b[2] = 'heart';
        setSharedBoard([H, G], b, 'coopTiles');
        scriptRandom(G, CALM_REFILL);
        var hpBefore = H.g('coopEnemyHP');
        tap(G, 'coopHandleTap', 'coopTiles', 2); tap(G, 'coopHandleTap', 'coopTiles', 3);
        await settleAll([H, G], bus);
        expect(H.g('coopEnemyHP')).toBeLessThan(hpBefore);
        expect(G.g('coopEnemyHP')).toBe(H.g('coopEnemyHP'));
        expect(H.stub.calls.some(function (c) { return c.event === 'enemy-hp-sync'; })).toBe(true);
    });

    it('killing the enemy clears the level for both and starts level 2 together', async function () {
        H.g('coopEnemyHP = 1; coopEnemyArmor = 0');
        G.g('coopEnemyHP = 1');
        var b = noMatchBoard(); b[0] = b[1] = 'sword'; b[3] = 'sword'; b[2] = 'heart';
        setSharedBoard([H, G], b, 'coopTiles');
        tap(H, 'coopHandleTap', 'coopTiles', 2); tap(H, 'coopHandleTap', 'coopTiles', 3);
        await settleAll([H, G], bus);
        expect(H.g('coopLevel')).toBe(2);
        expect(G.g('coopLevel')).toBe(2);
        expect(G.g('coopEnemyHP')).toBe(H.g('coopEnemyHP'));
        // each player earns their own kill gold
        expect(H.stub.calls.some(function (c) { return c.fn === 'earn_currency'; })).toBe(true);
        expect(G.stub.calls.some(function (c) { return c.fn === 'earn_currency'; })).toBe(true);
        expect(boardTypes(G, 'coopTiles')).toEqual(boardTypes(H, 'coopTiles'));
    });

    it('a downed teammate is revived at 30% when the other one finishes a turn', async function () {
        G.g('coopMyHP = 0; coopSyncSelfState()');
        await settleAll([H, G], bus);
        expect(H.g('coopAllyDown')).toBe(true);
        H.g('coopEndOwnTurn()');
        await settleAll([H, G], bus);
        expect(G.g('coopMyDown')).toBe(false);
        expect(G.g('coopMyHP')).toBe(30);
        expect(H.g('coopAllyHP')).toBe(30);
    });

    it('both down at once wipes the party on both clients', async function () {
        G.g('coopMyHP = 0; coopSyncSelfState()');
        await settleAll([H, G], bus);
        H.g('coopMyHP = 0; coopSyncSelfState(); coopFinishHostTurnResolution("host")');
        await settleAll([H, G], bus);
        expect(H.g('coopMatchOver') && G.g('coopMatchOver')).toBe(true);
        expect(G.$('coop-status').textContent).toContain('DÜŞTÜNÜZ');
    });
});

describe('Co-op opening board (regressions)', { world: false }, function () {
    it('a match-free opening board still reaches the guest and is playable', async function () {
        var bus = makeBus();
        var p = await joinCoop(bus, 'MAGE', 'ROGUE', {
            beforeJoin: function (H) {
                H.win.sbRandomizeBoard = function () { setBoard(H, noMatchBoard(), 'coopTiles'); };
            }
        });
        try {
            expect(boardTypes(p.G, 'coopTiles')).toEqual(boardTypes(p.H, 'coopTiles'));
            expect(boardTypes(p.G, 'coopTiles').indexOf('')).toBe(-1);
            expect(p.H.g('boardHasValidMove(coopTiles, 8)'), 'opening board has a move').toBe(true);
        } finally { p.H.destroy(); p.G.destroy(); }
    });
});
