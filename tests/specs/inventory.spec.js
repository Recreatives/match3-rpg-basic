// The Diablo-style inventory (inventory.js) and drawn item icons (avItemIcon).

function invWorld(opts) {
    return createWorld(Object.assign({ pixi: false }, opts || {})).then(function (w) {
        w.g("(function(){ var n=0; var mk=function(slot,r,o){ var it=generateItem(slot,r,Object.assign({level:1,cls:'warrior'},o||{})); it.id='t'+(n++); it.character_id='char-1'; it.player_id='test-user'; it.equipped_slot=null; it.locked=false; return it; };"
            + "currentOwnedItems=[mk('weapon','white'), mk('weapon','blue'), mk('chest','white'), mk('helmet','blue',{cls:'mage'}), mk('ring','white'), mk('ring','blue'), mk('boots','grey',{level:40})];"
            + "currentOwnedItems[0].equipped_slot='weapon'; __stub.db.player_items = JSON.parse(JSON.stringify(currentOwnedItems)); selectedClass=CLASSES.WARRIOR; })()");
        w.g("toggleModal('shop-modal'); switchShopTab('inventory')");
        return w;
    });
}

describe('Inventory', { world: false }, function () {
    it('shows the paper doll, stats and the bag grid; worn items are not in the bag', async function () {
        var w = await invWorld();
        try {
            expect(w.$('inv-slot-weapon').className).toContain('filled');
            expect(w.$('inv-slot-helmet').className).not.toContain('filled');
            expect(w.$('inv-grid').querySelectorAll('.inv-cell').length).toBe(6);
            expect(w.$('inv-stats').textContent.length).toBeGreaterThan(0);
            // unusable: a mage helmet and a level 40 pair of boots
            expect(w.$('inv-grid').querySelectorAll('.inv-cell.unusable').length).toBe(2);
            // drawn icons, not emoji
            expect(w.$('inv-grid').querySelectorAll('img.inv-icon').length).toBe(6);
        } finally { w.destroy(); }
    });

    it('selecting an item opens its sheet with a try-on figure and a compare', async function () {
        var w = await invWorld();
        try {
            var cell = w.$('inv-grid').querySelector('[data-item-id="t1"]');
            var before = w.$('inv-figure').querySelector('img').src;
            cell.click();
            expect(w.$('inv-detail').style.display).not.toBe('none');
            expect(w.$('inv-detail').querySelector('.inv-tryon-img')).toBeTruthy();
            // the big figure wears the selected weapon too
            expect(w.$('inv-figure').querySelector('img').src).not.toBe(before);
            // the compare against the worn weapon is shown
            expect(w.$('inv-detail').textContent).toContain(w.g("itemDisplayInfo(currentOwnedItems[0]).name"));
            expect(w.$('inv-act-equip').disabled).toBe(false);
        } finally { w.destroy(); }
    });

    it('equip, stash, bag and lock all go through the server functions', async function () {
        var w = await invWorld();
        try {
            w.$('inv-grid').querySelector('[data-item-id="t2"]').click();
            w.$('inv-act-stash').click();
            await w.settle(500);
            expect(w.g("currentOwnedItems.find(function(i){return i.id==='t2'}).character_id")).toBe(null);
            w.$('inv-tab-stash').click();
            expect(w.$('inv-grid').querySelectorAll('.inv-cell').length).toBe(1);
            w.$('inv-grid').querySelector('[data-item-id="t2"]').click();
            w.$('inv-act-lock').click();
            await w.settle(500);
            expect(w.g("currentOwnedItems.find(function(i){return i.id==='t2'}).locked")).toBe(true);
            // a locked item offers no sell / scrap
            expect(w.$('inv-act-sell')).toBe(null);
            w.$('inv-act-bag').click();
            await w.settle(500);
            expect(w.g("currentOwnedItems.find(function(i){return i.id==='t2'}).character_id")).toBe('char-1');
            var fns = w.stub.calls.filter(function (c) { return c.type === 'rpc'; }).map(function (c) { return c.fn + ':' + (c.args && (c.args.p_to || c.args.p_locked)); });
            expect(fns).toContain('move_item:stash');
            expect(fns).toContain('move_item:bag');
            expect(fns).toContain('lock_item:true');
        } finally { w.destroy(); }
    });

    it('two rings go into ring1 then ring2', async function () {
        var w = await invWorld();
        try {
            await awaitInWorld(w, w.g("equipItem('t4')"));
            await awaitInWorld(w, w.g("equipItem('t5')"));
            expect(w.g("currentOwnedItems.find(function(i){return i.id==='t4'}).equipped_slot")).toBe('ring1');
            expect(w.g("currentOwnedItems.find(function(i){return i.id==='t5'}).equipped_slot")).toBe('ring2');
            w.g('renderInventory()');
            expect(w.$('inv-slot-ring1').className).toContain('filled');
            expect(w.$('inv-slot-ring2').className).toContain('filled');
        } finally { w.destroy(); }
    });

    [[360, 640], [640, 360]].forEach(function (vp) {
        it('fits a small phone ' + vp[0] + 'x' + vp[1] + ' without sideways scrolling', async function () {
            var w = await invWorld({ viewport: { width: vp[0], height: vp[1] } });
            try {
                await w.tick(500);
                var content = w.$('shop-modal').querySelector('.modal-content');
                expect(content.scrollWidth - content.clientWidth, 'modal overflow').toBe(0);
                expect(noHorizontalScroll(w)).toBe(0);
                var doll = w.$('inv-doll').getBoundingClientRect(), box = content.getBoundingClientRect();
                expect(doll.right <= box.right + 0.5 && doll.left >= box.left - 0.5, 'doll inside the modal').toBe(true);
                ['inv-slot-helmet', 'inv-slot-boots', 'inv-slot-weapon', 'inv-slot-ring2'].forEach(function (id) {
                    var r = w.$(id).getBoundingClientRect();
                    expect(r.width >= 40 && r.height >= 40, id + ' tappable').toBe(true);
                });
            } finally { w.destroy(); }
        });
    });
});

