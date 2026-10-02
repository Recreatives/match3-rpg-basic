// Stand-in for the real @supabase/supabase-js UMD bundle. tests/harness.js
// swaps it in for the CDN <script> when it loads the real index.html into a
// test world, so tests never touch the network or the real project's
// database (there is no staging DB - see CLAUDE.md).
//
// Three pieces, all inspectable/overridable from a test via win.__stub:
//
//  - db: a tiny in-memory table store. from(t).select/insert/update/upsert/
//    delete + eq/filter/contains/match/order/limit + single/maybeSingle
//    behave like PostgREST enough for the game's own call shapes (see
//    `grep -n "sb.from" *.js`). No RLS - that's what tests/sql/ checks
//    against a real Postgres instead.
//  - rpc: a handler table keyed by function name. Unknown RPCs resolve to
//    { data: null, error: null } and are still recorded in __stub.calls, so
//    a test can assert "earn_currency was called with p_gold: 40" without
//    having to reimplement every server function.
//  - Realtime: channels live on a bus SHARED between worlds (the harness
//    hands the same bus object to both iframes of a PvP/co-op test), so two
//    real game instances can play against each other. Broadcasts are queued,
//    not delivered synchronously - bus.pump() (called by the harness's
//    settleAll) delivers them, keeping cross-world ordering deterministic.
(function () {
    var cfg = window.__TEST_CONFIG__ || {};
    var userId = cfg.userId || 'test-user';

    function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

    var db = {
        // the wallet row stands for the active character's purse (a view on
        // the real server - schema.sql section 30)
        wallets: [{ player_id: userId, gold: 100, materials: 0 }],
        players: [{ id: userId, display_name: 'Tester', prestige_level: 0, active_character_id: cfg.noCharacter ? null : 'char-1' }],
        characters: cfg.noCharacter ? [] : [{ id: 'char-1', player_id: userId, name: 'Tester', class_key: 'warrior', gender: 'm', appearance: {}, level: 1, xp: 0, mastery: 0, gold: 100, materials: 0, needs_setup: false, last_played_at: '2026-01-01T00:00:00Z' }],
        player_items: [],
        player_achievements: [],
        daily_login: [],
        daily_quests: [],
        pvp_ratings: [],
        coop_sessions: [],
        client_errors: [],
        analytics_events: []
    };
    var nextRowId = 1;
    var calls = [];

    function table(name) { if (!db[name]) db[name] = []; return db[name]; }

    function makeQuery(tableName) {
        var q = { op: 'select', filters: [], payload: null, single: false, maybe: false, orderBy: null, limitN: null, returning: false };
        function matches(row) { return q.filters.every(function (f) { return f(row); }); }
        function exec() {
            calls.push({ type: 'from', table: tableName, op: q.op, payload: clone(q.payload) });
            var rows = table(tableName), result;
            if (q.op === 'insert' || q.op === 'upsert') {
                var list = Array.isArray(q.payload) ? q.payload : [q.payload];
                result = list.map(function (r) {
                    var row = Object.assign({}, r);
                    if (q.op === 'upsert') {
                        var key = row.id !== undefined ? 'id' : (row.room_code !== undefined ? 'room_code' : (row.player_id !== undefined ? 'player_id' : null));
                        var existing = key && rows.find(function (x) { return x[key] === row[key]; });
                        if (existing) { Object.assign(existing, row); return existing; }
                    }
                    if (row.id === undefined) row.id = 'row-' + (nextRowId++);
                    rows.push(row);
                    return row;
                });
            } else if (q.op === 'update') {
                result = rows.filter(matches);
                result.forEach(function (r) { Object.assign(r, q.payload); });
            } else if (q.op === 'delete') {
                result = rows.filter(matches);
                db[tableName] = rows.filter(function (r) { return !matches(r); });
            } else {
                result = rows.filter(matches);
            }
            if (q.orderBy) {
                var k = q.orderBy.col, asc = q.orderBy.asc;
                result = result.slice().sort(function (a, b) { return (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1); });
            }
            if (q.limitN !== null) result = result.slice(0, q.limitN);
            result = clone(result);
            if (q.single || q.maybe) {
                if (result.length === 0) return q.maybe ? { data: null, error: null } : { data: null, error: { message: 'stub: no rows', code: 'PGRST116' } };
                return { data: result[0], error: null };
            }
            if ((q.op === 'update' || q.op === 'insert' || q.op === 'upsert' || q.op === 'delete') && !q.returning) return { data: null, error: null };
            return { data: result, error: null };
        }
        var chain = {
            select: function () { if (q.op !== 'select') q.returning = true; return chain; },
            insert: function (p) { q.op = 'insert'; q.payload = p; return chain; },
            upsert: function (p) { q.op = 'upsert'; q.payload = p; return chain; },
            update: function (p) { q.op = 'update'; q.payload = p; return chain; },
            delete: function () { q.op = 'delete'; return chain; },
            eq: function (c, v) { q.filters.push(function (r) { return r[c] === v; }); return chain; },
            neq: function (c, v) { q.filters.push(function (r) { return r[c] !== v; }); return chain; },
            in: function (c, vs) { q.filters.push(function (r) { return vs.indexOf(r[c]) !== -1; }); return chain; },
            match: function (obj) { Object.keys(obj).forEach(function (c) { chain.eq(c, obj[c]); }); return chain; },
            filter: function (c, op, v) { if (op === 'eq') chain.eq(c, v); return chain; },
            contains: function (c, v) { q.filters.push(function (r) { return JSON.stringify(r[c] || []).indexOf(JSON.stringify(v).replace(/^\[|\]$/g, '')) !== -1; }); return chain; },
            order: function (c, opts) { q.orderBy = { col: c, asc: !opts || opts.ascending !== false }; return chain; },
            limit: function (n) { q.limitN = n; return chain; },
            single: function () { q.single = true; return Promise.resolve(exec()); },
            maybeSingle: function () { q.maybe = true; return Promise.resolve(exec()); },
            then: function (resolve, reject) { return Promise.resolve(exec()).then(resolve, reject); }
        };
        return chain;
    }

    // Default server behavior for the RPCs the game calls at boot or on
    // ordinary play - just enough shape that the client code paths run
    // (e.g. earn_currency returns the updated wallet row array, the same
    // `data[0]` shape adjustWallet reads). Anything else: null data, no error.
    var rpc = {
        earn_currency: function (args) {
            var w = table('wallets').find(function (r) { return r.player_id === userId; });
            w.gold += args.p_gold || 0; w.materials += args.p_materials || 0;
            return { data: [{ gold: w.gold, materials: w.materials }], error: null };
        },
        // Shapes mirror schema.sql's `returns table(...)` declarations - a
        // table-returning function always comes back as an ARRAY of rows,
        // which is why the client reads data[0].
        get_talent_status: function () { return { data: [{ earned_points: 0, spent_points: 0, learned_ids: [] }], error: null }; },
        claim_daily_quest: function () { return { data: [{ quest_gold: 20, already_claimed: false }], error: null }; },
        claim_daily_reward: function () { return { data: [{ new_gold: 150, new_streak: 1, reward_gold: 50 }], error: null }; },
        resolve_pvp_match: function () { return { data: [{ new_winner_rating: 1016, new_loser_rating: 984, rating_delta: 16 }], error: null }; },
        resolve_betrayal: function () { return { data: { lost_gold: 0, lost_materials: 0, stolen_item: null }, error: null }; },
        prestige_reset: function () { return { data: 1, error: null }; },
        get_active_seasonal_events: function () { return { data: [], error: null }; },
        get_leaderboard: function () { return { data: [], error: null }; },
        get_pvp_leaderboard: function () { return { data: [], error: null }; },
        get_friends_list: function () { return { data: [], error: null }; },
        get_available_titles: function () { return { data: [], error: null }; },
        get_my_trade_offers: function () { return { data: [], error: null }; },
        get_guild_list: function () { return { data: [], error: null }; },
        // characters (schema.sql section 30) - same shapes, no rules beyond
        // what the client relies on
        create_character: function (a) {
            var row = { id: 'char-' + (nextRowId++), player_id: userId, name: a.p_name, class_key: a.p_class, gender: a.p_gender, appearance: a.p_appearance || {}, level: 1, xp: 0, mastery: 0, gold: 0, materials: 0, needs_setup: false, last_played_at: new Date().toISOString() };
            table('characters').push(row);
            table('players')[0].active_character_id = row.id;
            return { data: clone(row), error: null };
        },
        setup_character: function (a) {
            var c = table('characters').find(function (r) { return r.id === a.p_id; });
            if (!c) return { data: null, error: { message: 'character not found or already set up' } };
            Object.assign(c, { name: a.p_name, class_key: a.p_class, gender: a.p_gender, appearance: a.p_appearance || {}, needs_setup: false });
            return { data: clone(c), error: null };
        },
        select_character: function (a) {
            var c = table('characters').find(function (r) { return r.id === a.p_id; });
            if (!c) return { data: null, error: { message: 'character not found' } };
            table('players')[0].active_character_id = c.id;
            return { data: clone(c), error: null };
        },
        delete_character: function (a) {
            var c = table('characters').find(function (r) { return r.id === a.p_id; });
            if (!c || String(a.p_confirm_name || '').trim().toLowerCase() !== c.name.toLowerCase()) return { data: null, error: { message: 'character not found or name does not match' } };
            db.characters = table('characters').filter(function (r) { return r.id !== a.p_id; });
            db.player_items = table('player_items').filter(function (r) { return r.character_id !== a.p_id; });
            return { data: null, error: null };
        },
        award_run_xp: function (a) {
            var p = table('players')[0], c = table('characters').find(function (r) { return r.id === p.active_character_id; });
            if (!c) return { data: null, error: { message: 'no active character' } };
            c.xp += Math.min(30 + a.p_floor * 9 + Math.min(a.p_kills, 10) * 3, 600);
            var total = function (L) { var s = 0; for (var i = 1; i < L; i++) s += Math.round(80 * Math.pow(i, 1.6)); return s; };
            while (c.level < 50 && c.xp >= total(c.level + 1)) c.level++;
            return { data: [{ level: c.level, xp: c.xp, mastery: c.mastery, leveled_up: false }], error: null };
        },
        equip_item: function (a) {
            var items = table('player_items'), it = items.find(function (r) { return r.id === a.p_item_id; });
            if (!it) return { data: null, error: { message: 'equip_item: item not found or not yours' } };
            var charId = table('players')[0].active_character_id;
            var slot = a.p_slot || it.slot;
            items.forEach(function (r) { if (r !== it && r.equipped_slot === slot && (!r.character_id || r.character_id === charId)) r.equipped_slot = null; });
            it.equipped_slot = slot;
            if (charId) it.character_id = charId;
            return { data: clone(it), error: null };
        },
        unequip_item: function (a) {
            var it = table('player_items').find(function (r) { return r.id === a.p_item_id; });
            if (!it) return { data: null, error: { message: 'unequip_item: item not found' } };
            it.equipped_slot = null;
            return { data: clone(it), error: null };
        },
        move_item: function (a) {
            var it = table('player_items').find(function (r) { return r.id === a.p_item_id; });
            if (!it || it.equipped_slot) return { data: null, error: { message: 'move_item: item not found (or it is worn)' } };
            it.character_id = a.p_to === 'stash' ? null : table('players')[0].active_character_id;
            return { data: clone(it), error: null };
        },
        // dungeon runs (schema.sql section 32)
        start_run: function () { var r = { id: 'run-' + (nextRowId++), floor: 0, pending_xp: 0 }; table('dungeon_runs').push(r); return { data: { run_id: r.id, abandoned: null }, error: null }; },
        record_floor: function (a) {
            var r = table('dungeon_runs').find(function (x) { return x.id === a.p_run; });
            if (!r || a.p_floor !== r.floor + 1) return { data: null, error: { message: 'record_floor: floors must come in order' } };
            var gain = Math.min(30 + a.p_floor * 9 + Math.min(a.p_kills, 10) * 3, 600);
            r.floor = a.p_floor; r.pending_xp += gain;
            return { data: [{ floor: r.floor, pending_xp: r.pending_xp, gain: gain }], error: null };
        },
        end_run: function (a) {
            var r = table('dungeon_runs').find(function (x) { return x.id === a.p_run; });
            if (!r || r.ended) return { data: null, error: { message: 'end_run: no such open run' } };
            r.ended = true;
            var paid = a.p_outcome === 'exit' ? r.pending_xp : Math.floor(r.pending_xp / 2);
            var p = table('players')[0], c = table('characters').find(function (x) { return x.id === p.active_character_id; });
            var total = function (L) { var s = 0; for (var i = 1; i < L; i++) s += Math.round(80 * Math.pow(i, 1.6)); return s; };
            if (c) { c.xp += paid; while (c.level < 50 && c.xp >= total(c.level + 1)) c.level++; }
            var out = { outcome: a.p_outcome, floor: r.floor, banked_xp: r.pending_xp, xp_granted: paid, level: c ? c.level : 1, xp: c ? c.xp : 0, mastery: 0, leveled_up: false, lost_gold: 0, lost_item: null };
            if (a.p_outcome !== 'exit') {
                var w = table('wallets')[0]; if (w) { out.lost_gold = Math.floor(w.gold * 0.1); w.gold -= out.lost_gold; }
                var worn = table('player_items').filter(function (x) { return x.equipped_slot; });
                if (worn.length) { out.lost_item = clone(worn[0]); db.player_items = table('player_items').filter(function (x) { return x !== worn[0]; }); }
            }
            return { data: out, error: null };
        },
        update_character_look: function (a) {
            var c = table('characters').find(function (x) { return x.id === a.p_id; });
            if (!c) return { data: null, error: { message: 'update_character_look: character not found' } };
            c.gender = a.p_gender === 'f' ? 'f' : 'm'; c.appearance = clone(a.p_appearance || {});
            return { data: clone(c), error: null };
        },
        // auction hall (schema.sql section 33)
        list_item: function (a) {
            var it = table('player_items').find(function (r) { return r.id === a.p_item_id; });
            if (!it || it.equipped_slot || it.locked || it.listed) return { data: null, error: { message: 'list_item: item not found or not yours' } };
            if (!(a.p_price >= 1 && a.p_price <= 1000000)) return { data: null, error: { message: 'list_item: price out of bounds' } };
            it.listed = true; it.character_id = null;
            var c = table('characters').find(function (x) { return x.id === table('players')[0].active_character_id; });
            var l = { id: 'lst-' + (nextRowId++), item_id: it.id, seller_player: userId, seller_character: c ? c.id : null, seller_name: c ? c.name : '', base_id: it.base_id, slot: it.slot, rarity: it.rarity,
                rolled_stats: clone(it.rolled_stats), set_key: it.set_key || null, item_level: it.item_level || 1, req_level: it.req_level || 1, price: a.p_price, status: 'active' };
            table('auction_listings').push(l);
            return { data: clone(l), error: null };
        },
        get_auction_listings: function (a) {
            var rows = table('auction_listings').filter(function (l) { return l.status === 'active' && (!a.p_slot || l.slot === a.p_slot) && (!a.p_rarity || l.rarity === a.p_rarity); });
            rows.sort(function (x, y) { return a.p_sort === 'price_desc' ? y.price - x.price : x.price - y.price; });
            return { data: clone(rows), error: null };
        },
        get_my_listings: function () { return { data: clone(table('auction_listings').filter(function (l) { return l.seller_player === userId; })), error: null }; },
        buy_listing: function (a) {
            var l = table('auction_listings').find(function (x) { return x.id === a.p_listing_id; });
            if (!l || l.status !== 'active') return { data: null, error: { message: 'buy_listing: no longer for sale' } };
            if (l.seller_player === userId) return { data: null, error: { message: 'buy_listing: that is your own listing' } };
            var w = table('wallets')[0];
            if (!w || w.gold < l.price) return { data: null, error: { message: 'buy_listing: insufficient gold' } };
            w.gold -= l.price; l.status = 'sold'; l.buyer_player = userId;
            table('player_items').push({ id: l.item_id || ('row-' + (nextRowId++)), player_id: userId, character_id: null, base_id: l.base_id, slot: l.slot, rarity: l.rarity, rolled_stats: clone(l.rolled_stats), set_key: l.set_key, item_level: l.item_level, req_level: l.req_level, equipped_slot: null, listed: false, locked: false });
            return { data: clone(l), error: null };
        },
        cancel_listing: function (a) {
            var l = table('auction_listings').find(function (x) { return x.id === a.p_listing_id && x.seller_player === userId && x.status === 'active'; });
            if (!l) return { data: null, error: { message: 'cancel_listing: not your active listing' } };
            l.status = 'cancelled';
            var it = table('player_items').find(function (r) { return r.id === l.item_id; });
            if (it) { it.listed = false; it.character_id = null; }
            return { data: clone(l), error: null };
        },
        lose_item_on_death: function () {
            var charId = table('players')[0].active_character_id;
            var worn = table('player_items').filter(function (r) { return r.equipped_slot && (!r.character_id || r.character_id === charId); });
            if (!worn.length) return { data: null, error: null };
            var it = worn[0];
            db.player_items = table('player_items').filter(function (r) { return r !== it; });
            return { data: clone(it), error: null };
        },
        lock_item: function (a) {
            var it = table('player_items').find(function (r) { return r.id === a.p_item_id; });
            if (!it) return { data: null, error: { message: 'lock_item: item not found' } };
            it.locked = !!a.p_locked;
            return { data: clone(it), error: null };
        },
        get_my_guild_roster: function () { return { data: [], error: null }; }
    };

    // --- Realtime -----------------------------------------------------------
    // One bus per test (shared by every world in that test). Created lazily
    // on the PARENT window when the harness didn't pass one in.
    var bus = cfg.realtimeBus || { channels: {}, queue: [] };
    if (!bus.pump) {
        bus.pump = function () {
            var delivered = 0;
            while (bus.queue.length) { var m = bus.queue.shift(); m(); delivered++; }
            return delivered;
        };
    }

    function makeChannel(name, opts) {
        var config = (opts && opts.config) || {};
        var selfBroadcast = config.broadcast && config.broadcast.self === true;
        var presenceKey = config.presence && config.presence.key;
        var room = bus.channels[name] || (bus.channels[name] = { members: [], presence: {} });
        var handlers = [];
        var ch = {
            _world: userId,
            on: function (type, filter, cb) { handlers.push({ type: type, event: filter && filter.event, cb: cb }); return ch; },
            subscribe: function (cb) {
                if (room.members.indexOf(ch) === -1) room.members.push(ch);
                calls.push({ type: 'channel', name: name, op: 'subscribe' });
                if (cb) bus.queue.push(function () { cb('SUBSCRIBED'); });
                return ch;
            },
            send: function (msg) {
                calls.push({ type: 'channel', name: name, op: 'send', event: msg.event, payload: clone(msg.payload) });
                var payload = clone(msg.payload);
                room.members.forEach(function (m) {
                    if (m === ch && !selfBroadcast) return;
                    bus.queue.push(function () { m._deliver('broadcast', msg.event, { type: 'broadcast', event: msg.event, payload: payload }); });
                });
                return Promise.resolve('ok');
            },
            track: function (meta) {
                room.presence[presenceKey || userId] = [clone(meta)];
                room.members.forEach(function (m) { bus.queue.push(function () { m._deliver('presence', 'sync', {}); }); });
                return Promise.resolve('ok');
            },
            untrack: function () { delete room.presence[presenceKey || userId]; return Promise.resolve('ok'); },
            presenceState: function () { return clone(room.presence); },
            unsubscribe: function () {
                room.members = room.members.filter(function (m) { return m !== ch; });
                if (presenceKey) delete room.presence[presenceKey];
                room.members.forEach(function (m) { bus.queue.push(function () { m._deliver('presence', 'sync', {}); }); });
                return Promise.resolve('ok');
            },
            _deliver: function (type, event, arg) {
                handlers.forEach(function (h) { if (h.type === type && (!h.event || h.event === event)) h.cb(arg); });
            }
        };
        return ch;
    }

    var session = { user: { id: userId, email: null, is_anonymous: true } };
    var client = {
        auth: {
            getSession: function () { return Promise.resolve({ data: { session: cfg.noSession ? null : session } }); },
            getUser: function () { return Promise.resolve({ data: { user: session.user } }); },
            signInAnonymously: function () { return Promise.resolve({ data: { session: session }, error: null }); },
            signUp: function () { return Promise.resolve({ data: {}, error: null }); },
            signInWithPassword: function () { return Promise.resolve({ data: {}, error: null }); },
            signOut: function () { return Promise.resolve({ error: null }); },
            updateUser: function () { return Promise.resolve({ data: {}, error: null }); },
            verifyOtp: function () { return Promise.resolve({ data: {}, error: null }); },
            resetPasswordForEmail: function () { return Promise.resolve({ data: {}, error: null }); }
        },
        from: function (t) { return makeQuery(t); },
        rpc: function (fn, args) {
            calls.push({ type: 'rpc', fn: fn, args: clone(args) });
            var h = rpc[fn];
            var res = h ? h(args || {}) : { data: null, error: null };
            return Promise.resolve(res);
        },
        channel: function (name, opts) { return makeChannel(name, opts); },
        removeChannel: function (ch) { return ch.unsubscribe(); }
    };

    window.__stub = { db: db, rpc: rpc, calls: calls, bus: bus, userId: userId, table: table };
    window.supabase = { createClient: function () { return client; } };
})();
