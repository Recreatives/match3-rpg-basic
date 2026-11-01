// --- STATUS EFFECTS ---------------------------------------------------------------------
// Effects roadmap Faz 6 (docs/ROADMAP-effects.md): burning, poison and
// bleeding hurt at the start of their victim's turn (through armor), a
// stun makes its victim lose its next turn, weakness makes it hit for less.
//
// Where they come from: every class's ultimate (game.js CLASSES ultEffect
// -> the combat context's applyStatusToOpponent, which every mode now
// has), and in solo the soul-drainer's skull hits (poison) and an enraged
// boss (burn).
//
// One set of helpers, three owners - each side's statuses live with
// whoever is authoritative for that side's HP, so nothing is ever decided
// twice over the network:
//   solo   both sides here (soloStatus)
//   PvP    each client keeps its OWN statuses (pvp.js pvpStatusMe): an
//          ult sends 'status-apply' to the victim, the victim ticks them
//          at the start of its own turn and broadcasts 'status-sync' so
//          the other side can draw its badges
//   co-op  the enemy's statuses live with the host, who resolves the
//          enemy's turns (coop.js coopEnemyStatus); the host broadcasts
//          them for the guest's badges
//
// Shown as small badges on each fighter's HUD (turns left) and, when
// pixel effects are on, a pixelfx status effect on the fighter at every
// application and tick (pfx.js).

const STATUS_DEFS = {
    burn:   { icon: '🔥', name: 'Yanma',      dot: 0.04, fx: 'status-burning' },
    poison: { icon: '☠️', name: 'Zehir',      dot: 0.03, fx: 'status-poisoned' },
    bleed:  { icon: '🩸', name: 'Kanama',     dot: 0.05, fx: 'status-bleeding' },
    stun:   { icon: '💫', name: 'Sersemleme', skip: true, fx: 'status-stunned' },
    weaken: { icon: '🔻', name: 'Zayıflık',   outMult: 0.75, fx: 'status-cursed' },
};

// --- shared helpers (a "map" is { key: turns left }) ---------------------------------

// A fresh application refreshes the duration (never shortens it).
function statusAdd(map, key, turns) {
    if (!STATUS_DEFS[key] || !map) return false;
    map[key] = Math.max(map[key] || 0, turns | 0);
    return true;
}

// The start of the victim's turn: damage over time on maxHP, then every
// status counts down one turn. Returns { dmg, skip, keys } - what ticked.
function statusTickMap(map, maxHP) {
    let dmg = 0, skip = false;
    const keys = [];
    Object.keys(map || {}).forEach(key => {
        if (!(map[key] > 0)) { delete map[key]; return; }
        const def = STATUS_DEFS[key];
        if (def.dot) { dmg += Math.max(1, Math.round(maxHP * def.dot)); keys.push(key); }
        if (def.skip) { skip = true; keys.push(key); }
        map[key]--;
        if (map[key] <= 0) delete map[key];
    });
    return { dmg, skip, keys };
}

// The multiplier on what the owner of `map` deals (weakness).
function statusMultOf(map) { return map && map.weaken > 0 ? STATUS_DEFS.weaken.outMult : 1; }

// Badges in the bottom corner of a fighter's HUD box (absolutely placed:
// no layout change). `hud` is the .fighter-hud element.
function statusBadges(hud, id, map) {
    if (!hud) return;
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'status-badges';
        hud.appendChild(el);
    }
    map = map || {};
    el.innerHTML = Object.keys(map).filter(k => map[k] > 0 && STATUS_DEFS[k])
        .map(k => `<span class="status-badge" title="${t(STATUS_DEFS[k].name)}">${STATUS_DEFS[k].icon}${map[k]}</span>`).join('');
}
function statusHudOf(barId) { const b = document.getElementById(barId); return b ? b.closest('.fighter-hud') : null; }

function statusFx(stageId, key) {
    const def = STATUS_DEFS[key];
    if (def && typeof pfxStatus === 'function') pfxStatus(stageId, def.fx);
}

function statusLogText(isEnemy, key, turns) {
    const def = STATUS_DEFS[key];
    return tf(isEnemy ? '{icon} Düşman: {name} ({n} tur)' : '{icon} Sen: {name} ({n} tur)', { icon: def.icon, name: t(def.name), n: turns });
}

// --- solo -------------------------------------------------------------------------------
let soloStatus = { player: {}, enemy: {} };

function statusClear() {
    soloStatus = { player: {}, enemy: {} };
    statusRender();
}

function statusApply(side, key, turns) {
    if (!soloStatus[side] || !statusAdd(soloStatus[side], key, turns)) return;
    if (typeof log === 'function') log(statusLogText(side === 'enemy', key, turns), side === 'enemy' ? 'log-match' : 'log-enemy');
    statusFx(side === 'enemy' ? 'enemy-sprite' : 'player-sprite', key);
    statusRender();
}

function statusHas(side, key) { return !!(soloStatus[side] && soloStatus[side][key] > 0); }
function statusOutgoingMult(side) { return statusMultOf(soloStatus[side]); }

// Returns { skip } - true when a stun eats this turn.
function statusTick(side) {
    const st = soloStatus[side];
    if (!st) return { skip: false };
    const isPlayer = side === 'player';
    const r = statusTickMap(st, isPlayer ? maxPlayerHP : maxEnemyHP);
    if (r.dmg) {
        if (isPlayer) playerHP -= r.dmg; else enemyHP -= r.dmg;
        if (typeof soloCombatText === 'function') soloCombatText(side, '-' + r.dmg, isPlayer ? 'self' : 'dmg');
        if (typeof log === 'function') log(tf(isPlayer ? 'Durum etkileri: -{n} can' : 'Düşmana durum etkileri: -{n} can', { n: r.dmg }), isPlayer ? 'log-enemy' : 'log-hit');
    }
    r.keys.forEach(k => statusFx(isPlayer ? 'player-sprite' : 'enemy-sprite', k));
    statusRender();
    return { skip: r.skip };
}

function statusRender() {
    statusBadges(statusHudOf('player-hp-bar-container'), 'player-status-badges', soloStatus.player);
    statusBadges(statusHudOf('enemy-hp-bar-container'), 'enemy-status-badges', soloStatus.enemy);
}