describe('Item icons', function () {
    it('every catalog base and fixed item draws an icon', function (ctx) {
        var w = ctx.world;
        var missing = w.g("(function(){ var bad=[]; Object.keys(CATALOG_BASES).forEach(function(id){ var b=CATALOG_BASES[id]; var it={ base_id:id, slot:b.slot, rarity:'blue', rolled_stats:{} }; if (!avItemIcon(it)) bad.push(id); }); Object.keys(CATALOG_FIXED).forEach(function(id){ var f=CATALOG_FIXED[id]; var it={ base_id:id, slot:f.slot, rarity:f.rarity||'orange', rolled_stats:{} }; if (!avItemIcon(it)) bad.push(id); }); return bad; })()");
        expect(missing).toEqual([]);
    });

    it('a two-cell item gets a tall icon, and the paper doll a square one', function (ctx) {
        var w = ctx.world;
        var tall = w.g("avItemIcon({ base_id: Object.keys(CATALOG_BASES).find(function(id){ return CATALOG_BASES[id].size === 2; }), slot: 'weapon', rarity: 'white', rolled_stats: {} })");
        expect(tall).toContain('width="48"');
        var sq = w.g("avItemIcon({ base_id: Object.keys(CATALOG_BASES).find(function(id){ return CATALOG_BASES[id].size === 2; }), slot: 'weapon', rarity: 'white', rolled_stats: {} }, { square: true })");
        expect(sq).toContain('width="96"');
    });
});

describe('Gear effects', function () {
    it('worn uniques carry their idle effect to the body part wearing them; a full set adds the set aura', function (ctx) {
        var w = ctx.world;
        var fx = w.g("cgGearFxFrom(heroSpecFor('warrior', null, ['uniq_starfall_helm','uniq_the_throatreaver','uniq_shattered_time_aegis'].map(function(id){ var f=CATALOG_FIXED[id]; return { base_id:id, slot:f.slot, rarity:'red', rolled_stats:{}, equipped_slot:f.slot }; })))");
        var at = {}; fx.forEach(function (f) { at[f.fx] = f.at; });
        expect(at).toEqual({ stars: 'head', blood: 'hand', void: 'offhand' });
        var withSet = w.g("cgGearFxFrom({ gear: {}, setAura: '#22c55e' })");
        expect(withSet.map(function (f) { return f.fx; })).toEqual(['set']);
        // another client's payload can't smuggle in an unknown effect
        var remote = w.g("heroRemoteSpec({ cls: 'warrior', gear: { helmet: { style: 'circlet', color: '#ffffff', fx: 'nuke' } } })");
        expect(remote.gear.helmet.fx).toBe(undefined);
    });
});
