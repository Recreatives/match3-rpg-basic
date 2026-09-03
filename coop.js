// --- CO-OP PROTOTYPE (2 real players vs. 1 shared boss) ---
// Validates the piece the full "İhanet Protokolü" co-op dungeon will need
// most: two real browsers fighting the SAME enemy HP pool, with one player
// able to go down and get rescued by the other, before minions, multiple
// levels, the hidden betrayal vote and Kibir Laneti get layered on top.
//
// Reuses the exact same match rules single-player and PvP already share
// (findMatchGroups, getMatchShapeInfo, applyDefensiveTraits, CLASSES) via
// its own combat context, same as pvp.js.
//
// Networking model: each player is authoritative for their OWN hp/armor/
// down-state (same rule PvP uses). The shared boss HP is different - it has
// no single "owner" client by default, so whichever player joins the room
// FIRST becomes the "host" and is the one authoritative source for boss HP.
// A non-host player's damage is broadcast to the host ("boss-damage"); the
// host applies it and broadcasts the resulting HP back out ("boss-hp-sync").
//
// Turn order: player A moves -> boss counter-attacks A -> player B moves ->
// boss counter-attacks B -> repeat (mirrors single-player's player-then-
// enemy rhythm, just with two players sharing the "player" seat). Only the
// HOST decides turn order and boss attacks, since only the host can see
// both players' down-state reliably. When the boss's target is the host's
// own player, the outcome is known synchronously; when the target is the
// remote player, the host must wait for that player's own hp-sync (armor/
// dodge is THEIRS to resolve) before deciding what happens next - see
// coopPendingResolution below. Skipping that wait was the PvP turn-deadlock
// bug's cousin and is guarded against on purpose.

const COOP_WIDTH = 8;
const COOP_MAX_HP = 100;
const COOP_REVIVE_PCT = 0.3;
const COOP_BOSS_DIFFICULTY_MULT = 1.5;

let coopChannel = null;
let coopRoomCode = null;
let coopMyId = null;
let coopIsHost = false;
let coopRole = null; // 'host' | 'guest'
let coopTiles = [];
let coopStarted = false;
let coopMyTurn = false;
let coopProcessing = false;
let coopSelectedTile = null;
let coopMatchOver = false;
let coopThinkingInterval = null;

let coopMyHP = COOP_MAX_HP, coopMyArmor = 0, coopMyDown = false;
let coopAllyHP = COOP_MAX_HP, coopAllyArmor = 0, coopAllyDown = false;
let coopBossHP = 0, coopBossMaxHP = 0, coopBossStats = null;
let coopUltCharge = 0;
let coopExtraTurnTriggered = false;
// Set by the host between firing a boss-attack at the remote player and
// hearing that player's own hp-sync report back - see file header.
let coopPendingResolution = null;

let coopMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };

function coopLog(msg) {
    let el = document.getElementById('coop-log');
    if (!el) return;
    let div = document.createElement('div');
    div.innerText = msg;
    el.prepend(div);
}

function coopSetStatus(text) {
    let el1 = document.getElementById('coop-status');
    let el2 = document.getElementById('coop-status-battle');
    if (el1) el1.innerText = text;
    if (el2) el2.innerText = text;
}

function coopStartThinkingAnimation() {
    let dots = 0;
    clearInterval(coopThinkingInterval);
    coopThinkingInterval = setInterval(() => {
        dots = (dots + 1) % 4;
        coopSetStatus('Takım arkadaşın oynuyor' + '.'.repeat(dots));
    }, 400);
}

function coopStopThinkingAnimation() {
    clearInterval(coopThinkingInterval);
    coopThinkingInterval = null;
}

function coopIsRoleDown(role) {
    return role === coopRole ? coopMyDown : coopAllyDown;
}

// --- ROOM JOINING ------------------------------------------------------------

