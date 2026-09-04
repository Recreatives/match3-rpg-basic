// --- PVP (real-time 1v1) ---
// Started as a prototype validating the hardest technical piece of the
// betrayal system - two real browsers seeing each other's moves live -
// before the betrayal vote, Kibir Laneti, and currency stakes got layered on
// top (see the "İhanet Protokolü" design doc). Those are all here now, gated
// behind pvpBetrayalMode (see "BETRAYAL MODE" below) - manually joining a
// room via "PvP Test" leaves that null and behaves exactly as before. It has
// its own state and its own board, entirely separate from game.js's single-
// player globals (isPlayerTurn, currentState, etc.) - the two modes never
// touch the same variables, so nothing here can destabilize single-player.
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
// vulnerability) and reports back if it died.
//
// The BOARD, unlike hp, is a single shared thing both players look at (see
// sharedboard.js) - not two independently-randomized copies. Since only one
// player can ever act at a time, only the active mover's client ever runs
// match-detection or touches randomness; every visual step of their turn
// gets broadcast as a full tile snapshot and the opponent's client just
// paints it. Board-creation authority is a one-time question per match -
// whoever moves first (pvpMyTurn at pvpStartMatch) randomizes and resolves
// the very first board; the other side just waits for that broadcast.
//
// Turn order: whoever's presence timestamp is earliest goes first - UNLESS
// coop.js started this match as a betrayal duel, in which case it forces the
// betrayer to move first (pvpForcedFirstMoverId) instead. See "BETRAYAL MODE"
// below for that and the rest of what coop.js's hidden vote can trigger.

const PVP_WIDTH = 8;
const PVP_MAX_HP = 100;

let pvpChannel = null;
let pvpRoomCode = null;
let pvpMyId = null;
let pvpOpponentId = null;
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

// --- SPEED BONUS (TIME MULTIPLIER) ---
// Same mechanic single-player uses (game.js's SPEED_BONUS_WINDOW_MS/
// SPEED_BONUS_MAX_MULT, reused here rather than redeclared) - the faster you
// swap after regaining control, the bigger the multiplier on that move (and
// any chain it causes). Only ever runs while it's MY turn; letting the
// window expire never costs the turn, the bonus just decays to a neutral x1.
let pvpTurnStartTime = null;
let pvpMoveTimeMultiplier = 1;
let pvpSpeedBonusInterval = null;

function pvpGetTimeMultiplier() {
    if (!pvpTurnStartTime) return 1;
    let elapsed = Date.now() - pvpTurnStartTime;
    let ratio = Math.max(0, 1 - elapsed / SPEED_BONUS_WINDOW_MS);
    return 1 + ratio * (SPEED_BONUS_MAX_MULT - 1);
}

function pvpUpdateSpeedBonusUI() {
    let el = document.getElementById('pvp-speed-bonus');
    if (!el) return;
    let mult = pvpGetTimeMultiplier();
    if (!pvpTurnStartTime || mult <= 1.02) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerText = `⚡x${mult.toFixed(1)}`;
}

function pvpStartSpeedTimer() {
    if (!pvpMyTurn || pvpMatchOver) return;
    pvpTurnStartTime = Date.now();
    clearInterval(pvpSpeedBonusInterval);
    pvpSpeedBonusInterval = setInterval(pvpUpdateSpeedBonusUI, 100);
    pvpUpdateSpeedBonusUI();
}

function pvpStopSpeedTimer() {
    clearInterval(pvpSpeedBonusInterval);
    pvpSpeedBonusInterval = null;
    pvpTurnStartTime = null;
    let el = document.getElementById('pvp-speed-bonus');
    if (el) el.style.display = 'none';
}

