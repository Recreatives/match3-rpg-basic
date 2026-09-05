// Stand-in for the real @supabase/supabase-js UMD bundle, loaded instead of
// it in tests/fixture.html so the test harness never touches the network or
// the real project's database. economy.js's initEconomy() runs unconditionally
// at load time in the real app - this stub just needs to satisfy that call
// chain without throwing, not actually persist anything.
//
// Every query builder method returns a "thenable chain": an object that's
// both further-chainable (.eq/.select/...) AND awaitable directly, since the
// real call sites stop chaining at different points (some await the bare
// builder, some call .single() first) - whichever point code awaits it, it
// resolves to { data: null, error: null } (or an empty array for a bare
// select(), so array methods like .find()/.forEach() never throw).
function makeChain(defaultData) {
    var chain = {
        eq: function () { return chain; },
        order: function () { return chain; },
        select: function () { return makeChain([]); },
        insert: function () { return makeChain(null); },
        update: function () { return makeChain(null); },
        single: function () { return Promise.resolve({ data: null, error: null }); },
        then: function (resolve) { resolve({ data: defaultData, error: null }); return Promise.resolve(); }
    };
    return chain;
}

window.supabase = {
    createClient: function () {
        return {
            auth: {
                getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'test-user' } } } }); },
                getUser: function () { return Promise.resolve({ data: { user: { id: 'test-user' } } }); },
                signInAnonymously: function () { return Promise.resolve({ data: { session: {} }, error: null }); }
            },
            from: function () { return makeChain([]); },
            rpc: function () { return Promise.resolve({ data: null, error: { message: 'stub: rpc not implemented in test fixture' } }); },
            channel: function () {
                var ch = {
                    on: function () { return ch; },
                    subscribe: function (cb) { if (cb) cb('SUBSCRIBED'); return ch; },
                    send: function () { return ch; },
                    track: function () { return Promise.resolve(); },
                    unsubscribe: function () { return Promise.resolve(); }
                };
                return ch;
            }
        };
    }
};
