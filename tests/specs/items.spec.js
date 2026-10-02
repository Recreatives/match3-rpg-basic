// items.js catalog + generation + equip bonuses + unique passives.
// (The items.js <-> supabase/schema.sql reference-table sync lives in
// contracts.spec.js, since it reads schema.sql itself.)

describe('Item catalog', function () {
    it('no base_id collisions across bases, set pieces and uniques', function (ctx) {
        var w = ctx.world, ids = [];
        w.g('ITEM_SLOTS').forEach(function (slot) { w.g('ITEM_BASES')[slot].forEach(function (b) { ids.push(b.id); }); });
        Object.values(w.g('ITEM_SETS')).forEach(function (set) { Object.keys(set.pieces).forEach(function (id) { ids.push(id); }); });
        Object.values(w.g('UNIQUE_LEGENDARIES')).forEach(function (bySlot) { Object.values(bySlot).forEach(function (u) { ids.push(u.id); }); });
        var dupes = ids.filter(function (id, i) { return ids.indexOf(id) !== i; });
        expect(dupes, ids.length + ' ids').toEqual([]);
    });

    it('every slot has at least one procedural base with a valid primary stat', function (ctx) {
        var w = ctx.world, pool = w.g('STAT_POOL');
        w.g('ITEM_SLOTS').forEach(function (slot) {
            var bases = w.g('ITEM_BASES')[slot];
            expect(bases && bases.length, slot).toBeGreaterThan(0);
            bases.forEach(function (b) { expect(pool, slot + '/' + b.id).toContain(b.primaryStat); });
        });
    });

    it('every unique is keyed by its real slot', function (ctx) {
        var w = ctx.world, U = w.g('UNIQUE_LEGENDARIES'), slots = w.g('ITEM_SLOTS');
        ['orange', 'red', 'teal'].forEach(function (r) {
            expect(Object.keys(U[r]).length, r).toBe(8);
            Object.keys(U[r]).forEach(function (slot) { expect(slots, r + '/' + slot).toContain(slot); });
        });
    });

    it('every catalog base has a band, classes, a size and (except rings) a look the painter knows', function (ctx) {
        var w = ctx.world, B = w.g('CATALOG_BASES'), P = w.g('AV_PAINT'), W = w.g('AV_WEAPONS');
        var styles = { helmet: ['greathelm', 'horned', 'nasal', 'hood', 'cowl', 'circlet', 'kettle', 'winged', 'bonemask', 'pelt'], chest: ['plate', 'mail', 'leather', 'robe', 'brigandine', 'fur'],
            shoulders: ['plate', 'spiked', 'leather', 'mantle', 'fur', 'bone'],
            gloves: ['gauntlet', 'leather'], legs: ['plate', 'leather', 'cloth'], boots: ['plate', 'leather', 'cloth', 'fur'], belt: ['leather', 'sash', 'chain'], amulet: ['pendant'],
            offhand: ['kite', 'tower', 'orb', 'tome', 'lantern', 'dagger', 'quiver', 'buckler', 'skull'], ring: ['band'] };
        Object.keys(B).forEach(function (id) {
            var b = B[id];
            expect(b.min >= 1 && b.max <= 50 && b.min < b.max, id + ' band').toBe(true);
            expect(b.cls.length, id + ' classes').toBeGreaterThan(0);
            expect([1, 2], id + ' size').toContain(b.size);
            if (b.slot === 'ring') return;
            expect(!!b.vis && !!P[b.vis.slot], id + ' look').toBe(true);
            if (b.vis.slot === 'weapon') expect(typeof W[b.vis.style], id + ' weapon style').toBe('function');
            else expect(styles[b.vis.slot], id + ' style').toContain(b.vis.style);
        });
    });

    it('every class can dress every slot at every level band', function (ctx) {
        var w = ctx.world, bases = w.g('ITEM_BASES'), bands = w.g('CATALOG_BANDS');
        ['warrior', 'paladin', 'berserker', 'rogue', 'archer', 'mage', 'necromancer'].forEach(function (cls) {
            ['weapon', 'helmet', 'shoulder', 'amulet', 'chest', 'gloves', 'belt', 'legs', 'boots', 'ring'].forEach(function (slot) {
                bands.forEach(function (band) {
                    var ok = bases[slot].some(function (b) { return !b.legacy && b.classes.indexOf(cls) !== -1 && b.minLevel === band[0]; });
                    expect(ok, cls + ' ' + slot + ' ' + band[0]).toBe(true);
                });
            });
        });
    });

    it('every orange/red/teal unique has a passive hooked to a real hook name', function (ctx) {
        var w = ctx.world, U = w.g('UNIQUE_LEGENDARIES'), P = w.g('UNIQUE_PASSIVES');
        var hooks = ['sword', 'heart', 'shield', 'energy', 'skull', 'ultimate'];
        ['orange', 'red', 'teal'].forEach(function (r) {
            Object.values(U[r]).forEach(function (u) {
                expect(!!P[u.id], u.id + ' has a passive').toBe(true);
                expect(hooks, u.id + ' hook').toContain(P[u.id].hook);
            });
        });
    });

    it('every set piece belongs to a real slot and every set has a bonus fn', function (ctx) {
        var w = ctx.world, slots = w.g('ITEM_SLOTS');
        Object.entries(w.g('ITEM_SETS')).forEach(function (e) {
            expect(typeof e[1].bonus, e[0]).toBe('function');
            Object.entries(e[1].pieces).forEach(function (p) { expect(slots, e[0] + '/' + p[0]).toContain(p[1].slot); });
        });
    });
});