// --- BETRAYAL MODE ------------------------------------------------------------
// Set only when coop.js routes a betrayal-vote outcome into a PvP duel
// (pvpJoinBetrayalRoom) - null for every ordinary "PvP Test" match, which
// keeps all of this completely inert for manual testing.
//   isBetrayer: am I the one who chose ihanet (only meaningful when !isMutual)
//   isMutual:   both players chose ihanet - fair fight, no curse, higher stakes
let pvpBetrayalMode = null;
let pvpForcedFirstMoverId = null; // betrayer's uid, one-sided betrayal only
let pvpCurseTurnCount = 0; // counts MY OWN turns; Kibir Laneti bites from turn 2
let pvpBetrayalResolved = false; // guards the currency RPC against double-firing

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

    pvpBetrayalMode = null;
    pvpForcedFirstMoverId = null;
    await pvpConnectChannel(code);
    pvpSetStatus(`Oda "${pvpRoomCode}" - rakip bekleniyor…`);
}

// Entry point coop.js calls once its hidden betrayal vote resolves to
// anything other than both-loyal - skips the manual room-code screen
// entirely since both players already know the room (derived from the
// co-op room they're already in) and each other's identity.
async function pvpJoinBetrayalRoom(code, opts) {
    pvpBetrayalMode = { isBetrayer: !!opts.isBetrayer, isMutual: !!opts.isMutual };
    pvpForcedFirstMoverId = opts.firstMoverId || null;
    await pvpConnectChannel(code);
    pvpSetStatus(pvpBetrayalMode.isMutual ? 'İhanet düellosu hazırlanıyor…' : (pvpBetrayalMode.isBetrayer ? 'İlk vuruş senin - düello hazırlanıyor…' : 'İhanete uğradın - düello hazırlanıyor…'));
}

// Rejoining a different room code in the same tab without reloading the
// page used to leave every flag below at whatever a PREVIOUS match had set
// it to (pvpMatchOver stuck true silently blocked all interaction, a stale
// pvpBetrayalMode/pvpForcedFirstMoverId could leak into what should be a
// plain manual test match, etc.) - this is the fix.
function pvpResetSessionState() {
    pvpStarted = false;
    pvpMyTurn = false;
    pvpProcessing = false;
    pvpSelectedTile = null;
    pvpMyHP = PVP_MAX_HP;
    pvpMyArmor = 0;
    pvpMatchOver = false;
    pvpStopThinkingAnimation();
    pvpStopSpeedTimer();
    pvpMoveTimeMultiplier = 1;
    pvpUltCharge = 0;
    pvpExtraTurnTriggered = false;
    pvpMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };
    pvpIncomingStats = { damage: 0 };
    pvpOpponentId = null;
    pvpCurseTurnCount = 0;
    pvpBetrayalResolved = false;
}

async function pvpConnectChannel(code) {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { pvpSetStatus('Giriş yapılamadı, sayfayı yenile.'); return; }
    pvpMyId = user.id;
    pvpRoomCode = code;
    pvpResetSessionState();

    if (pvpChannel) await pvpChannel.unsubscribe();

    pvpChannel = sb.channel(`pvp-room-${pvpRoomCode}`, {
        config: { presence: { key: pvpMyId }, broadcast: { self: false } }
    });

    pvpChannel.on('broadcast', { event: 'attack' }, ({ payload }) => pvpReceiveAttack(payload));
    pvpChannel.on('broadcast', { event: 'defeated' }, () => pvpOnOpponentDefeated());
    pvpChannel.on('broadcast', { event: 'turn-end' }, () => pvpReceiveTurnEnd());
    // One shared board now (sharedboard.js) - this only ever fires on the
    // PASSIVE side, since broadcast self:false means the active mover never
    // gets its own step back.
    pvpChannel.on('broadcast', { event: 'board-sync' }, ({ payload }) => sbApplySnapshot(pvpTiles, payload));
    pvpChannel.on('presence', { event: 'sync' }, () => pvpCheckPresence());

    await new Promise(resolve => {
        pvpChannel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await pvpChannel.track({ joined_at: Date.now() });
                resolve();
            }
        });
    });
}

