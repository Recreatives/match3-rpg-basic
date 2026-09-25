// Combat math: class passives/ults, defense, life steal, enemy scaling,
// minion twists, boss enrage, rewards. Table-driven wherever the game itself
// is table-driven (CLASSES, REWARD_POOL), so adding a class or a reward
// automatically gets covered.

var BASE_STATS = { sword: 6, heart: 4, shield: 5, energy: 12, skull_dmg: 25, skull_self_dmg: 12, ult_dmg: 35, lifeSteal: 0, teamHeal: 6 };

// What each class's passive is documented to add on top of BASE_STATS
// (CLASSES[..].desc / the help modal). Changing a class's balance means
// updating this table on purpose - that's the point.
var EXPECTED_PASSIVES = {
    WARRIOR: { shield: 2 },
    BERSERKER: { sword: 5, skull_dmg: 15 },
    ROGUE: { energy: 5 },
    ARCHER: {},
    MAGE: { energy: 10, sword: -2 },
    NECROMANCER: { lifeSteal: 3, skull_dmg: 8 },
    PALADIN: { shield: 3, heart: 3 }
};

function statsWithPassive(key) {
    var s = Object.assign({}, BASE_STATS);
    Object.keys(EXPECTED_PASSIVES[key]).forEach(function (k) { s[k] += EXPECTED_PASSIVES[key][k]; });
    return s;
}

describe('Classes', { isolate: 'each' }, function () {
    it('there are exactly 7 classes, each with passive/ultEffect/ultName', function (ctx) {
        var C = ctx.world.g('CLASSES');
        expect(Object.keys(C).sort()).toEqual(Object.keys(EXPECTED_PASSIVES).sort());
        Object.keys(C).forEach(function (k) {
            expect(typeof C[k].passive, k + '.passive').toBe('function');
            expect(typeof C[k].ultEffect, k + '.ultEffect').toBe('function');
            expect(!!C[k].ultName, k + '.ultName').toBe(true);
        });
    });

    Object.keys(EXPECTED_PASSIVES).forEach(function (key) {
        it(key + ' passive produces the documented TILE_STATS', async function (ctx) {
            await startSolo(ctx.world, key);
            expect(ctx.world.g('TILE_STATS')).toEqual(statsWithPassive(key));
        });
    });

    // The class description is the only place a player learns these
    // numbers - it silently said +35% for Berserker while the code applied
    // +25% (fixed alongside this test).
    it('every class desc states its real incoming-damage and dodge numbers', function (ctx) {
        var C = ctx.world.g('CLASSES');
        Object.keys(C).forEach(function (k) {
            var c = C[k], desc = c.desc;
            if (c.incomingDmgMult > 1) expect(desc, k).toContain('%' + Math.round((c.incomingDmgMult - 1) * 100));
            if (c.incomingDmgMult < 1) expect(desc, k).toContain('%' + Math.round((1 - c.incomingDmgMult) * 100));
            if (c.dodgeChance >= 0.2) expect(desc, k).toContain('%' + Math.round(c.dodgeChance * 100));
        });
    });
});