describe('Item generation', function () {
    it('orange/red/teal always generate a fixed identity (that slot\'s, when it has one)', function (ctx) {
        var w = ctx.world, gen = w.g('generateItem'), U = w.g('UNIQUE_LEGENDARIES');
        ['orange', 'red', 'teal'].forEach(function (r) {
            var ids = Object.values(U[r]).map(function (u) { return u.id; });
            w.g('ITEM_SLOTS').forEach(function (slot) {
                var item = gen(slot, r);
                if (U[r][slot]) { expect(item.base_id).toBe(U[r][slot].id); expect(item.rolled_stats).toEqual(U[r][slot].stats); }
                else expect(ids, r + ' fallback for ' + slot).toContain(item.base_id);
                expect(item.req_level, item.base_id + ' level').toBeGreaterThanOrEqual(30);
            });
        });
    });

    it('rolls pick a base from the level\'s band, for the class when asked, and scale with the item level', function (ctx) {
        var w = ctx.world, gen = w.g('generateItem');
        for (var n = 0; n < 40; n++) {
            var low = gen('chest', 'white', { level: 3, cls: 'mage' }), high = gen('chest', 'white', { level: 47, cls: 'mage' });
            var bl = w.g('CATALOG_BASES')[low.base_id], bh = w.g('CATALOG_BASES')[high.base_id];
            expect(bl.cls, low.base_id).toContain('mage');
            expect(bh.cls, high.base_id).toContain('mage');
            expect(low.item_level >= bl.min && low.item_level <= bl.max, 'in band').toBe(true);
            expect(high.item_level).toBe(47);
            expect(high.req_level).toBe(47);
        }
        expect(w.g('itemLevelMult(50)')).toBeCloseTo(2.47, 0.01);
        expect(w.g("itemUsableBy({ base_id: 'plate_chest_3', req_level: 22 }, 'mage', 30)"), 'mages wear cloth').toBe(false);
        expect(w.g("itemUsableBy({ base_id: 'cloth_chest_3', req_level: 22 }, 'mage', 20)"), 'too low level').toBe(false);
        expect(w.g("itemUsableBy({ base_id: 'cloth_chest_3', req_level: 22 }, 'mage', 22)")).toBe(true);
    });

    it('procedural items roll exactly affixCount stats, primary stat always first', function (ctx) {
        var w = ctx.world, gen = w.g('generateItem'), R = w.g('RARITY_DEFS'), bases = w.g('ITEM_BASES');
        ['grey', 'white', 'blue', 'yellow'].forEach(function (r) {
            for (var n = 0; n < 50; n++) {
                w.g('ITEM_SLOTS').forEach(function (slot) {
                    var item = gen(slot, r);
                    var base = bases[slot].find(function (b) { return b.id === item.base_id; });
                    expect(Object.keys(item.rolled_stats).length, r + '/' + slot).toBe(R[r].affixCount);
                    expect(Object.keys(item.rolled_stats)[0]).toBe(base.primaryStat);
                });
            }
        });
    });

    it('skull_self_dmg affixes always roll negative (a downside stat reduced)', function (ctx) {
        var w = ctx.world;
        for (var i = 0; i < 300; i++) {
            var v = w.g("rollAffixValue('skull_self_dmg', 2)");
            expect(v).toBeLessThan(0);
        }
    });

    it('only grey/white/blue have a shop price', function (ctx) {
        var w = ctx.world, gen = w.g('generateItem');
        ['grey', 'white', 'blue'].forEach(function (r) { expect(gen('weapon', r).cost, r).toBeGreaterThan(0); });
        ['yellow', 'orange', 'red', 'teal'].forEach(function (r) { expect(gen('weapon', r).cost, r).toBeNull(); });
    });

    it('loot drop rarity follows dropWeight (seeded, 20000 rolls)', function (ctx) {
        var w = ctx.world, R = w.g('RARITY_DEFS'), counts = {}, N = 20000;
        var total = Object.values(R).reduce(function (s, r) { return s + r.dropWeight; }, 0);
        for (var i = 0; i < N; i++) { var it2 = w.g('rollLootDrop([], { level: 50 })'); counts[it2.rarity] = (counts[it2.rarity] || 0) + 1; }
        ['grey', 'white', 'blue', 'yellow'].forEach(function (k) {
            expect((counts[k] || 0) / N, k).toBeCloseTo(R[k].dropWeight / total, 0.015);
        });
        expect(counts.teal || 0, 'teal is rare but reachable').toBeGreaterThan(0);
    });

    it('a set drop prefers a piece the player does not own yet', function (ctx) {
        var w = ctx.world, sets = w.g('ITEM_SETS');
        var setKey = Object.keys(sets)[0], pieces = Object.keys(sets[setKey].pieces);
        var owned = pieces.slice(1).map(function (id) { return { base_id: id }; });
        w.g("RARITY_DEFS_BACKUP = JSON.stringify(Object.fromEntries(Object.entries(RARITY_DEFS).map(([k, v]) => [k, v.dropWeight])))");
        w.g("Object.keys(RARITY_DEFS).forEach(k => RARITY_DEFS[k].dropWeight = k === 'green' ? 1 : 0)");
        try {
            for (var i = 0; i < 30; i++) {
                var item = w.g('rollLootDrop')(owned, { level: 50 });
                if (item.set_key === setKey) expect(item.base_id).toBe(pieces[0]);
            }
        } finally {
            w.g("(function(b){ Object.keys(b).forEach(k => RARITY_DEFS[k].dropWeight = b[k]); })(JSON.parse(RARITY_DEFS_BACKUP))");
        }
    });
});

