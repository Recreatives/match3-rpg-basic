// Pixel Dungeon test harness - zero dependencies, runs in any browser (there
// is no Node in the dev environment - see CLAUDE.md's Testing section) and
// headlessly in CI via Playwright (.github/workflows/ci.yml reads
// window.__TEST_RESULTS__ / __TEST_PASS__ when the run finishes).
//
// The key idea: a "world" is an iframe running the REAL index.html - fetched
// as text and lightly rewritten (supabase CDN -> tests/supabase-stub.js,
// Turnstile and service worker removed, tests/world-prelude.js injected
// first). There is no hand-maintained copy of the page's DOM anymore; the
// old tests/fixture.html had silently drifted ~50 element ids and 30
// versions behind index.html, so code paths touching anything added since
// (portrait canvases, ghost HP bars, graphics.js itself) were never run.
//
// Game globals declared with let/const aren't window properties, but they
// ARE visible to an indirect eval in the iframe's global scope - world.g()
// uses exactly that, so tests need no production-side "test hooks".

(function () {
    var ROOT = new URL('../', location.href).href;
    var params = new URLSearchParams(location.search);
    var GREP = params.get('grep');
    var SEED_OVERRIDE = params.get('seed') ? Number(params.get('seed')) : null;
    // Appended to every script/stylesheet URL a world loads - the browser
    // otherwise happily serves a cached game.js/supabase-stub.js from before
    // your last edit (index.html's own ?v= only changes on release), and the
    // suite would test stale code while looking green.
    var RUN_TOKEN = 't' + Date.now().toString(36);

    var suites = [];
    var currentSuite = null;

    window.describe = function (name, opts, fn) {
        if (typeof opts === 'function') { fn = opts; opts = {}; }
        var suite = { name: name, opts: opts || {}, tests: [], beforeEach: [], afterEach: [], beforeAll: [] };
        var parent = currentSuite;
        currentSuite = suite;
        fn();
        currentSuite = parent;
        suites.push(suite);
    };
    window.it = function (name, fn, opts) {
        currentSuite.tests.push({ name: name, fn: fn, opts: opts || {} });
    };
    window.beforeEach = function (fn) { currentSuite.beforeEach.push(fn); };
    window.afterEach = function (fn) { currentSuite.afterEach.push(fn); };
    window.beforeAll = function (fn) { currentSuite.beforeAll.push(fn); };

    // --- expect ------------------------------------------------------------
    function fmt(v) {
        try { var s = JSON.stringify(v); return s === undefined ? String(v) : (s.length > 300 ? s.slice(0, 300) + '…' : s); }
        catch (e) { return String(v); }
    }
    function AssertionError(msg) { this.message = msg; this.stack = (new Error(msg)).stack; }
    AssertionError.prototype = Object.create(Error.prototype);
    AssertionError.prototype.name = 'AssertionError';

    // Key-order-insensitive: {a:1,b:2} equals {b:2,a:1}, arrays stay ordered.
    function canonical(v) {
        if (Array.isArray(v)) return v.map(canonical);
        if (v && typeof v === 'object') {
            var out = {};
            Object.keys(v).sort().forEach(function (k) { out[k] = canonical(v[k]); });
            return out;
        }
        return v;
    }
    function deepEqual(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }

    window.expect = function (actual, label) {
        function make(negate) {
            function check(pass, desc) {
                if (negate) pass = !pass;
                if (!pass) throw new AssertionError((label ? label + ': ' : '') + 'expected ' + fmt(actual) + (negate ? ' NOT ' : ' ') + desc);
            }
            return {
                toBe: function (e) { check(Object.is(actual, e), 'to be ' + fmt(e)); },
                toEqual: function (e) { check(deepEqual(actual, e), 'to equal ' + fmt(e)); },
                toBeTruthy: function () { check(!!actual, 'to be truthy'); },
                toBeFalsy: function () { check(!actual, 'to be falsy'); },
                toBeNull: function () { check(actual === null, 'to be null'); },
                toBeDefined: function () { check(actual !== undefined, 'to be defined'); },
                toBeGreaterThan: function (e) { check(actual > e, 'to be > ' + fmt(e)); },
                toBeGreaterThanOrEqual: function (e) { check(actual >= e, 'to be >= ' + fmt(e)); },
                toBeLessThan: function (e) { check(actual < e, 'to be < ' + fmt(e)); },
                toBeLessThanOrEqual: function (e) { check(actual <= e, 'to be <= ' + fmt(e)); },
                toBeCloseTo: function (e, eps) { check(Math.abs(actual - e) <= (eps === undefined ? 1e-6 : eps), 'to be close to ' + fmt(e)); },
                toContain: function (e) { check(actual != null && actual.indexOf(e) !== -1, 'to contain ' + fmt(e)); },
                toMatch: function (re) { check(re.test(String(actual)), 'to match ' + re); },
                toHaveLength: function (n) { check(actual != null && actual.length === n, 'to have length ' + n + ' (has ' + (actual && actual.length) + ')'); },
                toThrow: function () {
                    var threw = false;
                    try { actual(); } catch (e) { threw = true; }
                    check(threw, 'to throw');
                }
            };
        }
        var m = make(false);
        m.not = make(true);
        return m;
    };

    // --- source text (contract tests read the real files) -----------------
    var sourceCache = {};
    window.readSource = function (path) {
        if (!sourceCache[path]) {
            sourceCache[path] = fetch(ROOT + path, { cache: 'no-store' }).then(function (r) {
                if (!r.ok) throw new Error('readSource: ' + path + ' -> HTTP ' + r.status);
                return r.text();
            });
        }
        return sourceCache[path];
    };

    // --- worlds --------------------------------------------------------------
    var worldSeq = 0;
    window.__pendingWorldConfigs = {};
    var worldHost = null;

    function rewriteIndexHtml(html, id, opts) {
        var head =
            '<base href="' + ROOT + '">' +
            '<script>window.__TEST_CONFIG__ = window.parent.__pendingWorldConfigs[' + JSON.stringify(id) + '];</script>' +
            '<script src="tests/world-prelude.js?' + RUN_TOKEN + '"></script>';
        var out = html.replace(/<head>/i, '<head>' + head);
        out = out.replace(/(<(?:script|link)[^>]*(?:src|href)=")(?!https?:)([^"]+\.(?:js|css))(\?[^"]*)?"/gi, function (_, pre, path, q) {
            return pre + path + (q ? q + '&' : '?') + RUN_TOKEN + '"';
        });
        out = out.replace(/<script[^>]*challenges\.cloudflare\.com\/turnstile[^>]*><\/script>/i, '');
        out = out.replace(/<script[^>]*@supabase\/supabase-js[^>]*><\/script>/i, '<script src="tests/supabase-stub.js?' + RUN_TOKEN + '"></script>');
        if (opts.pixi === false) out = out.replace(/<script[^>]*pixi(\.min)?\.js[^>]*><\/script>/i, '');
        out = out.replace("'serviceWorker' in navigator", 'false');
        if (out.indexOf('tests/supabase-stub.js') === -1) throw new Error('harness: could not find the supabase <script> tag in index.html to replace');
        return out;
    }

    // opts: { seed, userId, viewport: {width, height}, storage, pixi,
    //         fakeTimers, realtimeBus, noSession }
    window.createWorld = async function (opts) {
        opts = opts || {};
        var id = 'w' + (++worldSeq);
        window.__pendingWorldConfigs[id] = {
            seed: SEED_OVERRIDE !== null ? SEED_OVERRIDE : (opts.seed || 1),
            userId: opts.userId || 'test-user',
            storage: opts.storage,
            fakeTimers: opts.fakeTimers,
            realtimeBus: opts.realtimeBus,
            noSession: opts.noSession
        };
        var html = rewriteIndexHtml(await readSource('index.html'), id, opts);
        if (!worldHost) {
            worldHost = document.createElement('div');
            worldHost.id = 'world-host';
            document.body.appendChild(worldHost);
        }
        var vp = opts.viewport || { width: 420, height: 820 };
        var frame = document.createElement('iframe');
        frame.style.width = vp.width + 'px';
        frame.style.height = vp.height + 'px';
        frame.setAttribute('data-world', id);
        var loaded = new Promise(function (resolve) { frame.onload = resolve; });
        frame.srcdoc = html;
        worldHost.appendChild(frame);
        await loaded;
        var win = frame.contentWindow;
        var world = {
            id: id, frame: frame, win: win, doc: win.document,
            clock: win.__clock, stub: win.__stub,
            // Evaluates in the game's global scope (sees let/const globals).
            g: function (expr) { return win.eval(expr); },
            $: function (elId) { return win.document.getElementById(elId); },
            errors: function () { return win.__testErrors; },
            settle: function (maxMs) { return win.__clock ? win.__clock.settle(maxMs) : Promise.resolve(true); },
            tick: function (ms) { return win.__clock.tickAsync(ms); },
            destroy: function () { frame.remove(); delete window.__pendingWorldConfigs[id]; }
        };
        // boot() in game.js awaits getSession() before bootGame() - let that
        // (and initEconomy's promise chain) run out before handing over.
        await world.settle(5000);
        if (win.__testErrors.length && !opts.allowBootErrors) {
            var msgs = win.__testErrors.map(function (e) { return e.message; }).join(' | ');
            world.destroy();
            throw new Error('world boot raised uncaught error(s): ' + msgs);
        }
        return world;
    };

    // Settles several worlds that talk to each other through one realtime
    // bus: deliver queued broadcasts, run each world's due timers, repeat
    // until nothing's left (or maxMs of fake time passes).
    window.settleAll = async function (worlds, bus, maxMs) {
        var limit = maxMs || 60000, step = 50, elapsed = 0;
        for (var guard = 0; guard < 5000; guard++) {
            var delivered = bus ? bus.pump() : 0;
            for (var i = 0; i < worlds.length; i++) await worlds[i].clock.flush();
            var pending = worlds.reduce(function (n, w) { return n + w.clock.pending(false); }, 0);
            if (!delivered && !pending && !(bus && bus.queue.length)) return true;
            if (elapsed >= limit) return false;
            for (var j = 0; j < worlds.length; j++) await worlds[j].clock.tickAsync(step);
            elapsed += step;
        }
        return false;
    };

    // --- runner ----------------------------------------------------------------
    var results = [];

    function withTimeout(promise, ms, what) {
        var timer;
        return Promise.race([
            promise,
            new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('timeout after ' + ms + 'ms: ' + what)); }, ms); })
        ]).finally(function () { clearTimeout(timer); });
    }

    async function runSuite(suite) {
        var tests = suite.tests.filter(function (t) {
            return !GREP || (suite.name + ' ' + t.name).toLowerCase().indexOf(GREP.toLowerCase()) !== -1;
        });
        if (!tests.length) return;
        var wantsWorld = suite.opts.world !== false;
        var perTest = suite.opts.isolate === 'each';
        var shared = null;
        var ctx = {};
        try {
            if (wantsWorld && !perTest) shared = await withTimeout(createWorld(suite.opts.world || {}), 20000, 'createWorld');
            ctx.world = shared;
            for (var b = 0; b < suite.beforeAll.length; b++) await suite.beforeAll[b](ctx);
        } catch (e) {
            tests.forEach(function (t) { results.push({ suite: suite.name, name: t.name, pass: false, detail: 'suite setup failed: ' + e.message, ms: 0 }); });
            if (shared) shared.destroy();
            return;
        }
        for (var i = 0; i < tests.length; i++) {
            var t = tests[i];
            var started = performance.now();
            var rec = { suite: suite.name, name: t.name, pass: true, detail: '', ms: 0 };
            var own = null;
            try {
                if (perTest && wantsWorld) { own = await withTimeout(createWorld(suite.opts.world || {}), 20000, 'createWorld'); ctx.world = own; }
                var w = ctx.world;
                if (w) {
                    if (w.clock) w.clock.reset();
                    w.win.__testErrors.length = 0;
                    w.win.__setSeed((SEED_OVERRIDE !== null ? SEED_OVERRIDE : (suite.opts.world && suite.opts.world.seed) || 1) + i);
                }
                for (var bi = 0; bi < suite.beforeEach.length; bi++) await suite.beforeEach[bi](ctx);
                await withTimeout(Promise.resolve(t.fn(ctx)), t.opts.timeout || 15000, t.name);
                for (var ai = 0; ai < suite.afterEach.length; ai++) await suite.afterEach[ai](ctx);
                if (w && w.win.__testErrors.length && !t.opts.allowErrors) {
                    throw new Error('uncaught error(s) in the game world: ' + w.win.__testErrors.map(function (e) {
                        return e.message + (e.stack ? ' @ ' + String(e.stack).split('\n').slice(1, 3).join(' <- ').trim() : '');
                    }).join(' | '));
                }
            } catch (e) {
                rec.pass = false;
                rec.detail = e.message + (e instanceof AssertionError ? '' : '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
            }
            if (own) own.destroy();
            rec.ms = Math.round(performance.now() - started);
            results.push(rec);
            renderProgress();
        }
        if (shared) shared.destroy();
    }

    function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

    function renderProgress() {
        var el = document.getElementById('summary');
        if (el) el.textContent = 'Running… ' + results.length + ' done, ' + results.filter(function (r) { return !r.pass; }).length + ' failed';
    }

    function render(totalMs) {
        var passCount = results.filter(function (r) { return r.pass; }).length;
        var allPass = passCount === results.length && results.length > 0;
        document.getElementById('summary').innerHTML =
            '<span class="' + (allPass ? 'pass' : 'fail') + '">' + passCount + '/' + results.length + ' passed</span>' +
            ' <small>(' + (totalMs / 1000).toFixed(1) + 's' + (GREP ? ', grep="' + esc(GREP) + '"' : '') + ')</small>';
        var bySuite = {};
        results.forEach(function (r) { (bySuite[r.suite] = bySuite[r.suite] || []).push(r); });
        document.getElementById('results').innerHTML = Object.keys(bySuite).map(function (name) {
            var rs = bySuite[name];
            var failed = rs.filter(function (r) { return !r.pass; }).length;
            var ms = rs.reduce(function (n, r) { return n + r.ms; }, 0);
            return '<details' + (failed ? ' open' : '') + '><summary class="' + (failed ? 'fail' : 'pass') + '">' +
                esc(name) + ' - ' + (rs.length - failed) + '/' + rs.length + ' <small>' + ms + 'ms</small>' +
                ' <a href="?grep=' + encodeURIComponent(name) + '">▶</a></summary>' +
                rs.map(function (r) {
                    return '<div class="' + (r.pass ? 'pass' : 'fail') + '">' + (r.pass ? '✓' : '✗') + ' ' + esc(r.name) +
                        ' <small>' + r.ms + 'ms</small>' + (r.detail ? '<pre>' + esc(r.detail) + '</pre>' : '') + '</div>';
                }).join('') + '</details>';
        }).join('');
        window.__TEST_RESULTS__ = results;
        window.__TEST_PASS__ = allPass;
    }

    window.runAllTests = async function () {
        var start = performance.now();
        for (var i = 0; i < suites.length; i++) {
            try { await runSuite(suites[i]); }
            catch (e) { results.push({ suite: suites[i].name, name: '(suite crashed)', pass: false, detail: e.message, ms: 0 }); }
        }
        render(performance.now() - start);
    };
})();
