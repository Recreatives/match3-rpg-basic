// Contract tests: the places where this codebase keeps two copies of the
// same truth by hand (items.js <-> supabase/schema.sql, source strings <->
// i18n-dict.js) and the "learned the expensive way" rules from CLAUDE.md.
// They read the real source files as text (readSource) and compare them
// against the live game world, so drift fails CI instead of production.

// --- tiny SQL helpers --------------------------------------------------------
// Pulls the VALUES tuples out of `insert into public.<table> (...) values ...;`
// Handles quoted strings containing commas/parens (the jsonb literals).
function sqlInsertRows(sql, table) {
    var re = new RegExp('insert into public\\.' + table + '\\s*\\(([^)]*)\\)\\s*values([\\s\\S]*?)(?:on conflict|;)', 'i');
    var m = sql.match(re);
    if (!m) throw new Error('no insert into public.' + table + ' found in schema.sql');
    var cols = m[1].split(',').map(function (c) { return c.trim(); });
    var body = m[2], rows = [], cur = null, tok = '', inStr = false;
    for (var i = 0; i < body.length; i++) {
        var ch = body[i];
        if (inStr) {
            if (ch === "'" && body[i + 1] === "'") { tok += "'"; i++; }
            else if (ch === "'") { inStr = false; cur.push({ s: tok }); tok = ''; }
            else tok += ch;
            continue;
        }
        if (ch === "'") { inStr = true; tok = ''; }
        else if (ch === '(' && !cur) { cur = []; tok = ''; }
        else if (ch === ',' && cur) { if (tok.trim()) cur.push({ n: tok.trim() }); tok = ''; }
        else if (ch === ')' && cur) {
            if (tok.trim()) cur.push({ n: tok.trim() });
            var row = {};
            cur.forEach(function (v, idx) { row[cols[idx]] = v.s !== undefined ? v.s : Number(v.n); });
            rows.push(row); cur = null; tok = '';
        }
        else if (cur) tok += ch;
    }
    return rows;
}

