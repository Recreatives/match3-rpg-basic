// Ultimates, driven the way a player does: through the real ULT button
// (a disabled <button> swallows .click(), exactly like a real tap), after
// a real turn cycle. combat.spec.js checks each ult's math by calling
// useUltimate() directly - that path skipped the button's own disabled
// state, which is where a real "ULT is 100% but I can't press it" bug hid
// (the enemy turn handed control back without re-enabling the button).

var ULT_CLASSES = ['WARRIOR', 'BERSERKER', 'ROGUE', 'ARCHER', 'MAGE', 'NECROMANCER', 'PALADIN'];

// A 3-in-a-row energy match (no extra turn) on the solo board: swap 2<->3.
function soloEnergyMove(w) {
    var b = noMatchBoard(); b[0] = b[1] = 'energy'; b[3] = 'energy'; b[2] = 'heart';
    setBoard(w, b);
    scriptRandom(w, CALM_REFILL_ULT);
    var tiles = w.g('tiles');
    w.g('attemptSwap')(tiles[2], tiles[3]);
}
var CALM_REFILL_ULT = [0.05, 0.45, 0.85];

describe('Ultimate button (solo, real turn cycle)', { isolate: 'each' }, function () {
    ULT_CLASSES.forEach(function (key) {
        it(key + ': charged by a match, still usable after the enemy turn, then the game goes on', async function (ctx) {
            var w = ctx.world;
            await startSolo(w, key, { level: 2, immortal: true });
            w.g('ultCharge = 95');
            soloEnergyMove(w);
            await w.settle(30000); // player match -> enemy turn -> back to the player
            expect(w.g('isPlayerTurn'), 'back to the player').toBe(true);
            expect(w.g('isProcessing'), 'not stuck processing').toBe(false);
            expect(w.g('ultCharge'), 'charged').toBe(100);
            var btn = w.$('ult-btn');
            expect(btn.disabled, 'ULT button enabled at 100%').toBe(false);
            expect(btn.innerText, 'button names the class ult').toContain(w.g('CLASSES.' + key + '.ultName'));
            w.g('enemyArmor = 0'); // so every class's ult damage shows up in HP
            var before = w.g('enemyHP');
            btn.click();
            expect(w.g('ultCharge'), 'ult consumed').toBe(0);
            expect(w.g('enemyHP'), 'ult hit the enemy').toBeLessThan(before);
            expect(btn.disabled, 'disabled right after use').toBe(true);
            await w.settle(30000);
            expect(w.g('isPlayerTurn'), 'turn came back after the ult').toBe(true);
            expect(w.g('isProcessing'), 'not stuck after the ult').toBe(false);
            expect(w.g('currentState')).toBe(w.g('STATE.PLAYING'));
        }, { timeout: 20000 });
    });

    it('the button keeps the class ult name after switching language', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'MAGE', { immortal: true });
        w.g("setLanguage('en')");
        expect(w.$('ult-btn').innerText).toContain('ARCANE BLAST');
        w.g("setLanguage('tr')");
        expect(w.$('ult-btn').innerText).toContain('ARCANE BLAST');
    });

    it('an enemy that finds no move hands back a usable ULT button', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        w.g('ultCharge = 100; isPlayerTurn = false; isProcessing = true');
        w.g('findMinionMove = function () { return null; }; findBestMove = function () { return null; }');
        w.g('enemyPlayTurn()');
        expect(w.$('ult-btn').disabled).toBe(false);
    });
});