function pvpCheckPresence() {
    if (pvpStarted) return;
    const state = pvpChannel.presenceState();
    const keys = Object.keys(state);
    if (keys.length < 2) return;

    let entries = keys.map(k => ({ key: k, joinedAt: state[k][0].joined_at }));
    entries.sort((a, b) => a.joinedAt - b.joinedAt);
    let opponent = entries.find(e => e.key !== pvpMyId);
    pvpOpponentId = opponent ? opponent.key : null;

    pvpStarted = true;
    pvpMyTurn = pvpForcedFirstMoverId ? (pvpForcedFirstMoverId === pvpMyId) : (entries[0].key === pvpMyId);
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
    pvpCurseTurnCount = 0;
    pvpBetrayalResolved = false;
    pvpMyTurnStats = { damage: 0, heal: 0, armor: 0, selfDamage: 0, ultGain: 0 };
    pvpIncomingStats = { damage: 0 };

    document.getElementById('pvp-setup').style.display = 'none';
    document.getElementById('pvp-battle').style.display = 'block';

    // One shared board for the whole duel - whoever moves first is also the
    // one-time authority for its very first state (randomizes + resolves any
    // initial matches + broadcasts the result). The other side just builds
    // the same empty grid and waits for that broadcast - see sharedboard.js.
    sbCreateBoardDOM('pvp-grid', 'pvp-tile-', pvpTiles, pvpHandleTap);
    pvpSelectedTile = null;
    if (pvpMyTurn) {
        sbRandomizeBoard(pvpTiles);
        pvpResolveMatches(true);
    }
    pvpUpdateUI();
    pvpLog(pvpBetrayalMode ? '⚔️ İhanet düellosu başladı.' : '🟢 Rakip bağlı - eşleşme başladı.');
    if (pvpMyTurn) {
        pvpStopThinkingAnimation();
        pvpSetStatus('Senin sıran!');
        pvpBeginMyTurn(); // counts as my turn 1 - Kibir Laneti only bites from turn 2
    } else pvpStartThinkingAnimation();
}

// Kibir Laneti: only the betrayer in a one-sided duel carries this. Their
// free first strike is turn 1 (no curse); from turn 2 on, self-damage that
// ignores armor escalates fast enough to force them to end things quickly
// rather than coast on the first-strike advantage forever.
const PVP_CURSE_PERCENTS = [3, 5, 8, 13, 21, 34];

function pvpBeginMyTurn() {
    pvpCurseTurnCount++;
    pvpStartSpeedTimer(); // a fresh speed-bonus window for every new turn, curse or not
    if (!pvpBetrayalMode || pvpBetrayalMode.isMutual || !pvpBetrayalMode.isBetrayer) return;
    if (pvpCurseTurnCount < 2) return;

    let pct = PVP_CURSE_PERCENTS[Math.min(pvpCurseTurnCount - 2, PVP_CURSE_PERCENTS.length - 1)];
    let dmg = Math.max(1, Math.round(PVP_MAX_HP * pct / 100));
    pvpMyHP -= dmg; // ignores armor - Kibir Laneti punishes arrogance directly
    pvpLog(`Kibir Laneti: kendine %${pct} (${dmg}) hasar verdin.`);
    showFloatingText(`-${dmg}`, document.getElementById('pvp-my-hp-bar'), '#9b59b6');
    pvpUpdateUI();

    if (pvpMyHP <= 0 && !pvpMatchOver) {
        pvpMatchOver = true;
        pvpStopThinkingAnimation();
        pvpChannel.send({ type: 'broadcast', event: 'defeated', payload: {} });
        pvpSetStatus('KAYBETTİN');
        pvpLog('Kibir Laneti seni yendi.');
        pvpOnDefeat();
        pvpUpdateUI();
    }
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
        pvpOnDefeat();
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
    pvpBeginMyTurn();
}

