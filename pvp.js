// --- PVP PROTOTYPE (real-time 1v1) ---
// This validates the hardest technical piece of the betrayal system - two
// real browsers seeing each other's moves live - before the betrayal vote,
// Kibir Laneti, and currency stakes get layered on top (see the "İhanet
// Protokolü" design doc). It has its own state and its own board, entirely
// separate from game.js's single-player globals (isPlayerTurn, currentState,
// etc.) - the two modes never touch the same variables, so nothing here can
// destabilize the existing single-player game.
//
// Match detection, the multiplier/extra-turn/ult-charge rules per match
// size, class passives, and ultimates are all the SAME code single-player
// uses (findMatchGroups, getMatchShapeInfo, applyDefensiveTraits, the
// CLASSES definitions) - only reached through a "combat context"
// (makePvpCombatContext) instead of game.js's single-player one, so an
// ultimate doesn't need to know whether it's fighting an AI or a real
// networked opponent. Keeping one copy of these rules is the whole point:
// two independently-maintained copies already found a way to disagree once
// (the turn-deadlock bug from the first real test).
//
// Networking model: each client is authoritative for its OWN hp/armor.
// "I matched sword tiles, here's how much damage that is" gets broadcast to
// the opponent; the RECEIVING client applies that amount to its own local
// hp/armor (using its own armor-absorption math and its own class's dodge/
// vulnerability) and reports back if it died. Nobody's client ever has to
// trust or replicate the other's board.
//
// Turn order: whoever's presence timestamp is earliest goes first.

const PVP_WIDTH = 8;
const PVP_MAX_HP = 100;

let pvpChannel = null;
let pvpRoomCode = null;
let pvpMyId = null;
let pvpTiles = [];
let pvpStarted = false;
let pvpMyTurn = false;
let pvpProcessing = false;
let pvpSelectedTile = null;
let pvpMyHP = PVP_MAX_HP;
let pvpMyArmor = 0;
let pvpMatchOver = false;
let pvpThinkingInterval = null;
let pvpUltCharge = 0;
let pvpExtraTurnTriggered = false;

// Effects accumulate here across a whole turn (including any cascade) and
// get flushed as ONE log line when the turn actually ends, instead of one
// line per individual match - with a big cascade the old per-match logging
// scrolled by too fast to read.
let pvpMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };
let pvpIncomingStats = { damage: 0 };

function pvpLog(msg) {
    let el = document.getElementById('pvp-log');
    if (!el) return;
    let div = document.createElement('div');
    div.innerText = msg;
    el.prepend(div);
}

function pvpSetStatus(text) {
    let el1 = document.getElementById('pvp-status');
    let el2 = document.getElementById('pvp-status-battle');
    if (el1) el1.innerText = text;
    if (el2) el2.innerText = text;
}

// A static "Rakibin sırası…" gave no sense that a real person was on the
// other end - this keeps the status line visibly alive while waiting.
function pvpStartThinkingAnimation() {
    let dots = 0;
    clearInterval(pvpThinkingInterval);
    pvpThinkingInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        pvpSetStatus('Rakip oynuyor' + '.'.repeat(dots));
    }, 400);
}

function pvpStopThinkingAnimation() {
    clearInterval(pvpThinkingInterval);
    pvpThinkingInterval = null;
}

// --- ROOM JOINING -----------------------------------------------------------

async function pvpJoinRoom() {
    let input = document.getElementById('pvp-room-input');
    let code = input ? input.value.trim().toUpperCase() : '';
    if (!code) { pvpSetStatus('Önce bir oda kodu yaz.'); return; }

    const { data: { user } } = await sb.auth.getUser();
    if (!user) { pvpSetStatus('Giriş yapılamadı, sayfayı yenile.'); return; }
    pvpMyId = user.id;
    pvpRoomCode = code;

    if (pvpChannel) await pvpChannel.unsubscribe();

    pvpChannel = sb.channel(`pvp-room-${pvpRoomCode}`, {
        config: { presence: { key: pvpMyId }, broadcast: { self: false } }
    });

    pvpChannel.on('broadcast', { event: 'attack' }, ({ payload }) => pvpReceiveAttack(payload));
    pvpChannel.on('broadcast', { event: 'defeated' }, () => pvpOnOpponentDefeated());
    pvpChannel.on('broadcast', { event: 'turn-end' }, () => pvpReceiveTurnEnd());
    pvpChannel.on('presence', { event: 'sync' }, () => pvpCheckPresence());

    pvpChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            await pvpChannel.track({ joined_at: Date.now() });
            pvpSetStatus(`Oda "${pvpRoomCode}" - rakip bekleniyor…`);
        }
    });
}

