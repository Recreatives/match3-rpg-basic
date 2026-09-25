// Injected as the VERY FIRST script of every test "world" (an iframe running
// the real index.html - see tests/harness.js's createWorld), before any game
// script or even index.html's own inline error logger. Makes a world
// deterministic without the game code knowing it's under test:
//
//  - Math.random is a seeded PRNG (mulberry32) - same seed, same board, same
//    enemy AI "mistakes", same item rolls, every run.
//  - setTimeout/setInterval/clearTimeout/clearInterval and Date.now run on a
//    fake clock the test advances explicitly (window.__clock.tickAsync etc.).
//    Nothing scheduled by one test can fire during the next one: the harness
//    calls __clock.reset() between tests, which simply drops every pending
//    timer. That exact leak (an enemy-turn setTimeout left over from the
//    previous board test firing mid-way through the next) is what made the
//    old "2-group match step settles" regression test flaky.
//    performance.now/requestAnimationFrame stay real on purpose - they only
//    drive PixiJS's ticker and graphics.js's tweens (pure presentation).
//  - Uncaught errors and unhandled promise rejections are recorded in
//    window.__testErrors so the harness can fail the test that caused them,
//    instead of a broken code path "passing" because nobody was listening.
(function () {
    var cfg = window.__TEST_CONFIG__ || {};

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    var rng = mulberry32(cfg.seed || 1);
    Math.random = function () { return rng(); };
    window.__setSeed = function (seed) { rng = mulberry32(seed); };

    // A test world is a same-origin srcdoc iframe, so its real localStorage
    // IS the developer's own localStorage for this origin - a test toggling
    // low-graphics mode or the language would silently change the real game's
    // settings on the next normal page load. An in-memory Storage replacement,
    // pre-seeded from cfg.storage (e.g. the tutorial marked as already seen so
    // it doesn't pop over every test), keeps each world sealed.
    var mem = Object.assign({ pd_tutorial_seen_v1: 'true' }, cfg.storage || {});
    var memStorage = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; },
        clear: function () { Object.keys(mem).forEach(function (k) { delete mem[k]; }); },
        key: function (i) { return Object.keys(mem)[i] || null; },
        get length() { return Object.keys(mem).length; }
    };
    try { Object.defineProperty(window, 'localStorage', { value: memStorage, configurable: true }); } catch (e) {}
    window.__memStorage = mem;

    window.__testErrors = [];
    window.addEventListener('error', function (e) {
        // Resource load errors (a 404'd image) also fire 'error' but carry no
        // message/error - those aren't script failures.
        if (!e.message && !e.error) return;
        window.__testErrors.push({ kind: 'error', message: e.message, stack: e.error && e.error.stack });
    });
    window.addEventListener('unhandledrejection', function (e) {
        var r = e.reason;
        window.__testErrors.push({ kind: 'unhandledrejection', message: r && r.message ? r.message : String(r), stack: r && r.stack });
    });

    if (cfg.fakeTimers === false) return;

    var realSetTimeout = window.setTimeout.bind(window);
    var realDateNow = Date.now.bind(Date);
    var epoch = realDateNow();
    var clock = { now: 0, queue: [], nextId: 1 };

    function schedule(fn, delay, args, repeat) {
        if (typeof fn !== 'function') { var code = String(fn); fn = function () { (0, eval)(code); }; }
        var d = Math.max(0, Number(delay) || 0);
        var id = clock.nextId++;
        clock.queue.push({ id: id, at: clock.now + d, fn: fn, args: args, repeat: repeat ? Math.max(1, d) : 0 });
        return id;
    }
    function cancel(id) {
        clock.queue = clock.queue.filter(function (t) { return t.id !== id; });
    }
    function nextDue(limit) {
        var best = null;
        for (var i = 0; i < clock.queue.length; i++) {
            var t = clock.queue[i];
            if (t.at > limit) continue;
            if (!best || t.at < best.at || (t.at === best.at && t.id < best.id)) best = t;
        }
        return best;
    }
    function fire(t) {
        clock.now = t.at;
        if (t.repeat) t.at += t.repeat; else cancel(t.id);
        t.fn.apply(window, t.args || []);
    }

    window.setTimeout = function (fn, delay) { return schedule(fn, delay, Array.prototype.slice.call(arguments, 2), false); };
    window.setInterval = function (fn, delay) { return schedule(fn, delay, Array.prototype.slice.call(arguments, 2), true); };
    window.clearTimeout = cancel;
    window.clearInterval = cancel;
    Date.now = function () { return epoch + clock.now; };

    // A real macrotask boundary (MessageChannel, not setTimeout - that one's
    // faked above and would never fire) so every promise chain the last timer
    // started gets to run to completion before the next timer fires, the same
    // ordering a real browser gives timers vs. microtasks.
    var mc = new MessageChannel();
    var waiters = [];
    mc.port1.onmessage = function () { var w = waiters.shift(); if (w) w(); };
    function yieldMacrotask() { return new Promise(function (r) { waiters.push(r); mc.port2.postMessage(0); }); }

    clock.pending = function (includeIntervals) {
        return clock.queue.filter(function (t) { return includeIntervals || !t.repeat; }).length;
    };
    clock.reset = function () { clock.queue = []; };
    clock.flush = async function () { for (var i = 0; i < 3; i++) await yieldMacrotask(); };
    // Synchronous advance - fine for code with no promises in between timers.
    clock.tick = function (ms) {
        var target = clock.now + ms, t;
        while ((t = nextDue(target))) fire(t);
        clock.now = target;
    };
    // Async advance - lets promise chains settle between timers.
    clock.tickAsync = async function (ms) {
        var target = clock.now + ms, t;
        await clock.flush();
        while ((t = nextDue(target))) { fire(t); await clock.flush(); }
        clock.now = target;
    };
    // Advances until no one-shot timer is pending (setIntervals like the
    // speed-bonus ticker never "finish", so they don't count), or maxMs of
    // fake time passes - whichever comes first. Returns whether it settled.
    clock.settle = async function (maxMs) {
        var limit = clock.now + (maxMs || 60000);
        await clock.flush();
        while (clock.pending(false) > 0 && clock.now < limit) {
            var t = null;
            for (var i = 0; i < clock.queue.length; i++) {
                var q = clock.queue[i];
                if (!t || q.at < t.at || (q.at === t.at && q.id < t.id)) t = q;
            }
            if (!t || t.at > limit) break;
            fire(t);
            await clock.flush();
        }
        return clock.pending(false) === 0;
    };
    clock.realSetTimeout = realSetTimeout;
    window.__clock = clock;
})();
