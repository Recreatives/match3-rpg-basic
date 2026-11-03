// --- SPELL SCHOOLS (prototype) -----------------------------------------------------------
// Roadmap 2.0 R0 / decision B (docs/DESIGN-spell-schools.md): the same class
// plays differently by school. Prototype scope: the Mage's three schools,
// solo only, behind a dev flag - open the game with ?okul=ates | buz | arkan
// (or call spellSetSchool('buz') in the console). Without the flag nothing
// here changes the game.
//
// A school brings three things:
//   rules   tile rules on top of the class (onTile: a hook on the player's
//           own sword/skull/energy matches)
//   spells  four spells paid for with mana - a second bar next to the ult,
//           filled by every player match (3 / 6 / 9 for a 3 / 4 / 5 match)
//   ult     its own ultimate in place of the class's
// The design has 2 of the 4 spells slotted; the prototype shows all four so
// every one can be tried.

const SPELL_MANA_MAX = 100;
// U = the class's ult damage (TILE_STATS.ult_dmg), the yardstick every number scales by
function spellU() { return (typeof TILE_STATS !== 'undefined' && TILE_STATS.ult_dmg) || 35; }

const SPELL_SCHOOLS = {
    MAGE: {
        ates: {
            name: 'Ateş', icon: '🔥',
            rules: 'Kafatası %25 yakar · yanan düşmana kılıç +%20',
            onTile(type, info) {
                if (type === 'skull' && Math.random() < 0.25) statusApply('enemy', 'burn', 2);
                if (type === 'sword' && statusHas('enemy', 'burn')) info.bonus = 0.2;
            },
            spells: [
                { key: 'fireball', name: 'Ateş Topu', icon: '☄️', mana: 30, move: 'm.fireball',
                  cast(c) { c.damage(Math.round(spellU() * 0.7)); } },
                { key: 'spark', name: 'Kıvılcım', icon: '✨', mana: 15, quick: true, move: 'm.fire',
                  cast() { statusApply('enemy', 'burn', 3); } },
                { key: 'flamewall', name: 'Alev Duvarı', icon: '🧱', mana: 40, move: 'm.ward',
                  cast() { spellState.flameWall = 2; } },
                { key: 'firerain', name: 'Ateş Yağmuru', icon: '🌋', mana: 60, move: 'm.meteor',
                  cast(c) { for (let i = 0; i < 3; i++) c.damage(Math.round(spellU() * 0.4)); statusApply('enemy', 'burn', 3); } },
            ],
            ult: { name: 'METEOR SHOWER', move: 'm.ult',
                   cast(c) { c.damage(Math.round(spellU() * 1.8)); statusApply('enemy', 'burn', 3); } },
        },
        buz: {
            name: 'Buz', icon: '❄️',
            rules: 'Kılıç %20 yavaşlatır · yavaş/donmuş düşmana kılıç +%20',
            onTile(type, info) {
                if (type !== 'sword') return;
                if (statusHas('enemy', 'slow') || statusHas('enemy', 'freeze')) info.bonus = 0.2;
                if (Math.random() < 0.2) statusApply('enemy', 'slow', 2);
            },
            spells: [
                { key: 'icelance', name: 'Buz Mızrağı', icon: '🧊', mana: 25, move: 'm.shard',
                  cast(c) { c.damage(Math.round(spellU() * 0.6)); statusApply('enemy', 'slow', 2); } },
                { key: 'freeze', name: 'Dondur', icon: '❄️', mana: 50, move: 'm.frost',
                  cast() { statusApply('enemy', 'freeze', 1); } },
                { key: 'icearmor', name: 'Buz Zırhı', icon: '🛡️', mana: 35, quick: true, move: 'm.barrier',
                  cast(c) { c.armor(TILE_STATS.shield * 3); } },
                { key: 'blizzard', name: 'Tipi', icon: '🌨️', mana: 60, move: 'm.spikes',
                  cast(c) { c.damage(spellU()); statusApply('enemy', 'slow', 2); } },
            ],
            ult: { name: 'ABSOLUTE ZERO', move: 'm.frost',
                   cast(c) { c.damage(Math.round(spellU() * 1.2)); statusApply('enemy', 'freeze', 1); statusApply('enemy', 'slow', 3); } },
        },
        arkan: {
            name: 'Arkan', icon: '✨',
            rules: 'Enerji eşleşmesi +5 mana · her 3. büyü bedava',
            onTile(type, info) { if (type === 'energy') info.mana += 5; },
            freeEvery: 3,
            spells: [
                { key: 'missiles', name: 'Arkan Füzeler', icon: '🔮', mana: 25, move: 'm.arcane',
                  cast(c) { for (let i = 0; i < 3; i++) c.damage(Math.round(spellU() * 0.25)); } },
                { key: 'manashield', name: 'Mana Kalkanı', icon: '🌀', mana: 40, move: 'm.ward',
                  cast() { spellState.manaShield = 2; } },
                { key: 'timewarp', name: 'Zaman Bükme', icon: '⏳', mana: 55, move: 'm.gather',
                  cast(c) { c.extraTurn(); } },
                { key: 'burst', name: 'Arkan Patlama', icon: '💥', mana: 20, all: true, move: 'm.beam',
                  cast(c, paid) { c.damage(Math.round(paid * 0.02 * spellU())); } },
            ],
            ult: { name: 'TIME STOP', move: 'm.starfall',
                   cast(c) { c.damage(Math.round(spellU() * 0.8)); c.extraTurn(); } },
        },
    },
};