function pvpCheckPresence() {
    if (pvpStarted) return;
    const state = pvpChannel.presenceState();
    const keys = Object.keys(state);
    if (keys.length < 2) return;

    let entries = keys.map(k => ({ key: k, joinedAt: state[k][0].joined_at }));
    entries.sort((a, b) => a.joinedAt - b.joinedAt);

    pvpStarted = true;
    pvpMyTurn = entries[0].key === pvpMyId;
    pvpStartMatch();
}

// --- MATCH LIFECYCLE ---------------------------------------------------------

function pvpStartMatch() {
    pvpMyHP = PVP_MAX_HP;
    pvpMyArmor = 0;
    pvpUltCharge = 0;
    pvpExtraTurnTriggered = false;
    pvpMatchOver = false;
    pvpProcessing = false;
    pvpMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };
    pvpIncomingStats = { damage: 0 };

    document.getElementById('pvp-setup').style.display = 'none';
    document.getElementById('pvp-battle').style.display = 'block';

    pvpCreateBoard();
    pvpUpdateUI();
    pvpLog('🟢 Rakip bağlı - eşleşme başladı.');
    if (pvpMyTurn) { pvpStopThinkingAnimation(); pvpSetStatus('Senin sıran!'); }
    else pvpStartThinkingAnimation();
}

// Applies an incoming hit to MY OWN hp/armor - used both for regular tile
// damage and for ultimate damage aimed at me. `direct` bypasses armor
// (an ability that "ignores armor" still respects dodge, since dodge and
// armor are different defensive layers - only armor is what "ignores armor"
// refers to).
function pvpApplyIncomingDamage(amount, direct) {
    let afterDefense = applyDefensiveTraits(amount);
    if (afterDefense === null) {
        showFloatingText("DODGE!", document.getElementById('pvp-my-hp-bar'), "#2ecc71");
        pvpLog('Rakibin saldırısını savuşturdun!');
        return;
    }
    amount = afterDefense;

    let before = pvpMyHP;
    if (direct) {
        pvpMyHP -= amount;
    } else if (pvpMyArmor >= amount) {
        pvpMyArmor -= amount;
    } else {
        let remainder = amount - pvpMyArmor;
        pvpMyArmor = 0;
        pvpMyHP -= remainder;
    }
    pvpIncomingStats.damage += amount;
    showFloatingText(`-${amount}`, document.getElementById('pvp-my-hp-bar'), '#e74c3c');
    pvpUpdateUI();

    if (pvpMyHP <= 0 && before > 0) {
        pvpMatchOver = true;
        pvpStopThinkingAnimation();
        pvpChannel.send({ type: 'broadcast', event: 'defeated', payload: {} });
        pvpSetStatus('KAYBETTİN');
        pvpLog(`Rakip bu turda toplam ${pvpIncomingStats.damage} hasar verdi ve seni yendi.`);
    }
}

function pvpReceiveAttack(payload) {
    if (pvpMatchOver) return;
    pvpApplyIncomingDamage(payload.amount || 0, !!payload.direct);
    // Turn handoff does NOT happen here - see pvpReceiveTurnEnd. It used to
    // be granted on taking damage, which meant a turn that only matched
    // shield/heart (no attack broadcast at all) never told the opponent it
    // was over - both sides ended up stuck waiting on each other. Turn
    // passing is now its own explicit, unconditional message.
}

function pvpReceiveTurnEnd() {
    if (pvpMatchOver) return;
    pvpStopThinkingAnimation();
    if (pvpIncomingStats.damage > 0) pvpLog(`Rakip bu turda toplam ${pvpIncomingStats.damage} hasar verdi.`);
    else pvpLog('Rakip bu tur hasar vermedi.');
    pvpIncomingStats = { damage: 0 };

    pvpMyTurn = true;
    pvpSetStatus('Senin sıran!');
    pvpUpdateUI();
}