describe('Ultimates (solo combat context)', { isolate: 'each' }, function () {
    async function ultWith(ctx, key, setup) {
        var w = ctx.world;
        await startSolo(w, key, { level: 4 });
        w.g('enemyHP = maxEnemyHP = 500; enemyArmor = 0; playerHP = 50; maxPlayerHP = 100; playerArmor = 0; ultCharge = 100; isProcessing = false');
        if (setup) w.g(setup);
        var before = { enemyHP: w.g('enemyHP'), playerHP: w.g('playerHP'), ult: w.g('TILE_STATS.ult_dmg') };
        w.g('useUltimate()');
        return before;
    }

    it('WARRIOR: ult_dmg + current armor', async function (ctx) {
        await ultWith(ctx, 'WARRIOR', 'playerArmor = 20');
        expect(ctx.world.g('enemyHP')).toBe(500 - (35 + 20));
    });
    it('BERSERKER: double ult_dmg, costs 10 own HP', async function (ctx) {
        await ultWith(ctx, 'BERSERKER');
        expect(ctx.world.g('enemyHP')).toBe(500 - 70);
        expect(ctx.world.g('playerHP')).toBe(40);
    });
    it('ROGUE: ult_dmg + an extra turn', async function (ctx) {
        await ultWith(ctx, 'ROGUE');
        expect(ctx.world.g('enemyHP')).toBe(500 - 35);
        await ctx.world.settle(2000);
        expect(ctx.world.g('isPlayerTurn')).toBe(true);
    });
    it('ARCHER: ignores armor (ult_dmg + 2x sword)', async function (ctx) {
        await ultWith(ctx, 'ARCHER', 'enemyArmor = 1000');
        expect(ctx.world.g('enemyHP')).toBe(500 - (35 + 12));
        expect(ctx.world.g('enemyArmor')).toBe(1000);
    });
    it('MAGE: permanently grows ult_dmg by 10 per cast', async function (ctx) {
        await ultWith(ctx, 'MAGE');
        expect(ctx.world.g('enemyHP')).toBe(500 - 35);
        expect(ctx.world.g('TILE_STATS.ult_dmg')).toBe(45);
    });
    it('NECROMANCER: heals half of the damage dealt (plus life steal on it)', async function (ctx) {
        await ultWith(ctx, 'NECROMANCER');
        expect(ctx.world.g('enemyHP')).toBe(500 - 35);
        // 17 from the ult itself + floor(35 * 3%) = 1 life steal
        expect(ctx.world.g('playerHP')).toBe(50 + 17 + 1);
    });
    it('PALADIN: heals 4x heart, deals 60% ult_dmg', async function (ctx) {
        await ultWith(ctx, 'PALADIN');
        expect(ctx.world.g('playerHP')).toBe(50 + 7 * 4);
        expect(ctx.world.g('enemyHP')).toBe(500 - Math.floor(35 * 0.6));
    });
    it('ult is refused below 100% charge', async function (ctx) {
        await ultWith(ctx, 'WARRIOR', 'ultCharge = 99');
        expect(ctx.world.g('enemyHP')).toBe(500);
    });
    it('an ult that kills ends the level without passing the turn', async function (ctx) {
        await ultWith(ctx, 'BERSERKER', 'enemyHP = 10');
        expect(ctx.world.g('currentState')).toBe(ctx.world.g('STATE.GAMEOVER'));
        await ctx.world.settle(5000);
        expect(ctx.world.g('currentState')).toBe(ctx.world.g('STATE.REWARD'));
    });
});

describe('Damage, armor, defense', { isolate: 'each' }, function () {
    beforeEach(async function (ctx) { await startSolo(ctx.world, 'WARRIOR'); ctx.world.g('enemyHP = maxEnemyHP = 200; playerHP = maxPlayerHP = 100'); });

    it('armor absorbs damage before HP', function (ctx) {
        var w = ctx.world;
        w.g("enemyArmor = 10; inflictDamage('enemy', 25)");
        expect(w.g('enemyArmor')).toBe(0);
        expect(w.g('enemyHP')).toBe(185);
    });
    it('armor larger than the hit takes all of it', function (ctx) {
        var w = ctx.world;
        w.g("playerArmor = 30; inflictDamage('player', 25)");
        expect(w.g('playerArmor')).toBe(5);
        expect(w.g('playerHP')).toBe(100);
    });
    it('BERSERKER takes +25% incoming damage, PALADIN -15%', function (ctx) {
        var w = ctx.world;
        w.g("selectedClass = CLASSES.BERSERKER; playerArmor = 0; inflictDamage('player', 20)");
        expect(w.g('playerHP')).toBe(75);
        w.g("playerHP = 100; selectedClass = CLASSES.PALADIN; inflictDamage('player', 20)");
        expect(w.g('playerHP')).toBe(83);
    });
    it('ARCHER dodges roughly 20% of hits (seeded, 2000 rolls)', function (ctx) {
        var w = ctx.world;
        w.g('selectedClass = CLASSES.ARCHER');
        var dodged = 0;
        for (var i = 0; i < 2000; i++) if (w.g('applyDefensiveTraits(10)') === null) dodged++;
        expect(dodged / 2000).toBeGreaterThan(0.17);
        expect(dodged / 2000).toBeLessThan(0.23);
    });
    it('life steal heals a % of damage dealt on the player turn only', function (ctx) {
        var w = ctx.world;
        w.g("TILE_STATS.lifeSteal = 10; playerHP = 50; isPlayerTurn = true; inflictDamage('enemy', 40)");
        expect(w.g('playerHP')).toBe(54);
        w.g("isPlayerTurn = false; inflictDamage('enemy', 40)");
        expect(w.g('playerHP')).toBe(54);
    });
    it('heal never exceeds max HP', function (ctx) {
        var w = ctx.world;
        w.g("playerHP = 98; isPlayerTurn = true; applyRPGEffects('heart', 5)");
        expect(w.g('playerHP')).toBe(100);
    });
    it('energy match caps ult charge at 100', function (ctx) {
        var w = ctx.world;
        w.g("ultCharge = 95; isPlayerTurn = true; applyRPGEffects('energy', 3)");
        expect(w.g('ultCharge')).toBe(100);
    });
    it('enemy energy match heals the enemy by half its energy stat', function (ctx) {
        var w = ctx.world;
        w.g("enemyHP = 100; isPlayerTurn = false; applyRPGEffects('energy', 1)");
        expect(w.g('enemyHP')).toBe(100 + Math.floor(w.g('ENEMY_TILE_STATS.energy') / 2));
    });
    it('skull deals skull_dmg and recoils skull_self_dmg', function (ctx) {
        var w = ctx.world;
        w.g("enemyArmor = 0; playerArmor = 0; isPlayerTurn = true; applyRPGEffects('skull', 1)");
        expect(w.g('enemyHP')).toBe(200 - 25);
        expect(w.g('playerHP')).toBe(100 - 12);
    });
    it('match multiplier scales the effect (floor)', function (ctx) {
        var w = ctx.world;
        w.g("enemyArmor = 0; isPlayerTurn = true; applyRPGEffects('sword', 2.5)");
        expect(w.g('enemyHP')).toBe(200 - Math.floor(6 * 2.5));
    });
});

