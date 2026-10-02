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

describe('Auction hall', { world: false }, function () {
    function seed(w) {
        w.g("__stub.table('player_items').push({ id: 'a1', player_id: 'test-user', character_id: 'char-1', base_id: 'blade', slot: 'weapon', rarity: 'white', rolled_stats: { sword: 3 }, equipped_slot: null, item_level: 1, req_level: 1, locked: false, listed: false });"
            + "__stub.table('auction_listings').push({ id: 'L9', item_id: 'x9', seller_player: 'someone-else', seller_name: 'Kara', base_id: 'sword_t1', slot: 'weapon', rarity: 'blue', rolled_stats: { sword: 4, energy: 2 }, item_level: 3, req_level: 3, price: 40, status: 'active' });"
            + "__stub.table('auction_listings').push({ id: 'L8', item_id: 'x8', seller_player: 'someone-else', seller_name: 'Kara', base_id: 'plate_chest_t2', slot: 'chest', rarity: 'yellow', rolled_stats: { heart: 6, sword: 2, shield: 2 }, item_level: 8, req_level: 8, price: 900, status: 'active' });");
        return awaitInWorld(w, w.g('fetchOwnedItems()'));
    }

    it('the auction hall opens from the town and lists what is for sale, cheapest first', async function () {
        var w = await townWorld();
        try {
            await seed(w);
            w.$('town-b-auction').dispatchEvent(new w.win.MouseEvent('click', { bubbles: true }));
            await w.settle(500);
            expect(w.$('auction-modal').classList.contains('visible')).toBe(true);
            var rows = w.$('auction-list').querySelectorAll('.auc-row');
            expect(rows.length).toBe(2);
            expect(rows[0].textContent).toContain('40');
            // 100 gold: the 40 one is buyable, the 900 one isn't
            var btns = w.$('auction-list').querySelectorAll('button');
            expect(btns[0].disabled).toBe(false);
            expect(btns[1].disabled).toBe(true);
        } finally { w.destroy(); }
    });

    it('buying puts the item in the shared stash; listing freezes an item; withdrawing returns it', async function () {
        var w = await townWorld();
        try {
            await seed(w);
            w.g("toggleModal('auction-modal')");
            await w.settle(300);
            await awaitInWorld(w, w.g("auctionBuy('L9')"));
            expect(w.g("__stub.table('wallets')[0].gold")).toBe(60);
            expect(w.g("currentOwnedItems.some(function (i) { return i.base_id === 'sword_t1' && i.character_id === null; })")).toBe(true);
            await awaitInWorld(w, w.g("auctionList('a1', 25)"));
            expect(w.g("currentOwnedItems.find(function (i) { return i.id === 'a1'; }).listed")).toBe(true);
            // a listed item is gone from the bag grid
            w.g('renderInventory()');
            expect(w.g("invBagItems().some(function (i) { return i.id === 'a1'; })")).toBe(false);
            var mine = w.stub.table('auction_listings').filter(function (l) { return l.seller_player === 'test-user'; });
            await awaitInWorld(w, w.g("auctionCancel('" + mine[0].id + "')"));
            expect(w.g("currentOwnedItems.find(function (i) { return i.id === 'a1'; }).listed")).toBe(false);
        } finally { w.destroy(); }
    });

    it('the auction hall is shut during a dungeon run', async function () {
        var w = await townWorld();
        try {
            w.$('town-b-gate').dispatchEvent(new w.win.MouseEvent('click', { bubbles: true }));
            await w.settle(1000);
            w.g("toggleModal('auction-modal')");
            expect(w.$('auction-modal').classList.contains('visible')).toBe(false);
        } finally { w.destroy(); }
    });
});
