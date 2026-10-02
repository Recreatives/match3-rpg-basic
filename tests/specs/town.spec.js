// The town (town.js): the hub between adventures, and the rule that gear /
// gold / progress windows only open outside a fight.

function townWorld(opts) {
    return createWorld(Object.assign({ pixi: false }, opts || {})).then(async function (w) {
        w.$('char-list').children[0].click();
        await w.settle(500);
        return w;
    });
}

describe('Town', { world: false }, function () {
    it('picking a hero opens the town, with every building', async function () {
        var w = await townWorld();
        try {
            expect(w.g('townIsOpen()')).toBe(true);
            ['tower', 'auction', 'arena', 'smithy', 'tavern', 'store', 'fame', 'chest', 'gate'].forEach(function (id) {
                expect(!!w.$('town-b-' + id), id).toBe(true);
            });
            expect(w.$('town-name').textContent).toBe('Tester');
            expect(w.$('town-hero')).toBeTruthy();
        } finally { w.destroy(); }
    });

    it('the smithy and storehouse open the shop / bag in town', async function () {
        var w = await townWorld();
        try {
            w.$('town-b-store').dispatchEvent(new w.win.MouseEvent('click', { bubbles: true }));
            await w.tick(400);
            expect(w.$('shop-modal').classList.contains('visible')).toBe(true);
            expect(w.$('inventory-list').style.display).toBe('block');
        } finally { w.destroy(); }
    });

    it('the dungeon gate starts a run; mid-run the shop, profile and auction stay shut', async function () {
        var w = await townWorld();
        try {
            w.$('town-b-gate').dispatchEvent(new w.win.MouseEvent('click', { bubbles: true }));
            await w.settle(1500);
            expect(w.g('townIsOpen()')).toBe(false);
            expect(w.g('currentState === STATE.PLAYING')).toBe(true);
            expect(w.stub.calls.some(function (c) { return c.fn === 'start_run'; })).toBe(true);
            ['shop-modal', 'profile-modal', 'talents-modal', 'daily-login-modal'].forEach(function (id) {
                w.g("toggleModal('" + id + "')");
                expect(w.$(id).classList.contains('visible'), id + ' must stay shut').toBe(false);
            });
            // settings-type windows still open
            w.g("toggleModal('info-modal')");
            expect(w.$('info-modal').classList.contains('visible')).toBe(true);
        } finally { w.destroy(); }
    });

    it('dying sends the hero back to town (same character)', async function () {
        var w = await townWorld();
        try {
            w.$('town-b-gate').dispatchEvent(new w.win.MouseEvent('click', { bubbles: true }));
            await w.settle(1500);
            w.g('gameOver()');
            await w.settle(500);
            expect(w.$('overlay-btn').textContent).toBe('KASABAYA DÖN');
            w.$('overlay-btn').click();
            expect(w.g('townIsOpen()')).toBe(true);
            expect(w.g('selectedClass && selectedClass.name')).toBe('Warrior');
        } finally { w.destroy(); }
    });

    [[360, 640], [640, 360]].forEach(function (vp) {
        it('the town fits ' + vp[0] + 'x' + vp[1] + ' without sideways scrolling', async function () {
            var w = await townWorld({ viewport: { width: vp[0], height: vp[1] } });
            try {
                var svg = w.$('town-svg').getBoundingClientRect();
                expect(svg.left >= -0.5 && svg.right <= vp[0] + 0.5, JSON.stringify(svg)).toBe(true);
                var root = w.$('town-screen');
                expect(root.scrollWidth - root.clientWidth).toBe(0);
            } finally { w.destroy(); }
        });
    });
});