describe('Enemy scaling & minions', { isolate: 'each' }, function () {
    it('enemy stats grow 15%/level and bosses get x1.3', function (ctx) {
        var f = ctx.world.g('getEnemyStatsForLevel');
        expect(f(1, false)).toEqual({ sword: 4, heart: 3, shield: 4, energy: 10, skull_dmg: 15, skull_self_dmg: 8 });
        expect(f(5, true).sword).toBe(Math.round(4 * 1.6 * 1.3));
        for (var l = 1; l < 30; l++) expect(f(l + 1, false).skull_dmg).toBeGreaterThanOrEqual(f(l, false).skull_dmg);
    });
    it('minion types cycle normal/armored/swift/drain and every 5th level is a boss', function (ctx) {
        var f = ctx.world.g('minionTypeForLevel');
        expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(f)).toEqual(['normal', 'armored', 'swift', 'drain', 'boss', 'armored', 'swift', 'drain', 'normal', 'boss']);
    });
    it('solo and co-op use the same minion cycle', function (ctx) {
        for (var l = 1; l <= 25; l++) {
            if (l % 5 === 0) continue;
            expect(ctx.world.g('coopMinionTypeForLevel(' + l + ')'), 'level ' + l).toBe(ctx.world.g('minionTypeForLevel(' + l + ')'));
        }
    });
    it('armored minions start with 30% of max HP as armor', async function (ctx) {
        await startSolo(ctx.world, 'WARRIOR', { level: 2 });
        expect(ctx.world.g('enemyArmor')).toBe(Math.round(ctx.world.g('maxEnemyHP') * 0.3));
    });
    it('drain minions steal 15 ult charge per hit, never below 0', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { level: 4 });
        w.g('ultCharge = 40; drainPlayerUltIfNeeded()');
        expect(w.g('ultCharge')).toBe(25);
        w.g('ultCharge = 5; drainPlayerUltIfNeeded()');
        expect(w.g('ultCharge')).toBe(0);
    });
    it('swift minions get exactly one bonus move per enemy turn', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { level: 3 });
        var enemyMoves = 0;
        w.win.enemyPlayTurn = function () { enemyMoves++; w.g('endTurnLogic()'); };
        w.g('isPlayerTurn = true; isProcessing = true; endTurnLogic()'); // player turn ends
        await w.settle(10000);
        expect(enemyMoves).toBe(2);
        expect(w.g('isPlayerTurn')).toBe(true);
    });
    it('boss enrages exactly once at 50% HP (+30% sword/skull)', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { level: 5 });
        var sword = w.g('ENEMY_TILE_STATS.sword'), skull = w.g('ENEMY_TILE_STATS.skull_dmg');
        w.g('enemyHP = Math.floor(maxEnemyHP * 0.51); checkBossEnrage()');
        expect(w.g('bossEnraged')).toBe(false);
        w.g('enemyHP = Math.floor(maxEnemyHP * 0.5); checkBossEnrage(); checkBossEnrage()');
        expect(w.g('bossEnraged')).toBe(true);
        expect(w.g('ENEMY_TILE_STATS.sword')).toBe(Math.round(sword * 1.3));
        expect(w.g('ENEMY_TILE_STATS.skull_dmg')).toBe(Math.round(skull * 1.3));
        w.g('startLevel()');
        expect(w.g('bossEnraged')).toBe(false);
    });
    it('enemy max HP = 50 + 20/level', async function (ctx) {
        await startSolo(ctx.world, 'WARRIOR', { level: 7 });
        expect(ctx.world.g('maxEnemyHP')).toBe(50 + 6 * 20);
    });
});