async function coopJoinRoom() {
    let input = document.getElementById('coop-room-input');
    let code = input ? input.value.trim().toUpperCase() : '';
    if (!code) { coopSetStatus('Önce bir oda kodu yaz.'); return; }

    const { data: { user } } = await sb.auth.getUser();
    if (!user) { coopSetStatus('Giriş yapılamadı, sayfayı yenile.'); return; }
    coopMyId = user.id;
    coopRoomCode = code;

    if (coopChannel) await coopChannel.unsubscribe();

    coopChannel = sb.channel(`coop-room-${coopRoomCode}`, {
        config: { presence: { key: coopMyId }, broadcast: { self: false } }
    });

    coopChannel.on('broadcast', { event: 'match-start' }, ({ payload }) => coopOnMatchStart(payload));
    coopChannel.on('broadcast', { event: 'boss-damage' }, ({ payload }) => { if (coopIsHost) coopApplyBossDamage(payload.amount || 0); });
    coopChannel.on('broadcast', { event: 'boss-hp-sync' }, ({ payload }) => { coopBossHP = payload.hp; coopUpdateUI(); });
    coopChannel.on('broadcast', { event: 'boss-attack' }, ({ payload }) => coopOnBossAttack(payload));
    coopChannel.on('broadcast', { event: 'hp-sync' }, ({ payload }) => coopOnAllyHpSync(payload));
    coopChannel.on('broadcast', { event: 'turn-set' }, ({ payload }) => coopOnTurnSet(payload));
    coopChannel.on('broadcast', { event: 'turn-done' }, ({ payload }) => { if (coopIsHost) coopHostResolveTurnEnd(payload.role); });
    coopChannel.on('broadcast', { event: 'revive' }, ({ payload }) => coopOnRevive(payload));
    coopChannel.on('broadcast', { event: 'boss-defeated' }, () => coopOnBossDefeated());
    coopChannel.on('broadcast', { event: 'party-wiped' }, () => coopOnPartyWiped());
    coopChannel.on('presence', { event: 'sync' }, () => coopCheckPresence());

    coopChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            await coopChannel.track({ joined_at: Date.now() });
            coopSetStatus(`Oda "${coopRoomCode}" - takım arkadaşı bekleniyor…`);
        }
    });
}

function coopCheckPresence() {
    if (coopStarted) return;
    const state = coopChannel.presenceState();
    const keys = Object.keys(state);
    if (keys.length < 2) return;

    let entries = keys.map(k => ({ key: k, joinedAt: state[k][0].joined_at }));
    entries.sort((a, b) => a.joinedAt - b.joinedAt);

    coopStarted = true;
    coopIsHost = entries[0].key === coopMyId;
    coopRole = coopIsHost ? 'host' : 'guest';

    if (coopIsHost) {
        coopBossStats = coopComputeBossStats();
        coopBossMaxHP = coopComputeBossMaxHP();
        coopBossHP = coopBossMaxHP;
        coopChannel.send({ type: 'broadcast', event: 'match-start', payload: { bossHP: coopBossHP, bossMaxHP: coopBossMaxHP, bossStats: coopBossStats } });
        coopBeginMatch('host');
    } else {
        coopSetStatus('Takım arkadaşın bulundu, savaş hazırlanıyor…');
    }
}

// --- BOSS CONFIG (prototype: a single fixed boss-level encounter) -----------

function coopComputeBossStats() {
    let stats = getEnemyStatsForLevel(5, true);
    Object.keys(stats).forEach(k => stats[k] = Math.round(stats[k] * COOP_BOSS_DIFFICULTY_MULT));
    return stats;
}

function coopComputeBossMaxHP() {
    return Math.round((50 + (5 - 1) * 20) * 1.3 * COOP_BOSS_DIFFICULTY_MULT);
}

function coopOnMatchStart(payload) {
    if (coopStarted && coopRole === 'host') return; // host already started itself
    coopStarted = true;
    coopBossHP = payload.bossHP;
    coopBossMaxHP = payload.bossMaxHP;
    coopBossStats = payload.bossStats;
    coopBeginMatch('host'); // host always moves first
}

// --- MATCH LIFECYCLE ----------------------------------------------------------