describe('Loot below the unique / set levels', function () {
    it('a low-level character never gets uniques or set pieces it could not wear for ages', function (ctx) {
        var w = ctx.world;
        for (var i = 0; i < 3000; i++) {
            var it2 = w.g('rollLootDrop([], { level: 5 })');
            expect(['orange', 'red', 'teal', 'green'].indexOf(it2.rarity), it2.rarity).toBe(-1);
        }
    });
});

describe('Equipped item bonuses', function () {
    function zero() { return { sword: 0, heart: 0, shield: 0, energy: 0, skull_dmg: 0, skull_self_dmg: 0, ult_dmg: 0, lifeSteal: 0, teamHeal: 0 }; }

    it('only EQUIPPED items add their stats', function (ctx) {
        var w = ctx.world, s = zero();
        w.g('applyEquippedItemBonuses')(s, [
            { base_id: 'x', rolled_stats: { sword: 3 }, equipped_slot: 'weapon' },
            { base_id: 'y', rolled_stats: { sword: 50 }, equipped_slot: null }
        ]);
        expect(s.sword).toBe(3);
    });

    it('set bonus applies only with every piece equipped', function (ctx) {
        var w = ctx.world, gen = w.g('generateItem'), s1 = zero(), s2 = zero();
        var glove = Object.assign(gen('gloves', 'green', { setKey: 'berserker_fury', pieceId: 'bloodied_gauntlet' }), { equipped_slot: 'gloves' });
        var shoulder = Object.assign(gen('shoulder', 'green', { setKey: 'berserker_fury', pieceId: 'crimson_pauldron' }), { equipped_slot: 'shoulder' });
        w.g('applyEquippedItemBonuses')(s1, [glove]);
        expect(s1.ult_dmg).toBe(0);
        w.g('applyEquippedItemBonuses')(s2, [glove, shoulder]);
        expect(s2.ult_dmg).toBe(10);
    });

    it('itemPower rises with rarity for the same base', function (ctx) {
        var w = ctx.world, gen = w.g('generateItem'), power = w.g('itemPower');
        var avg = function (r) { var s = 0; for (var i = 0; i < 40; i++) s += power(gen('weapon', r)); return s / 40; };
        var grey = avg('grey'), white = avg('white'), blue = avg('blue'), yellow = avg('yellow');
        expect(white).toBeGreaterThan(grey);
        expect(blue).toBeGreaterThan(white);
        expect(yellow).toBeGreaterThan(blue);
    });
});