describe('Speed bonus', { isolate: 'each' }, function () {
    it('x2 at the start of the turn, decays linearly to x1 over 8s', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        w.g('startPlayerTimer()');
        expect(w.g('getTimeMultiplier()')).toBeCloseTo(2, 0.001);
        await w.tick(4000);
        expect(w.g('getTimeMultiplier()')).toBeCloseTo(1.5, 0.02);
        await w.tick(5000);
        expect(w.g('getTimeMultiplier()')).toBe(1);
    });
});

describe('Rewards & gold', { isolate: 'each' }, function () {
    // Parses a REWARD_POOL desc ("Kafatası Hsr +20 (Öz Hsr +10) & Kılıç +4")
    // into the stat diff it promises the player.
    var LABELS = [
        ['Kafatası Hsr', 'skull_dmg'], ['Kafatası', 'skull_dmg'], ['Öz Hsr', 'skull_self_dmg'],
        ['Ult Hasarı', 'ult_dmg'], ['Ult', 'ult_dmg'], ['Maks Can', 'maxHP'], ['Can Çalma', 'lifeSteal'],
        ['Çalma', 'lifeSteal'], ['Can', 'maxHP'], ['Kılıç', 'sword'], ['Kalkan', 'shield'],
        ['İyileşme', 'heart'], ['Enerji', 'energy']
    ];
    function parseDesc(desc) {
        var out = {};
        desc.split(/,|&|\/|\(|\)/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (part) {
            var m = part.match(/^(.*?)\s*\+%?(\d+)$/);
            if (!m) throw new Error('unparseable reward desc part: "' + part + '" in "' + desc + '"');
            var label = LABELS.find(function (l) { return l[0] === m[1]; });
            if (!label) throw new Error('unknown stat label "' + m[1] + '" in "' + desc + '"');
            out[label[1]] = (out[label[1]] || 0) + Number(m[2]);
        });
        return out;
    }

    it('every REWARD_POOL entry does exactly what its description says', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        var pool = w.g('REWARD_POOL');
        expect(pool.length).toBeGreaterThan(20);
        pool.forEach(function (r) {
            w.g('rebuildTileStats(); pickedRewards = []');
            w.g('applyReward')(r);
            var diff = w.g('pickedRewards[0].diff');
            expect(diff, r.name + ' ("' + r.desc + '")').toEqual(parseDesc(r.desc));
        });
    });

    it('reward tier odds: ~5% legendary, 10% epic, 15% rare, 30% uncommon, 40% common', function (ctx) {
        var counts = {}, N = 5000;
        for (var i = 0; i < N; i++) { var t = ctx.world.g('rollOneReward()').tier; counts[t] = (counts[t] || 0) + 1; }
        var expected = { legendary: 0.05, epic: 0.10, rare: 0.15, uncommon: 0.30, common: 0.40 };
        Object.keys(expected).forEach(function (t) { expect((counts[t] || 0) / N, t).toBeCloseTo(expected[t], 0.02); });
    });

    it('every reward tier label has a Turkish display name', function (ctx) {
        var labels = ctx.world.g('REWARD_TIER_LABELS');
        ctx.world.g('REWARD_POOL').forEach(function (r) { expect(!!labels[r.tier], r.tier).toBe(true); });
    });

    var PICK_CASES = [[0.005, 5], [0.05, 3], [1.0, 3], [0.8, 2], [0.5, 1]];
    PICK_CASES.forEach(function (c) {
        it('winning at ' + (c[0] * 100) + '% HP grants ' + c[1] + ' pick(s)', async function (ctx) {
            var w = ctx.world;
            await startSolo(w, 'WARRIOR', { level: 2 });
            w.g('maxPlayerHP = 1000; playerHP = ' + Math.round(1000 * c[0]) + '; winLevel()');
            expect(w.g('rewardPicksLeft')).toBe(c[1]);
        });
    });

    it('a boss kill adds +1 pick on top', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { level: 5 });
        w.g('maxPlayerHP = 1000; playerHP = 500; winLevel()');
        expect(w.g('rewardPicksLeft')).toBe(2);
    });

    it('gold per kill: minion 8+2L, boss 20+4L, +5%/prestige level', function (ctx) {
        var w = ctx.world;
        expect(w.g('goldRewardForKill(1, false)')).toBe(10);
        expect(w.g('goldRewardForKill(5, true)')).toBe(40);
        w.g('currentPrestigeLevel = 2');
        expect(w.g('goldRewardForKill(10, false)')).toBe(Math.round(28 * 1.1));
        w.g('currentPrestigeLevel = 0');
    });

    it('winning a level asks the server for exactly the kill gold (earn_currency RPC)', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR', { level: 3 });
        w.g('winLevel()');
        await w.settle(3000);
        var call = w.stub.calls.filter(function (c) { return c.fn === 'earn_currency'; }).pop();
        expect(call.args).toEqual({ p_gold: 14, p_materials: 0 });
        expect(w.stub.db.wallets[0].gold).toBe(114);
    });

    it('next level heals 50% of missing HP', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        w.g('playerHP = 40; maxPlayerHP = 100; rewardPicksLeft = 0; updateRewardTitle()');
        w.g('overlayBtn.onclick()');
        expect(w.g('playerHP')).toBe(70);
        expect(w.g('level')).toBe(2);
    });

    it('rebuildTileStats wipes a previous run\'s temporary rewards', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'ROGUE');
        w.g('TILE_STATS.sword += 50');
        w.g('rebuildTileStats()');
        expect(w.g('TILE_STATS')).toEqual(statsWithPassive('ROGUE'));
    });

    it('talents and active achievements stack on top of the class passive', async function (ctx) {
        var w = ctx.world;
        await startSolo(w, 'WARRIOR');
        w.g("currentLearnedTalents = ['sharp_blade', 'lethal_strike']; currentActiveAchievements = ['flawless_victory']; rebuildTileStats()");
        var s = w.g('TILE_STATS');
        expect(s.sword).toBe(6 + 2);
        expect(s.skull_dmg).toBe(25 + 5);
        expect(s.shield).toBe(5 + 2 + 5);
        w.g('currentLearnedTalents = []; currentActiveAchievements = []');
    });
});