function coopBeginMatch(firstRole) {
    coopMyHP = COOP_MAX_HP; coopMyArmor = 0; coopMyDown = false;
    coopAllyHP = COOP_MAX_HP; coopAllyArmor = 0; coopAllyDown = false;
    coopUltCharge = 0;
    coopExtraTurnTriggered = false;
    coopMatchOver = false;
    coopProcessing = false;
    coopPendingResolution = null;
    coopMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };
    coopMyTurn = (coopRole === firstRole);

    document.getElementById('coop-setup').style.display = 'none';
    document.getElementById('coop-battle').style.display = 'block';

    coopCreateBoard();
    coopUpdateUI();
    coopLog('🐉 Takım tamamlandı - boss karşılaşması başladı.');
    if (coopMyTurn) { coopStopThinkingAnimation(); coopSetStatus('Senin sıran!'); }
    else coopStartThinkingAnimation();
}

// --- SELF STATE SYNC -----------------------------------------------------------

// Broadcasts MY current hp/armor/down state so my teammate's (and, if I'm
// not the host, the host's) copy of it stays live. Called after every self
// hp/armor change - damage taken, healing, armor gained, skull recoil.
function coopSyncSelfState() {
    let wasDown = coopMyDown;
    if (coopMyHP <= 0 && !coopMyDown) {
        coopMyHP = 0;
        coopMyDown = true;
        coopLog('Bayıldın! Takım arkadaşın seni ayağa kaldırana kadar bekle.');
    }
    coopChannel.send({ type: 'broadcast', event: 'hp-sync', payload: { role: coopRole, hp: coopMyHP, armor: coopMyArmor, down: coopMyDown } });
    coopUpdateUI();
}

// Applies an incoming hit to MY OWN hp/armor (boss attack aimed at me).
function coopApplyIncomingDamage(amount) {
    let afterDefense = applyDefensiveTraits(amount);
    if (afterDefense === null) {
        showFloatingText("DODGE!", document.getElementById('coop-my-hp-bar'), "#2ecc71");
        coopLog('Boss saldırısını savuşturdun!');
        return;
    }
    amount = afterDefense;

    if (coopMyArmor >= amount) coopMyArmor -= amount;
    else { coopMyHP -= (amount - coopMyArmor); coopMyArmor = 0; }

    showFloatingText(`-${amount}`, document.getElementById('coop-my-hp-bar'), '#e74c3c');
    coopLog(`Boss sana ${amount} hasar verdi.`);
    coopSyncSelfState();
}

function coopOnBossAttack(payload) {
    if (coopMatchOver) return;
    if (payload.role === coopRole) coopApplyIncomingDamage(payload.amount || 0);
    else coopLog(`Boss takım arkadaşına ${payload.amount} hasar verdi.`);
}

function coopOnAllyHpSync(payload) {
    coopAllyHP = payload.hp;
    coopAllyArmor = payload.armor;
    coopAllyDown = payload.down;
    coopUpdateUI();

    if (coopIsHost && coopPendingResolution && payload.role !== coopRole) {
        let { moverRole } = coopPendingResolution;
        coopPendingResolution = null;
        coopFinishHostTurnResolution(moverRole);
    }
}

// --- HOST-ONLY: BOSS BRAIN -----------------------------------------------------

function coopApplyBossDamage(amount) {
    if (coopMatchOver) return;
    coopBossHP = Math.max(0, coopBossHP - amount);
    coopChannel.send({ type: 'broadcast', event: 'boss-hp-sync', payload: { hp: coopBossHP } });
    coopUpdateUI();
    if (coopBossHP <= 0) {
        coopMatchOver = true;
        coopChannel.send({ type: 'broadcast', event: 'boss-defeated', payload: {} });
        coopOnBossDefeated();
    }
}

