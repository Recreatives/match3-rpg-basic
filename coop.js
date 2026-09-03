// --- CO-OP DUNGEON (2 real players vs. shared minions/bosses) ---
// Builds on the co-op prototype (which proved two real browsers can fight
// the SAME enemy HP pool with a down/revive mechanic) by turning that one
// fixed boss fight into an actual level-by-level dungeon run: minions on
// most levels, a boss every 5th, healing between levels - the same shape
// single-player's own run already has (see game.js's startLevel/winLevel).
// The hidden betrayal vote, Kibir Laneti and currency stakes from the
// "İhanet Protokolü" design doc are still NOT here - this only proves two
// players can run an open-ended shared dungeon together.
//
// Reuses the exact same match rules single-player and PvP already share
// (findMatchGroups, getMatchShapeInfo, applyDefensiveTraits, CLASSES) via
// its own combat context.
//
// Networking model: each player is authoritative for their OWN hp/armor/
// down-state (same rule PvP uses). The shared enemy HP has no single
// natural owner, so whichever player joins the room FIRST becomes "host"
// and is the one authoritative source for it - a non-host player's damage
// is broadcast to the host ("enemy-damage"); the host applies it and
// broadcasts the result back out ("enemy-hp-sync"). The host also decides
// when a level is cleared and what the next one looks like ("level-start").
//
// Turn order: player A moves -> enemy counter-attacks A -> player B moves
// -> enemy counter-attacks B -> repeat (mirrors single-player's player-
// then-enemy rhythm). The one exception: a killing blow does NOT get
// countered - the player who landed it keeps the turn into the next level,
// same as single-player always handing the very next turn back to the
// player after a win. Only the HOST decides turn order and enemy attacks,
// since only the host can see both players' down-state reliably. When the
// enemy's target is the host's own player, the outcome is known
// synchronously; when the target is the remote player, the host must wait
// for that player's own hp-sync (armor/dodge is THEIRS to resolve) before
// deciding what happens next - see coopPendingResolution below. Skipping
// that wait was the PvP turn-deadlock bug's cousin and is guarded against
// on purpose.

const COOP_WIDTH = 8;
const COOP_MAX_HP = 100;
const COOP_REVIVE_PCT = 0.3;
// Applied on top of single-player's own level scaling (getEnemyStatsForLevel
// in game.js) so two players sharing one enemy pool don't trivialize it.
const COOP_DIFFICULTY_MULT = 1.5;

let coopChannel = null;
let coopRoomCode = null;
let coopMyId = null;
let coopIsHost = false;
let coopRole = null; // 'host' | 'guest'
let coopTiles = [];
let coopStarted = false; // presence/role already resolved for this room
let coopRunBegun = false; // the very first level-start has been applied
let coopMyTurn = false;
let coopProcessing = false;
let coopSelectedTile = null;
// True while no board interaction should happen: either the whole run has
// ended (party wipe) or a level is mid-transition (enemy just died, next
// level hasn't started yet).
let coopMatchOver = false;
let coopThinkingInterval = null;

let coopMyHP = COOP_MAX_HP, coopMyArmor = 0, coopMyDown = false;
let coopAllyHP = COOP_MAX_HP, coopAllyArmor = 0, coopAllyDown = false;
let coopLevel = 1, coopIsBossLevel = false;
let coopEnemyHP = 0, coopEnemyMaxHP = 0, coopEnemyStats = null;
let coopUltCharge = 0;
let coopExtraTurnTriggered = false;
// Set by the host between firing an enemy-attack at the remote player and
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

function coopIsBoss(level) {
    return level % 5 === 0;
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

    coopChannel.on('broadcast', { event: 'level-start' }, ({ payload }) => coopOnLevelStart(payload));
    coopChannel.on('broadcast', { event: 'enemy-defeated' }, ({ payload }) => coopOnEnemyDefeated(payload));
    coopChannel.on('broadcast', { event: 'enemy-damage' }, ({ payload }) => { if (coopIsHost) coopApplyEnemyDamage(payload.amount || 0, payload.from); });
    coopChannel.on('broadcast', { event: 'enemy-hp-sync' }, ({ payload }) => { coopEnemyHP = payload.hp; coopUpdateUI(); });
    coopChannel.on('broadcast', { event: 'enemy-attack' }, ({ payload }) => coopOnEnemyAttack(payload));
    coopChannel.on('broadcast', { event: 'hp-sync' }, ({ payload }) => coopOnAllyHpSync(payload));
    coopChannel.on('broadcast', { event: 'turn-set' }, ({ payload }) => coopOnTurnSet(payload));
    coopChannel.on('broadcast', { event: 'turn-done' }, ({ payload }) => { if (coopIsHost) coopHostResolveTurnEnd(payload.role); });
    coopChannel.on('broadcast', { event: 'revive' }, ({ payload }) => coopOnRevive(payload));
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
        coopBeginRun();
        let payload = coopBuildLevelPayload(1, 'host');
        coopChannel.send({ type: 'broadcast', event: 'level-start', payload });
        coopOnLevelStart(payload);
    } else {
        coopSetStatus('Takım arkadaşın bulundu, savaş hazırlanıyor…');
    }
}

