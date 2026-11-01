// --- STATUS EFFECTS (solo) -------------------------------------------------------------
// Effects roadmap Faz 6 (docs/ROADMAP-effects.md): burning, poison and
// bleeding hurt at the start of their victim's turn (through armor), a
// stun makes the enemy lose its next turn, weakness makes it hit for less.
//
// Where they come from:
//   - every class's ultimate (game.js CLASSES ultEffect -> the combat
//     context's applyStatusToOpponent, which only the solo context has)
//   - the soul-drainer's skull hits poison you; an enraged boss's burn
// PvP and co-op don't use them yet: both sides would have to agree on
// every tick over the network (pvp.js / coop.js sync), a later step.
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

// side -> { key: turns left }
let soloStatus = { player: {}, enemy: {} };

function statusClear() {
    soloStatus = { player: {}, enemy: {} };
    statusRender();
}

// A fresh application refreshes the duration (never shortens it).
function statusApply(side, key, turns) {
    const def = STATUS_DEFS[key];
    if (!def || !soloStatus[side]) return;
    soloStatus[side][key] = Math.max(soloStatus[side][key] || 0, turns);
    if (typeof log === 'function') {
        log(tf(side === 'enemy' ? '{icon} Düşman: {name} ({n} tur)' : '{icon} Sen: {name} ({n} tur)', { icon: def.icon, name: t(def.name), n: turns }), side === 'enemy' ? 'log-match' : 'log-enemy');
    }
    statusPlayFx(side, key);
    statusRender();
}

function statusHas(side, key) { return !!(soloStatus[side] && soloStatus[side][key] > 0); }

// The damage multiplier on what `side` deals (weakness).
function statusOutgoingMult(side) {
    return statusHas(side, 'weaken') ? STATUS_DEFS.weaken.outMult : 1;
}

// The start of `side`'s turn: damage over time, then every status counts
// down one turn. Returns { skip } - true when a stun eats this turn.
function statusTick(side) {
    const st = soloStatus[side];
    if (!st) return { skip: false };
    let skip = false, total = 0;
    const isPlayer = side === 'player';
    const maxHP = isPlayer ? maxPlayerHP : maxEnemyHP;
    Object.keys(st).forEach(key => {
        if (!(st[key] > 0)) return;
        const def = STATUS_DEFS[key];
        if (def.dot) {
            const dmg = Math.max(1, Math.round(maxHP * def.dot));
            total += dmg;
            if (isPlayer) playerHP -= dmg; else enemyHP -= dmg;
            if (typeof soloCombatText === 'function') soloCombatText(side, def.icon + '-' + dmg, isPlayer ? 'self' : 'dmg');
            statusPlayFx(side, key);
        }
        if (def.skip) { skip = true; statusPlayFx(side, key); }
        st[key]--;
        if (st[key] <= 0) delete st[key];
    });
    if (total && typeof log === 'function') log(tf(isPlayer ? 'Durum etkileri: -{n} can' : 'Düşmana durum etkileri: -{n} can', { n: total }), isPlayer ? 'log-enemy' : 'log-hit');
    statusRender();
    return { skip };
}

function statusPlayFx(side, key) {
    const def = STATUS_DEFS[key];
    if (!def || typeof pfxStatus !== 'function') return;
    pfxStatus(side === 'enemy' ? 'enemy-sprite' : 'player-sprite', def.fx);
}

// Badges top-right of each fighter's HUD box: icon + turns left.
function statusRender() {
    [['player', 'player-hp-bar-container'], ['enemy', 'enemy-hp-bar-container']].forEach(([side, barId]) => {
        const bar = document.getElementById(barId);
        const hud = bar && bar.parentElement;
        if (!hud) return;
        const id = side + '-status-badges';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.className = 'status-badges';
            hud.appendChild(el);
        }
        const st = soloStatus[side] || {};
        el.innerHTML = Object.keys(st).filter(k => st[k] > 0)
            .map(k => `<span class="status-badge" title="${t(STATUS_DEFS[k].name)}">${STATUS_DEFS[k].icon}${st[k]}</span>`).join('');
    });
}