function pvpOnOpponentDefeated() {
    if (pvpMatchOver) return;
    pvpMatchOver = true;
    pvpStopThinkingAnimation();
    pvpSetStatus('KAZANDIN!');
    pvpLog('Rakip yenildi - kazandın!');
    pvpUpdateUI();
    if (pvpBetrayalMode) pvpResolveBetrayalPayoutIfNeeded().then(() => pvpShowBetrayalSummary(true));
    // Betrayal duels already have their own currency-stakes reward (steal %
    // or the small loyal-survivor bonus) - loot drops are only for a
    // straightforward "PvP Test" win, to keep that reward model unmuddied.
    else if (typeof awardLootDrop === 'function') awardLootDrop();
}

// --- BETRAYAL CURRENCY STAKES --------------------------------------------------
// Only the WINNING client ever calls the RPC (resolveBetrayal, economy.js) -
// the loser's client just observes the resulting balance next time it fetches
// its own wallet, same "one authoritative caller" rule the rest of this file
// uses for shared state. See supabase/schema.sql's resolve_betrayal for why a
// client can't just write the other player's wallet row directly.
function pvpBetrayalLossPercent() {
    if (!pvpBetrayalMode) return 0;
    return pvpBetrayalMode.isMutual ? 0.25 : 0.15;
}

function pvpResolveBetrayalPayoutIfNeeded() {
    if (!pvpBetrayalMode || pvpBetrayalResolved) return Promise.resolve();
    pvpBetrayalResolved = true;

    if (pvpBetrayalMode.isMutual) {
        unlockAchievement('mutual_destruction');
    } else if (pvpBetrayalMode.isBetrayer) {
        unlockAchievement('cursed_but_victorious');
    } else {
        unlockAchievement('loyal_survivor');
    }

    if (pvpBetrayalMode.isMutual || pvpBetrayalMode.isBetrayer) {
        // Mutual winner either way, or the betrayer winning their one-sided
        // duel: steal currency from the loser.
        let pct = pvpBetrayalLossPercent();
        return resolveBetrayal(pvpMyId, pvpOpponentId, pct).then(ok => {
            pvpLog(ok ? `Rakibinden %${Math.round(pct * 100)} çaldın.` : 'Ödül aktarımı başarısız oldu.');
        });
    } else {
        // The loyal player winning against a betrayer - deliberately tiny,
        // no steal from the betrayer's wallet (see the design doc: this
        // reward is intentionally small so loyalty isn't a free win).
        return adjustWallet(10, 5).then(() => pvpLog('Sadakatinin küçük bir ödülü: +10 altın, +5 hammadde.'));
    }
}

// Called from every "I lost this duel" path - betrayal-specific bookkeeping
// plus the one thing every defeat has in common regardless of mode: this
// run's achievement buffs are gone (see achievements.js's "ACTIVE" vs
// "lifetime" split).
function pvpOnDefeat() {
    if (typeof resetActiveAchievements === 'function') resetActiveAchievements();
    pvpLogBetrayalLossIfNeeded();
}

function pvpLogBetrayalLossIfNeeded() {
    if (!pvpBetrayalMode) return;
    if (pvpBetrayalMode.isMutual || !pvpBetrayalMode.isBetrayer) {
        let pct = pvpBetrayalLossPercent();
        pvpLog(`Cüzdanının %${Math.round(pct * 100)}'i rakibine geçti.`);
    } else {
        pvpLog('İhanetin sana kazandırmadı ama cüzdanın güvende.');
    }
    // Give the WINNER's resolve_betrayal RPC a moment to actually land server-
    // side before we fetch our own wallet for the summary screen - I have no
    // way to await it directly since I (the loser) never call it myself.
    setTimeout(() => pvpShowBetrayalSummary(false), 1200);
}