describe('Unique passives in combat', { isolate: 'each' }, function () {
    it('an equipped unique fires on its hook through the real combat path', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        var P = w.g('UNIQUE_PASSIVES');
        var swordUnique = Object.keys(P).find(function (id) { return id === 'uniq_nights_lament'; });
        expect(!!swordUnique).toBe(true);
        w.g("currentOwnedItems = [{ base_id: 'uniq_nights_lament', rolled_stats: {}, equipped_slot: 'weapon' }]");
        w.g("enemyHP = maxEnemyHP = 500; enemyArmor = 0; playerArmor = 0; isPlayerTurn = true; applyRPGEffects('sword', 2)");
        // 20% of the 12 sword damage dealt -> +2 armor
        expect(w.g('playerArmor')).toBe(2);
        w.g('currentOwnedItems = []');
    });

    it('an unequipped unique never fires', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        w.g("currentOwnedItems = [{ base_id: 'uniq_nights_lament', rolled_stats: {}, equipped_slot: null }]");
        w.g("enemyHP = maxEnemyHP = 500; playerArmor = 0; isPlayerTurn = true; applyRPGEffects('sword', 2)");
        expect(w.g('playerArmor')).toBe(0);
        w.g('currentOwnedItems = []');
    });

    it('every passive runs against a real combat context without throwing', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        var P = w.g('UNIQUE_PASSIVES');
        Object.keys(P).forEach(function (id) {
            var c = w.g('makeSinglePlayerCombatContext()');
            var payload = { amount: 20, dmgToOpponent: 30, recoil: 10 };
            P[id].effect(c, payload);
        });
    });
});

describe('Loot: always wearable, strong items rare', function () {
    it('a drop never needs a higher level than the character has', function (ctx) {
        var w = ctx.world;
        var bad = w.g("(function(){ var bad=[]; [1,3,7,12,19,24,29,33,38,44,50].forEach(function(L){ for (var i=0;i<150;i++){ var it=rollLootDrop([], { level: L, cls: 'warrior', floor: L * 2, boss: i % 4 === 0 }); if (itemReqLevel(it) > L) bad.push(L+':'+it.base_id+'@'+itemReqLevel(it)); } }); return bad.slice(0,10); })()");
        expect(bad).toEqual([]);
    });

    it('each 5 levels brings new bases (10 tiers), never rolling the legacy ones', function (ctx) {
        var w = ctx.world;
        var tiers = w.g("(function(){ var s={}; Object.keys(CATALOG_BASES).forEach(function(id){ var b=CATALOG_BASES[id]; if (!b.legacy) s[b.min+'-'+b.max]=1; }); return Object.keys(s).length; })()");
        expect(tiers).toBe(10);
        var legacy = w.g("(function(){ for (var i=0;i<300;i++){ var it=generateItem('chest','white',{ level: 1 + (i % 50) }); if (CATALOG_BASES[it.base_id].legacy) return it.base_id; } return null; })()");
        expect(legacy).toBe(null);
        expect(w.g("Object.keys(CATALOG_BASES).filter(function(id){ return !CATALOG_BASES[id].legacy; }).length")).toBeGreaterThan(600);
    });

    it('rare-and-up stays rare: ~7% normally, under 15% even on a deep boss; uniques around 1% at most', function (ctx) {
        var w = ctx.world;
        var r = w.g("(function(){ var w1=lootRarityWeights({ floor: 1 }), w2=lootRarityWeights({ floor: 50, boss: true }); function share(w, keys){ var t=0,k=0; Object.keys(w).forEach(function(x){ t+=w[x]; if (keys.indexOf(x)!==-1) k+=w[x]; }); return k/t; } return { rare1: share(w1,['yellow','green','orange','red','teal']), uniq1: share(w1,['orange','red','teal']), rareBoss: share(w2,['yellow','green','orange','red','teal']), uniqBoss: share(w2,['orange','red','teal']) }; })()");
        expect(r.rare1).toBeLessThan(0.08);
        expect(r.uniq1).toBeLessThan(0.008);
        expect(r.rareBoss).toBeLessThan(0.15);
        expect(r.uniqBoss).toBeLessThan(0.015);
    });

    it('a rare (yellow) item gets its own stable two-word name', function (ctx) {
        var w = ctx.world;
        var a = w.g("itemDisplayInfo({ base_id: 'plate_chest_t3', slot: 'chest', rarity: 'yellow', rolled_stats: { heart: 3, sword: 2 } }).name");
        var b = w.g("itemDisplayInfo({ base_id: 'plate_chest_t3', slot: 'chest', rarity: 'yellow', rolled_stats: { heart: 3, sword: 2 } }).name");
        expect(a).toBe(b);
        expect(a.split(' · ').length).toBe(2);
    });
});