// Called (host only) once a player's turn (theirs or the remote player's)
// has fully resolved: boss counter-attacks the mover, then turn/revival is
// decided. See file header for why the remote-target case has to wait.
function coopHostResolveTurnEnd(moverRole) {
    if (coopMatchOver) return;

    if (coopIsRoleDown(moverRole)) {
        // Downed themselves with their own move (e.g. ult recoil) - boss has
        // nothing left to hit, skip straight to revival/next-turn.
        coopFinishHostTurnResolution(moverRole);
        return;
    }

    let dmg = Math.round(coopBossStats.sword * (1 + Math.random() * 0.6));

    if (moverRole === coopRole) {
        coopApplyIncomingDamage(dmg);
        coopChannel.send({ type: 'broadcast', event: 'boss-attack', payload: { role: moverRole, amount: dmg } });
        coopFinishHostTurnResolution(moverRole);
    } else {
        coopPendingResolution = { moverRole };
        coopChannel.send({ type: 'broadcast', event: 'boss-attack', payload: { role: moverRole, amount: dmg } });
        // broadcast self:false means the host - the sender here - never gets
        // its own message back, so it has to log this locally instead of
        // relying on coopOnBossAttack's observer branch to fire for it.
        coopLog(`Boss takım arkadaşına ${dmg} hasar verdi.`);
        // Waits for that player's own hp-sync (see coopOnAllyHpSync) before continuing.
    }
}

function coopFinishHostTurnResolution(moverRole) {
    if (coopMatchOver) return;

    if (coopMyDown && coopAllyDown) {
        coopChannel.send({ type: 'broadcast', event: 'party-wiped', payload: {} });
        coopOnPartyWiped();
        return;
    }

    let otherRole = moverRole === 'host' ? 'guest' : 'host';
    if (coopIsRoleDown(otherRole) && !coopIsRoleDown(moverRole)) {
        coopReviveRole(otherRole);
    }

    let nextRole = !coopIsRoleDown(otherRole) ? otherRole : moverRole;
    coopChannel.send({ type: 'broadcast', event: 'turn-set', payload: { role: nextRole } });
    coopApplyTurnSet(nextRole);
}

function coopReviveRole(role) {
    let reviveHP = Math.round(COOP_MAX_HP * COOP_REVIVE_PCT);
    if (role === coopRole) {
        coopMyHP = reviveHP; coopMyArmor = 0; coopMyDown = false;
        coopLog('Takım arkadaşın seni ayağa kaldırdı!');
    } else {
        coopAllyHP = reviveHP; coopAllyArmor = 0; coopAllyDown = false;
        coopLog('Takım arkadaşını ayağa kaldırdın!');
    }
    coopChannel.send({ type: 'broadcast', event: 'revive', payload: { role } });
    coopUpdateUI();
}

function coopOnRevive(payload) {
    let reviveHP = Math.round(COOP_MAX_HP * COOP_REVIVE_PCT);
    if (payload.role === coopRole) {
        coopMyHP = reviveHP; coopMyArmor = 0; coopMyDown = false;
        coopLog('Takım arkadaşın seni ayağa kaldırdı!');
        coopChannel.send({ type: 'broadcast', event: 'hp-sync', payload: { role: coopRole, hp: coopMyHP, armor: coopMyArmor, down: false } });
    } else {
        coopAllyHP = reviveHP; coopAllyArmor = 0; coopAllyDown = false;
        coopLog('Takım arkadaşını ayağa kaldırdın!');
    }
    coopUpdateUI();
}

function coopOnTurnSet(payload) {
    if (coopMatchOver) return;
    coopApplyTurnSet(payload.role);
}

function coopApplyTurnSet(role) {
    coopMyTurn = (role === coopRole);
    if (coopMyTurn) { coopStopThinkingAnimation(); coopSetStatus('Senin sıran!'); }
    else coopStartThinkingAnimation();
    coopUpdateUI();
}

function coopOnBossDefeated() {
    coopMatchOver = true;
    coopStopThinkingAnimation();
    coopSetStatus('ZAFER!');
    coopLog('Boss yenildi - takım kazandı!');
    coopUpdateUI();
}