// --- ENEMY CONFIG (scales exactly like single-player, plus a co-op tax) -----

function coopComputeEnemyStats(level, isBoss) {
    let stats = getEnemyStatsForLevel(level, isBoss);
    Object.keys(stats).forEach(k => stats[k] = Math.round(stats[k] * COOP_DIFFICULTY_MULT));
    return stats;
}

function coopComputeEnemyMaxHP(level, isBoss) {
    let base = 50 + (level - 1) * 20;
    if (isBoss) base *= 1.3;
    return Math.round(base * COOP_DIFFICULTY_MULT);
}

// Host-only: packages up everything the guest needs to render a level
// without computing it independently (guest never calls this itself).
function coopBuildLevelPayload(level, continuingRole) {
    let isBoss = coopIsBoss(level);
    let maxHP = coopComputeEnemyMaxHP(level, isBoss);
    return { level, isBoss, enemyHP: maxHP, enemyMaxHP: maxHP, enemyStats: coopComputeEnemyStats(level, isBoss), continuingRole };
}

// --- RUN / LEVEL LIFECYCLE ----------------------------------------------------

// Full reset - only ever runs once, right before level 1 starts.
function coopBeginRun() {
    coopRunBegun = true;
    coopMyHP = COOP_MAX_HP; coopMyArmor = 0; coopMyDown = false;
    coopAllyHP = COOP_MAX_HP; coopAllyArmor = 0; coopAllyDown = false;
    coopUltCharge = 0;
    coopExtraTurnTriggered = false;
    coopMatchOver = false;
    coopProcessing = false;
    coopPendingResolution = null;
    coopMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };

    document.getElementById('coop-setup').style.display = 'none';
    document.getElementById('coop-battle').style.display = 'block';
    coopLog('🐉 Takım tamamlandı - zindan yürüyüşü başladı.');
}

// Reused between EVERY level after the first: the "rest before battle" heal
// single-player applies in winLevel() (LEVEL_CLEAR_HEAL_PERCENT lives in
// game.js), extended so a downed player instead gets back on their feet.
function coopApplyLevelClearHeal() {
    let wasDown = coopMyDown;
    let missing = wasDown ? COOP_MAX_HP : (COOP_MAX_HP - coopMyHP);
    let healed = Math.ceil(missing * LEVEL_CLEAR_HEAL_PERCENT);
    if (wasDown) { coopMyHP = 0; coopMyDown = false; }
    if (healed > 0) {
        coopMyHP = Math.min(coopMyHP + healed, COOP_MAX_HP);
        coopLog(wasDown ? `Ayağa kalktın: +${healed} HP` : `Dinlenme: +${healed} HP`);
    }
    coopSyncSelfState();
}

function coopOnLevelStart(payload) {
    if (!coopRunBegun) coopBeginRun();
    else coopApplyLevelClearHeal();

    coopLevel = payload.level;
    coopIsBossLevel = payload.isBoss;
    coopEnemyHP = payload.enemyHP;
    coopEnemyMaxHP = payload.enemyMaxHP;
    coopEnemyStats = payload.enemyStats;
    coopMatchOver = false;
    coopProcessing = false;
    coopMyTurn = (payload.continuingRole === coopRole);

    coopCreateBoard();
    coopUpdateUI();
    coopLog(payload.isBoss ? `⚠️ BOSS - Lvl ${payload.level} başlıyor!` : `Lvl ${payload.level} başlıyor.`);
    if (coopMyTurn) { coopStopThinkingAnimation(); coopSetStatus('Senin sıran!'); }
    else coopStartThinkingAnimation();
}

