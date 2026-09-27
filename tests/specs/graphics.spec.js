// graphics.js: the shared-renderer portrait pipeline (G0) and the DOM/CSS
// effect helpers. These run with the real PixiJS build; rendering itself is
// driven by the shared PIXI.Ticker, which these tests step by hand
// (pumpFrames) in real time rather than on the world's fake clock.

var PORTRAIT_IDS = ['player-sprite', 'enemy-sprite', 'pvp-my-sprite', 'pvp-opp-sprite', 'coop-my-sprite', 'coop-ally-sprite', 'coop-enemy-sprite'];

function realWait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Drives the shared ticker by hand for `ms` of real time (~60 steps/s)
// instead of relying on requestAnimationFrame, which a hidden/background
// tab (and some headless setups) never fires. Tweens measure real
// performance.now() time, so real time still has to pass between steps.
async function pumpFrames(world, ms) {
    var end = performance.now() + ms;
    while (performance.now() < end) {
        var ticker = world.g('cgShared.ticker');
        if (ticker) ticker.update(world.win.performance.now());
        await realWait(16);
    }
}

function opaquePixels(canvas) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return -1;
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data, n = 0;
    for (var i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
}

// Brings the world's iframe on-screen while a rendering test runs - an
// off-screen iframe may get its requestAnimationFrame throttled.
function onScreen(world) { world.frame.parentNode.style.left = '0px'; world.frame.parentNode.style.zIndex = '-1'; }
function offScreen(world) { world.frame.parentNode.style.left = '-10000px'; }

describe('Portrait renderer (shared WebGL)', { isolate: 'each' }, function () {
    afterEach(function (ctx) { offScreen(ctx.world); });

    it('all 7 fighters share ONE WebGL renderer, drawn into one 2D canvas per mode arena', async function (ctx) {
        var w = ctx.world;
        var stages = PORTRAIT_IDS.map(function (id) { return w.g('cgGetStage')(id); });
        await awaitInWorld(w, Promise.all(stages.map(function (s) { return s.ready; })));
        expect(w.g('cgShared.stages.length')).toBe(7);
        ['solo', 'pvp', 'coop'].forEach(function (k) {
            expect(w.$(k + '-arena-canvas').getContext('2d'), k + ' arena is a 2D canvas').toBeTruthy();
        });
        expect(w.g('cgArenas.solo.fighters.length')).toBe(2);
        expect(w.g('cgArenas.pvp.fighters.length')).toBe(2);
        expect(w.g('cgArenas.coop.fighters.length')).toBe(3);
        stages.forEach(function (st, i) { expect(st.embedded && !!st.arena, PORTRAIT_IDS[i] + ' lives in its arena').toBe(true); });
        expect(!!w.g('cgShared.renderer')).toBe(true);
    });

    it('a visible portrait really draws pixels (setPortrait -> render -> drawImage)', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        await startSolo(w, 'MAGE');
        var stage = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, stage.ready);
        await awaitInWorld(w, stage.setPortrait(w.g('CHARACTER_SPRITES.mage')));
        await pumpFrames(w, 300);
        expect(stage.renderCount).toBeGreaterThan(0);
        expect(opaquePixels(w.$('solo-arena-canvas'))).toBeGreaterThan(200);
    });

    it('a portrait inside a closed modal never renders', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        var stage = w.g("cgGetStage('pvp-opp-sprite')");
        await awaitInWorld(w, stage.ready);
        await awaitInWorld(w, stage.setPortrait(w.g('CHARACTER_SPRITES.rogue')));
        stage.playUlt('rogue');
        await pumpFrames(w, 400);
        expect(getComputedStyle(w.$('pvp-modal')).display).toBe('none');
        expect(stage.renderCount).toBe(0);
    });

    it('an idle visible portrait breathes at ~15fps, never full frame rate', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        await startSolo(w, 'WARRIOR');
        var stage = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, stage.setPortrait(w.g('CHARACTER_SPRITES.warrior')));
        await pumpFrames(w, 1300); // the monster's walk-in finishes first
        var before = stage.renderCount;
        await pumpFrames(w, 1000);
        var perSecond = stage.renderCount - before;
        expect(perSecond, 'renders in 1s idle').toBeLessThan(22);
        expect(perSecond, 'idle breathing does repaint').toBeGreaterThan(5);
    });

    it('an effect makes it repaint every frame, then settle back down', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        await startSolo(w, 'WARRIOR');
        var stage = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, stage.setPortrait(w.g('CHARACTER_SPRITES.warrior')));
        await pumpFrames(w, 200);
        var before = stage.renderCount;
        stage.playUlt('warrior');
        await pumpFrames(w, 500);
        expect(stage.renderCount - before, 'renders during the ult').toBeGreaterThan(10);
        await pumpFrames(w, 1400); // ult burst ~1.2s + layer stagger
        expect(stage.activeTweens).toBe(0);
        expect(stage.effectLayer.children.length, 'burst sprites cleaned up').toBe(0);
    });

    it('portraits re-layout when the viewport changes size', async function (ctx) {
        var w = ctx.world;
        var stage = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, stage.ready);
        await awaitInWorld(w, stage.setPortrait(w.g('CHARACTER_SPRITES.warrior')));
        var before = w.$('solo-arena-canvas').width + 'x' + stage.size.join('x');
        w.frame.style.width = '1100px'; w.frame.style.height = '1000px';
        // Browsers deliver 'resize' as part of a rendering update, which a
        // hidden tab never runs - dispatch it explicitly.
        w.win.dispatchEvent(new w.win.Event('resize'));
        await w.tick(200); // the resize handler is debounced on the (fake) setTimeout
        var after = w.$('solo-arena-canvas').width + 'x' + stage.size.join('x');
        expect(after, 'from ' + before).not.toBe(before);
        w.frame.style.width = '420px'; w.frame.style.height = '820px';
    });

    it('a context loss stops drawing, a restore repaints everything', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        await startSolo(w, 'MAGE');
        var stage = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, stage.setPortrait(w.g('CHARACTER_SPRITES.mage')));
        var canvas = w.g('cgShared.renderer.canvas');
        canvas.dispatchEvent(new w.win.Event('webglcontextlost'));
        expect(w.g('cgShared.lost')).toBe(true);
        canvas.dispatchEvent(new w.win.Event('webglcontextrestored'));
        expect(w.g('cgShared.lost')).toBe(false);
        expect(stage.needsRender).toBe(true);
    });

    it('graphics still boot without PixiJS (CDN down) - combat never depends on it', async function () {
        var w = await createWorld({ pixi: false });
        try {
            expect(w.g("cgGetStage('player-sprite')")).toBeNull();
            await startSolo(w, 'ARCHER', { immortal: true });
            freezeEnemyTurn(w);
            var b = noMatchBoard(); b[0] = b[1] = b[2] = 'sword';
            setBoard(w, b);
            w.g('checkForMatches(false)');
            expect(await w.settle(10000)).toBe(true);
        } finally { w.destroy(); }
    });
});

