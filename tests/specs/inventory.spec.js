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

describe('Item animation', function () {
    it('the weapon in hand adds its own moves to the attack pool', function (ctx) {
        var w = ctx.world;
        expect(w.g("cgWeaponMoves('spear', 'sword').map(function(m){ return m.id; })")).toContain('ws.lunge');
        expect(w.g("cgWeaponMoves('hammer', 'sword').length")).toBeGreaterThan(0);
        expect(w.g("cgWeaponMoves('bow', 'sword').length")).toBe(0);
    });

    it("a unique's passive firing shows a proc on the hero", async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        w.g("window.__procs = []; var orig = cgGearProc; cgGearProc = function (it, label) { __procs.push(it.base_id + '|' + label); };");
        w.g("currentOwnedItems = [{ id: 'p1', base_id: 'uniq_titans_hide', slot: 'chest', rarity: 'red', rolled_stats: {}, equipped_slot: 'chest', character_id: 'char-1' }]");
        w.g("triggerPassiveHook('sword', makeSinglePlayerCombatContext(), { amount: 40 })");
        expect(w.g('__procs')).toEqual(['uniq_titans_hide|Titan Zırhı']);
        // another character's worn item never fires
        w.g("__procs = []; currentOwnedItems[0].character_id = 'someone-else'; triggerPassiveHook('sword', makeSinglePlayerCombatContext(), { amount: 40 })");
        expect(w.g('__procs')).toEqual([]);
    });

    it('a rare drop plays a loot beam; common drops do not', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        w.g("window.__beams = []; var st = cgGetStage('enemy-sprite'); var o = st.playLootBeam.bind(st); st.playLootBeam = function (c, big) { __beams.push(big); o(c, big); };");
        w.g("cgLootBeam('white'); cgLootBeam('blue'); cgLootBeam('red')");
        expect(w.g('__beams')).toEqual([false, true]);
    });
});

describe('Painted monsters', function () {
    it('every monster type paints at every floor, keeping its move set key', function (ctx) {
        var w = ctx.world;
        var bad = w.g("(function(){ var out=[]; ['normal','armored','swift','drain','boss'].forEach(function(t){ [1,6,11,16,26,41,50].forEach(function(L){ var sp=avMonsterSpec(t,L); var p=avPaint(sp); if (!p.parts.torso || !p.parts.head || sp.charKey !== 'monster_'+t) out.push(t+'@'+L); }); }); return out; })()");
        expect(bad).toEqual([]);
        // the floor theme changes its colors, deeper floors its gear
        expect(w.g("JSON.stringify(avMonsterSpec('normal',1)) !== JSON.stringify(avMonsterSpec('normal',6))")).toBe(true);
        expect(w.g("avMonsterSpec('normal',1).gear.weapon.style + '/' + avMonsterSpec('normal',15).gear.weapon.style")).toBe('mace/axe');
        expect(w.g("avMonsterSpec('boss',5).sizeBoost")).toBeGreaterThan(1);
    });

    it('a solo floor puts its painted monster on the enemy stage', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { level: 5 });
        var st = w.g("cgGetStage('enemy-sprite')");
        await awaitInWorld(w, st.ready);
        for (var i = 0; i < 40 && st.charKey !== 'monster_boss'; i++) { await w.tick(50); await new Promise(function (r) { setTimeout(r, 20); }); }
        expect(st.charKey).toBe('monster_boss');
        expect(st.isAvatar).toBe(true);
    });
});