function coopOnEnemyDefeated(payload) {
    coopLog(payload.isBoss ? `Boss (Lvl ${payload.level}) yenildi!` : `Minion (Lvl ${payload.level}) yenildi!`);
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

// Applies an incoming hit to MY OWN hp/armor (enemy attack aimed at me).
function coopApplyIncomingDamage(amount) {
    let afterDefense = applyDefensiveTraits(amount);
    if (afterDefense === null) {
        showFloatingText("DODGE!", document.getElementById('coop-my-hp-bar'), "#2ecc71");
        coopLog('Saldırıyı savuşturdun!');
        return;
    }
    amount = afterDefense;

    if (coopMyArmor >= amount) coopMyArmor -= amount;
    else { coopMyHP -= (amount - coopMyArmor); coopMyArmor = 0; }

    showFloatingText(`-${amount}`, document.getElementById('coop-my-hp-bar'), '#e74c3c');
    coopLog(`Düşman sana ${amount} hasar verdi.`);
    coopSyncSelfState();
}

function coopOnEnemyAttack(payload) {
    if (coopMatchOver) return;
    if (payload.role === coopRole) coopApplyIncomingDamage(payload.amount || 0);
    else coopLog(`Düşman takım arkadaşına ${payload.amount} hasar verdi.`);
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

// --- HOST-ONLY: ENEMY BRAIN ----------------------------------------------------

function coopApplyEnemyDamage(amount, fromRole) {
    if (coopMatchOver) return;
    coopEnemyHP = Math.max(0, coopEnemyHP - amount);
    coopChannel.send({ type: 'broadcast', event: 'enemy-hp-sync', payload: { hp: coopEnemyHP } });
    coopUpdateUI();
    if (coopEnemyHP <= 0) coopBeginLevelTransition(fromRole || coopRole);
}

// A killing blow isn't countered - the player who landed it carries their
// turn straight into the next level, same as single-player always handing
// the very next turn back to the player after a win.
function coopBeginLevelTransition(continuingRole) {
    coopMatchOver = true; // pause all board interaction until the next level-start
    coopStopThinkingAnimation();
    if (continuingRole === coopRole) coopLogTurnSummary();

    let clearedLevel = coopLevel, clearedIsBoss = coopIsBossLevel;
    coopChannel.send({ type: 'broadcast', event: 'enemy-defeated', payload: { level: clearedLevel, isBoss: clearedIsBoss } });
    coopOnEnemyDefeated({ level: clearedLevel, isBoss: clearedIsBoss });

    setTimeout(() => {
        let payload = coopBuildLevelPayload(clearedLevel + 1, continuingRole);
        coopChannel.send({ type: 'broadcast', event: 'level-start', payload });
        coopOnLevelStart(payload);
    }, 1500);
}

// Called (host only) once a player's turn (theirs or the remote player's)
// has fully resolved: the enemy counter-attacks the mover, then turn/
// revival is decided. See file header for why the remote-target case has
// to wait. Never runs for a killing blow - see coopBeginLevelTransition.
function coopHostResolveTurnEnd(moverRole) {
    if (coopMatchOver) return;

    if (coopIsRoleDown(moverRole)) {
        // Downed themselves with their own move (e.g. ult recoil) - the
        // enemy has nothing left to hit, skip straight to revival/next-turn.
        coopFinishHostTurnResolution(moverRole);
        return;
    }

    let dmg = Math.round(coopEnemyStats.sword * (1 + Math.random() * 0.6));

    if (moverRole === coopRole) {
        coopApplyIncomingDamage(dmg);
        coopChannel.send({ type: 'broadcast', event: 'enemy-attack', payload: { role: moverRole, amount: dmg } });
        coopFinishHostTurnResolution(moverRole);
    } else {
        coopPendingResolution = { moverRole };
        coopChannel.send({ type: 'broadcast', event: 'enemy-attack', payload: { role: moverRole, amount: dmg } });
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

function coopOnPartyWiped() {
    coopMatchOver = true;
    coopStopThinkingAnimation();
    coopSetStatus(`İKİNİZ DE DÜŞTÜNÜZ - Lvl ${coopLevel}'de YENİLGİ`);
    coopLog('İkiniz de aynı anda düştünüz. Zindan yürüyüşü bitti.');
    coopUpdateUI();
}

// --- ULTIMATE ------------------------------------------------------------------

function makeCoopCombatContext() {
    return {
        dealDamageToOpponent(amount) { coopApplyDamageToEnemy(amount); },
        dealDirectDamageToOpponent(amount) { coopApplyDamageToEnemy(amount); },
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

function coopApplyDamageToEnemy(amount) {
    coopMyTurnStats.damage += amount;
    if (coopIsHost) coopApplyEnemyDamage(amount, coopRole);
    else coopChannel.send({ type: 'broadcast', event: 'enemy-damage', payload: { amount, from: coopRole } });
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
        coopApplyDamageToEnemy(amount);
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
    if (coopMyTurnStats.damage > 0) parts.push(`düşmana ${coopMyTurnStats.damage} hasar verdin`);
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
// settling and from finishing an ultimate. A no-op if the move that just
// finished was a killing blow - coopBeginLevelTransition already owns what
// happens next in that case (coopMatchOver guards it out below).
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

    let enemyPct = coopEnemyMaxHP > 0 ? Math.max(0, (coopEnemyHP / coopEnemyMaxHP) * 100) : 0;
    let enemyBar = document.getElementById('coop-boss-hp-bar');
    let enemyText = document.getElementById('coop-boss-hp-text');
    if (enemyBar) enemyBar.style.width = enemyPct + '%';
    if (enemyText) enemyText.innerText = `${Math.max(0, Math.floor(coopEnemyHP))}/${coopEnemyMaxHP}`;

    let levelLabel = document.getElementById('coop-level-label');
    if (levelLabel) levelLabel.innerText = coopIsBossLevel ? `Lvl ${coopLevel} 👹 BOSS` : `Lvl ${coopLevel}`;

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