describe('DOM effects', { isolate: 'each', world: { pixi: false } }, function () {
    it('tile bursts, confetti and flashes clean themselves up', async function (ctx) {
        var w = ctx.world, doc = w.doc;
        var base = doc.body.children.length;
        w.g("cgTileBurst(tiles[0], 'sword'); cgCelebrate('victory', true); cgBossIntro('enemy-sprite'); cgLevelTransition(); cgCelebrate('defeat')");
        expect(doc.body.children.length).toBeGreaterThan(base);
        await w.tick(3000);
        expect(doc.querySelectorAll('.cg-tile-burst, .cg-confetti-layer, .cg-boss-flash, .cg-level-curtain, .cg-defeat-vignette').length).toBe(0);
    });

    it('low-graphics mode suppresses the heavy DOM effects and persists', function (ctx) {
        var w = ctx.world;
        w.g('cgToggleLowGraphics()');
        expect(w.doc.documentElement.classList.contains('low-graphics-mode')).toBe(true);
        w.g("cgTileBurst(tiles[0], 'sword'); cgCelebrate('victory', true)");
        expect(w.doc.querySelectorAll('.cg-tile-burst, .cg-confetti-layer').length).toBe(0);
        expect(w.win.localStorage.getItem('pixelDungeonLowGraphics')).toBe('true');
        w.g('cgToggleLowGraphics()');
    });

    it('HP bar + ghost trail are set together', function (ctx) {
        var w = ctx.world;
        w.g("cgSetBarWithGhost('player-hp-bar', 42)");
        expect(w.$('player-hp-bar').style.width).toBe('42%');
        expect(w.$('player-hp-bar-ghost').style.width).toBe('42%');
    });

    it('modals fade in/out and end fully hidden', async function (ctx) {
        var w = ctx.world, m = w.$('info-modal');
        w.g("cgAnimateModal(document.getElementById('info-modal'), true)");
        expect(m.style.display).toBe('flex');
        expect(m.classList.contains('visible')).toBe(true);
        w.g("cgAnimateModal(document.getElementById('info-modal'), false)");
        await w.tick(300);
        expect(m.style.display).toBe('none');
    });

    it('a board impact below x2 does not shake, x3+ shakes big', function (ctx) {
        var w = ctx.world, grid = w.$('grid');
        w.g('cgBoardImpact')(grid, 1);
        expect(grid.classList.contains('shake') || grid.classList.contains('shake-big')).toBe(false);
        w.g('cgBoardImpact')(grid, 3);
        expect(grid.classList.contains('shake-big')).toBe(true);
    });
});