function coopOnPartyWiped() {
    coopMatchOver = true;
    coopStopThinkingAnimation();
    coopSetStatus('İKİNİZ DE DÜŞTÜNÜZ - YENİLGİ');
    coopLog('İkiniz de aynı anda düştünüz. Takım yenildi.');
    coopUpdateUI();
}

// --- ULTIMATE ------------------------------------------------------------------

function makeCoopCombatContext() {
    return {
        dealDamageToOpponent(amount) { coopApplyDamageToBoss(amount); },
        dealDirectDamageToOpponent(amount) { coopApplyDamageToBoss(amount); },
        dealDirectDamageToSelf(amount) {
            coopMyHP -= amount;
            coopMyTurnStats.selfDamage += amount;
            coopSyncSelfState();
        },
        getSelfArmor() { return coopMyArmor; },
        grantExtraTurn() { coopExtraTurnTriggered = true; },
        log(msg) { coopLog(msg); }
    };
}

function coopApplyDamageToBoss(amount) {
    coopMyTurnStats.damage += amount;
    if (coopIsHost) coopApplyBossDamage(amount);
    else coopChannel.send({ type: 'broadcast', event: 'boss-damage', payload: { amount } });
}

function coopUseUltimate() {
    if (coopMatchOver || coopProcessing || !coopMyTurn || coopUltCharge < 100 || !selectedClass) return;

    coopProcessing = true;
    selectedClass.ultEffect(makeCoopCombatContext());
    coopUltCharge = 0;
    coopUpdateUI();

    setTimeout(() => {
        coopProcessing = false;
        coopEndOwnTurn();
    }, 500);
}

// --- BOARD ---------------------------------------------------------------------

function coopCreateBoard() {
    let grid = document.getElementById('coop-grid');
    grid.innerHTML = '';
    coopTiles.length = 0;
    coopSelectedTile = null;

    for (let i = 0; i < COOP_WIDTH * COOP_WIDTH; i++) {
        const tile = document.createElement('div');
        tile.setAttribute('id', 'coop-tile-' + i);
        tile.className = 'tile';
        let randomType = Math.floor(Math.random() * tileTypes.length);
        tile.dataset.type = tileTypes[randomType].type;
        tile.innerHTML = tileTypes[randomType].symbol;
        grid.appendChild(tile);
        coopTiles.push(tile);

        tile.addEventListener('mousedown', () => coopHandleTap(tile));
        tile.addEventListener('touchstart', (e) => { e.preventDefault(); coopHandleTap(tile); }, { passive: false });
    }
    coopResolveMatches(true);
}

function coopHandleTap(tile) {
    if (coopMatchOver || coopProcessing || !coopMyTurn) return;
    if (!coopSelectedTile) {
        coopSelectedTile = tile;
        tile.classList.add('selected');
        return;
    }
    if (tile === coopSelectedTile) {
        tile.classList.remove('selected');
        coopSelectedTile = null;
        return;
    }
    let id1 = parseInt(coopSelectedTile.id.replace('coop-tile-', ''));
    let id2 = parseInt(tile.id.replace('coop-tile-', ''));
    let r1 = Math.floor(id1 / COOP_WIDTH), c1 = id1 % COOP_WIDTH;
    let r2 = Math.floor(id2 / COOP_WIDTH), c2 = id2 % COOP_WIDTH;
    let adjacent = (r1 === r2 && Math.abs(c1 - c2) === 1) || (c1 === c2 && Math.abs(r1 - r2) === 1);

    if (adjacent) {
        coopAttemptSwap(coopSelectedTile, tile);
        coopSelectedTile.classList.remove('selected');
        coopSelectedTile = null;
    } else {
        coopSelectedTile.classList.remove('selected');
        coopSelectedTile = tile;
        tile.classList.add('selected');
    }
}

function coopAttemptSwap(tile1, tile2) {
    coopProcessing = true;
    let t = tile1.dataset.type, h = tile1.innerHTML;
    tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
    tile2.dataset.type = t; tile2.innerHTML = h;

    let matched = coopResolveMatches(false);
    if (!matched) {
        setTimeout(() => {
            let t2 = tile1.dataset.type, h2 = tile1.innerHTML;
            tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
            tile2.dataset.type = t2; tile2.innerHTML = h2;
            coopProcessing = false;
        }, 150);
    }
}