describe('schema.sql <-> items.js catalog sync', { world: { pixi: false } }, function () {
    var sql;
    beforeAll(async function () { sql = await readSource('supabase/schema.sql'); });

    it('item_bases lists exactly ITEM_BASES (slot, base_id, primary_stat)', function (ctx) {
        var w = ctx.world, fromJs = [], fromSql = sqlInsertRows(sql, 'item_bases');
        w.g('ITEM_SLOTS').forEach(function (slot) {
            w.g('ITEM_BASES')[slot].forEach(function (b) { fromJs.push(slot + '/' + b.id + '/' + b.primaryStat); });
        });
        var sqlKeys = fromSql.map(function (r) { return r.slot + '/' + r.base_id + '/' + r.primary_stat; });
        expect(sqlKeys.filter(function (k) { return fromJs.indexOf(k) === -1; }), 'in schema.sql but not items.js').toEqual([]);
        expect(fromJs.filter(function (k) { return sqlKeys.indexOf(k) === -1; }), 'in items.js but not schema.sql').toEqual([]);
    });

    it('item_fixed_defs lists every unique legendary with its exact stats', function (ctx) {
        var w = ctx.world, U = w.g('UNIQUE_LEGENDARIES');
        var rows = sqlInsertRows(sql, 'item_fixed_defs');
        var byKey = {};
        rows.forEach(function (r) { byKey[r.rarity + '/' + r.base_id] = JSON.parse(r.rolled_stats); });
        var jsKeys = [];
        ['orange', 'red', 'teal'].forEach(function (r) {
            Object.values(U[r]).forEach(function (u) {
                jsKeys.push(r + '/' + u.id);
                expect(byKey[r + '/' + u.id], r + '/' + u.id).toEqual(u.stats);
            });
        });
        var sqlUniques = Object.keys(byKey).filter(function (k) { return k.indexOf('green/') !== 0; });
        expect(sqlUniques.filter(function (k) { return jsKeys.indexOf(k) === -1; }), 'stale rows in schema.sql').toEqual([]);
    });

    it('item_fixed_defs lists every set piece with its exact stats', function (ctx) {
        var w = ctx.world, rows = sqlInsertRows(sql, 'item_fixed_defs'), byId = {};
        rows.filter(function (r) { return r.rarity === 'green'; }).forEach(function (r) { byId[r.base_id] = JSON.parse(r.rolled_stats); });
        var jsIds = [];
        Object.values(w.g('ITEM_SETS')).forEach(function (set) {
            Object.entries(set.pieces).forEach(function (e) { jsIds.push(e[0]); expect(byId[e[0]], e[0]).toEqual(e[1].stats); });
        });
        expect(Object.keys(byId).filter(function (id) { return jsIds.indexOf(id) === -1; }), 'stale set rows').toEqual([]);
    });

    // The server rejects any procedural item whose affix count or |stat|
    // exceeds item_rarity_bounds. Computed from the SAME inputs generateItem
    // uses (RARITY_DEFS.statMult/affixCount, rollAffixValue's top-of-range
    // roll), so a drift here means real drops get silently rejected.
    it('item_rarity_bounds can hold the best possible legitimate roll', function (ctx) {
        var w = ctx.world, R = w.g('RARITY_DEFS');
        var baseRange = { sword: 2, heart: 2, shield: 2, energy: 3, skull_dmg: 4, ult_dmg: 5, lifeSteal: 2, teamHeal: 2, skull_self_dmg: 2 };
        var bounds = {};
        sqlInsertRows(sql, 'item_rarity_bounds').forEach(function (r) { bounds[r.rarity] = r; });
        ['grey', 'white', 'blue', 'yellow'].forEach(function (rk) {
            var b = bounds[rk];
            expect(!!b, rk + ' has a bounds row').toBe(true);
            expect(R[rk].affixCount, rk + ' affix count').toBeLessThanOrEqual(b.max_affix_count);
            var maxBase = Math.max.apply(null, Object.values(baseRange));
            var maxRoll = Math.max(1, Math.round(maxBase * R[rk].statMult * 1.2));
            expect(maxRoll, rk + ' best primary roll').toBeLessThanOrEqual(b.max_stat_value);
        });
    });

    it('rarity bounds were not loosened beyond what rolls need (x2 headroom max)', function (ctx) {
        var R = ctx.world.g('RARITY_DEFS');
        sqlInsertRows(sql, 'item_rarity_bounds').forEach(function (b) {
            var maxRoll = Math.max(1, Math.round(5 * R[b.rarity].statMult * 1.2));
            expect(b.max_stat_value, b.rarity).toBeLessThanOrEqual(maxRoll * 2);
        });
    });

    it('scrap / sell / upgrade tables match items.js', function (ctx) {
        var w = ctx.world;
        var scrap = {}, sell = {}, up = {};
        sqlInsertRows(sql, 'item_scrap_values').forEach(function (r) { scrap[r.rarity] = r.materials; });
        sqlInsertRows(sql, 'item_sell_values').forEach(function (r) { sell[r.rarity] = r.gold; });
        sqlInsertRows(sql, 'item_upgrade_costs').forEach(function (r) { up[r.from_rarity] = { to: r.to_rarity, gold: r.gold_cost, materials: r.material_cost }; });
        expect(scrap).toEqual(w.g('ITEM_SCRAP_VALUES'));
        expect(sell).toEqual(w.g('ITEM_SELL_VALUES'));
        expect(up).toEqual(w.g('ITEM_UPGRADE_COSTS'));
    });

    it('purchase_item prices/affixes/multipliers match RARITY_DEFS', function (ctx) {
        var R = ctx.world.g('RARITY_DEFS');
        var fn = sql.slice(sql.indexOf('function public.purchase_item'));
        fn = fn.slice(0, fn.indexOf('$$;'));
        function caseValue(varName, rarity) {
            var line = fn.split('\n').find(function (l) { return l.indexOf(varName + ' :=') !== -1; });
            var m = line.match(new RegExp("when '" + rarity + "' then ([0-9.]+)"));
            return m ? Number(m[1]) : undefined;
        }
        ['grey', 'white', 'blue'].forEach(function (rk) {
            expect(caseValue('v_affix_count', rk), rk + ' affix').toBe(R[rk].affixCount);
            expect(caseValue('v_stat_mult', rk), rk + ' statMult').toBe(R[rk].statMult);
            var costLine = fn.split('\n').find(function (l) { return l.indexOf('v_cost :=') !== -1; });
            expect(Number(costLine.match(new RegExp("when '" + rk + "' then ([0-9.]+)"))[1]), rk + ' costMult').toBe(R[rk].costMult);
        });
        // Every shop-purchasable rarity (and only those) is allowed server-side.
        var shop = Object.keys(R).filter(function (k) { return R[k].shopAvailable; }).sort();
        expect(fn.match(/p_rarity not in \(([^)]*)\)/)[1].replace(/'|\s/g, '').split(',').sort()).toEqual(shop);
    });

    it('talent_defs lists exactly TALENT_CATALOG', function (ctx) {
        var ids = sqlInsertRows(sql, 'talent_defs').map(function (r) { return r.id; }).sort();
        expect(ids).toEqual(Object.keys(ctx.world.g('TALENT_CATALOG')).sort());
    });

    it('daily quest keys match DAILY_QUEST_DEFS', function (ctx) {
        var m = sql.match(/quest_key in \(([^)]*)\)/);
        var keys = m[1].replace(/'|\s/g, '').split(',').sort();
        expect(keys).toEqual(Object.keys(ctx.world.g('DAILY_QUEST_DEFS')).sort());
    });
});

describe('i18n completeness', { world: { pixi: false } }, function () {
    var FILES = ['game.js', 'pvp.js', 'coop.js', 'economy.js', 'items.js', 'achievements.js', 'sharedboard.js', 'graphics.js', 'i18n.js'];
    var sources = {};
    beforeAll(async function () {
        for (var i = 0; i < FILES.length; i++) sources[FILES[i]] = await readSource(FILES[i]);
    });

    function literalCalls(src) {
        var out = [], re = /\bt[f]?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g, m;
        while ((m = re.exec(src))) if (m[1] !== '`' || m[2].indexOf('${') === -1) out.push(m[2].replace(/\\(['"`\\])/g, '$1'));
        return out;
    }

    it('every t()/tf() string literal has an English translation', function (ctx) {
        var dict = ctx.world.g('EN_DICT'), missing = [];
        FILES.forEach(function (f) {
            literalCalls(sources[f]).forEach(function (s) { if (dict[s] === undefined) missing.push(f + ': ' + s); });
        });
        expect(missing).toEqual([]);
    });

    it('every catalog string shown through t() has an English translation', function (ctx) {
        var w = ctx.world, dict = w.g('EN_DICT'), missing = [];
        function need(label, s) { if (s && dict[s] === undefined) missing.push(label + ': ' + s); }
        Object.entries(w.g('CLASSES')).forEach(function (e) { need('class ' + e[0], e[1].desc); });
        w.g('REWARD_POOL').forEach(function (r) { need('reward', r.name); need('reward', r.desc); });
        Object.values(w.g('REWARD_TIER_LABELS')).forEach(function (s) { need('tier', s); });
        Object.values(w.g('MINION_LOG')).forEach(function (s) { need('minion log', s); });
        Object.values(w.g('ACHIEVEMENT_CATALOG')).forEach(function (a) { need('achievement', a.name); need('achievement', a.desc); need('achievement', a.bonusDesc); });
        Object.values(w.g('DAILY_QUEST_DEFS')).forEach(function (q) { need('quest', q.label); });
        Object.values(w.g('RARITY_DEFS')).forEach(function (r) { need('rarity', r.label); });
        Object.values(w.g('ITEM_SETS')).forEach(function (s) {
            need('set', s.name); need('set', s.bonusDesc);
            Object.values(s.pieces).forEach(function (p) { need('set piece', p.name); });
        });
        Object.values(w.g('UNIQUE_LEGENDARIES')).forEach(function (bySlot) { Object.values(bySlot).forEach(function (u) { need('unique', u.name); }); });
        w.g('ITEM_SLOTS').forEach(function (slot) { w.g('ITEM_BASES')[slot].forEach(function (b) { need('base', b.name); }); });
        Object.values(w.g('COOP_VOTE_COPY')).forEach(function (c) { need('vote', c.desc); need('vote', c.labelA); need('vote', c.labelB); });
        expect(missing).toEqual([]);
    });

    it('translations keep every {placeholder} of their key', function (ctx) {
        var dict = ctx.world.g('EN_DICT'), bad = [];
        Object.keys(dict).forEach(function (k) {
            var ph = (k.match(/\{\w+\}/g) || []).sort().join(','), phEn = (String(dict[k]).match(/\{\w+\}/g) || []).sort().join(',');
            if (ph !== phEn) bad.push(k + ' -> ' + dict[k]);
        });
        expect(bad).toEqual([]);
    });

    it('no empty translations', function (ctx) {
        var dict = ctx.world.g('EN_DICT');
        expect(Object.keys(dict).filter(function (k) { return !String(dict[k]).trim(); })).toEqual([]);
    });

    // Found in live testing: the reward title was written in English as the
    // SOURCE string, so Turkish mode showed "VICTORY! PICK 2".
    it('Turkish mode shows Turkish (reward title, ULT button), English mode English', async function (ctx) {
        var w = ctx.world;
        w.g("setLanguage('tr')");
        await startSolo(w, 'WARRIOR', { level: 2 });
        w.g("CLASSES.WARRIOR && document.getElementById('class-selection') && renderClassButtons(); document.getElementById('class-selection').children[0].click()");
        expect(w.$('ult-btn').textContent).toMatch(/KULLAN/);
        w.g('maxPlayerHP = 100; playerHP = 50; winLevel()');
        expect(w.$('overlay-title').textContent).toMatch(/ZAFER/);
        w.g("setLanguage('en'); updateRewardTitle()");
        expect(w.$('overlay-title').textContent).toMatch(/VICTORY/);
        w.g("setLanguage('tr')");
    });

    it('no English UI text is hard-coded outside the translation system', async function () {
        var bad = [];
        for (var i = 0; i < FILES.length; i++) {
            var src = await readSource(FILES[i]);
            var re = /(?:innerText|textContent)\s*=\s*[`'"]([^`'"]*)[`'"]/g, m;
            while ((m = re.exec(src))) if (/\b(USE|VICTORY|PICK|READY|WAITING|NEXT LEVEL|GAME OVER|YOU WIN|YOU LOSE)\b/.test(m[1])) bad.push(FILES[i] + ': ' + m[1]);
        }
        expect(bad).toEqual([]);
    });

    it('switching to English and back re-renders static UI without errors', function (ctx) {
        var w = ctx.world;
        w.g("setLanguage('en')");
        expect(w.$('ult-btn').textContent).toMatch(/ULTIMATE|USE/);
        w.g("setLanguage('tr')");
        expect(w.$('ult-btn').textContent).toMatch(/ULT/);
    });
});

describe('DOM rules from CLAUDE.md', { world: { pixi: false } }, function () {
    var JS = ['game.js', 'pvp.js', 'coop.js', 'economy.js', 'items.js', 'achievements.js', 'sharedboard.js', 'graphics.js', 'i18n.js', 'sound.js'];
    var src = {}, html;
    beforeAll(async function () {
        for (var i = 0; i < JS.length; i++) src[JS[i]] = await readSource(JS[i]);
        html = await readSource('index.html');
    });

    it('index.html has no duplicate element ids', function () {
        var ids = (html.match(/\sid="[^"]+"/g) || []).map(function (s) { return s.slice(5, -1); });
        expect(ids.filter(function (id, i) { return ids.indexOf(id) !== i; })).toEqual([]);
    });

    // Every getElementById('literal') must point at something that exists:
    // either in index.html or created by JS under that exact id. A typo'd id
    // returns null and usually only breaks one rarely-clicked screen.
    it('every getElementById literal refers to a real element', function () {
        var created = [];
        JS.forEach(function (f) {
            var re = /(?:id\s*=\s*["'`]|\.id\s*=\s*['"`]|setAttribute\(\s*['"]id['"]\s*,\s*['"`])([\w-]+)/g, m;
            while ((m = re.exec(src[f]))) created.push(m[1]);
        });
        var missing = [];
        JS.forEach(function (f) {
            var re = /getElementById\(\s*['"]([\w-]+)['"]\s*\)/g, m;
            while ((m = re.exec(src[f]))) {
                var id = m[1];
                if (html.indexOf('id="' + id + '"') === -1 && created.indexOf(id) === -1) missing.push(f + ': ' + id);
            }
        });
        expect(missing).toEqual([]);
    });

    // .grid / .stat-box / .tile / .hp-bar-* are reused by solo, PvP and co-op;
    // pvp-modal/coop-modal sit earlier in index.html, so a document-level
    // class query silently returns the wrong mode's element (two real bugs).
    it('no document-level querySelector on a class shared across modes', function () {
        var shared = ['grid', 'stat-box', 'tile', 'hp-bar', 'bar-container', 'combat-portrait', 'turn-indicator', 'ult-bar'];
        var bad = [];
        JS.forEach(function (f) {
            var re = /document\.querySelector(?:All)?\(\s*['"]\.([\w-]+)/g, m;
            while ((m = re.exec(src[f]))) if (shared.indexOf(m[1]) !== -1) bad.push(f + ': .' + m[1]);
        });
        expect(bad).toEqual([]);
    });

    it('every script index.html loads exists and uses the same ?v= cache-bust', function () {
        var tags = html.match(/<script src="(?!https?:)[^"]+"/g) || [];
        var versions = tags.map(function (t) { var m = t.match(/\?v=([\d.]+)/); return m ? m[1] : null; });
        expect(versions.filter(function (v, i) { return v !== versions[0]; }), 'mixed versions').toEqual([]);
        var css = html.match(/style\.css\?v=([\d.]+)/);
        expect(css && css[1]).toBe(versions[0]);
    });

    it('the visible version label matches the asset cache-bust version', function () {
        var v = html.match(/graphics\.js\?v=([\d.]+)/)[1];
        var label = html.match(/class="version"[^>]*>([^<]*)</);
        expect(!!label, 'version label present').toBe(true);
        expect(label[1]).toContain(v);
    });

    it('sw.js precaches only files that exist', async function () {
        var sw = await readSource('sw.js');
        var shell = (sw.match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
        var paths = (shell.match(/['"]([^'"]+)['"]/g) || []).map(function (s) { return s.slice(1, -1).replace(/^\.?\//, '').split('?')[0]; }).filter(Boolean);
        for (var i = 0; i < paths.length; i++) {
            if (paths[i] === '' || paths[i] === '.') continue;
            await readSource(paths[i]); // throws on 404
        }
    });

    it('sw.js precaches every local script index.html loads', async function () {
        var sw = await readSource('sw.js');
        var scripts = (html.match(/<script src="(?!https?:)([^"?]+)/g) || []).map(function (t) { return t.replace('<script src="', ''); });
        scripts.forEach(function (f) { expect(sw, 'sw.js APP_SHELL').toContain("'./" + f + "'"); });
    });

    it('every url() in style.css points at a real file', async function () {
        var css = await readSource('style.css');
        var urls = (css.match(/url\(['"]?([^'")]+)['"]?\)/g) || []).map(function (u) { return u.replace(/^url\(['"]?|['"]?\)$/g, ''); })
            .filter(function (u) { return !/^(data:|https?:|#)/.test(u); });
        for (var i = 0; i < urls.length; i++) await readSource(urls[i]);
    });

    it('every tile type the game can deal has a pixel-art sprite', async function (ctx) {
        var css = await readSource('style.css');
        var types = ctx.world.g('COOP_TILE_TYPES').map(function (t) { return t.type; });
        // inlined as data: URIs by tools/make_tiles.py (no first-paint flash)
        types.forEach(function (ty) { expect(css, 'sprite rule for ' + ty).toContain('.tile[data-type="' + ty + '"] { background-image: url(\'data:image/png;base64,'); });
    });

    it('every asset graphics.js references exists', async function () {
        var g = src['graphics.js'], refs = g.match(/assets\/[\w\/.-]+\.(png|webp|json)/g) || [];
        refs = refs.filter(function (r, i) { return refs.indexOf(r) === i; });
        expect(refs.length).toBeGreaterThan(5);
        for (var i = 0; i < refs.length; i++) await readSource(refs[i]);
    });
});
