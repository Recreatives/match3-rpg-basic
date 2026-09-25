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
        wallets: [{ player_id: userId, gold: 100, materials: 0 }],
        players: [{ id: userId, display_name: 'Tester', prestige_level: 0 }],
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