function pvpOnOpponentDefeated() {
    if (pvpMatchOver) return;
    pvpMatchOver = true;
    pvpStopThinkingAnimation();
    pvpSetStatus('KAZANDIN!');
    pvpLog('Rakip yenildi - kazandın!');
    pvpUpdateUI();
}

// --- ULTIMATE ----------------------------------------------------------------
// PvP's implementation of the same combat-context interface game.js's
// makeSinglePlayerCombatContext implements - the CLASSES ultEffect
// definitions are unaware which one they're given.
function makePvpCombatContext() {
    return {
        dealDamageToOpponent(amount) {
            pvpMyTurnStats.damage += amount;
            pvpChannel.send({ type: 'broadcast', event: 'attack', payload: { amount, type: 'ult' } });
        },
        dealDirectDamageToOpponent(amount) {
            pvpMyTurnStats.damage += amount;
            pvpChannel.send({ type: 'broadcast', event: 'attack', payload: { amount, type: 'ult', direct: true } });
        },
        dealDirectDamageToSelf(amount) {
            pvpMyHP -= amount;
            pvpMyTurnStats.selfDamage += amount;
        },
        getSelfArmor() { return pvpMyArmor; },
        grantExtraTurn() { pvpExtraTurnTriggered = true; },
        log(msg) { pvpLog(msg); }
    };
}

function pvpUseUltimate() {
    if (pvpMatchOver || pvpProcessing || !pvpMyTurn || pvpUltCharge < 100 || !selectedClass) return;

    pvpProcessing = true;
    selectedClass.ultEffect(makePvpCombatContext());
    pvpUltCharge = 0;
    pvpUpdateUI();

    if (pvpMyHP <= 0) {
        pvpMatchOver = true;
        pvpChannel.send({ type: 'broadcast', event: 'defeated', payload: {} });
        pvpSetStatus('KAYBETTİN');
        pvpUpdateUI();
        return;
    }

    // Mirrors single-player's useUltimate(): using the ult ends your turn
    // unless it granted an extra one (Rogue).
    setTimeout(() => {
        pvpProcessing = false;
        if (pvpExtraTurnTriggered) {
            pvpExtraTurnTriggered = false;
            pvpLog('>> Ekstra tur!');
        } else {
            pvpMyTurn = false;
            pvpStartThinkingAnimation();
            pvpChannel.send({ type: 'broadcast', event: 'turn-end', payload: {} });
        }
        pvpUpdateUI();
    }, 500);
}

// --- BOARD -------------------------------------------------------------------

function pvpCreateBoard() {
    let grid = document.getElementById('pvp-grid');
    grid.innerHTML = '';
    pvpTiles.length = 0;
    pvpSelectedTile = null;

    for (let i = 0; i < PVP_WIDTH * PVP_WIDTH; i++) {
        const tile = document.createElement('div');
        tile.setAttribute('id', 'pvp-tile-' + i);
        tile.className = 'tile';
        let randomType = Math.floor(Math.random() * tileTypes.length);
        tile.dataset.type = tileTypes[randomType].type;
        tile.innerHTML = tileTypes[randomType].symbol;
        grid.appendChild(tile);
        pvpTiles.push(tile);

        tile.addEventListener('mousedown', () => pvpHandleTap(tile));
        tile.addEventListener('touchstart', (e) => { e.preventDefault(); pvpHandleTap(tile); }, { passive: false });
    }
    pvpResolveMatches(true);
}

function pvpHandleTap(tile) {
    if (pvpMatchOver || pvpProcessing || !pvpMyTurn) return;
    if (!pvpSelectedTile) {
        pvpSelectedTile = tile;
        tile.classList.add('selected');
        return;
    }
    if (tile === pvpSelectedTile) {
        tile.classList.remove('selected');
        pvpSelectedTile = null;
        return;
    }
    let id1 = parseInt(pvpSelectedTile.id.replace('pvp-tile-', ''));
    let id2 = parseInt(tile.id.replace('pvp-tile-', ''));
    let r1 = Math.floor(id1 / PVP_WIDTH), c1 = id1 % PVP_WIDTH;
    let r2 = Math.floor(id2 / PVP_WIDTH), c2 = id2 % PVP_WIDTH;
    let adjacent = (r1 === r2 && Math.abs(c1 - c2) === 1) || (c1 === c2 && Math.abs(r1 - r2) === 1);

    if (adjacent) {
        pvpAttemptSwap(pvpSelectedTile, tile);
        pvpSelectedTile.classList.remove('selected');
        pvpSelectedTile = null;
    } else {
        pvpSelectedTile.classList.remove('selected');
        pvpSelectedTile = tile;
        tile.classList.add('selected');
    }
}

