// Characters (characters.js + schema.sql section 30): the start screen,
// the creator, per-character play, experience, and equip through the RPC.

describe('Characters', { world: false }, function () {
    it('the start screen lists my heroes; picking one plays it', async function () {
        var w = await createWorld({ pixi: false });
        try {
            w.g("setLanguage('tr')");
            expect(w.g('charactersLoaded')).toBe(true);
            expect(w.g('activeCharacter && activeCharacter.id')).toBe('char-1');
            var list = w.$('char-list');
            expect(list && list.children.length).toBe(1);
            expect(w.$('class-selection').children[0].id).toBe('char-list');
            list.children[0].click();
            await w.settle(1000);
            expect(w.g('selectedClass && selectedClass.name')).toBe('Warrior');
            // the hero goes to town (town.js)
            expect(w.$('town-screen').style.display).toBe('flex');
            expect(w.$('mode-selection').style.display).not.toBe('flex');
            expect(w.$('player-class-label').textContent).toContain('TESTER · Sv. 1');
        } finally { w.destroy(); }
    });

    it('a new player goes straight to the creator, and creating plays the new hero', async function () {
        var w = await createWorld({ pixi: false, noCharacter: true });
        try {
            expect(w.g('myCharacters.length')).toBe(0);
            expect(w.$('character-modal').style.display).toBe('flex');
            // pick mage, female, then name it
            var classBtns = w.$('character-creator').querySelectorAll('.char-row')[0].querySelectorAll('button');
            classBtns[5].click();
            var bodyBtns = w.$('character-creator').querySelectorAll('.char-row')[1].querySelectorAll('button');
            bodyBtns[1].click();
            expect(w.g('charDraft.cls + "/" + charDraft.gender')).toBe('mage/f');
            // no beard row for a female body
            expect(w.$('character-creator').textContent).not.toContain('Sakal');
            w.$('char-name-input').value = 'X';
            w.$('char-name-input').oninput();
            w.$('char-create-btn').click();
            await w.settle(500);
            expect(w.$('char-create-msg').textContent.length).toBeGreaterThan(0);
            w.$('char-name-input').value = 'Selin';
            w.$('char-name-input').oninput();
            w.$('char-create-btn').click();
            await w.settle(2000);
            var call = w.stub.calls.filter(function (c) { return c.fn === 'create_character'; })[0];
            expect(call.args.p_class + '/' + call.args.p_gender + '/' + call.args.p_name).toBe('mage/f/Selin');
            expect(w.g('activeCharacter.name')).toBe('Selin');
            expect(w.g('selectedClass.name')).toBe('Mage');
        } finally { w.destroy(); }
    });

    it('clearing a dungeon level awards experience and can level up', async function () {
        var w = await createWorld({ pixi: false });
        try {
            await startSolo(w, 'WARRIOR');
            w.g('maxPlayerHP = 100; playerHP = 50; winLevel()');
            await w.settle(1000);
            var call = w.stub.calls.filter(function (c) { return c.fn === 'award_run_xp'; })[0];
            expect(call && call.args.p_floor).toBe(1);
            // 30 + 9 per floor + 3 per kill
            expect(w.g('activeCharacter.xp')).toBe(42);
            expect(w.g('activeCharacter.level')).toBe(1);
            await awaitInWorld(w, w.g('awardRunXp(5, 3)'));
            expect(w.g('activeCharacter.xp')).toBe(42 + 84);
            expect(w.g('activeCharacter.level')).toBe(2);
            expect(w.$('player-class-label').textContent).toContain('Sv. 2');
            expect(w.g('characterLevelProgress(activeCharacter).need')).toBe(w.g('xpTotalFor(3) - xpTotalFor(2)'));
        } finally { w.destroy(); }
    });

    it('equip and unequip go through the server functions, never a direct row update', async function () {
        var w = await createWorld({ pixi: false });
        try {
            w.g("__stub.table('player_items').push({ id: 'it-1', player_id: 'test-user', character_id: 'char-1', base_id: 'blade', slot: 'weapon', rarity: 'white', rolled_stats: { sword: 3 }, equipped_slot: null, item_level: 1, req_level: 1 })");
            w.g('selectedClass = CLASSES.WARRIOR');
            await awaitInWorld(w, w.g('fetchOwnedItems()'));
            await awaitInWorld(w, w.g("equipItem('it-1')"));
            expect(w.g("currentOwnedItems.find(function (i) { return i.id === 'it-1'; }).equipped_slot")).toBe('weapon');
            await awaitInWorld(w, w.g("unequipItem('it-1')"));
            var fns = w.stub.calls.filter(function (c) { return c.type === 'rpc'; }).map(function (c) { return c.fn; });
            expect(fns).toContain('equip_item');
            expect(fns).toContain('unequip_item');
            expect(w.stub.calls.filter(function (c) { return c.type === 'from' && c.table === 'player_items' && c.op === 'update'; }).length).toBe(0);
        } finally { w.destroy(); }
    });

});