describe('Combat scene (G3)', { isolate: 'each' }, function () {
    it('class glow and legendary aura land on the right portrait', async function (ctx) {
        var w = ctx.world;
        // arena fighters: a colored floor ring + a pulsing aura, not CSS
        w.g("cgSetClassGlow('player-sprite', 'mage'); cgSetLegendaryAura('player-sprite', 'red')");
        var me = w.g("cgGetStage('player-sprite')"), foe = w.g("cgGetStage('enemy-sprite')");
        await awaitInWorld(w, me.ready); await awaitInWorld(w, foe.ready);
        expect(me.groundGlow).toBe(w.g('CLASS_GLOW_COLORS.mage'));
        expect(me.auras.legendary).toBe(parseInt(w.g('RARITY_DEFS.red.color').slice(1), 16));
        expect(foe.groundGlow).toBe(null);
        w.g("cgSetLegendaryAura('player-sprite', null)");
        expect(me.auras.legendary).toBe(null);
    });

    it('a real sword match sends the tiles\' energy from the board to the fighter who matched', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'sword';
        setBoard(w, b);
        w.g('checkForMatches(false)');
        var shots = w.doc.querySelectorAll('.cg-projectile');
        expect(shots.length).toBe(1);
        var me = w.$('player-sprite').getBoundingClientRect(), tile = w.g('tiles')[1].getBoundingClientRect();
        var dx = parseFloat(shots[0].style.getPropertyValue('--dx'));
        expect(dx, 'flies to the player (their attack then crosses the arena)').toBeCloseTo((me.left + me.width / 2) - (tile.left + tile.width / 2), 1);
        await w.settle(5000);
        expect(w.doc.querySelectorAll('.cg-projectile').length, 'cleaned up').toBe(0);
    });

    it('heal/shield shots go to your own portrait; low-graphics fires none', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'heart';
        setBoard(w, b);
        w.g('checkForMatches(false)');
        var shot = w.doc.querySelector('.cg-projectile');
        var me = w.$('player-sprite').getBoundingClientRect(), tile = w.g('tiles')[1].getBoundingClientRect();
        expect(parseFloat(shot.style.getPropertyValue('--dx')), 'flies to the player').toBeCloseTo((me.left + me.width / 2) - (tile.left + tile.width / 2), 1);
        await w.settle(5000);
        w.g('cgToggleLowGraphics()');
        setBoard(w, b);
        w.g('checkForMatches(false)');
        expect(w.doc.querySelectorAll('.cg-projectile').length).toBe(0);
        w.g('cgToggleLowGraphics()');
    });

    it('the backdrop changes theme every 5 floors', async function (ctx) {
        var w = ctx.world, seen = {};
        [[1, 'crypt'], [5, 'crypt'], [6, 'moss'], [11, 'ember'], [16, 'abyss'], [21, 'crypt']].forEach(function (c) {
            w.g('level = ' + c[0] + '; currentState = STATE.PLAYING; startLevel()');
            seen[c[0]] = w.$('solo-hud').dataset.floor;
            expect(seen[c[0]], 'level ' + c[0]).toBe(c[1]);
        });
        var bg = w.win.getComputedStyle(w.$('solo-hud')).getPropertyValue('--scene-a').trim();
        expect(bg.length, 'theme vars resolve on the HUD').toBeGreaterThan(0);
    });

    it('the enemy lunges when its own sword/skull hit lands, not on the player\'s', async function (ctx) {
        var w = ctx.world, calls = [];
        await startSolo(w, 'WARRIOR', { immortal: true });
        var orig = w.win.cgStageDo;
        w.win.cgStageDo = function (id, m, arg) { calls.push(id + '.' + m); return orig(id, m, arg); };
        w.g("isPlayerTurn = true; applyRPGEffects('sword', 1)");
        expect(calls.indexOf('enemy-sprite.playAttack')).toBe(-1);
        w.g("isPlayerTurn = false; applyRPGEffects('skull', 1)");
        expect(calls).toContain('enemy-sprite.playAttack');
    });

    it('a kill topples the portrait; the next portrait/level stands it back up', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        try {
            await startSolo(w, 'WARRIOR');
            var stage = w.g("cgGetStage('enemy-sprite')");
            await awaitInWorld(w, stage.setPortrait(w.g('MONSTER_SPRITES.normal')));
            w.g("enemyHP = 0; checkWinCondition()");
            await pumpFrames(w, 800);
            expect(stage.dead).toBe(true);
            expect(stage.portraitSprite.alpha).toBe(0);
            await awaitInWorld(w, stage.setPortrait(w.g('MONSTER_SPRITES.armored')));
            expect(stage.dead).toBe(false);
            expect(stage.portraitSprite.alpha).toBe(1);
            var player = w.g("cgGetStage('player-sprite')");
            await awaitInWorld(w, player.ready);
            player.playDeath(); await pumpFrames(w, 800);
            await awaitInWorld(w, player.revive());
            expect(player.portraitSprite.alpha).toBe(1);
        } finally { offScreen(w); }
    });
});