function pvpAttemptSwap(tile1, tile2) {
    pvpProcessing = true;
    let t = tile1.dataset.type, h = tile1.innerHTML;
    tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
    tile2.dataset.type = t; tile2.innerHTML = h;

    let matched = pvpResolveMatches(false);
    if (!matched) {
        setTimeout(() => {
            let t2 = tile1.dataset.type, h2 = tile1.innerHTML;
            tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
            tile2.dataset.type = t2; tile2.innerHTML = h2;
            pvpProcessing = false;
        }, 150);
    }
}

function pvpResolveMatches(isInitial) {
    // Same match-detection (including L/T cross-shapes) single-player uses,
    // just pointed at pvpTiles instead of the single-player `tiles` array.
    let groups = findMatchGroups(pvpTiles, PVP_WIDTH);
    if (groups.length === 0) {
        if (!isInitial) pvpProcessing = false;
        return false;
    }

    groups.forEach(g => pvpApplyGroupEffect(g, isInitial));
    setTimeout(() => pvpDropAndRefill(isInitial), isInitial ? 0 : 350);
    return true;
}

function pvpApplyGroupEffect(group, isInitial) {
    let count = group.indices.length;
    let isCross = (group.subShape === 'cross');
    // Same size/shape -> multiplier/extra-turn/ult-charge priority rules as
    // single-player (getMatchShapeInfo lives in game.js).
    let { multiplier, extraTurn, ultBonus } = getMatchShapeInfo(count, isCross);

    group.indices.forEach(i => {
        if (!isInitial) pvpTiles[i].classList.add('matched');
        else pvpTiles[i].innerHTML = '';
        pvpTiles[i].dataset.type = '';
    });

    if (isInitial) return;

    if (extraTurn) pvpExtraTurnTriggered = true;
    if (ultBonus > 0) {
        pvpUltCharge = Math.min(pvpUltCharge + ultBonus, 100);
        pvpMyTurnStats.ultGain += ultBonus;
    }

    if (group.type === 'sword' || group.type === 'skull') {
        let base = group.type === 'sword' ? TILE_STATS.sword : TILE_STATS.skull_dmg;
        let amount = Math.floor(base * multiplier);
        pvpMyTurnStats.damage += amount;
        pvpChannel.send({ type: 'broadcast', event: 'attack', payload: { amount, type: group.type } });
        if (group.type === 'skull') {
            let recoil = Math.floor(TILE_STATS.skull_self_dmg * multiplier);
            if (pvpMyArmor >= recoil) pvpMyArmor -= recoil; else { pvpMyHP -= (recoil - pvpMyArmor); pvpMyArmor = 0; }
            pvpMyTurnStats.selfDamage += recoil;
        }
    } else if (group.type === 'heart') {
        let heal = Math.floor(TILE_STATS.heart * multiplier);
        pvpMyHP = Math.min(pvpMyHP + heal, PVP_MAX_HP);
        pvpMyTurnStats.heal += heal;
    } else if (group.type === 'shield') {
        let gain = Math.floor(TILE_STATS.shield * multiplier);
        pvpMyArmor += gain;
        pvpMyTurnStats.armor += gain;
    } else if (group.type === 'energy') {
        let gain = Math.floor(TILE_STATS.energy * multiplier);
        pvpUltCharge = Math.min(pvpUltCharge + gain, 100);
        pvpMyTurnStats.ultGain += gain;
    }

    pvpUpdateUI();

    if (pvpMyHP <= 0) {
        pvpMatchOver = true;
        pvpStopThinkingAnimation();
        pvpChannel.send({ type: 'broadcast', event: 'defeated', payload: {} });
        pvpSetStatus('KAYBETTİN');
        pvpLogTurnSummary();
        pvpLog('Kendi hasarınla yenildin.');
    }
}