describe('Characters: level curve', function () {
    it('the level curve matches schema.sql (level 2 at 80 xp)', function (ctx) {
        var w = ctx.world;
        expect(w.g('xpTotalFor(1)')).toBe(0);
        expect(w.g('xpTotalFor(2)')).toBe(80);
        expect(w.g('xpTotalFor(3)')).toBe(80 + Math.round(80 * Math.pow(2, 1.6)));
    });
});

describe('Characters: death penalty and banked experience', function () {
    it('dying in a solo run ends it through end_run: half the experience, 10% gold, one worn item', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        await awaitInWorld(w, w.g('runStart()'));
        w.g("currentOwnedItems = [{ id: 'd1', base_id: 'blade', slot: 'weapon', rarity: 'white', rolled_stats: { sword: 3 }, equipped_slot: 'weapon', character_id: 'char-1' }, { id: 'd2', base_id: 'blade', slot: 'weapon', rarity: 'white', rolled_stats: { sword: 3 }, equipped_slot: null, character_id: 'char-1' }]; __stub.db.player_items = JSON.parse(JSON.stringify(currentOwnedItems));");
        await awaitInWorld(w, w.g('runRecordFloor(1, 1)'));
        expect(w.g('dungeonRun.pending')).toBe(42);
        expect(w.g('activeCharacter.xp')).toBe(0); // banked, not paid yet
        w.g('gameOver()');
        await w.settle(1000);
        var end = w.stub.calls.filter(function (c) { return c.fn === 'end_run'; })[0];
        expect(end && end.args.p_outcome).toBe('death');
        expect(w.g('activeCharacter.xp')).toBe(21);
        expect(w.g("currentOwnedItems.map(function (i) { return i.id; })")).toEqual(['d2']);
    });

    it('leaving after a boss pays the whole banked run', async function (ctx) {
        var w = ctx.world;
        w.g('activeCharacter.xp = 0; activeCharacter.level = 1; __stub.table("characters")[0].xp = 0; __stub.table("characters")[0].level = 1;');
        await startSolo(w, 'WARRIOR');
        await awaitInWorld(w, w.g('runStart()'));
        for (var f = 1; f <= 5; f++) await awaitInWorld(w, w.g('runRecordFloor(' + f + ', 1)'));
        var banked = w.g('dungeonRun.pending');
        await awaitInWorld(w, w.g("runEnd('exit')"));
        expect(w.g('activeCharacter.xp')).toBe(banked);
        expect(w.g('dungeonRun')).toBe(null);
    });
});

describe('Characters: growth', function () {
    it('a character grows along its class lines, and solo HP with its level', async function (ctx) {
        var w = ctx.world;
        expect(w.g("applyCharacterLevelBonuses({ shield: 0, sword: 0, heart: 0 }, 'warrior', 50)")).toEqual({ shield: 5, sword: 3, heart: 1 });
        expect(w.g("applyCharacterLevelBonuses({ shield: 0, sword: 0, heart: 0 }, 'warrior', 1)")).toEqual({ shield: 0, sword: 0, heart: 0 });
        w.g('activeCharacter.level = 11; activeCharacter.mastery = 0');
        await startSolo(w, 'WARRIOR');
        expect(w.g('maxPlayerHP')).toBe(120);
        // level 11 warrior: base 5 shield + 2 passive + floor(10 * 0.12) = 1
        expect(w.g('TILE_STATS.shield')).toBe(8);
        w.g('activeCharacter.level = 1');
    });
});

describe('Characters: the screens fit a small phone', { world: false }, function () {
    [[360, 640], [640, 360]].forEach(function (vp) {
        it('creator ' + vp[0] + 'x' + vp[1], async function () {
            var w = await createWorld({ pixi: false, noCharacter: true, viewport: { width: vp[0], height: vp[1] } });
            try {
                expect(w.$('character-modal').style.display).toBe('flex');
                expect(noHorizontalScroll(w), 'horizontal overflow px').toBe(0);
                var box = w.$('character-modal').querySelector('.modal-content').getBoundingClientRect();
                expect(box.left >= 0 && box.right <= vp[0] && box.top >= 0 && box.bottom <= vp[1], JSON.stringify(box)).toBe(true);
                // the whole form is reachable (the content scrolls inside the modal)
                var content = w.$('character-modal').querySelector('.modal-content');
                expect(content.scrollWidth - content.clientWidth).toBe(0);
            } finally { w.destroy(); }
        });
    });
});