function coopResolveMatches(isInitial) {
    let groups = findMatchGroups(coopTiles, COOP_WIDTH);
    if (groups.length === 0) {
        if (!isInitial) coopProcessing = false;
        return false;
    }

    groups.forEach(g => coopApplyGroupEffect(g, isInitial));
    setTimeout(() => coopDropAndRefill(isInitial), isInitial ? 0 : 350);
    return true;
}

function coopApplyGroupEffect(group, isInitial) {
    let count = group.indices.length;
    let isCross = (group.subShape === 'cross');
    let { multiplier, extraTurn, ultBonus } = getMatchShapeInfo(count, isCross);

    group.indices.forEach(i => {
        if (!isInitial) coopTiles[i].classList.add('matched');
        else coopTiles[i].innerHTML = '';
        coopTiles[i].dataset.type = '';
    });

    if (isInitial) return;
    if (coopMatchOver) return;

    if (extraTurn) coopExtraTurnTriggered = true;
    if (ultBonus > 0) {
        coopUltCharge = Math.min(coopUltCharge + ultBonus, 100);
        coopMyTurnStats.ultGain += ultBonus;
    }

    if (group.type === 'sword' || group.type === 'skull') {
        let base = group.type === 'sword' ? TILE_STATS.sword : TILE_STATS.skull_dmg;
        let amount = Math.floor(base * multiplier);
        coopApplyDamageToBoss(amount);
        if (group.type === 'skull') {
            let recoil = Math.floor(TILE_STATS.skull_self_dmg * multiplier);
            if (coopMyArmor >= recoil) coopMyArmor -= recoil; else { coopMyHP -= (recoil - coopMyArmor); coopMyArmor = 0; }
            coopMyTurnStats.selfDamage += recoil;
            coopSyncSelfState();
        }
    } else if (group.type === 'heart') {
        let heal = Math.floor(TILE_STATS.heart * multiplier);
        coopMyHP = Math.min(coopMyHP + heal, COOP_MAX_HP);
        coopMyTurnStats.heal += heal;
        coopSyncSelfState();
    } else if (group.type === 'shield') {
        let gain = Math.floor(TILE_STATS.shield * multiplier);
        coopMyArmor += gain;
        coopMyTurnStats.armor += gain;
        coopSyncSelfState();
    } else if (group.type === 'energy') {
        let gain = Math.floor(TILE_STATS.energy * multiplier);
        coopUltCharge = Math.min(coopUltCharge + gain, 100);
        coopMyTurnStats.ultGain += gain;
    }

    coopUpdateUI();
}

function coopLogTurnSummary() {
    let parts = [];
    if (coopMyTurnStats.damage > 0) parts.push(`boss'a ${coopMyTurnStats.damage} hasar verdin`);
    if (coopMyTurnStats.heal > 0) parts.push(`${coopMyTurnStats.heal} can iyileştin`);
    if (coopMyTurnStats.armor > 0) parts.push(`${coopMyTurnStats.armor} zırh kazandın`);
    if (coopMyTurnStats.ultGain > 0) parts.push(`ult +%${coopMyTurnStats.ultGain}`);
    if (coopMyTurnStats.selfDamage > 0) parts.push(`kendine ${coopMyTurnStats.selfDamage} hasar verdin`);
    coopLog(parts.length > 0 ? `Hamlen: ${parts.join(', ')}.` : 'Hamlen bir etki yaratmadı.');
    coopMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };
}