describe('Automatic quality (G4)', { isolate: 'each', world: { pixi: false } }, function () {
    // The page counts as visible here (the real check would skip a hidden
    // tab - which the test runner often is).
    beforeEach(function (ctx) { ctx.world.win.cgPageVisible = function () { return true; }; });
    function fakeFps(w, fps) { w.win.cgMeasureFps = function () { return Promise.resolve(fps); }; }

    it('a slow device (25 fps) switches itself to low graphics, remembered as auto', async function (ctx) {
        var w = ctx.world;
        fakeFps(w, 25);
        expect(await w.g('cgRunAutoQuality()')).toBe('low-auto');
        expect(w.doc.documentElement.classList.contains('low-graphics-mode')).toBe(true);
        expect(w.$('low-graphics-btn').innerText).toBe('🐢');
        expect(w.win.localStorage.getItem('pixelDungeonQualitySource')).toBe('auto');
        expect(w.g('cgEffectsEnabled()')).toBe(false);
    });

    it('a smooth device (58 fps) stays on high', async function (ctx) {
        var w = ctx.world;
        fakeFps(w, 58);
        expect(await w.g('cgRunAutoQuality()')).toBe('high');
        expect(w.doc.documentElement.classList.contains('low-graphics-mode')).toBe(false);
    });

    it('a manual choice is never overridden', async function (ctx) {
        var w = ctx.world, measured = false;
        w.g('cgToggleLowGraphics(); cgToggleLowGraphics()'); // player picked HIGH on purpose
        w.win.cgMeasureFps = function () { measured = true; return Promise.resolve(10); };
        expect(await w.g('cgRunAutoQuality()')).toBe('high');
        expect(measured, 'does not even measure').toBe(false);
    });

    it('the player can turn an auto-lowered device back to high, and it sticks', async function (ctx) {
        var w = ctx.world;
        fakeFps(w, 20);
        await w.g('cgRunAutoQuality()');
        w.g('cgToggleLowGraphics()');
        expect(w.g('cgQualityLevel()')).toBe('high');
        expect(await w.g('cgRunAutoQuality()')).toBe('high');
    });

    it('a hidden tab is never measured', async function (ctx) {
        var w = ctx.world, measured = false;
        w.win.cgPageVisible = function () { return false; };
        w.win.cgMeasureFps = function () { measured = true; return Promise.resolve(5); };
        expect(await w.g('cgRunAutoQuality()')).toBe('high');
        expect(measured).toBe(false);
    });

    it('an untrustworthy sample (hidden tab / throttled) changes nothing', async function (ctx) {
        var w = ctx.world;
        fakeFps(w, null);
        expect(await w.g('cgRunAutoQuality()')).toBe('high');
    });

    it('the real sampler refuses a sample shorter than asked (fake clock)', async function (ctx) {
        var w = ctx.world;
        var p = w.g('cgMeasureFps(3000)');
        await w.tick(3100); // fake 3s pass instantly in real time
        expect(await p).toBeNull();
    });
});