// --- BETRAYAL RESULT SCREEN -----------------------------------------------------
// A recap replacing the plain "KAZANDIN!"/"KAYBETTİN" text with the context
// that actually made a betrayal duel dramatic: who broke the deal, what it
// cost, and (since PvP intentionally hides your opponent's hp for the whole
// fight) the first real look at how the currency stakes landed.
async function pvpShowBetrayalSummary(iWon) {
    if (!pvpBetrayalMode) return;

    let title = pvpBetrayalMode.isMutual ? '💀 KARŞILIKLI İHANET'
        : (pvpBetrayalMode.isBetrayer ? '🗡️ İHANET ETTİN' : '🩹 İHANETE UĞRADIN');

    let detail;
    if (iWon) {
        detail = (pvpBetrayalMode.isMutual || pvpBetrayalMode.isBetrayer)
            ? `Rakibinin cüzdanının %${Math.round(pvpBetrayalLossPercent() * 100)}'ini çaldın.`
            : 'Sadakatinin küçük bir ödülünü aldın (+10 altın, +5 hammadde) - rakibinin cüzdanına dokunmadın.';
    } else {
        detail = (pvpBetrayalMode.isMutual || !pvpBetrayalMode.isBetrayer)
            ? `Cüzdanının %${Math.round(pvpBetrayalLossPercent() * 100)}'i rakibine geçti.`
            : 'İhanetin sana kazandırmadı ama cüzdanın güvende kaldı.';
    }

    await fetchWallet();
    let walletLine = currentWallet ? `Güncel cüzdanın: 🪙 ${currentWallet.gold}  🪨 ${currentWallet.materials}` : '';

    document.getElementById('betrayal-summary-title').innerText = title;
    let outcomeEl = document.getElementById('betrayal-summary-outcome');
    outcomeEl.innerText = iWon ? 'KAZANDIN' : 'KAYBETTİN';
    outcomeEl.style.color = iWon ? '#2ecc71' : '#e74c3c';
    document.getElementById('betrayal-summary-detail').innerText = detail;
    document.getElementById('betrayal-summary-wallet').innerText = walletLine;
    document.getElementById('betrayal-summary-modal').style.display = 'flex';
}

function pvpCloseBetrayalSummary() {
    document.getElementById('betrayal-summary-modal').style.display = 'none';
    document.getElementById('pvp-modal').style.display = 'none';
    pvpBetrayalMode = null;
    pvpForcedFirstMoverId = null;
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
        pvpOnDefeat();
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
    // Lock in the speed bonus for this move before anything else happens -
    // the countdown is about how fast the decision was made.
    pvpMoveTimeMultiplier = pvpGetTimeMultiplier();
    pvpStopSpeedTimer();

    pvpProcessing = true;
    let t = tile1.dataset.type, h = tile1.innerHTML;
    tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
    tile2.dataset.type = t; tile2.innerHTML = h;
    sbBroadcastStep(pvpChannel, pvpTiles); // opponent sees the swap as it happens

    let matched = pvpResolveMatches(false);
    if (!matched) {
        setTimeout(() => {
            let t2 = tile1.dataset.type, h2 = tile1.innerHTML;
            tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
            tile2.dataset.type = t2; tile2.innerHTML = h2;
            pvpProcessing = false;
            sbBroadcastStep(pvpChannel, pvpTiles); // ...and the revert too, if it wasn't a match
            // Invalid swap didn't cost the turn - fresh speed-bonus window for the next attempt.
            pvpStartSpeedTimer();
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
    sbBroadcastStep(pvpChannel, pvpTiles); // opponent sees the matched tiles clear
    setTimeout(() => pvpDropAndRefill(isInitial), isInitial ? 0 : 350);
    return true;
}

function pvpApplyGroupEffect(group, isInitial) {
    let count = group.indices.length;
    let isCross = (group.subShape === 'cross');
    // Same size/shape -> multiplier/extra-turn/ult-charge priority rules as
    // single-player (getMatchShapeInfo lives in game.js). The speed bonus
    // scales the tile EFFECT the same way single-player does - ultBonus
    // stays a flat add, not scaled by it (matching game.js's processMatch).
    let { multiplier: shapeMultiplier, extraTurn, ultBonus } = getMatchShapeInfo(count, isCross);
    let multiplier = shapeMultiplier * pvpMoveTimeMultiplier;

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
        pvpOnDefeat();
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
    sbBroadcastStep(pvpChannel, pvpTiles); // opponent sees the refilled board settle
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
        pvpStartSpeedTimer(); // fresh speed-bonus window for the extra turn
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
