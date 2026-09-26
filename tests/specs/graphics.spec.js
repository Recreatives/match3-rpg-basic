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

    it('all 7 portrait slots share ONE WebGL renderer (every portrait canvas is 2D)', async function (ctx) {
        var w = ctx.world;
        var stages = PORTRAIT_IDS.map(function (id) { return w.g('cgGetStage')(id); });
        await awaitInWorld(w, Promise.all(stages.map(function (s) { return s.ready; })));
        expect(w.g('cgShared.stages.length')).toBe(7);
        PORTRAIT_IDS.forEach(function (id) {
            expect(w.$(id).getContext('2d'), id + ' is a 2D canvas').toBeTruthy();
        });
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
        expect(opaquePixels(w.$('player-sprite'))).toBeGreaterThan(200);
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
        await pumpFrames(w, 300);
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
        var before = w.$('player-sprite').style.width;
        w.frame.style.width = '1100px'; w.frame.style.height = '1000px';
        // Browsers deliver 'resize' as part of a rendering update, which a
        // hidden tab never runs - dispatch it explicitly.
        w.win.dispatchEvent(new w.win.Event('resize'));
        await w.tick(200); // the resize handler is debounced on the (fake) setTimeout
        var after = w.$('player-sprite').style.width;
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

    it('class glow and legendary aura land on the right portrait', function (ctx) {
        var w = ctx.world;
        w.g("cgSetClassGlow('player-sprite', 'mage'); cgSetLegendaryAura('player-sprite', 'red')");
        expect(w.$('player-sprite').classList.contains('class-glow-mage')).toBe(true);
        expect(w.$('player-sprite').classList.contains('cg-legendary-aura')).toBe(true);
        expect(w.$('enemy-sprite').classList.contains('class-glow-mage')).toBe(false);
        w.g("cgSetLegendaryAura('player-sprite', null)");
        expect(w.$('player-sprite').classList.contains('cg-legendary-aura')).toBe(false);
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
    it('a real sword match fires a shot from the board to the enemy portrait', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { immortal: true });
        freezeEnemyTurn(w);
        var b = noMatchBoard(); b[0] = b[1] = b[2] = 'sword';
        setBoard(w, b);
        w.g('checkForMatches(false)');
        var shots = w.doc.querySelectorAll('.cg-projectile');
        expect(shots.length).toBe(1);
        var enemy = w.$('enemy-sprite').getBoundingClientRect(), tile = w.g('tiles')[1].getBoundingClientRect();
        var dx = parseFloat(shots[0].style.getPropertyValue('--dx'));
        expect(dx, 'flies right, toward the enemy').toBeCloseTo((enemy.left + enemy.width / 2) - (tile.left + tile.width / 2), 1);
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
        expect(parseFloat(shot.style.getPropertyValue('--dx')), 'flies left, to the player').toBeLessThan(0);
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

describe('Class choreography (per-class actions + VFX)', { isolate: 'each' }, function () {
    var SLOTS = ['player-sprite', 'enemy-sprite', 'pvp-my-sprite', 'pvp-opp-sprite', 'coop-my-sprite', 'coop-ally-sprite', 'coop-enemy-sprite'];
    var CLASSES = ['warrior', 'berserker', 'rogue', 'archer', 'mage', 'necromancer', 'paladin'];
    var ACTIONS = ['sword', 'skull', 'heart', 'shield', 'energy', 'ult'];

    it('every class has its own move for all 6 actions, every monster an attack and a buff', function (ctx) {
        var A = ctx.world.g('CG_CLASS_ACTIONS'), M = ctx.world.g('CG_MONSTER_ACTIONS');
        CLASSES.forEach(function (c) {
            ACTIONS.forEach(function (a) {
                expect(!!(A[c] && A[c][a] && A[c][a].pose && A[c][a].fx), c + '.' + a).toBe(true);
                expect(A[c][a].ms, c + '.' + a + ' lasts long enough to read').toBeGreaterThanOrEqual(700);
            });
        });
        ['monster_normal', 'monster_armored', 'monster_swift', 'monster_drain', 'monster_boss'].forEach(function (m) {
            expect(!!(M[m] && M[m].attack && M[m].buff), m).toBe(true);
        });
        // no two classes share the same sword move
        var fxSrc = CLASSES.map(function (c) { return String(A[c].sword.fx) + String(A[c].sword.pose); });
        expect(fxSrc.filter(function (s, i) { return fxSrc.indexOf(s) !== i; })).toEqual([]);
    });

    it('all 42 class actions run, draw effects, then clean up and return to rest', async function (ctx) {
        var w = ctx.world;
        var stages = SLOTS.map(function (id) { return w.g("cgGetStage('" + id + "')"); });
        for (var i = 0; i < 7; i++) {
            await awaitInWorld(w, stages[i].ready);
            await awaitInWorld(w, stages[i].setPortrait(w.g('CHARACTER_SPRITES.' + CLASSES[i])));
        }
        var drew = [];
        stages.forEach(function (st, i) {
            ACTIONS.forEach(function (a) { if (a === 'ult') st.playUlt(CLASSES[i]); else st.playClassMotion(CLASSES[i], a); });
        });
        await pumpFrames(w, 120);
        stages.forEach(function (st, i) { drew.push(st.effectLayer.children.length + st.backLayer.children.length); });
        drew.forEach(function (n, i) { expect(n, CLASSES[i] + ' spawned effects').toBeGreaterThan(3); });
        await pumpFrames(w, 1800);
        stages.forEach(function (st, i) {
            expect(st.activeTweens, CLASSES[i] + ' tweens').toBe(0);
            expect(st.effectLayer.children.length + st.backLayer.children.length, CLASSES[i] + ' vfx cleaned').toBe(0);
            expect(st.portraitSprite.x, CLASSES[i] + ' back at rest').toBe(st.baseX);
            expect(st.portraitSprite.alpha, CLASSES[i] + ' visible').toBe(1);
        });
    }, { timeout: 30000 });

    it('every monster attacks and buffs with its own move, facing left', async function (ctx) {
        var w = ctx.world, types = ['normal', 'armored', 'swift', 'drain', 'boss'];
        var stages = SLOTS.slice(0, 5).map(function (id) { return w.g("cgGetStage('" + id + "')"); });
        for (var i = 0; i < 5; i++) { await awaitInWorld(w, stages[i].ready); await awaitInWorld(w, stages[i].setPortrait(w.g('MONSTER_SPRITES.' + types[i]))); }
        stages.forEach(function (st) { expect(st.facing).toBe(-1); st.playAttack(); });
        await pumpFrames(w, 300);
        stages.forEach(function (st, i) {
            var moved = st.portraitSprite.x !== st.baseX || st.portraitSprite.y !== st.baseY || st.portraitSprite.alpha !== 1;
            expect(moved, types[i] + ' attack moves').toBe(true);
        });
        await pumpFrames(w, 1000);
        stages.forEach(function (st) { st.playBuff(); });
        await pumpFrames(w, 1200);
        stages.forEach(function (st, i) { expect(st.effectLayer.children.length + st.backLayer.children.length, types[i]).toBe(0); });
    }, { timeout: 20000 });

    it('characters are jointed rigs: limbs swing during every action and settle back', async function (ctx) {
        var w = ctx.world, JOINTS = ['legL', 'legR', 'torso', 'head', 'armL', 'armR'];
        var R = w.g('CG_CLASS_RIGS'), RIGS = w.g('CG_RIGS'), MR = w.g('CG_MONSTER_RIGS');
        CLASSES.forEach(function (c) { ACTIONS.forEach(function (a) { expect(!!RIGS[R[c][a]], c + '.' + a + ' rig').toBe(true); }); });
        Object.keys(MR).forEach(function (m) { expect(!!(RIGS[MR[m].attack] && RIGS[MR[m].buff]), m + ' rigs').toBe(true); });
        var stages = SLOTS.map(function (id) { return w.g("cgGetStage('" + id + "')"); });
        for (var i = 0; i < 7; i++) {
            await awaitInWorld(w, stages[i].ready);
            await awaitInWorld(w, stages[i].setPortrait(w.g('CHARACTER_SPRITES.' + CLASSES[i])));
            JOINTS.forEach(function (j) { expect(!!stages[i].joints[j], CLASSES[i] + ' has ' + j).toBe(true); });
        }
        for (var a = 0; a < ACTIONS.length; a++) {
            var act = ACTIONS[a];
            stages.forEach(function (st, i) { if (act === 'ult') st.playUlt(CLASSES[i]); else st.playClassMotion(CLASSES[i], act); });
            var peak = stages.map(function () { return 0; });
            for (var f = 0; f < 12; f++) {
                await pumpFrames(w, 100);
                stages.forEach(function (st, i) { JOINTS.forEach(function (j) { peak[i] = Math.max(peak[i], Math.abs(st.joints[j].rotation)); }); });
            }
            peak.forEach(function (p, i) { expect(p, CLASSES[i] + '.' + act + ' moves a limb clearly').toBeGreaterThan(0.3); });
            await pumpFrames(w, 1200);
            stages.forEach(function (st, i) {
                expect(st.activeTweens, CLASSES[i] + '.' + act + ' done').toBe(0);
                JOINTS.forEach(function (j) { expect(Math.abs(st.joints[j].rotation), CLASSES[i] + '.' + act + ' ' + j + ' back to idle').toBeLessThan(0.1); });
            });
        }
    }, { timeout: 60000 });

    it('low-graphics mode keeps the move but skips the effects', async function (ctx) {
        var w = ctx.world;
        var st = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, st.ready); await awaitInWorld(w, st.setPortrait(w.g('CHARACTER_SPRITES.mage')));
        w.g('cgToggleLowGraphics()');
        st.playClassMotion('mage', 'skull');
        await pumpFrames(w, 200);
        expect(st.effectLayer.children.length + st.backLayer.children.length).toBe(0);
        expect(st.activeTweens).toBeGreaterThan(0);
        w.g('cgToggleLowGraphics()');
    });
});