describe('Combat feedback (numbers, sparkles, bar pulse)', { isolate: 'each', world: { pixi: false } }, function () {
    function texts(w) { return Array.prototype.map.call(w.doc.querySelectorAll('.cg-combat-text'), function (e) { return e.className.replace('cg-combat-text ', '') + ' ' + e.textContent; }); }

    it('a sword hit shows a red "-N" over the enemy when the shot lands, then cleans up', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        w.g('enemyArmor = 0');
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'sword'; setBoard(w, b);
        scriptRandom(w, [0.05, 0.45, 0.85]); // calm refill - no chain reactions
        w.g('currentMoveTimeMultiplier = 1; checkForMatches(false)');
        expect(texts(w), 'nothing before the shot lands').toEqual([]);
        await w.tick(500);
        expect(texts(w)).toEqual(['cg-ct-dmg -6']);
        var t = w.doc.querySelector('.cg-combat-text').getBoundingClientRect(), e = w.$('enemy-sprite').getBoundingClientRect();
        expect(Math.abs((t.left + t.width / 2) - (e.left + e.width / 2)), 'centered over the enemy').toBeLessThan(20);
        await w.settle(10000);
        expect(texts(w)).toEqual([]);
    });

    it('a heal shows a green "+N", sparkles and a green bar pulse on the healer', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'heart'; setBoard(w, b);
        w.g('currentMoveTimeMultiplier = 1; checkForMatches(false)');
        await w.tick(500);
        expect(texts(w)).toEqual(['cg-ct-heal +4']);
        expect(w.doc.querySelectorAll('.cg-sparkle').length).toBeGreaterThan(0);
        expect(w.$('player-hp-bar-container').classList.contains('cg-bar-heal')).toBe(true);
        await w.settle(5000);
        expect(w.doc.querySelectorAll('.cg-sparkle-layer, .cg-combat-text').length).toBe(0);
    });

    it('a skull shows damage on the target AND the recoil on the matcher', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        w.g('enemyArmor = 0; playerArmor = 0');
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'skull'; setBoard(w, b);
        w.g('currentMoveTimeMultiplier = 1; checkForMatches(false)');
        await w.tick(500);
        expect(texts(w).sort()).toEqual(['cg-ct-crit -25', 'cg-ct-self -12']);
    });

    it('numbers still show in low-graphics mode (information), sparkles do not', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        w.g('cgToggleLowGraphics()');
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'heart'; setBoard(w, b);
        w.g('checkForMatches(false)');
        await w.tick(500);
        expect(texts(w).length).toBe(1);
        expect(w.doc.querySelectorAll('.cg-sparkle').length).toBe(0);
        w.g('cgToggleLowGraphics()');
    });
});