function pvpLogTurnSummary() {
    let parts = [];
    if (pvpMyTurnStats.damage > 0) parts.push(`${pvpMyTurnStats.damage} hasar verdin`);
    if (pvpMyTurnStats.heal > 0) parts.push(`${pvpMyTurnStats.heal} can iyileştin`);
    if (pvpMyTurnStats.armor > 0) parts.push(`${pvpMyTurnStats.armor} zırh kazandın`);
    if (pvpMyTurnStats.ultGain > 0) parts.push(`ult +%${pvpMyTurnStats.ultGain}`);
    if (pvpMyTurnStats.selfDamage > 0) parts.push(`kendine ${pvpMyTurnStats.selfDamage} hasar verdin`);
    pvpLog(parts.length > 0 ? `Hamlen: ${parts.join(', ')}.` : 'Hamlen bir etki yaratmadı.');
    pvpMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };
}

function pvpDropAndRefill(isInitial) {
    for (let col = 0; col < PVP_WIDTH; col++) {
        let colTiles = [];
        for (let row = 0; row < PVP_WIDTH; row++) {
            let i = col + row * PVP_WIDTH;
            if (pvpTiles[i].dataset.type !== '') colTiles.push({ type: pvpTiles[i].dataset.type, html: pvpTiles[i].innerHTML });
        }
        let missing = PVP_WIDTH - colTiles.length;
        for (let i = 0; i < missing; i++) {
            let rt = tileTypes[Math.floor(Math.random() * tileTypes.length)];
            colTiles.unshift({ type: rt.type, html: rt.symbol });
        }
        for (let row = 0; row < PVP_WIDTH; row++) {
            let i = col + row * PVP_WIDTH;
            pvpTiles[i].dataset.type = colTiles[row].type;
            pvpTiles[i].innerHTML = colTiles[row].html;
            pvpTiles[i].classList.remove('matched');
        }
    }
    let chained = pvpResolveMatches(isInitial);
    if (chained || isInitial || pvpMatchOver) return;

    pvpLogTurnSummary();
    pvpProcessing = false;

    if (pvpExtraTurnTriggered) {
        // A 4+/cross match grants another turn immediately, same as
        // single-player - stay pvpMyTurn=true, no turn-end broadcast.
        pvpExtraTurnTriggered = false;
        pvpLog('>> Ekstra tur!');
        pvpUpdateUI();
    } else {
        pvpMyTurn = false;
        pvpStartThinkingAnimation();
        pvpUpdateUI();
        // Unconditional - sent whether or not this turn dealt any damage, so
        // a shield/heart-only turn still hands control back to the opponent.
        pvpChannel.send({ type: 'broadcast', event: 'turn-end', payload: {} });
    }
}

function pvpUpdateUI() {
    let hpPct = Math.max(0, (pvpMyHP / PVP_MAX_HP) * 100);
    let hpBar = document.getElementById('pvp-my-hp-bar');
    let hpText = document.getElementById('pvp-my-hp-text');
    if (hpBar) hpBar.style.width = hpPct + '%';
    if (hpText) hpText.innerText = `${Math.max(0, Math.floor(pvpMyHP))}/${PVP_MAX_HP}` + (pvpMyArmor > 0 ? ` [+${pvpMyArmor}]` : '');

    let ultBar = document.getElementById('pvp-ult-bar');
    let ultText = document.getElementById('pvp-ult-text');
    if (ultBar) ultBar.style.width = pvpUltCharge + '%';
    if (ultText) ultText.innerText = `${Math.floor(pvpUltCharge)}%`;

    let ultBtn = document.getElementById('pvp-ult-btn');
    if (ultBtn) {
        ultBtn.disabled = pvpUltCharge < 100 || !pvpMyTurn || pvpMatchOver || pvpProcessing || !selectedClass;
        ultBtn.innerText = selectedClass ? `${selectedClass.ultName} (${Math.floor(pvpUltCharge)}%)` : 'ULT (sınıf seçilmedi)';
    }

    let grid = document.getElementById('pvp-grid');
    if (grid) grid.classList.toggle('locked', !pvpMyTurn || pvpMatchOver);
}
