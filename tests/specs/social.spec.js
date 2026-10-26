// The social layer (social.js): handles Name#1234, the Post Tower (friends /
// messages / party), the Clan Hall, the bell, and the clan crest painted on
// the hero. The server rules themselves are proven in tests/sql/20_social.sql.

function socialWorld(opts) {
    return createWorld(Object.assign({ pixi: false }, opts || {})).then(async function (w) {
        w.$('char-list').children[0].click();
        await w.settle(500);
        return w;
    });
}
function click(w, id) { w.$(id).dispatchEvent(new w.win.MouseEvent('click', { bubbles: true })); }

describe('Social', { world: false }, function () {
    it('a player with a handle sees it in town; nobody is asked for a name', async function () {
        var w = await socialWorld();
        try {
            expect(w.$('handle-modal').classList.contains('visible')).toBe(false);
            expect(w.$('town-handle').textContent).toContain('Tester#1234');
            expect(w.stub.calls.some(function (c) { return c.fn === 'touch_presence' && c.args.p_activity === 'town'; })).toBe(true);
        } finally { w.destroy(); }
    });

    it('without a handle the name window opens; saving goes through set_handle', async function () {
        var w = await socialWorld({ noHandle: true });
        try {
            expect(w.$('handle-modal').classList.contains('visible')).toBe(true);
            w.$('handle-input').value = 'x';
            click(w, 'handle-save-btn');
            await w.settle(200);
            expect(w.$('handle-status').textContent.length > 0).toBe(true);
            w.$('handle-input').value = 'Hakan';
            click(w, 'handle-save-btn');
            await w.settle(600);
            var call = w.stub.calls.filter(function (c) { return c.fn === 'set_handle'; }).pop();
            expect(call.args.p_name).toBe('Hakan');
            expect(w.g('socialMe.handle')).toBe('Hakan#4821');
            expect(w.$('handle-modal').classList.contains('visible')).toBe(false);
        } finally { w.destroy(); }
    });

    it('the Post Tower lists friends with where they are, and adds by Name#1234', async function () {
        var w = await socialWorld();
        try {
            w.g("__stub.table('social_list').push({ friend_id: 'f1', handle: 'Ayse#0042', status: 'accepted', incoming: false, last_seen: new Date().toISOString(), activity: 'dungeon:7', char_name: 'Ayse', char_class: 'mage', char_level: 12, clan_tag: 'WOLF', unread: 2 })");
            w.g("__stub.table('known_players').push({ id: 'f2', handle: 'Mert#7777' })");
            click(w, 'town-b-post');
            await w.settle(600);
            expect(w.$('friends-modal').classList.contains('visible')).toBe(true);
            var list = w.$('friends-list').textContent;
            expect(list).toContain('Ayse#0042');
            expect(list).toContain('[WOLF]');
            expect(list).toContain('kat 7');
            w.$('friend-request-input').value = 'Mert';
            click(w, 'soc-add-btn');
            await w.settle(300);
            expect(w.$('friends-status').textContent).toContain('Ad#1234');
            w.$('friend-request-input').value = 'Mert#7777';
            click(w, 'soc-add-btn');
            await w.settle(600);
            expect(w.$('friends-status').textContent).toBe('İstek gönderildi.');
            expect(w.$('friends-list').textContent).toContain('Mert#7777');
            click(w, 'soc-tab-messages');
            await w.settle(300);
            expect(!!w.$('soc-privacy')).toBe(true);
        } finally { w.destroy(); }
    });

    it('the bell counts requests and messages', async function () {
        var w = await socialWorld();
        try {
            w.g("__stub.table('social_list').push({ friend_id: 'f3', handle: 'Can#0001', status: 'pending', incoming: true, unread: 0 }, { friend_id: 'f1', handle: 'Ayse#0042', status: 'accepted', incoming: false, unread: 3 })");
            await w.g('socialPollNotes()');
            await w.settle(100);
            expect(w.$('town-bell-count').textContent).toBe('4');
            click(w, 'town-bell-btn');
            await w.settle(300);
            expect(w.$('notes-modal').classList.contains('visible')).toBe(true);
            expect(w.$('notes-body').textContent).toContain('1 arkadaşlık isteği');
            expect(w.$('notes-body').textContent).toContain('3 okunmamış mesaj');
        } finally { w.destroy(); }
    });

    it('founding a clan needs Lv 20 + 5,000 gold; then the tag and crest show', async function () {
        var w = await socialWorld();
        try {
            click(w, 'town-b-clan');
            await w.settle(600);
            expect(w.$('clan-modal').classList.contains('visible')).toBe(true);
            w.$('clan-new-name').value = 'Kurtlar';
            w.$('clan-new-tag').value = 'kurt';
            w.win.confirm = function () { return true; };
            click(w, 'clan-create-btn');
            await w.settle(400);
            expect(w.$('clan-status').textContent).toBe('Seviye 20 bir karakter gerekiyor.');
            w.g("(function(){ var c = __stub.table('characters')[0]; c.level = 20; c.gold = 6000; })()");
            click(w, 'clan-create-btn');
            await w.settle(800);
            expect(w.$('clan-body').textContent).toContain('[KURT] Kurtlar');
            expect(w.g('socialNotes.clan_tag')).toBe('KURT');
            expect(w.g('myAvatarSpec().crest.sym')).toBe('lion');
            // the leader edits the crest: it lands on the server, sanitised on the way back
            click(w, 'clan-tab-settings');
            await w.settle(300);
            w.$('clan-sym').value = 'wolf';
            w.$('clan-c1').value = '#123456';
            click(w, 'clan-save');
            await w.settle(600);
            expect(w.g('socialClanCrestCache.sym')).toBe('wolf');
            expect(w.g('myAvatarSpec().crest.c1')).toBe('#123456');
            // the town shows [KURT] next to the name
            w.g('renderTown()');
            expect(w.$('town-name').textContent).toContain('[KURT]');
        } finally { w.destroy(); }
    });

    it('a crest from another player is kept to known values', async function () {
        var w = await socialWorld();
        try {
            var c = w.g("avCrestClean({ c1: 'red;}', c2: '#00ff00', sym: '<script>' })");
            expect(c).toEqual({ c1: '#8e1b1b', c2: '#00ff00', sym: 'lion' });
            var spec = w.g("heroRemoteSpec({ cls: 'warrior', gear: {}, crest: { c1: '#112233', c2: '#445566', sym: 'axe' } })");
            expect(spec.crest).toEqual({ c1: '#112233', c2: '#445566', sym: 'axe' });
            // every charge paints
            w.g('AV_CREST_SYMS').forEach(function (sym) { expect(w.g("avCrestSvg({ sym: '" + sym + "' }, 40)").indexOf('<path') !== -1, sym).toBe(true); });
        } finally { w.destroy(); }
    });

    it('a party with a co-op code sends both players into the same room', async function () {
        var w = await socialWorld();
        try {
            w.g("__stub.db.party = { party_id: 'p1', leader_id: 'someone', coop_code: 'PABCDE', members: [{ player_id: 'someone', handle: 'Lead#0001' }, { player_id: 'test-user', handle: 'Tester#1234' }] }");
            await w.g('socialFetchParty()');
            await w.settle(600);
            expect(w.$('coop-room-input').value).toBe('PABCDE');
            expect(w.g('townIsOpen()')).toBe(false);
        } finally { w.destroy(); }
    });
});