describe('Arena moves (moves.js: variety, tiers, distance, timing)', { isolate: 'each' }, function () {
    var SLOTS = ['player-sprite', 'enemy-sprite', 'pvp-my-sprite', 'pvp-opp-sprite', 'coop-my-sprite', 'coop-ally-sprite', 'coop-enemy-sprite'];
    var CLASSES = ['warrior', 'berserker', 'rogue', 'archer', 'mage', 'necromancer', 'paladin'];
    var ACTIONS = ['sword', 'skull', 'heart', 'shield', 'energy'];
    var JOINTS = ['legL', 'legR', 'torso', 'head', 'armL', 'armR'];

    it('the move library is complete and well-formed', function (ctx) {
        var w = ctx.world, M = w.g('CG_MOVES'), U = w.g('CG_ULTS'), MM = w.g('CG_MONSTER_MOVES');
        var RIGS = w.g('CG_RIGS'), SHOTS = w.g('CG_SHOTS'), ids = {}, total = 0;
        function check(m, where) {
            expect(!!m.id, where + ' id').toBe(true);
            expect(ids[m.id], 'unique id ' + m.id).toBe(undefined);
            ids[m.id] = true; total++;
            expect(['melee', 'ranged', 'self'].indexOf(m.kind) >= 0, m.id + ' kind').toBe(true);
            expect(!!RIGS[m.rig], m.id + ' rig ' + m.rig).toBe(true);
            if (m.kind === 'ranged') expect(typeof SHOTS[m.shot], m.id + ' shot ' + m.shot).toBe('function');
            if (m.kind === 'melee') expect(['dash', 'leap', 'blink', 'charge', 'slide'].indexOf(m.approach) >= 0, m.id + ' approach').toBe(true);
            expect(m.ms, m.id + ' readable length').toBeGreaterThanOrEqual(900);
        }
        CLASSES.forEach(function (c) {
            ACTIONS.forEach(function (a) {
                var list = M[c][a];
                expect(list.length, c + '.' + a + ' has variety').toBeGreaterThanOrEqual(2);
                list.forEach(function (m) { check(m, c + '.' + a); });
                expect(list.filter(function (m) { return (m.tier || 1) === 1; }).length, c + '.' + a + ' light moves').toBeGreaterThanOrEqual(2);
            });
            ['sword', 'skull'].forEach(function (a) {
                var tiers = M[c][a].map(function (m) { return m.tier || 1; });
                expect(tiers.indexOf(2) >= 0 && tiers.indexOf(3) >= 0, c + '.' + a + ' has a heavy move and a finisher').toBe(true);
            });
            check(U[c], c + '.ult');
            expect(U[c].tier).toBe(3);
        });
        Object.keys(MM).forEach(function (k) {
            expect(MM[k].attack.length, k + ' attacks').toBeGreaterThanOrEqual(3);
            expect(MM[k].buff.length, k + ' buffs').toBeGreaterThanOrEqual(2);
            MM[k].attack.concat(MM[k].buff, MM[k].enraged || []).forEach(function (m) { check(m, k); });
        });
        expect(total, 'moves in total').toBeGreaterThanOrEqual(120);
    });

    it('match power picks the tier: 3-match light, 4-match heavy, 5+ or a big combo a finisher', function (ctx) {
        var w = ctx.world, tier = w.g('cgTierFor');
        expect(tier(1, 0)).toBe(1); expect(tier(2, 0)).toBe(2); expect(tier(2.5, 1)).toBe(2);
        expect(tier(3, 0)).toBe(3); expect(tier(4, 0)).toBe(3); expect(tier(1, 2)).toBe(2); expect(tier(2, 3)).toBe(3);
    });

    it('the same move never plays twice in a row, and every light move shows up', async function (ctx) {
        var w = ctx.world, st = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, st.ready);
        CLASSES.forEach(function (c) {
            ['sword', 'skull', 'shield'].forEach(function (a) {
                var list = w.g('cgMovesFor')(c, a), seen = {}, prev = null;
                for (var i = 0; i < 40; i++) {
                    var m = st._pickMove(c + '.' + a, list, 1);
                    expect(m.id === prev, c + '.' + a + ' repeated ' + m.id).toBe(false);
                    expect(m.tier || 1, c + '.' + a + ' light').toBe(1);
                    seen[m.id] = true; prev = m.id;
                }
                var light = list.filter(function (m) { return (m.tier || 1) === 1; }).length;
                expect(Object.keys(seen).length, c + '.' + a + ' variety').toBe(light);
                expect(st._pickMove(c + '.' + a, list, 3).tier || 1, c + '.' + a + ' finisher tier').toBe(a === 'shield' ? 1 : 3);
            });
        });
    });

    it('a melee move crosses the arena to the target and is back home afterwards', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        await startSolo(w, 'WARRIOR', { immortal: true });
        var me = w.g("cgGetStage('player-sprite')"), foe = w.g("cgGetStage('enemy-sprite')");
        await awaitInWorld(w, me.setPortrait(w.g('CHARACTER_SPRITES.warrior')));
        await pumpFrames(w, 1200);
        var arena = me.arena, reach = arena.reachTo(me, foe);
        expect(reach, 'real distance between them').toBeGreaterThan(40);
        me._perform(w.g('CG_MOVES.warrior.sword[0]'));
        var peak = 0;
        for (var i = 0; i < 40; i++) { await pumpFrames(w, 16); peak = Math.max(peak, me.portraitSprite.x - me.baseX); }
        expect(peak, 'ran most of the way').toBeGreaterThan(reach * 0.8);
        await pumpFrames(w, 900);
        expect(me.portraitSprite.x).toBe(me.baseX);
        offScreen(w);
    }, { timeout: 15000 });

    it('a ranged move fires a projectile that flies across the arena', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        await startSolo(w, 'ARCHER', { immortal: true });
        var me = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, me.setPortrait(w.g('CHARACTER_SPRITES.archer')));
        await pumpFrames(w, 1200);
        var fx = me.arena.fxLayer, xs = [];
        me._perform(w.g('CG_MOVES.archer.sword[0]'));
        for (var i = 0; i < 30; i++) { await pumpFrames(w, 16); fx.children.forEach(function (c) { xs.push(c.x); }); }
        expect(xs.length, 'something flew').toBeGreaterThan(5);
        expect(Math.max.apply(null, xs) - Math.min.apply(null, xs), 'across the arena').toBeGreaterThan(60);
        await pumpFrames(w, 1200);
        expect(fx.children.length, 'projectiles cleaned up').toBe(0);
        offScreen(w);
    }, { timeout: 15000 });

    it('every class action (and ult) runs in every mode, draws effects, then everything returns to rest', async function (ctx) {
        var w = ctx.world;
        var stages = SLOTS.map(function (id) { return w.g("cgGetStage('" + id + "')"); });
        for (var i = 0; i < 7; i++) {
            await awaitInWorld(w, stages[i].ready);
            await awaitInWorld(w, stages[i].setPortrait(w.g('CHARACTER_SPRITES.' + CLASSES[i])));
        }
        await pumpFrames(w, 1200);
        for (var a = 0; a < ACTIONS.length + 1; a++) {
            var act = ACTIONS[a] || 'ult', drew = [], peak = stages.map(function () { return 0; });
            stages.forEach(function (st, i) { if (act === 'ult') st.playUlt(CLASSES[i]); else st.playClassMotion(CLASSES[i], act, 1 + (a % 3)); });
            for (var f = 0; f < 12; f++) {
                await pumpFrames(w, 60);
                stages.forEach(function (st, i) { JOINTS.forEach(function (j) { peak[i] = Math.max(peak[i], Math.abs(st.joints[j].rotation)); }); });
                if (f === 3) stages.forEach(function (st) { drew.push(st.effectLayer.children.length + st.backLayer.children.length); });
            }
            peak.forEach(function (p, i) { expect(p, CLASSES[i] + '.' + act + ' moves a limb').toBeGreaterThan(0.3); });
            if (act !== 'shield') drew.forEach(function (n, i) { expect(n, CLASSES[i] + '.' + act + ' spawned effects').toBeGreaterThan(0); });
            await pumpFrames(w, 2200);
            stages.forEach(function (st, i) {
                var id = CLASSES[i] + '.' + act;
                expect(st.activeTweens, id + ' tweens').toBe(0);
                expect(st.effectLayer.children.length + st.backLayer.children.length, id + ' vfx cleaned').toBe(0);
                expect(st.portraitSprite.x, id + ' back at rest').toBe(st.baseX);
                expect(st.portraitSprite.alpha, id + ' visible').toBe(1);
                JOINTS.forEach(function (j) { expect(Math.abs(st.joints[j].rotation), id + ' ' + j + ' idle').toBeLessThan(0.1); });
            });
        }
        ['solo', 'pvp', 'coop'].forEach(function (k) {
            expect(w.g('cgArenas.' + k + '.fxLayer.children.length'), k + ' arena effects cleaned').toBe(0);
            expect(w.g('cgArenas.' + k + '.overlayLayer.children.length'), k + ' cinematic cleaned').toBe(0);
        });
    }, { timeout: 90000 });

    it('monsters face left from the right side, attack and buff with their own moves', async function (ctx) {
        var w = ctx.world, types = ['normal', 'armored', 'swift', 'drain', 'boss'];
        var right = ['enemy-sprite', 'pvp-opp-sprite', 'coop-enemy-sprite'];
        for (var batch = 0; batch < 2; batch++) {
            var group = types.slice(batch * 3, batch * 3 + 3);
            var stages = group.map(function (t, i) { return w.g("cgGetStage('" + right[i] + "')"); });
            for (var i = 0; i < group.length; i++) { await awaitInWorld(w, stages[i].ready); await awaitInWorld(w, stages[i].setPortrait(w.g('MONSTER_SPRITES.' + group[i]))); }
            await pumpFrames(w, 1300);
            stages.forEach(function (st) { expect(st.facing).toBe(-1); st.playAttack(1); });
            // whichever move it picked (melee or ranged), it visibly moves at
            // some point during the attack - sample the whole move
            var moved = stages.map(function () { return false; });
            for (var f = 0; f < 16; f++) {
                await pumpFrames(w, 50);
                stages.forEach(function (st, i) {
                    if (st.portraitSprite.x !== st.baseX || st.portraitSprite.y !== st.baseY || st.portraitSprite.alpha !== 1 || JOINTS.some(function (j) { return Math.abs(st.joints[j].rotation) > 0.2; })) moved[i] = true;
                });
            }
            moved.forEach(function (m, i) { expect(m, group[i] + ' attack moves').toBe(true); });
            await pumpFrames(w, 700);
            stages.forEach(function (st) { st.playBuff(); });
            await pumpFrames(w, 1400);
            stages.forEach(function (st, i) { expect(st.effectLayer.children.length + st.backLayer.children.length, group[i]).toBe(0); });
        }
    }, { timeout: 30000 });

    it('a heavy blow knocks the target down, a light one only flinches it', async function (ctx) {
        var w = ctx.world;
        var foe = w.g("cgGetStage('enemy-sprite')");
        await awaitInWorld(w, foe.ready); await awaitInWorld(w, foe.setPortrait(w.g('MONSTER_SPRITES.normal')));
        await pumpFrames(w, 1300);
        foe.playHitReaction('sword', 0, 1);
        var maxRot = 0;
        for (var i = 0; i < 20; i++) { await pumpFrames(w, 16); maxRot = Math.max(maxRot, Math.abs(foe.portraitSprite.rotation)); }
        expect(maxRot, 'flinch stays upright').toBeLessThan(0.3);
        await pumpFrames(w, 800);
        foe.playHitReaction('skull', 0, 3);
        maxRot = 0;
        for (var j = 0; j < 30; j++) { await pumpFrames(w, 16); maxRot = Math.max(maxRot, Math.abs(foe.portraitSprite.rotation)); }
        expect(maxRot, 'knocked off its feet').toBeGreaterThan(0.8);
        await pumpFrames(w, 1500);
        expect(foe.portraitSprite.rotation).toBe(0);
        expect(foe.portraitSprite.x).toBe(foe.baseX);
    }, { timeout: 15000 });

    it('low-graphics mode keeps the move but skips the effects', async function (ctx) {
        var w = ctx.world;
        var st = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, st.ready); await awaitInWorld(w, st.setPortrait(w.g('CHARACTER_SPRITES.mage')));
        w.g('cgToggleLowGraphics()');
        st.playClassMotion('mage', 'skull');
        await pumpFrames(w, 200);
        expect(st.effectLayer.children.length + st.backLayer.children.length).toBe(0);
        expect(st.arena.fxLayer.children.length, 'no projectiles').toBe(0);
        expect(st.activeTweens).toBeGreaterThan(0);
        w.g('cgToggleLowGraphics()');
    });
});