describe('Ultimate button (PvP and co-op, every class)', { world: false }, function () {
    ULT_CLASSES.forEach(function (key) {
        it('PvP ' + key + ': usable when the turn comes back, hits and passes the turn', async function () {
            var bus = makeBus(), p = await joinPvp(bus, key, 'WARRIOR');
            var A = p.A, B = p.B, M = A.g('pvpMyTurn') ? A : B, W = M === A ? B : A;
            try {
                // M passes with a shield match, W moves, turn returns to M with a full ult
                var b = noMatchBoard(); b[0] = b[1] = 'shield'; b[3] = 'shield'; b[2] = 'heart';
                setSharedBoard([A, B], b, 'pvpTiles');
                scriptRandom(M, CALM_REFILL);
                tap(M, 'pvpHandleTap', 'pvpTiles', 2); tap(M, 'pvpHandleTap', 'pvpTiles', 3);
                await settleAll([A, B], bus);
                M.g('pvpUltCharge = 100; pvpUpdateUI()');
                var b2 = noMatchBoard(); b2[0] = b2[1] = 'shield'; b2[3] = 'shield'; b2[2] = 'heart';
                setSharedBoard([A, B], b2, 'pvpTiles');
                scriptRandom(W, CALM_REFILL);
                tap(W, 'pvpHandleTap', 'pvpTiles', 2); tap(W, 'pvpHandleTap', 'pvpTiles', 3);
                await settleAll([A, B], bus);
                expect(M.g('pvpMyTurn'), 'turn back').toBe(true);
                var btn = M.$('pvp-ult-btn');
                expect(btn.disabled, 'enabled').toBe(false);
                expect(btn.innerText).toContain(M.g('CLASSES.' + key + '.ultName'));
                var hpBefore = W.g('pvpMyHP');
                btn.click();
                await settleAll([A, B], bus);
                expect(M.g('pvpUltCharge')).toBe(0);
                expect(W.g('pvpMyHP'), 'opponent hit').toBeLessThan(hpBefore);
                if (key === 'ROGUE') expect(M.g('pvpMyTurn'), 'rogue keeps the turn').toBe(true);
                else expect(W.g('pvpMyTurn'), 'turn passed').toBe(true);
                expect(M.g('pvpProcessing'), 'not stuck').toBe(false);
            } finally { A.destroy(); B.destroy(); }
        }, { timeout: 30000 });

        it('Co-op ' + key + ': usable on your turn, hits the enemy and passes the turn', async function () {
            var bus = makeBus(), p = await joinCoop(bus, key, 'WARRIOR');
            var H = p.H, G = p.G;
            try {
                // host passes, guest moves, turn returns to host with a full ult
                var b = noMatchBoard(); b[0] = b[1] = 'shield'; b[3] = 'shield'; b[2] = 'heart';
                setSharedBoard([H, G], b, 'coopTiles');
                scriptRandom(H, CALM_REFILL);
                tap(H, 'coopHandleTap', 'coopTiles', 2); tap(H, 'coopHandleTap', 'coopTiles', 3);
                await settleAll([H, G], bus);
                H.g('coopUltCharge = 100; coopUpdateUI()');
                H.g('coopEnemyHP = coopEnemyMaxHP = 100000'); G.g('coopEnemyHP = coopEnemyMaxHP = 100000');
                var b2 = noMatchBoard(); b2[0] = b2[1] = 'shield'; b2[3] = 'shield'; b2[2] = 'heart';
                setSharedBoard([H, G], b2, 'coopTiles');
                scriptRandom(G, CALM_REFILL);
                tap(G, 'coopHandleTap', 'coopTiles', 2); tap(G, 'coopHandleTap', 'coopTiles', 3);
                await settleAll([H, G], bus);
                expect(H.g('coopMyTurn'), 'turn back').toBe(true);
                var btn = H.$('coop-ult-btn');
                expect(btn.disabled, 'enabled').toBe(false);
                expect(btn.innerText).toContain(H.g('CLASSES.' + key + '.ultName'));
                var hpBefore = H.g('coopEnemyHP');
                btn.click();
                await settleAll([H, G], bus);
                expect(H.g('coopUltCharge')).toBe(0);
                expect(H.g('coopEnemyHP'), 'enemy hit').toBeLessThan(hpBefore);
                expect(G.g('coopEnemyHP'), 'guest sees it').toBe(H.g('coopEnemyHP'));
                expect(H.g('coopProcessing'), 'not stuck').toBe(false);
            } finally { H.destroy(); G.destroy(); }
        }, { timeout: 30000 });
    });
});