function coopDropAndRefill(isInitial) {
    for (let col = 0; col < COOP_WIDTH; col++) {
        let colTiles = [];
        for (let row = 0; row < COOP_WIDTH; row++) {
            let i = col + row * COOP_WIDTH;
            if (coopTiles[i].dataset.type !== '') colTiles.push({ type: coopTiles[i].dataset.type, html: coopTiles[i].innerHTML });
        }
        let missing = COOP_WIDTH - colTiles.length;
        for (let i = 0; i < missing; i++) {
            let rt = tileTypes[Math.floor(Math.random() * tileTypes.length)];
            colTiles.unshift({ type: rt.type, html: rt.symbol });
        }
        for (let row = 0; row < COOP_WIDTH; row++) {
            let i = col + row * COOP_WIDTH;
            coopTiles[i].dataset.type = colTiles[row].type;
            coopTiles[i].innerHTML = colTiles[row].html;
            coopTiles[i].classList.remove('matched');
        }
    }
    let chained = coopResolveMatches(isInitial);
    if (chained || isInitial || coopMatchOver) return;

    coopLogTurnSummary();
    coopProcessing = false;
    coopEndOwnTurn();
}

// Common "my move is fully done" tail, reached both from a normal cascade
// settling and from finishing an ultimate.
function coopEndOwnTurn() {
    if (coopMatchOver) return;

    if (coopExtraTurnTriggered) {
        coopExtraTurnTriggered = false;
        coopLog('>> Ekstra tur!');
        coopUpdateUI();
        return;
    }

    coopMyTurn = false;
    coopStartThinkingAnimation();
    coopUpdateUI();

    if (coopIsHost) coopHostResolveTurnEnd(coopRole);
    else coopChannel.send({ type: 'broadcast', event: 'turn-done', payload: { role: coopRole } });
}

// --- UI --------------------------------------------------------------------------

function coopUpdateUI() {
    let hpPct = Math.max(0, (coopMyHP / COOP_MAX_HP) * 100);
    let hpBar = document.getElementById('coop-my-hp-bar');
    let hpText = document.getElementById('coop-my-hp-text');
    if (hpBar) hpBar.style.width = hpPct + '%';
    if (hpText) hpText.innerText = coopMyDown
        ? 'BAYILDIN'
        : `${Math.max(0, Math.floor(coopMyHP))}/${COOP_MAX_HP}` + (coopMyArmor > 0 ? ` [+${coopMyArmor}]` : '');

    let allyPct = Math.max(0, (coopAllyHP / COOP_MAX_HP) * 100);
    let allyBar = document.getElementById('coop-ally-hp-bar');
    let allyText = document.getElementById('coop-ally-hp-text');
    if (allyBar) allyBar.style.width = allyPct + '%';
    if (allyText) allyText.innerText = coopAllyDown
        ? 'BAYILDI - KURTAR!'
        : `${Math.max(0, Math.floor(coopAllyHP))}/${COOP_MAX_HP}` + (coopAllyArmor > 0 ? ` [+${coopAllyArmor}]` : '');

    let bossPct = coopBossMaxHP > 0 ? Math.max(0, (coopBossHP / coopBossMaxHP) * 100) : 0;
    let bossBar = document.getElementById('coop-boss-hp-bar');
    let bossText = document.getElementById('coop-boss-hp-text');
    if (bossBar) bossBar.style.width = bossPct + '%';
    if (bossText) bossText.innerText = `${Math.max(0, Math.floor(coopBossHP))}/${coopBossMaxHP}`;

    let ultBar = document.getElementById('coop-ult-bar');
    let ultText = document.getElementById('coop-ult-text');
    if (ultBar) ultBar.style.width = coopUltCharge + '%';
    if (ultText) ultText.innerText = `${Math.floor(coopUltCharge)}%`;

    let ultBtn = document.getElementById('coop-ult-btn');
    if (ultBtn) {
        ultBtn.disabled = coopUltCharge < 100 || !coopMyTurn || coopMatchOver || coopProcessing || !selectedClass || coopMyDown;
        ultBtn.innerText = selectedClass ? `${selectedClass.ultName} (${Math.floor(coopUltCharge)}%)` : 'ULT (sınıf seçilmedi)';
    }

    let grid = document.getElementById('coop-grid');
    if (grid) grid.classList.toggle('locked', !coopMyTurn || coopMatchOver || coopMyDown);
}