let spellSchool = null; // the active school's def, or null (no flag / another class)
let spellState = { mana: 0, casts: 0, flameWall: 0, manaShield: 0 };

function spellFlag() {
    try { return new URLSearchParams(location.search).get('okul'); } catch (e) { return null; }
}
let spellForced = null; // spellSetSchool() from the console beats the URL
function spellSetSchool(key) { spellForced = key || ''; spellRefresh(); }

// Called when a level starts (game.js startLevel) and on a school change.
function spellRefresh() {
    const key = spellForced !== null ? spellForced : spellFlag();
    const cls = typeof selectedClass !== 'undefined' && selectedClass ? selectedClass.name.toUpperCase() : '';
    spellSchool = (SPELL_SCHOOLS[cls] && SPELL_SCHOOLS[cls][key]) || null;
    spellState = { mana: 0, casts: 0, flameWall: 0, manaShield: 0 };
    spellRender();
}

// The ultimate this hero uses: the school's, or the class's own.
function spellUltName() { return spellSchool ? spellSchool.ult.name : (selectedClass && selectedClass.ultName); }
function spellUltOverride(ctx) {
    if (!spellSchool) return false;
    spellSchool.ult.cast(spellCtx(ctx));
    spellVisual(spellSchool.ult.move);
    return true;
}

// The player's own match (game.js applyRPGEffects): mana, then the school's
// tile rule. Returns the damage bonus for this match (0.2 = +20%).
function spellOnPlayerMatch(type, multiplier) {
    if (!spellSchool) return 0;
    const info = { mana: Math.round(3 * multiplier), bonus: 0 };
    if (spellSchool.onTile) spellSchool.onTile(type, info);
    spellState.mana = Math.min(SPELL_MANA_MAX, spellState.mana + info.mana);
    spellRender();
    return info.bonus;
}