describe('Painted heroes (avatar.js + hero.js)', { isolate: 'each' }, function () {
    var CLASSES = ['warrior', 'berserker', 'rogue', 'archer', 'mage', 'necromancer', 'paladin'];

    it('every class x gender paints all its parts and installs a two-bone rig', async function (ctx) {
        var w = ctx.world, st = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, st.ready);
        for (var i = 0; i < CLASSES.length; i++) {
            for (var g = 0; g < 2; g++) {
                var spec = w.g('heroSpecFor')(CLASSES[i], { gender: g ? 'f' : 'm', skin: i % 5, hair: g ? 'braid' : 'long', hairColor: i % 6, beard: 'full' }, []);
                var painted = w.g('avPaint')(spec);
                ['legL', 'shinL', 'legR', 'shinR', 'armL', 'foreL', 'torso', 'head', 'armR', 'foreR'].forEach(function (p) {
                    expect(!!painted.parts[p], CLASSES[i] + ' ' + p).toBe(true);
                });
                expect(painted.legs.L.knee.length, 'leg IK data').toBe(2);
            }
        }
        await awaitInWorld(w, st.setAvatar(w.g('heroSpecFor')('paladin', null, [])));
        expect(st.isAvatar).toBe(true);
        ['foreR', 'shinL', 'foreLf'].forEach(function (j) { expect(!!st.joints[j], j).toBe(true); });
    });

    it('equipping an item changes how the hero looks; an ill-fitting off-hand is hidden', function (ctx) {
        var w = ctx.world, spec = w.g('heroSpecFor');
        var bare = spec('warrior', null, []);
        var armored = spec('warrior', null, [{ base_id: 'breastplate', slot: 'chest', rarity: 'blue', equipped_slot: 'chest' }, { base_id: 'helm', slot: 'helmet', rarity: 'red', equipped_slot: 'helmet' }]);
        expect(bare.gear.chest.style).toBe('leather');
        expect(armored.gear.chest.style).toBe('plate');
        expect(armored.gear.chest.tier).toBe(2);
        expect(armored.gear.helmet.tier).toBe(3);
        expect(!!armored.gear.helmet.glow).toBe(true);
        var archer = spec('warrior', null, [{ base_id: 'bow', slot: 'weapon', rarity: 'white', equipped_slot: 'weapon' }]);
        expect(archer.gear.weapon.style).toBe('bow');
        expect(archer.gear.offhand, 'no shield with a bow').toBe(undefined);
    });

    it("another player's look is sanitised before it is painted", function (ctx) {
        var w = ctx.world;
        var spec = w.g('heroRemoteSpec')({ cls: 'rogue', gender: 'f', skin: 99, hairColor: -4, gear: { chest: { style: 'leather', color: 'red"/><script>', tier: 9 }, evil: { style: 'x' } } }, 'rogue');
        expect(spec.skin).toBe(4);
        expect(spec.hairColor).toBe(0);
        expect(spec.gear.chest.color).toBe('#888888');
        expect(spec.gear.chest.tier).toBe(3);
        expect(spec.gear.evil).toBe(undefined);
        var fallback = w.g('heroRemoteSpec')(null, 'mage');
        expect(fallback.cls).toBe('mage');
        expect(fallback.gear.weapon.style).toBe('staff');
    });
});
