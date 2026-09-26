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

    it('an idle visible portrait repaints only a few times per second', async function (ctx) {
        var w = ctx.world;
        onScreen(w);
        await startSolo(w, 'WARRIOR');
        var stage = w.g("cgGetStage('player-sprite')");
        await awaitInWorld(w, stage.setPortrait(w.g('CHARACTER_SPRITES.warrior')));
        await pumpFrames(w, 300);
        var before = stage.renderCount;
        await pumpFrames(w, 1000);
        var perSecond = stage.renderCount - before;
        expect(perSecond, 'renders in 1s idle').toBeLessThan(12);
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
        expect(stage.renderCount - before, 'renders during a 650ms ult').toBeGreaterThan(10);
        await pumpFrames(w, 600);
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