// A hit about to land on the player (game.js inflictDamage, enemy turn):
// the flame wall and the mana shield. Returns the amount that still lands.
function spellIncoming(amount) {
    if (!spellSchool || amount <= 0) return amount;
    if (spellState.flameWall > 0) {
        spellState.flameWall--;
        amount = Math.floor(amount * 0.6);
        statusApply('enemy', 'burn', 2);
        log(t('🧱 Alev Duvarı saldırıyı kırdı!'), 'log-armor');
    }
    if (spellState.manaShield > 0 && spellState.mana > 0) {
        const paid = Math.min(spellState.mana, Math.floor(amount / 2));
        spellState.mana -= paid;
        amount -= paid;
        if (paid > 0) log(tf('🌀 Mana Kalkanı {n} hasarı emdi', { n: paid }), 'log-armor');
    }
    spellRender();
    return amount;
}

// The turn came back to the player (game.js endTurnLogic): a turn-long shield counts down.
function spellPlayerTurnStart() {
    if (!spellSchool) return;
    if (spellState.manaShield > 0) spellState.manaShield--;
    spellRender();
}

function spellCost(sp) {
    if (spellSchool.freeEvery && (spellState.casts + 1) % spellSchool.freeEvery === 0) return 0;
    return sp.mana;
}
function spellCanCast(i) {
    const sp = spellSchool && spellSchool.spells[i];
    if (!sp || currentState !== STATE.PLAYING || !isPlayerTurn || isProcessing) return false;
    return spellState.mana >= spellCost(sp);
}

// What a spell can do, on top of the solo combat context.
function spellCtx(base) {
    return {
        damage(n) { base.dealDamageToOpponent(n); },
        armor(n) { base.addArmor(n); },
        extraTurn() { base.grantExtraTurn(); },
    };
}

function spellVisual(moveId) {
    if (typeof cgGetStage !== 'function' || typeof CG_MOVES === 'undefined') return;
    const st = cgGetStage('player-sprite');
    if (!st || !st._perform) return;
    const all = [].concat(...Object.values(CG_MOVES.mage), CG_ULTS.mage);
    const m = all.find(x => x.id === moveId);
    if (m) st._perform(m);
}

function spellCast(i) {
    if (!spellCanCast(i)) return;
    const sp = spellSchool.spells[i];
    const cost = spellCost(sp);
    const paid = sp.all ? spellState.mana : cost;
    spellState.mana -= paid;
    spellState.casts++;
    const ctx = makeSinglePlayerCombatContext();
    if (!sp.quick) isProcessing = true;
    sp.cast(spellCtx(ctx), paid);
    spellVisual(sp.move);
    log(tf('✨ Büyü: {name}', { name: t(sp.name) }) + (cost === 0 ? ' ' + t('(bedava)') : ''), 'log-hit');
    if (typeof playSound === 'function') playSound('ult');
    spellRender();
    updateUI();
    if (enemyHP <= 0) { checkWinCondition(); return; }
    if (!sp.quick) setTimeout(endTurnLogic, 600);
}

// --- UI: a mana bar and the spell buttons under the ULT button ---------------------
function spellRender() {
    const bar = document.getElementById('spell-bar');
    if (!bar) return;
    bar.hidden = !spellSchool;
    if (!spellSchool) return;
    document.getElementById('spell-school').innerText = spellSchool.icon + ' ' + t(spellSchool.name);
    document.getElementById('spell-school').title = t(spellSchool.rules);
    document.getElementById('spell-mana-fill').style.width = (spellState.mana / SPELL_MANA_MAX * 100) + '%';
    const flags = (spellState.flameWall ? ' 🧱' + spellState.flameWall : '') + (spellState.manaShield ? ' 🌀' + spellState.manaShield : '');
    document.getElementById('spell-mana-text').innerText = Math.floor(spellState.mana) + flags;
    spellSchool.spells.forEach((sp, i) => {
        const b = document.getElementById('spell-btn-' + i);
        if (!b) return;
        const cost = spellCost(sp);
        b.innerHTML = `<span class="spell-icon">${sp.icon}</span><span class="spell-name">${t(sp.name)}</span><span class="spell-cost">${sp.all ? t('tümü') : cost}${sp.quick ? ' ⚡' : ''}</span>`;
        b.disabled = !spellCanCast(i);
    });
}
