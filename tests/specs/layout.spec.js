// T5 - mobile/desktop layout. The standing rule for this project: no size
// change may overflow a small phone, and every element needed to PLAY must
// be visible without scrolling, in portrait AND landscape. Each case loads
// the real page in a world iframe of that exact viewport size (vmin/dvh
// resolve against the iframe) and measures real layout boxes.

var VIEWPORTS = [
    [360, 640], [375, 667], [390, 844], [412, 915],   // phones, portrait
    [640, 360], [667, 375], [844, 390], [915, 412],   // phones, landscape
    [768, 1024], [1024, 768],                         // tablet
    [1280, 800], [1366, 768], [1920, 1080]            // laptop / desktop
];

function offscreen(world, ids, W, H) {
    var bad = [];
    ids.forEach(function (id) {
        var el = world.$(id);
        if (!el) { bad.push(id + ' (missing)'); return; }
        var b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) { bad.push(id + ' (zero size)'); return; }
        if (b.left < -0.5 || b.top < -0.5 || b.right > W + 0.5 || b.bottom > H + 0.5) {
            bad.push(id + ' [' + [b.left, b.top, b.right, b.bottom].map(Math.round).join(',') + ']');
        }
    });
    return bad;
}

function noHorizontalScroll(world) {
    var se = world.doc.scrollingElement;
    return se.scrollWidth - se.clientWidth;
}

describe('Layout: solo screen fits without scrolling', { world: false }, function () {
    VIEWPORTS.forEach(function (vp) {
        var W = vp[0], H = vp[1];
        it(W + 'x' + H, async function () {
            // PixiJS on: portrait canvases get their real (viewport-scaled) size.
            var w = await createWorld({ viewport: { width: W, height: H } });
            try {
                await startSolo(w, 'WARRIOR');
                w.g("setMyPortraitEverywhere('warrior')");
                var st = w.g("cgGetStage('player-sprite')"); if (st) await st.ready;
                expect(noHorizontalScroll(w), 'horizontal overflow px').toBe(0);
                expect(offscreen(w, ['grid', 'player-sprite', 'enemy-sprite', 'player-hp-bar-container',
                    'enemy-hp-bar-container', 'turn-banner', 'ult-btn', 'log-toggle'], W, H)).toEqual([]);
                var board = w.$('grid').getBoundingClientRect().width;
                expect(board, 'board stays playable').toBeGreaterThanOrEqual(220);
            } finally { w.destroy(); }
        });
    });
});

['pvp', 'coop'].forEach(function (mode) {
    var ids = mode === 'pvp'
        ? ['pvp-grid', 'pvp-my-sprite', 'pvp-opp-sprite', 'pvp-my-hp-bar-container', 'pvp-ult-btn']
        : ['coop-grid', 'coop-my-sprite', 'coop-ally-sprite', 'coop-enemy-sprite', 'coop-my-hp-bar-container', 'coop-ult-btn'];
    describe('Layout: ' + mode + ' battle view fits without scrolling', { world: false }, function () {
        VIEWPORTS.forEach(function (vp) {
            var W = vp[0], H = vp[1];
            it(W + 'x' + H, async function () {
                var w = await createWorld({ viewport: { width: W, height: H } });
                try {
                    w.g('selectedClass = CLASSES.WARRIOR');
                    var stages = ids.filter(function (id) { return /sprite/.test(id); }).map(function (id) { return w.g("cgGetStage('" + id + "')"); });
                    for (var si = 0; si < stages.length; si++) if (stages[si]) await stages[si].ready;
                    w.g("toggleModal('" + mode + "-modal')");
                    await w.tick(300);
                    // exactly what pvpStartMatch / coopBeginRun do to the view
                    w.$(mode + '-setup').style.display = 'none';
                    w.$(mode + '-battle').style.display = 'block';
                    expect(noHorizontalScroll(w), 'horizontal overflow px').toBe(0);
                    expect(offscreen(w, ids, W, H)).toEqual([]);
                    expect(w.$(mode + '-grid').getBoundingClientRect().width, 'board stays playable').toBeGreaterThanOrEqual(220);
                } finally { w.destroy(); }
            });
        });
    });
});

describe('Layout: modals and overlays', { world: false }, function () {
    it('every modal stays inside a 360x640 screen', async function () {
        var w = await createWorld({ viewport: { width: 360, height: 640 }, pixi: false });
        try {
            var modals = Array.prototype.slice.call(w.doc.querySelectorAll('.modal-overlay')).map(function (m) { return m.id; }).filter(Boolean);
            expect(modals.length).toBeGreaterThan(5);
            var bad = [];
            modals.forEach(function (id) {
                var m = w.$(id);
                m.style.display = 'flex';
                var content = m.querySelector('.modal-content');
                if (content) {
                    var b = content.getBoundingClientRect();
                    if (b.left < 0 || b.right > 360.5 || b.top < 0 || b.bottom > 640.5) bad.push(id);
                }
                m.style.display = 'none';
            });
            expect(bad).toEqual([]);
            expect(noHorizontalScroll(w)).toBe(0);
        } finally { w.destroy(); }
    });

    it('the class-selection overlay fits on the smallest phone', async function () {
        var w = await createWorld({ viewport: { width: 360, height: 640 }, pixi: false });
        try {
            expect(offscreen(w, ['game-overlay', 'overlay-title'], 360, 640)).toEqual([]);
        } finally { w.destroy(); }
    });
});