// A seeded, fully scripted solo run (the player always takes the enemy AI's
// own "best move" suggestion and the first reward offered). Any change to
// combat math, AI, board generation, rewards or turn flow changes this
// fingerprint - which is exactly what it's for: a balance change should be
// deliberate, noticed, and the snapshot updated in the same commit. The
// failure message prints the new fingerprint to paste in.
describe('Golden master (seeded solo run)', { isolate: 'each', world: { seed: 20260925, pixi: false } }, function () {
    var EXPECTED = '19/938c405c/9:27:22:74';

    it('40 scripted player moves produce the recorded fingerprint', async function (ctx) {
        var w = ctx.world, trace = [];
        await startSolo(w, 'NECROMANCER');
        for (var move = 0; move < 40; move++) {
            var state = w.g('currentState'), S = w.g('STATE');
            if (state === S.REWARD) {
                // Click only what a player could actually see/click.
                var area = w.$('reward-area'), checkpoint = w.$('boss-checkpoint');
                if (area.style.display !== 'none' && area.querySelector('button')) area.querySelector('button').click();
                else if (checkpoint.style.display === 'flex') checkpoint.querySelector('button').click();
                else w.g('overlayBtn.onclick()');
                await w.settle(10000);
                continue;
            }
            if (state !== S.PLAYING) break;
            var m = w.g('findBestMove()');
            if (!m) break;
            var tiles = w.g('tiles');
            w.g('handleInputStart')(tiles[m.index]);
            w.g('handleInputStart')(tiles[m.target]);
            await w.settle(30000);
            trace.push([w.g('level'), w.g('playerHP'), w.g('enemyHP'), w.g('ultCharge')].join(':'));
        }
        var fp = trace.join('|');
        var hash = 0;
        for (var i = 0; i < fp.length; i++) hash = (hash * 31 + fp.charCodeAt(i)) | 0;
        var got = trace.length + '/' + (hash >>> 0).toString(16) + '/' + trace[trace.length - 1];
        expect(got, 'fingerprint changed (if this balance change is intended, set EXPECTED = ' + JSON.stringify(got) + ')').toBe(EXPECTED);
    }, { timeout: 60000 });
});
