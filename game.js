// getElementById, not querySelector('.grid') - pvp-grid/coop-grid share the
// same "grid" class for sizing and both appear earlier in the DOM than the
// solo #grid, so the class selector was silently grabbing pvp-grid instead:
// createBoard() would append the class-selection overlay and all 64 tiles
// into the (hidden, zero-size) PvP modal instead of the visible board.
const gridDisplay = document.getElementById('grid');
const logDisplay = document.getElementById('log');
const turnBanner = document.getElementById('turn-banner');
const aiCursor = document.getElementById('ai-cursor');

const overlay = document.getElementById('game-overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayBtn = document.getElementById('overlay-btn');
const rewardArea = document.getElementById('reward-area');
const enemySprite = document.getElementById('enemy-sprite');

const width = 8;
const tiles = [];

// --- STATS ---
// teamHeal only ever matters in co-op (coop.js's teamheal tile, never
// spawned in solo or PvP) - kept here anyway since this is the one shared
// stat pool every mode reads, same as every other stat.
let TILE_STATS = {
    sword: 6, heart: 4, shield: 5, energy: 12,
    skull_dmg: 25, skull_self_dmg: 12, ult_dmg: 35, lifeSteal: 0, teamHeal: 6
};

// Rebuilds TILE_STATS from scratch: base numbers, then the selected class's
// passive, then permanent equipped-item bonuses, then this-run-only active
// achievement bonuses. Called at the start of every mode's actual run/match
// (solo's resetGame, the class-selection handler, pvp.js's pvpStartMatch,
// coop.js's coopBeginRun) so a previous run's temporary reward picks
// (REWARD_POOL, further down this file) can never leak into a new one,
// regardless of which mode that new one is - TILE_STATS is one shared pool
// every mode reads, so "the run is over" has to mean the same clean slate
// everywhere, not just in whichever mode happened to build it last.
function rebuildTileStats() {
    TILE_STATS = { sword: 6, heart: 4, shield: 5, energy: 12, skull_dmg: 25, skull_self_dmg: 12, ult_dmg: 35, lifeSteal: 0, teamHeal: 6 };
    if (selectedClass) selectedClass.passive(TILE_STATS);
    applyEquippedItemBonuses(TILE_STATS, currentOwnedItems);
    applyActiveAchievementBonuses(TILE_STATS, currentActiveAchievements);
    applyLearnedTalentBonuses(TILE_STATS, currentLearnedTalents);
}

// Talent tree (Phase 1) - permanent, run-independent bonuses spent from
// points earned via PvP wins + daily quests claimed (see
// supabase/schema.sql's get_talent_status/learn_talent - both already
// protected by their own trusted RPCs, so there's nothing new to cheat
// here). Each talent is a single unlock, no multi-rank complexity. Keep
// this catalog's keys in sync with schema.sql's talent_defs table by hand,
// same tradeoff as ITEM_BASES/item_bases.
const TALENT_CATALOG = {
    iron_will:      { name: 'Demir İrade', emoji: '🛡️', desc: '+2 Kalkan (kalıcı)', bonus: (s) => { s.shield += 2; } },
    sharp_blade:    { name: 'Keskin Kılıç', emoji: '⚔️', desc: '+2 Kılıç (kalıcı)', bonus: (s) => { s.sword += 2; } },
    healing_touch:  { name: 'Şifa Dokunuşu', emoji: '💖', desc: '+1 Kalp (kalıcı)', bonus: (s) => { s.heart += 1; } },
    energy_flow:    { name: 'Enerji Akışı', emoji: '⚡', desc: '+2 Enerji (kalıcı)', bonus: (s) => { s.energy += 2; } },
    lethal_strike:  { name: 'Öldürücü Vuruş', emoji: '💀', desc: '+5 Kafatası Hasarı (kalıcı)', bonus: (s) => { s.skull_dmg += 5; } },
    ultimate_power: { name: 'Ultimate Gücü', emoji: '💥', desc: '+5 Ult Gücü (kalıcı)', bonus: (s) => { s.ult_dmg += 5; } }
};
let currentLearnedTalents = [];

function applyLearnedTalentBonuses(stats, learnedIds) {
    (learnedIds || []).forEach(id => {
        let def = TALENT_CATALOG[id];
        if (def && def.bonus) def.bonus(stats);
    });
}

// Enemies used to read the player's own TILE_STATS, so every reward the
// player picked up also buffed enemy tile-match damage/healing. Enemies
// now have their own stat pool that scales with level/boss independently.
let ENEMY_TILE_STATS = { sword: 4, heart: 3, shield: 4, energy: 10, skull_dmg: 15, skull_self_dmg: 8 };

// Minion variety, ported from co-op's COOP_MINION_TYPES (coop.js) so solo
// levels have the same flavor - a minion's actual tile-match damage still
// comes from ENEMY_TILE_STATS/AI move quality (unchanged), these are
// additional twists layered on top: armored starts the fight with a shield
// to break through, swift gets an extra consecutive move each of its turns
// (reuses the same extraTurnTriggered mechanism a 4-match grants the
// player, see endTurnLogic), drain chips the player's own ult charge
// whenever it lands a hit.
const MINION_TYPES = ['normal', 'armored', 'swift', 'drain'];
const MINION_ARMORED_PCT = 0.3; // starting armor as a fraction of the level's max HP
const MINION_DRAIN_AMOUNT = 15; // flat ult-charge % stolen per drain hit
const MINION_ICON = { normal: null, armored: '🛡️', swift: '⚡', drain: '🌀', boss: '👹' };
const MINION_LOG = {
    normal: '', boss: '',
    armored: '🛡️ Zırhlı düşman - önce zırhını kırman gerekiyor.',
    swift: '⚡ Hızlı düşman - her turunda bir kez ekstra hamle yapıyor.',
    drain: '🌀 Enerji emen düşman - saldırısı ult şarjını da çalıyor.'
};
function minionTypeForLevel(lvl) {
    return (lvl % 5 === 0) ? 'boss' : MINION_TYPES[(lvl - 1) % MINION_TYPES.length];
}
let currentMinionType = 'normal';
let swiftBonusUsed = false; // one extra move per enemy turn, not per match
function getEnemyStatsForLevel(lvl, isBoss) {
    let scale = 1 + (lvl - 1) * 0.15;
    if (isBoss) scale *= 1.3;
    return {
        sword: Math.round(4 * scale),
        heart: Math.round(3 * scale),
        shield: Math.round(4 * scale),
        energy: Math.round(10 * scale),
        skull_dmg: Math.round(15 * scale),
        skull_self_dmg: Math.round(8 * scale)
    };
}

// Fraction of missing HP restored when moving on to the next level.
const LEVEL_CLEAR_HEAL_PERCENT = 0.5;

// --- SPEED BONUS (TIME MULTIPLIER) ---
// Only applies to the player's own moves. The faster you swap after
// regaining control, the bigger the multiplier on that move's effect
// (and any chain reaction it causes). Letting the window expire never
// costs a turn - the bonus just decays back down to a neutral x1.
const SPEED_BONUS_WINDOW_MS = 8000;
const SPEED_BONUS_MAX_MULT = 2.0;
let turnStartTime = null;
let currentMoveTimeMultiplier = 1;
let speedBonusInterval = null;

function getTimeMultiplier() {
    if (!turnStartTime) return 1;
    let elapsed = Date.now() - turnStartTime;
    let ratio = Math.max(0, 1 - elapsed / SPEED_BONUS_WINDOW_MS);
    return 1 + ratio * (SPEED_BONUS_MAX_MULT - 1);
}

function updateSpeedBonusUI() {
    let el = document.getElementById('speed-bonus');
    let mult = getTimeMultiplier();
    if (!turnStartTime || mult <= 1.02) {
        el.style.display = 'none';
        return;
    }
    el.style.display = 'block';
    el.innerText = `⚡x${mult.toFixed(1)}`;
}

function startPlayerTimer() {
    if (currentState !== STATE.PLAYING || !isPlayerTurn) return;
    turnStartTime = Date.now();
    clearInterval(speedBonusInterval);
    speedBonusInterval = setInterval(updateSpeedBonusUI, 100);
    updateSpeedBonusUI();
}

function stopPlayerTimer() {
    clearInterval(speedBonusInterval);
    speedBonusInterval = null;
    turnStartTime = null;
    document.getElementById('speed-bonus').style.display = 'none';
}

// --- HISTORY TRACKING ---
let pickedRewards = [];
let totalStatsGained = {
    sword: 0, shield: 0, heart: 0, energy: 0,
    skull_dmg: 0, skull_self_dmg: 0, ult_dmg: 0, lifeSteal: 0, maxHP: 0
};

const STATE = { START: 0, PLAYING: 1, REWARD: 2, GAMEOVER: 3 };
let currentState = STATE.START;
let rewardPicksLeft = 1;

// --- CLASS DEFINITIONS ---
// Each ultEffect takes a "combat context" (ctx) instead of touching
// playerHP/enemyHP/inflictDamage/log directly, so the exact same class
// definitions work whether the opponent is the local AI (single-player,
// makeSinglePlayerCombatContext) or a real networked player (PvP,
// makePvpCombatContext in pvp.js) - the class doesn't need to know which.
// useUltimate() already handles the post-ult win-check for every class
// uniformly, so no ultEffect needs to call anything win-related itself.
const CLASSES = {
    WARRIOR: {
        name: "Warrior", emoji: "🛡️",
        desc: "<b>Tank:</b> +2 Bonus Zırh kazanır. Ult, Zırhına göre hasar verir.",
        passive: (stats) => { stats.shield += 2; },
        dodgeChance: 0, incomingDmgMult: 1.0,
        ultName: "SHIELD SLAM",
        ultEffect: (ctx) => {
            let dmg = TILE_STATS.ult_dmg + ctx.getSelfArmor();
            ctx.dealDamageToOpponent(dmg);
            ctx.log(`ULT: Shield Slam ${dmg} hasar verdi!`, "log-hit");
        }
    },
    BERSERKER: {
        name: "Berserker", emoji: "🪓",
        desc: "<b>DPS:</b> +5 Kılıç / +15 Kafatası Hasarı, ama <b>%35 DAHA FAZLA HASAR</b> alır.",
        passive: (stats) => { stats.sword += 5; stats.skull_dmg += 15; },
        dodgeChance: 0, incomingDmgMult: 1.25,
        ultName: "BLOOD LUST",
        ultEffect: (ctx) => {
            ctx.dealDirectDamageToSelf(10);
            ctx.dealDamageToOpponent(TILE_STATS.ult_dmg * 2);
            ctx.log(`ULT: Blood Lust çift hasar verdi!`, "log-crit");
        }
    },
    ROGUE: {
        name: "Rogue", emoji: "🗡️",
        desc: "<b>Kombo:</b> Hızlı Enerji kazanır. Ult, <b>EKSTRA TUR</b> verir.",
        passive: (stats) => { stats.energy += 5; },
        dodgeChance: 0.1, incomingDmgMult: 1.0,
        ultName: "ASSASSINATE",
        ultEffect: (ctx) => {
            ctx.dealDamageToOpponent(TILE_STATS.ult_dmg);
            ctx.grantExtraTurn();
            ctx.log(`ULT: Assassinate! Ekstra Tur!`, "log-match");
        }
    },
    ARCHER: {
        name: "Archer", emoji: "🏹",
        desc: "<b>Delici:</b> <b>%20 Savuşturma</b>. Ult, Zırhı yok sayıp doğrudan can hasarı verir.",
        passive: (stats) => {},
        dodgeChance: 0.2, incomingDmgMult: 1.0,
        ultName: "PIERCING SHOT",
        ultEffect: (ctx) => {
            let pierceDmg = TILE_STATS.ult_dmg + (TILE_STATS.sword * 2);
            ctx.dealDirectDamageToOpponent(pierceDmg);
            ctx.log(`ULT: Piercing Shot zırhı yok saydı! -${pierceDmg} Can`, "log-crit");
        }
    },
    MAGE: {
        name: "Mage", emoji: "🧙",
        desc: "<b>Ölçeklenme:</b> Ult her kullanımda <b>+10 Güç</b> kazanır.",
        passive: (stats) => { stats.energy += 10; stats.sword -= 2; },
        dodgeChance: 0, incomingDmgMult: 1.0,
        ultName: "ARCANE BLAST",
        ultEffect: (ctx) => {
            ctx.dealDamageToOpponent(TILE_STATS.ult_dmg);
            TILE_STATS.ult_dmg += 10;
            ctx.log(`ULT: Güç ${TILE_STATS.ult_dmg}'e yükseldi!`, "log-match");
        }
    },
    NECROMANCER: {
        name: "Necromancer", emoji: "🧟",
        desc: "<b>Can Emme:</b> +%3 Can Çalma, +8 Kafatası Hasarı. Ult hasar verir ve yarısını iyileştirir.",
        passive: (stats) => { stats.lifeSteal += 3; stats.skull_dmg += 8; },
        dodgeChance: 0, incomingDmgMult: 1.0,
        ultName: "SOUL SIPHON",
        ultEffect: (ctx) => {
            let dmg = TILE_STATS.ult_dmg;
            let heal = Math.floor(dmg * 0.5);
            ctx.dealDamageToOpponent(dmg);
            ctx.healSelf(heal);
            ctx.log(`ULT: Soul Siphon ${dmg} hasar verdi, ${heal} iyileştirdi!`, "log-crit");
        }
    },
    PALADIN: {
        name: "Paladin", emoji: "⚜️",
        desc: "<b>Kalkan:</b> +3 Zırh, +3 İyileşme, <b>%15 DAHA AZ</b> hasar alır. Ult büyük iyileştirir, biraz hasar verir.",
        passive: (stats) => { stats.shield += 3; stats.heart += 3; },
        dodgeChance: 0, incomingDmgMult: 0.85,
        ultName: "DIVINE JUDGEMENT",
        ultEffect: (ctx) => {
            let heal = Math.floor(TILE_STATS.heart * 4);
            let dmg = Math.floor(TILE_STATS.ult_dmg * 0.6);
            ctx.healSelf(heal);
            ctx.dealDamageToOpponent(dmg);
            ctx.log(`ULT: Divine Judgement ${heal} iyileştirdi, ${dmg} hasar verdi!`, "log-heal");
        }
    }
};
let selectedClass = null;

// The single-player implementation of the combat context described above.
function makeSinglePlayerCombatContext() {
    return {
        dealDamageToOpponent(amount) { inflictDamage('enemy', amount); },
        dealDirectDamageToOpponent(amount) {
            if (enemyHP > 0) {
                enemyHP -= amount;
                showFloatingText(`-${amount}`, document.getElementById('enemy-hp-bar'), "#e74c3c");
                gridDisplay.classList.remove('shake');
                void gridDisplay.offsetWidth;
                gridDisplay.classList.add('shake');
            }
        },
        dealDirectDamageToSelf(amount) { playerHP -= amount; },
        healSelf(amount) { playerHP = Math.min(playerHP + amount, maxPlayerHP); },
        getSelfArmor() { return playerArmor; },
        grantExtraTurn() { extraTurnTriggered = true; },
        log(msg, cls) { log(msg, cls); }
    };
}

let playerHP = 100, maxPlayerHP = 100, playerArmor = 0, ultCharge = 0;
let level = 1, enemyHP = 50, maxEnemyHP = 50, enemyArmor = 0;
let logCounter = 1;

let isProcessing = false;
let isPlayerTurn = true;
let extraTurnTriggered = false;
let isMouseDown = false;
let selectedTile = null;
let touchMoveScheduled = false;

// Without these, isMouseDown never resets after an invalid tap/drag,
// which permanently disabled the "reselect on invalid move" behavior.
document.addEventListener('mouseup', () => { isMouseDown = false; });
document.addEventListener('touchend', () => { isMouseDown = false; });

const tileTypes = [
    { type: 'sword', symbol: '⚔️' },
    { type: 'heart', symbol: '💖' },
    { type: 'shield', symbol: '🛡️' },
    { type: 'energy', symbol: '⚡' },
    { type: 'skull', symbol: '💀' }
];

// --- GAME FLOW ---

function renderClassButtons() {
    const container = document.getElementById('class-selection');
    container.innerHTML = '';
    container.style.display = 'flex';
    overlayBtn.style.display = 'none';

    Object.keys(CLASSES).forEach(key => {
        const c = CLASSES[key];
        const btn = document.createElement('button');
        btn.className = 'reward-btn rarity-rare';
        btn.innerHTML = `<b>${c.emoji} ${c.name}</b><small>${c.desc}</small>`;
        btn.onclick = () => {
            selectedClass = c;
            if (typeof trackEvent === 'function') trackEvent('class_selected', { class: key });
            // getElementById, not querySelector('.stat-box div:first-child') -
            // pvp-modal/coop-modal have their own .stat-box elements earlier in
            // the DOM than the solo HUD, so the class selector was silently
            // writing the class name into a hidden modal instead of the
            // visible "YOU" label (the same class of bug as gridDisplay above).
            const playerBox = document.getElementById('player-class-label');
            playerBox.style.color = 'var(--accent)';
            playerBox.innerHTML = `${c.emoji} ${c.name.toUpperCase()}`;
            // Picking a class is also PvP/co-op's own "start of run" moment
            // (they never call resetGame() - that's solo's own start path),
            // so this needs the exact same clean-slate rebuild.
            rebuildTileStats();
            document.getElementById('ult-btn').innerText = `USE ${c.ultName} (100%)`;
            updateUI();
            container.style.display = 'none';
            renderModeButtons();
        };
        container.appendChild(btn);
    });
}

// Shown right after a class is picked, before anything actually starts -
// class selection used to fall straight into solo's "READY, X? / START
// BATTLE" prompt, so the only way to reach co-op/PvP was to ignore that
// prompt and dig for the top-bar buttons instead. Now class pick always
// leads here, and this is the one place that decides which mode begins.
function renderModeButtons() {
    const container = document.getElementById('mode-selection');
    container.innerHTML = '';
    container.style.display = 'flex';
    overlayTitle.innerText = 'NASIL OYNAMAK İSTİYORSUN?';

    const modes = [
        { emoji: '⚔️', label: 'Solo', desc: 'Tek başına canavar dalgalarına karşı savaş.', action: () => { container.style.display = 'none'; resetGame(); startLevel(); } },
        { emoji: '🤝', label: 'Co-op', desc: 'Bir arkadaşınla aynı zindanda, paylaşımlı tahtada savaş.', action: () => { overlay.classList.remove('visible'); toggleModal('coop-modal'); } },
        { emoji: '🗡️', label: 'PvP', desc: 'Gerçek zamanlı 1v1 düello.', action: () => { overlay.classList.remove('visible'); toggleModal('pvp-modal'); } }
    ];
    modes.forEach(m => {
        const btn = document.createElement('button');
        btn.className = 'reward-btn rarity-rare';
        btn.innerHTML = `<b>${m.emoji} ${m.label}</b><small>${m.desc}</small>`;
        btn.onclick = () => {
            if (typeof trackEvent === 'function') trackEvent('mode_selected', { mode: m.label.toLowerCase(), class: selectedClass ? selectedClass.name : null });
            m.action();
        };
        container.appendChild(btn);
    });
}

function handleOverlayClick() {
    if (currentState === STATE.START || currentState === STATE.GAMEOVER) {
        if (!selectedClass) {
            renderClassButtons();
            overlayTitle.innerText = "KAHRAMANINI SEÇ";
            return;
        }
        resetGame();
        startLevel();
    }
}

function resetGame() {
    playerHP = 100; maxPlayerHP = 100; playerArmor = 0; ultCharge = 0;
    level = 1; logCounter = 1;
    rebuildTileStats();
    ENEMY_TILE_STATS = getEnemyStatsForLevel(1, false);

    // Reset History
    pickedRewards = [];
    totalStatsGained = {
        sword: 0, shield: 0, heart: 0, energy: 0,
        skull_dmg: 0, skull_self_dmg: 0, ult_dmg: 0, lifeSteal: 0, maxHP: 0
    };

    isProcessing = false;
    extraTurnTriggered = false;
    gridDisplay.classList.remove('shake');
    enemySprite.classList.remove('dying');
    log("Oyun sıfırlandı.", "log-turn");
}

function startLevel() {
    currentState = STATE.PLAYING;
    overlay.classList.remove('visible');
    rewardArea.style.display = 'none';
    gridDisplay.classList.remove('locked');

    enemySprite.classList.remove('dying');
    enemySprite.classList.add('enemy-display');

    maxEnemyHP = 50 + ((level - 1) * 20);
    enemyHP = maxEnemyHP;

    let isBoss = (level % 5 === 0);
    currentMinionType = minionTypeForLevel(level);
    swiftBonusUsed = false;
    bossEnraged = false;
    enemySprite.classList.remove('enraged');
    enemyArmor = currentMinionType === 'armored' ? Math.round(maxEnemyHP * MINION_ARMORED_PCT) : 0;

    let name = isBoss ? `BOSS Sv. ${level}` : `Canavar Sv. ${level}`;
    document.getElementById('enemy-name').innerText = name;
    document.getElementById('enemy-sprite').innerText = MINION_ICON[currentMinionType] || (isBoss ? '👹' : ['👾','👺','👻','🤖'][level % 4]);
    ENEMY_TILE_STATS = getEnemyStatsForLevel(level, isBoss);

    if (isBoss) log("UYARI: BOSS SAVAŞI!", "log-crit");
    else if (MINION_LOG[currentMinionType]) log(MINION_LOG[currentMinionType], "log-enemy");

    turnBanner.innerText = "OYUNCU SIRASI";
    turnBanner.className = "turn-indicator turn-player";
    isPlayerTurn = true;
    isProcessing = false;
    extraTurnTriggered = false;

    createBoard();
    updateUI();
    startPlayerTimer();
    log(`SEVİYE ${level} BAŞLADI`, "log-turn");
}

function checkWinCondition() {
    if (currentState !== STATE.PLAYING) return;
    if (playerHP <= 0) triggerDeathSequence('player');
    else if (enemyHP <= 0) triggerDeathSequence('enemy');
}

function triggerDeathSequence(who) {
    currentState = STATE.GAMEOVER;
    isProcessing = true;
    stopPlayerTimer();
    if (who === 'enemy') {
        enemySprite.classList.remove('enemy-display');
        enemySprite.classList.add('dying');
        log("DÜŞMAN YENİLDİ!", "log-crit");
        gridDisplay.classList.add('shake');
        if (typeof playSound === 'function') playSound('victory');
        setTimeout(() => { gridDisplay.classList.remove('shake'); winLevel(); }, 1500);
    } else {
        gridDisplay.classList.add('shake');
        if (typeof playSound === 'function') playSound('defeat');
        setTimeout(() => { gridDisplay.classList.remove('shake'); gameOver(); }, 1500);
    }
}

// Every kill pays out - a boss pays more, and both scale gently with level
// so late-run kills aren't worth the same as level 1's. Not tied to reward
// tier/HP performance (unlike item picks) - gold is just "you fought,
// here's pay," always earned regardless of how clean the win was.
// currentPrestigeLevel (economy.js) - a permanent +5%/level bonus from
// prestige_reset (supabase/schema.sql). Applied here so both solo
// (winLevel) and co-op (coopOnEnemyDefeated) benefit from a single call
// site - PvP's small fixed loyalty-bonus payout deliberately does NOT
// scale with this, that's a flat consolation amount, not a kill reward.
function goldRewardForKill(lvl, isBoss) {
    let base = isBoss ? (20 + lvl * 4) : (8 + lvl * 2);
    let prestigeMult = 1 + (typeof currentPrestigeLevel !== 'undefined' ? currentPrestigeLevel : 0) * 0.05;
    return Math.round(base * prestigeMult);
}

function winLevel() {
    if (currentState === STATE.REWARD) return;
    currentState = STATE.REWARD;
    if (typeof awardLootDrop === 'function') awardLootDrop();
    if (level % 5 === 0 && typeof claimDailyQuest === 'function') claimDailyQuest('kill_boss');

    let goldReward = goldRewardForKill(level, level % 5 === 0);
    if (typeof adjustWallet === 'function') {
        adjustWallet(goldReward, 0).then(result => {
            if (!result) return;
            log(`+${goldReward} 🪙 kazandın!`, 'log-hit');
            if (typeof playSound === 'function') playSound('gold');
        });
    }

    // Calculate Reward Picks
    // NOTE: order matters here - the <=0.01 case must be checked before
    // <=0.10, otherwise it is unreachable (0.01 also satisfies <=0.10).
    let hpPercent = (playerHP / maxPlayerHP);
    if (hpPercent <= 0.01) { rewardPicksLeft = 5; log("MUCİZE! 5 Ödül Seç!", "log-crit"); }
    else if (hpPercent <= 0.10) { rewardPicksLeft = 3; log("ÇARESİZ ZAFER! 3 Ödül Seç!", "log-match"); }
    else if (hpPercent >= 1.0) { rewardPicksLeft = 3; log("KUSURSUZ ZAFER! 3 Ödül Seç!", "log-hit"); unlockAchievement('flawless_victory'); }
    else if (hpPercent >= 0.75) { rewardPicksLeft = 2; log("İYİ ZAFER! 2 Ödül Seç!", "log-match"); }
    else { rewardPicksLeft = 1; log("Seviye Tamamlandı! 1 Ödül Seç.", "log-hit"); }

    if (level % 5 === 0) unlockAchievement('boss_slayer');

    // Boss Bonus: an extra pick for clearing a boss level (Lvl 5, 10...)
    if (level % 5 === 0) {
        rewardPicksLeft += 1;
        log("BOSS BONUSU! +1 Ödül!", "log-crit");
    }

    generateRewards();
    updateRewardTitle();
    overlayBtn.style.display = 'none';
    rewardArea.style.display = 'flex';
    overlay.classList.add('visible');
}

function updateRewardTitle() {
    if (rewardPicksLeft > 0) {
        overlayTitle.innerText = `VICTORY! PICK ${rewardPicksLeft}`;
        return;
    }
    rewardArea.style.display = 'none';
    // Every other level auto-continues (you're still mid-dungeon, no safe
    // moment to shop) - a boss kill is the one checkpoint where continuing
    // is a real choice, since it's also the only point where leaving to
    // spend gold/equip loot actually makes sense (see showBossCheckpoint).
    if (level % 5 === 0) {
        showBossCheckpoint();
        return;
    }
    overlayTitle.innerText = `SEVİYE ${level + 1} İÇİN HAZIR MISIN?`;
    overlayBtn.innerText = "SONRAKİ SEVİYE";
    overlayBtn.style.display = 'block';
    overlayBtn.onclick = () => {
        let missingHP = maxPlayerHP - playerHP;
        let healed = Math.ceil(missingHP * LEVEL_CLEAR_HEAL_PERCENT);
        if (healed > 0) {
            playerHP = Math.min(playerHP + healed, maxPlayerHP);
            log(`Savaş öncesi dinlenme: +${healed} Can`, 'log-heal');
        }
        level++;
        startLevel();
    };
}

// The one in-dungeon checkpoint: after every boss kill, offer a real choice
// instead of silently auto-continuing. Shop/inventory access is blocked
// everywhere else during a run (see toggleModal's shop-modal guard) - this
// is deliberately the only door back out to spend gold and equip loot
// before the level scaling gets ahead of you.
function showBossCheckpoint() {
    let container = document.getElementById('boss-checkpoint');
    container.innerHTML = '';
    container.style.display = 'flex';
    overlayTitle.innerText = 'BOSS DÜŞTÜ! NE YAPMAK İSTERSİN?';
    overlayBtn.style.display = 'none';

    let continueBtn = document.createElement('button');
    continueBtn.className = 'reward-btn rarity-rare';
    continueBtn.innerHTML = `<b>⚔️ Zindana Devam Et</b><small>Bir sonraki seviyeye geç.</small>`;
    continueBtn.onclick = () => {
        if (typeof trackEvent === 'function') trackEvent('boss_checkpoint_choice', { choice: 'continue', level });
        container.style.display = 'none';
        let missingHP = maxPlayerHP - playerHP;
        let healed = Math.ceil(missingHP * LEVEL_CLEAR_HEAL_PERCENT);
        if (healed > 0) {
            playerHP = Math.min(playerHP + healed, maxPlayerHP);
            log(`Savaş öncesi dinlenme: +${healed} Can`, 'log-heal');
        }
        level++;
        startLevel();
    };
    container.appendChild(continueBtn);

    let returnBtn = document.createElement('button');
    returnBtn.className = 'reward-btn rarity-epic';
    returnBtn.innerHTML = `<b>🏠 Ana Menüye Dön</b><small>Zindandan çık - altının ve eşyaların dükkanda seni bekliyor.</small>`;
    returnBtn.onclick = () => {
        if (typeof trackEvent === 'function') trackEvent('boss_checkpoint_choice', { choice: 'menu', level });
        returnToMainMenu();
    };
    container.appendChild(returnBtn);
}

function returnToMainMenu() {
    document.getElementById('boss-checkpoint').style.display = 'none';
    currentState = STATE.START;
    overlay.classList.add('visible');
    renderModeButtons(); // selectedClass is already set - straight to Solo/Co-op/PvP
    log('Zindandan ayrıldın. Kazandıkların dükkanda seni bekliyor.', 'log-turn');
}

// Turkish label for each REWARD_POOL tier key - used anywhere a tier is
// shown to the player (the raw key was leaking into the UI as literal
// English text, e.g. "(legendary)", in both solo's and co-op's reward-pick
// buttons).
const REWARD_TIER_LABELS = { common: 'Sıradan', uncommon: 'Az Bulunur', rare: 'Nadir', epic: 'Epik', legendary: 'Efsanevi' };

// Shared by solo's between-level reward screen (generateRewards, 3 picks at
// once) and co-op's smaller per-player version (coopShowRewardPick, one at
// a time) - one pool, one tier-weighting rule, instead of two copies that
// could quietly drift apart.
const REWARD_POOL = [
    // === COMMON (40%) - 1 Stat ===
        { tier: 'common', name: 'Bileği Taşı', desc: 'Kılıç +1', fn: () => TILE_STATS.sword += 1 },
        { tier: 'common', name: 'Deri Yama', desc: 'Kalkan +1', fn: () => TILE_STATS.shield += 1 },
        { tier: 'common', name: 'Şifalı Bitki Karışımı', desc: 'İyileşme +1', fn: () => TILE_STATS.heart += 1 },
        { tier: 'common', name: 'Meditasyon', desc: 'Enerji +1', fn: () => TILE_STATS.energy += 1 },
        { tier: 'common', name: 'Kemik Parçası', desc: 'Kafatası Hsr +6 / Öz Hsr +3', fn: () => { TILE_STATS.skull_dmg += 6; TILE_STATS.skull_self_dmg += 3; } },
        { tier: 'common', name: 'Küçük Şarj', desc: 'Ult Hasarı +10', fn: () => TILE_STATS.ult_dmg += 10 },
        { tier: 'common', name: 'Sülük Tohumu', desc: 'Can Çalma +%1', fn: () => TILE_STATS.lifeSteal += 1 },

        // === UNCOMMON (30%) - 1 Stat (Stronger) ===
        { tier: 'uncommon', name: 'Çelik Kılıç', desc: 'Kılıç +2', fn: () => TILE_STATS.sword += 2 },
        { tier: 'uncommon', name: 'Demir Levha', desc: 'Kalkan +2', fn: () => TILE_STATS.shield += 2 },
        { tier: 'uncommon', name: 'İksir', desc: 'İyileşme +2', fn: () => TILE_STATS.heart += 2 },
        { tier: 'uncommon', name: 'Odaklanma', desc: 'Enerji +2', fn: () => TILE_STATS.energy += 2 },
        { tier: 'uncommon', name: 'Kafatası Put', desc: 'Kafatası +10 / Öz Hsr +5', fn: () => { TILE_STATS.skull_dmg += 10; TILE_STATS.skull_self_dmg += 5; } },
        { tier: 'uncommon', name: 'Mana Kristali', desc: 'Ult Hasarı +20', fn: () => TILE_STATS.ult_dmg += 20 },
        { tier: 'uncommon', name: 'Yarasa Kanadı', desc: 'Can Çalma +%2', fn: () => TILE_STATS.lifeSteal += 2 },

        // === RARE (15%) - 1 Stat (Big) ===
        { tier: 'rare', name: 'Elmas Bıçak', desc: 'Kılıç +3', fn: () => TILE_STATS.sword += 3 },
        { tier: 'rare', name: 'Kule Kalkanı', desc: 'Kalkan +3', fn: () => TILE_STATS.shield += 3 },
        { tier: 'rare', name: 'İksir Özü', desc: 'İyileşme +3', fn: () => TILE_STATS.heart += 3 },
        { tier: 'rare', name: 'Derin Odaklanma', desc: 'Enerji +3', fn: () => TILE_STATS.energy += 3 },
        { tier: 'rare', name: 'Lanetli Kafatası', desc: 'Kafatası +14 / Öz Hsr +7', fn: () => { TILE_STATS.skull_dmg += 14; TILE_STATS.skull_self_dmg += 7; } },
        { tier: 'rare', name: 'Büyü Kitabı', desc: 'Ult Hasarı +35', fn: () => TILE_STATS.ult_dmg += 35 },
        { tier: 'rare', name: 'Vampir Dişi', desc: 'Can Çalma +%3', fn: () => TILE_STATS.lifeSteal += 3 },

        // === EPIC (10%) - 2 Stats (Enriched Pool) ===
        { tier: 'epic', name: 'Paladin Takımı', desc: 'Kılıç +3 & Kalkan +3', fn: () => { TILE_STATS.sword += 3; TILE_STATS.shield += 3; } },
        { tier: 'epic', name: 'Kan Büyücüsü', desc: 'Ult +30 & Çalma +%3', fn: () => { TILE_STATS.ult_dmg += 30; TILE_STATS.lifeSteal += 3; } },
        { tier: 'epic', name: 'Berserker Ruhu', desc: 'Kafatası Hsr +20 (Öz Hsr +10) & Kılıç +4', fn: () => { TILE_STATS.skull_dmg += 20; TILE_STATS.skull_self_dmg += 10; TILE_STATS.sword += 4; } },
        { tier: 'epic', name: 'Keşiş Yemini', desc: 'İyileşme +4 & Enerji +4', fn: () => { TILE_STATS.heart += 4; TILE_STATS.energy += 4; } },
        { tier: 'epic', name: 'Taş Deri', desc: 'Kalkan +4 & Can +30', fn: () => { TILE_STATS.shield += 4; maxPlayerHP += 30; playerHP += 30; } },
        { tier: 'epic', name: 'Kızıl Kenar', desc: 'Kılıç +4 & Çalma +%3', fn: () => { TILE_STATS.sword += 4; TILE_STATS.lifeSteal += 3; } },
        { tier: 'epic', name: 'Fırtına Çağırıcı', desc: 'Enerji +4 & Ult +25', fn: () => { TILE_STATS.energy += 4; TILE_STATS.ult_dmg += 25; } },
        { tier: 'epic', name: 'Demir Yürek', desc: 'Kalkan +4 & İyileşme +4', fn: () => { TILE_STATS.shield += 4; TILE_STATS.heart += 4; } },
        { tier: 'epic', name: 'Nekromansi', desc: 'Kafatası Hsr +24 (Öz Hsr +12) & Çalma +%3', fn: () => { TILE_STATS.skull_dmg += 24; TILE_STATS.skull_self_dmg += 12; TILE_STATS.lifeSteal += 3; } },
        { tier: 'epic', name: 'Gladyatör', desc: 'Kılıç +4 & Enerji +3', fn: () => { TILE_STATS.sword += 4; TILE_STATS.energy += 3; } },
        { tier: 'epic', name: 'Dev Gücü', desc: 'Maks Can +40 & Kılıç +3', fn: () => { maxPlayerHP += 40; playerHP += 40; TILE_STATS.sword += 3; } },

        // === LEGENDARY (5%) - 3 Stats ===
        { tier: 'legendary', name: 'Tanrı Katili', desc: 'Kılıç +5, Ult +40, Enerji +3', fn: () => { TILE_STATS.sword += 5; TILE_STATS.ult_dmg += 40; TILE_STATS.energy += 3; } },
        { tier: 'legendary', name: 'Ölümsüzlük', desc: 'Kalkan +5, İyileşme +5, Maks Can +50', fn: () => { TILE_STATS.shield += 5; TILE_STATS.heart += 5; maxPlayerHP+=50; playerHP+=50; } },
        { tier: 'legendary', name: 'İblis Lordu', desc: 'Kafatası Hsr +30 (Öz Hsr +15), Çalma +%5, Kılıç +4', fn: () => { TILE_STATS.skull_dmg += 30; TILE_STATS.skull_self_dmg += 15; TILE_STATS.lifeSteal += 5; TILE_STATS.sword += 4; } },
        { tier: 'legendary', name: 'Baş Büyücü', desc: 'Enerji +5, Ult +30, Kalkan +4', fn: () => { TILE_STATS.energy += 5; TILE_STATS.ult_dmg += 30; TILE_STATS.shield += 4; } },
        { tier: 'legendary', name: 'Üçleme', desc: 'Kılıç +3, Kalkan +3, İyileşme +3', fn: () => { TILE_STATS.sword += 3; TILE_STATS.shield += 3; TILE_STATS.heart += 3; } },
        { tier: 'legendary', name: 'Titan Kanı', desc: 'Maks Can +40, İyileşme +4, Kılıç +3', fn: () => { maxPlayerHP += 40; playerHP += 40; TILE_STATS.heart += 4; TILE_STATS.sword += 3; } },
        { tier: 'legendary', name: 'Vampir Kral', desc: 'Can Çalma +%4, Kafatası Hsr +20 (Öz Hsr +10), Enerji +3', fn: () => { TILE_STATS.lifeSteal += 4; TILE_STATS.skull_dmg += 20; TILE_STATS.skull_self_dmg += 10; TILE_STATS.energy += 3; } },
    { tier: 'legendary', name: 'Ezici Güç', desc: 'Maks Can +60, Kalkan +4, Kılıç +2', fn: () => { maxPlayerHP += 60; playerHP += 60; TILE_STATS.shield += 4; TILE_STATS.sword += 2; } }
];

function rollOneReward() {
    let rand = Math.random();
    let chosenTier = 'common';

    if (rand < 0.05) chosenTier = 'legendary';
    else if (rand < 0.15) chosenTier = 'epic';
    else if (rand < 0.30) chosenTier = 'rare';
    else if (rand < 0.60) chosenTier = 'uncommon';

    let pool = REWARD_POOL.filter(r => r.tier === chosenTier);
    if (pool.length === 0) pool = REWARD_POOL.filter(r => r.tier === 'common');
    return pool[Math.floor(Math.random() * pool.length)];
}

// Applies one reward's stat bonus and records it in solo's Loot History -
// shared by solo's own reward buttons and (for the TILE_STATS/history side
// of it - co-op keeps its own separate log line) coop.js's per-player picks.
function applyReward(reward) {
    let prevStats = { ...TILE_STATS, maxHP: maxPlayerHP };
    reward.fn();
    let newStats = { ...TILE_STATS, maxHP: maxPlayerHP };

    let diff = {};
    for (let key in newStats) {
        let d = newStats[key] - prevStats[key];
        if (d !== 0) diff[key] = d;
    }

    pickedRewards.push({ name: reward.name, tier: reward.tier, desc: reward.desc, diff: diff });
    for (let key in diff) totalStatsGained[key] = (totalStatsGained[key] || 0) + diff[key];
}

function generateRewards() {
    rewardArea.innerHTML = '';

    for (let i = 0; i < 3; i++) {
        let reward = rollOneReward();

        let btn = document.createElement('button');
        btn.className = `reward-btn rarity-${reward.tier}`;
        btn.innerHTML = `<b>${reward.name} <span style="font-size:0.7em; text-transform:uppercase; opacity:0.8;">(${REWARD_TIER_LABELS[reward.tier]})</span></b><small>${reward.desc}</small>`;
        btn.onclick = () => {
            applyReward(reward);
            log(`Seçildi: ${reward.name}`, "log-heal");
            rewardPicksLeft--;

            updateUI();

            if (rewardPicksLeft > 0) {
                generateRewards();
                updateRewardTitle();
            } else {
                btn.style.display = 'none';
                updateRewardTitle();
            }
        };
        rewardArea.appendChild(btn);
    }
}

function gameOver() {
    if (typeof resetActiveAchievements === 'function') resetActiveAchievements();
    if (typeof trackEvent === 'function') trackEvent('solo_run_ended', { level, class: selectedClass ? selectedClass.name : null });
    currentState = STATE.GAMEOVER;
    overlayTitle.innerText = "OYUN BİTTİ";
    overlayBtn.innerText = "TEKRAR DENE";
    overlayBtn.style.display = 'block';
    overlayBtn.onclick = handleOverlayClick;
    rewardArea.style.display = 'none';
    overlay.classList.add('visible');
    selectedClass = null;
}

// --- GAME LOGIC ---
function createBoard() {
    gridDisplay.innerHTML = '';
    gridDisplay.appendChild(aiCursor);
    gridDisplay.appendChild(overlay);
    tiles.length = 0;
    for (let i = 0; i < width * width; i++) {
        const tile = document.createElement('div');
        tile.setAttribute('id', i);
        let randomType = Math.floor(Math.random() * tileTypes.length);
        tile.dataset.type = tileTypes[randomType].type;
        tile.innerHTML = tileTypes[randomType].symbol;
        tile.classList.add('tile');
        gridDisplay.appendChild(tile);
        tiles.push(tile);

        tile.addEventListener('mousedown', (e) => { e.preventDefault(); handleInputStart(tile); });
        tile.addEventListener('touchstart', (e) => { e.preventDefault(); handleInputStart(tile); }, {passive: false});
        tile.addEventListener('mouseenter', (e) => { e.preventDefault(); handleInputEnter(tile); });
        tile.addEventListener('touchmove', (e) => {
            e.preventDefault();
            // touchmove can fire much faster than the screen can redraw,
            // especially while it's also busy animating the board. Doing a
            // fresh elementFromPoint() hit-test and swap check on every
            // single one of those events adds up on a slower device -
            // coalesce to at most once per animation frame instead.
            if (touchMoveScheduled) return;
            touchMoveScheduled = true;
            let t = e.touches[0];
            requestAnimationFrame(() => {
                touchMoveScheduled = false;
                let target = document.elementFromPoint(t.clientX, t.clientY);
                if (target && target.classList.contains('tile')) handleInputEnter(target);
            });
        }, {passive: false});
    }
    resolveMatches(true);
    updateUI();
}

function handleInputStart(tile) {
    if (currentState !== STATE.PLAYING || isProcessing || !isPlayerTurn) return;
    isMouseDown = true;
    if (!selectedTile) {
        selectedTile = tile;
        tile.classList.add('selected');
    } else {
        if (tile !== selectedTile) checkAndSwap(selectedTile, tile, true);
        else {
            selectedTile.classList.remove('selected');
            selectedTile = null;
        }
    }
}

function handleInputEnter(tile) {
    if (!isMouseDown || !selectedTile || isProcessing) return;
    if (tile !== selectedTile) checkAndSwap(selectedTile, tile, false);
}

// allowReselect: only a fresh tap/click (handleInputStart) may jump the
// selection to the tapped tile when the move is invalid; a drag passing
// over a non-adjacent tile (handleInputEnter) should be ignored instead.
function checkAndSwap(tile1, tile2, allowReselect) {
    let id1 = parseInt(tile1.id), id2 = parseInt(tile2.id);
    let r1 = Math.floor(id1 / width), c1 = id1 % width;
    let r2 = Math.floor(id2 / width), c2 = id2 % width;
    let isAdjacent = (r1 === r2 && Math.abs(c1 - c2) === 1) || (c1 === c2 && Math.abs(r1 - r2) === 1);

    if (isAdjacent) {
        attemptSwap(tile1, tile2);
        tile1.classList.remove('selected');
        selectedTile = null;
        isMouseDown = false;
    } else if (allowReselect) {
        tile1.classList.remove('selected');
        selectedTile = tile2;
        tile2.classList.add('selected');
    }
}

function attemptSwap(tile1, tile2) {
    // Lock in the speed bonus for this move (player only) before anything
    // else happens - the countdown is about how fast the decision was made.
    if (isPlayerTurn) {
        currentMoveTimeMultiplier = getTimeMultiplier();
        stopPlayerTimer();
    }

    isProcessing = true;
    let tempType = tile1.dataset.type; let tempHTML = tile1.innerHTML;
    tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
    tile2.dataset.type = tempType; tile2.innerHTML = tempHTML;

    let hasMatch = checkForMatches(false);
    if (!hasMatch) {
        setTimeout(() => {
            let tempType = tile1.dataset.type; let tempHTML = tile1.innerHTML;
            tile1.dataset.type = tile2.dataset.type; tile1.innerHTML = tile2.innerHTML;
            tile2.dataset.type = tempType; tile2.innerHTML = tempHTML;
            isProcessing = false;
            // Invalid swap didn't cost the turn, so give the player a
            // fresh speed-bonus window for their next attempt.
            if (isPlayerTurn) startPlayerTimer();
        }, 200);
    }
}

function resolveMatches(isInitial) {
    checkForMatches(isInitial);
    extraTurnTriggered = false;
}

// --- NEW MERGE LOGIC ---
function mergeIntersectingMatches(hRuns, vRuns) {
    let allMatches = [];
    let processedV = new Set();

    // 1. Try to merge every Horizontal run with any intersecting Vertical run
    hRuns.forEach(hGroup => {
        let merged = false;
        for (let i = 0; i < vRuns.length; i++) {
            let vGroup = vRuns[i];

            // Check if Same Type AND they share a tile (Intersection)
            if (hGroup.type === vGroup.type && hGroup.indices.some(idx => vGroup.indices.includes(idx))) {
                // Merge indices ensuring no duplicates
                let uniqueIndices = [...new Set([...hGroup.indices, ...vGroup.indices])];

                allMatches.push({
                    indices: uniqueIndices,
                    type: hGroup.type,
                    subShape: 'cross' // Mark as special shape
                });

                processedV.add(i); // Mark vertical as used
                merged = true;
                break;
            }
        }
        // If not merged, keep as standard line
        if (!merged) allMatches.push({...hGroup, subShape: 'line'});
    });

    // 2. Add remaining Vertical runs
    vRuns.forEach((vGroup, i) => {
        if (!processedV.has(i)) allMatches.push({...vGroup, subShape: 'line'});
    });

    return allMatches;
}

// --- SHARED CORE LOGIC ---
// findMatchGroups and getMatchShapeInfo are pure (no game-state globals) so
// PvP mode (pvp.js) can call the exact same match-detection and multiplier
// rules on its own separate board, instead of maintaining a second,
// inevitably-diverging copy of these rules.

// Scans a tile-element array (anything with .dataset.type, any width x width
// board) for horizontal/vertical runs of 3+ and merges any that intersect
// into cross (L/T) shapes. Returns the final list of match groups.
// Shared by every mode (solo, PvP, co-op) - true if ANY adjacent swap on
// this board would produce a match. Checked after every settle (initial
// deal, every refill) so a "stuck" board with no possible move never
// leaves a player unable to act - see reshuffleBoard below for what
// happens when this comes back false. Only ever touches dataset.type
// (never innerHTML), so the temporary swap-and-revert below never causes
// a visible flicker - nothing repaints mid-synchronous-execution.
function boardHasValidMove(tileArray, w) {
    for (let i = 0; i < tileArray.length; i++) {
        let r = Math.floor(i / w), c = i % w;
        let neighbors = [];
        if (c < w - 1) neighbors.push(i + 1);
        if (r < w - 1) neighbors.push(i + w);
        for (let j of neighbors) {
            let t1 = tileArray[i].dataset.type, t2 = tileArray[j].dataset.type;
            tileArray[i].dataset.type = t2; tileArray[j].dataset.type = t1;
            let hasMatch = findMatchGroups(tileArray, w).length > 0;
            tileArray[i].dataset.type = t1; tileArray[j].dataset.type = t2;
            if (hasMatch) return true;
        }
    }
    return false;
}

// Re-randomizes every tile until the result has at least one valid move.
// `pool` defaults to the base tileTypes - co-op passes COOP_TILE_TYPES so a
// reshuffle can still deal its teamheal tile. Doesn't bother rejecting a
// reshuffle that happens to ALSO land some free matches on it - insisting on
// zero matches turned out to need many hundreds of random tries to satisfy
// on a 64-cell board with this few tile types (confirmed while testing:
// even 50 tries reliably wasn't enough), while "at least one valid move"
// is satisfied almost immediately. Any matches the reshuffle happens to
// create just get resolved by the normal match-check pipeline right after
// this returns - the exact same way createBoard()'s own initial random
// fill already lets checkForMatches(true) clean up whatever it landed on,
// instead of trying to avoid matches during generation.
function reshuffleBoard(tileArray, w, pool) {
    pool = pool || tileTypes;
    let attempts = 0;
    do {
        tileArray.forEach(tile => {
            let t = pool[Math.floor(Math.random() * pool.length)];
            tile.dataset.type = t.type;
            tile.innerHTML = t.symbol;
        });
        attempts++;
    } while (!boardHasValidMove(tileArray, w) && attempts < 200);
}

function findMatchGroups(tileArray, w) {
    let hRuns = [], vRuns = [];

    for (let r = 0; r < w; r++) {
        let count = 1;
        for (let c = 0; c < w; c++) {
            let i = r * w + c;
            if (c < w - 1 && tileArray[i].dataset.type !== '' && tileArray[i].dataset.type === tileArray[i + 1].dataset.type) {
                count++;
            } else {
                if (count >= 3) {
                    let indices = [];
                    for (let k = 0; k < count; k++) indices.push(i - k);
                    hRuns.push({ indices: indices, type: tileArray[i].dataset.type });
                }
                count = 1;
            }
        }
    }
    for (let c = 0; c < w; c++) {
        let count = 1;
        for (let r = 0; r < w; r++) {
            let i = r * w + c;
            if (r < w - 1 && tileArray[i].dataset.type !== '' && tileArray[i].dataset.type === tileArray[i + w].dataset.type) {
                count++;
            } else {
                if (count >= 3) {
                    let indices = [];
                    for (let k = 0; k < count; k++) indices.push(i - (k * w));
                    vRuns.push({ indices: indices, type: tileArray[i].dataset.type });
                }
                count = 1;
            }
        }
    }

    return mergeIntersectingMatches(hRuns, vRuns);
}

// Given a match's tile count and whether it's a merged cross shape, returns
// the shape label, effect multiplier, whether it grants an extra turn, and
// how much ult charge it grants (before the isPlayerTurn/speed-bonus scaling
// that callers apply on top). Priority order matters: a >=7 or ===6 run
// always outranks a same-sized cross, checked in this exact order.
function getMatchShapeInfo(count, isCross) {
    if (count >= 7) return { shapeLabel: '7!!', multiplier: 4, extraTurn: true, ultBonus: 90 };
    if (count === 6) return { shapeLabel: '6!', multiplier: 3.5, extraTurn: true, ultBonus: 60 };
    if (count === 5 && !isCross) return { shapeLabel: '5', multiplier: 3, extraTurn: true, ultBonus: 30 };
    if (isCross) return { shapeLabel: 'CROSS', multiplier: 2.5, extraTurn: true, ultBonus: 0 };
    if (count === 4) return { shapeLabel: '4', multiplier: 2, extraTurn: true, ultBonus: 0 };
    return { shapeLabel: '3', multiplier: 1, extraTurn: false, ultBonus: 0 };
}

function checkForMatches(isInitial) {
    if (!isInitial && currentState !== STATE.PLAYING) return false;
    let finalGroups = findMatchGroups(tiles, width);

    if (finalGroups.length > 0) {
        finalGroups.forEach(group => processMatch(group, isInitial));
        if (currentState === STATE.PLAYING || isInitial) {
            setTimeout(() => fillBoard(isInitial), 400);
        }
        return true;
    } else {
        if (!isInitial) isProcessing = false;
        return false;
    }
}

function processMatch(group, isInitial) {
    if (currentState !== STATE.PLAYING && !isInitial) return;

    let count = group.indices.length;
    let isCross = (group.subShape === 'cross');
    let { shapeLabel, multiplier, extraTurn, ultBonus } = getMatchShapeInfo(count, isCross);

    if (extraTurn) extraTurnTriggered = true;
    if (ultBonus > 0 && isPlayerTurn) ultCharge += ultBonus;

    // Speed Bonus: the player's own moves (and any chain reaction they
    // trigger) are further scaled by how fast the swap was made.
    let finalMultiplier = isPlayerTurn ? multiplier * currentMoveTimeMultiplier : multiplier;

    if (!isInitial && typeof playSound === 'function') playSound(count >= 4 ? 'match_big' : 'match');

    // --- VISUALS & LOGS ---
    if (!isInitial && finalMultiplier > 1) { // Only log if it's special
        let user = isPlayerTurn ? "Oyuncu" : "Düşman";
        let displayMult = Math.round(finalMultiplier * 10) / 10;

        log(`${user}: ${shapeLabel} Eşleşme! (x${displayMult})`, "log-match");

        let centerTile = tiles[group.indices[1]];
        let color = (finalMultiplier >= 3) ? "#f1c40f" : "#e74c3c";
        showFloatingText(`${shapeLabel}x${displayMult}`, centerTile, color);
    }

    let validTiles = 0;
    group.indices.forEach(index => {
        if (tiles[index].dataset.type !== '') {
            if (!isInitial) tiles[index].classList.add('matched');
            else tiles[index].innerHTML = '';
            tiles[index].dataset.type = '';
            validTiles++;
        }
    });

    if (validTiles > 0 && !isInitial) {
        applyRPGEffects(group.type, finalMultiplier);
    }
}

function showFloatingText(text, tileElement, color) {
    let rect = tileElement.getBoundingClientRect();
    let pop = document.createElement('div');
    pop.classList.add('pop-text');
    pop.innerText = text;
    pop.style.color = color;
    pop.style.left = (rect.left + window.scrollX) + 'px';
    pop.style.top = (rect.top + window.scrollY) + 'px';
    document.body.appendChild(pop);
    setTimeout(() => pop.remove(), 1500);
}

function applyRPGEffects(type, multiplier) {
    if (currentState !== STATE.PLAYING) return;

    let user = isPlayerTurn ? "Oyuncu" : "Düşman";
    let target = isPlayerTurn ? 'enemy' : 'player';
    let stats = isPlayerTurn ? TILE_STATS : ENEMY_TILE_STATS;

    if (type === 'sword') {
        let baseVal = Math.floor(stats.sword * multiplier);
        inflictDamage(target, baseVal);
        log(`${user} Saldırı ${baseVal}`, isPlayerTurn ? 'log-hit' : 'log-enemy');
        if (!isPlayerTurn) drainPlayerUltIfNeeded();
        if (typeof playSound === 'function') playSound('hit');

    } else if (type === 'heart') {
        let baseVal = Math.floor(stats.heart * multiplier);
        if (isPlayerTurn) playerHP = Math.min(playerHP + baseVal, maxPlayerHP);
        else enemyHP = Math.min(enemyHP + baseVal, maxEnemyHP);
        log(`${user} İyileşme +${baseVal}`, 'log-heal');
        if (isPlayerTurn && typeof playSound === 'function') playSound('heal');

    } else if (type === 'shield') {
        let baseVal = Math.floor(stats.shield * multiplier);
        if (isPlayerTurn) playerArmor += baseVal;
        else enemyArmor += baseVal;
        log(`${user} Zırh +${baseVal}`, 'log-armor');
        if (isPlayerTurn && typeof playSound === 'function') playSound('shield');

    } else if (type === 'energy') {
        let baseVal = Math.floor(stats.energy * multiplier);
        if (isPlayerTurn) {
            ultCharge = Math.min(ultCharge + baseVal, 100);
            log(`Ult +${baseVal}%`, 'log-hit');
        } else {
            let absorb = Math.floor(baseVal / 2);
            enemyHP = Math.min(enemyHP + absorb, maxEnemyHP);
            log(`Düşman ${absorb} emdi`, "log-enemy");
        }

    } else if (type === 'skull') {
        let dmgToOpponent = Math.floor(stats.skull_dmg * multiplier);
        let recoil = Math.floor(stats.skull_self_dmg * multiplier);

        let self = isPlayerTurn ? 'player' : 'enemy';
        inflictDamage(target, dmgToOpponent);
        inflictDamage(self, recoil);
        log(`Kafatası! Hasar: ${dmgToOpponent} / Kendine: ${recoil}`, 'log-crit');
        if (!isPlayerTurn) drainPlayerUltIfNeeded();
        if (typeof playSound === 'function') playSound('crit');
    }

    if (isPlayerTurn) checkBossEnrage();
    checkWinCondition();
    updateUI();
}

// A 'drain' minion (see MINION_TYPES) chips the player's ult charge on
// every hit it lands, on top of its normal tile damage - never below 0.
function drainPlayerUltIfNeeded() {
    if (currentMinionType !== 'drain') return;
    let before = ultCharge;
    ultCharge = Math.max(0, ultCharge - MINION_DRAIN_AMOUNT);
    if (ultCharge < before) log(`Enerjini emdi: ult -%${before - ultCharge}`, 'log-enemy');
}

// Boss phase mechanic: every boss (level % 5 === 0) permanently hits harder
// once its own HP drops to half - a one-time, one-way step change (not a
// gradual scale), so a boss fight has a real "it just got harder" beat
// instead of feeling identical from 100% to 0%. Checked only on the
// player's own damaging matches (the moment that could have crossed the
// threshold) - bossEnraged resets at every startLevel() so each boss fight
// gets its own single enrage.
let bossEnraged = false;
const BOSS_ENRAGE_HP_PCT = 0.5;
const BOSS_ENRAGE_STAT_MULT = 1.3;
function checkBossEnrage() {
    if (level % 5 !== 0 || bossEnraged) return;
    if (enemyHP > 0 && enemyHP <= maxEnemyHP * BOSS_ENRAGE_HP_PCT) {
        bossEnraged = true;
        ENEMY_TILE_STATS.sword = Math.round(ENEMY_TILE_STATS.sword * BOSS_ENRAGE_STAT_MULT);
        ENEMY_TILE_STATS.skull_dmg = Math.round(ENEMY_TILE_STATS.skull_dmg * BOSS_ENRAGE_STAT_MULT);
        enemySprite.classList.add('enraged');
        log('⚠️ BOSS ENRAGED! Saldırıları %30 daha güçlü!', 'log-crit');
    }
}

// Shared with PvP (pvp.js): rolls the local player's class-specific defense
// (dodge chance, incoming-damage multiplier) against a hit about to land on
// THEM. Returns null if fully dodged, otherwise the (possibly scaled)
// amount. Only ever applies to damage the local player is receiving - in
// PvP each client is authoritative for its own hp, so this always runs on
// the receiving side, never the attacker's.
function applyDefensiveTraits(amount) {
    if (selectedClass && selectedClass.dodgeChance > 0 && Math.random() < selectedClass.dodgeChance) {
        return null;
    }
    if (selectedClass && selectedClass.incomingDmgMult) {
        amount = Math.floor(amount * selectedClass.incomingDmgMult);
    }
    return amount;
}

function inflictDamage(targetStr, amount) {
    if (targetStr === 'player') {
        let afterDefense = applyDefensiveTraits(amount);
        if (afterDefense === null) {
            showFloatingText("DODGE!", document.getElementById('player-hp-bar'), "#2ecc71");
            log("SAVUŞTURULDU!", "log-heal");
            if (typeof playSound === 'function') playSound('dodge');
            return;
        }
        amount = afterDefense;
    }

    // Life Steal
    if (targetStr === 'enemy' && isPlayerTurn && TILE_STATS.lifeSteal > 0) {
        let heal = Math.floor(amount * (TILE_STATS.lifeSteal / 100));
        if (heal > 0) {
            playerHP = Math.min(playerHP + heal, maxPlayerHP);
            log(`Can Çalma +${heal}`, 'log-heal');
        }
    }

    // Visual Shake
    if (currentState === STATE.PLAYING) {
        gridDisplay.classList.remove('shake');
        void gridDisplay.offsetWidth;
        gridDisplay.classList.add('shake');
    }

    if (targetStr === 'player') {
        if (playerArmor >= amount) playerArmor -= amount;
        else {
            let remainder = amount - playerArmor;
            playerArmor = 0;
            playerHP -= remainder;
        }
    } else {
        if (enemyArmor >= amount) enemyArmor -= amount;
        else {
            let remainder = amount - enemyArmor;
            enemyArmor = 0;
            enemyHP -= remainder;
        }
    }
}

function fillBoard(isInitial) {
    if (!isInitial && currentState !== STATE.PLAYING) return;
    // Tiles that need their fall-in animation restarted this pass. Collected
    // and reflowed once at the end instead of once per tile - triggering a
    // forced synchronous layout inside this loop (as this used to do) is
    // "layout thrashing" and is exactly the kind of thing that makes a board
    // full of falling tiles feel janky instead of silky smooth.
    let tilesToAnimate = [];
    for (let col = 0; col < width; col++) {
        let columnTiles = [];
        for (let row = 0; row < width; row++) {
            let index = col + (row * width);
            if (tiles[index].dataset.type !== '') {
                columnTiles.push({ type: tiles[index].dataset.type, html: tiles[index].innerHTML });
            }
        }
        let missingCount = width - columnTiles.length;
        for (let i = 0; i < missingCount; i++) {
            let randomType = Math.floor(Math.random() * tileTypes.length);
            columnTiles.unshift({ type: tileTypes[randomType].type, html: tileTypes[randomType].symbol, isNew: true });
        }
        for (let row = 0; row < width; row++) {
            let index = col + (row * width);
            let tileData = columnTiles[row];
            if (tiles[index].dataset.type !== tileData.type || tileData.isNew) {
                tiles[index].dataset.type = tileData.type;
                tiles[index].innerHTML = tileData.html;
                tiles[index].classList.remove('matched');
                if (!isInitial) {
                    tiles[index].classList.remove('falling');
                    tilesToAnimate.push(tiles[index]);
                }
            }
        }
    }
    if (tilesToAnimate.length > 0) {
        void gridDisplay.offsetWidth; // one batched reflow instead of one per tile
        tilesToAnimate.forEach(t => t.classList.add('falling'));
    }
    let chainReaction = checkForMatches(isInitial);
    if (!chainReaction && !boardHasValidMove(tiles, width)) {
        reshuffleBoard(tiles, width, tileTypes);
        log("Hiç hamle kalmamıştı, tahta karıştırıldı!", "log-turn");
        chainReaction = checkForMatches(isInitial); // resolve any matches the reshuffle happened to land
    }
    if (!chainReaction && !isInitial) endTurnLogic();
}

function endTurnLogic() {
    if (currentState !== STATE.PLAYING) return;
    if (enemyHP <= 0 || playerHP <= 0) return;

    // Swift minions get one extra consecutive move per enemy turn - reuses
    // the same extraTurnTriggered mechanism a real 4-match grants, it's just
    // forced here instead of earned. swiftBonusUsed keeps this to exactly
    // once per turn even if the enemy's own move ALSO happens to earn a real
    // extra turn (both would otherwise stack).
    if (!isPlayerTurn && currentMinionType === 'swift' && !swiftBonusUsed && !extraTurnTriggered) {
        swiftBonusUsed = true;
        extraTurnTriggered = true;
    }

    if (extraTurnTriggered) {
        log(isPlayerTurn ? ">> EKSTRA TUR!" : ">> DÜŞMANIN EKSTRA TURU!", "log-turn");
        extraTurnTriggered = false;
        isProcessing = false;
        updateUI();
        if (!isPlayerTurn) setTimeout(enemyPlayTurn, 1000);
        else { gridDisplay.classList.remove('locked'); startPlayerTimer(); }
    } else {
        isPlayerTurn = !isPlayerTurn;
        updateTurnBanner();
        updateUI();
        if (!isPlayerTurn) {
            swiftBonusUsed = false; // fresh enemy turn starting - it earns its one swift bonus again
            gridDisplay.classList.add('locked');
            setTimeout(enemyPlayTurn, 1500);
        } else {
            gridDisplay.classList.remove('locked');
            isProcessing = false;
            startPlayerTimer();
        }
    }
}

function updateTurnBanner() {
    if (isPlayerTurn) {
        turnBanner.innerText = "OYUNCU SIRASI";
        turnBanner.className = "turn-indicator turn-player";
    } else {
        turnBanner.innerText = "DÜŞMAN SIRASI";
        turnBanner.className = "turn-indicator turn-enemy";
    }
}

function enemyPlayTurn() {
    if (currentState !== STATE.PLAYING || enemyHP <= 0) return;
    let isBoss = (level % 5 === 0);
    let move = isBoss ? findBestMove() : findMinionMove();

    if (move) {
        let t1 = tiles[move.index];
        let t2 = tiles[move.target];
        // .ai-target outlines both tiles directly (brightness boosted so it
        // still reads clearly through .grid.locked's dimming, which the
        // moving .ai-cursor circle alone doesn't escape - opacity on a
        // parent dims every descendant regardless of the child's own
        // opacity). Slowed to 3 distinct beats (settle on t1, slide to t2,
        // hold before the swap actually lands) instead of one quick blur.
        log(`Düşman ${t1.innerHTML} ↔ ${t2.innerHTML} hedefliyor...`, "log-enemy");
        t1.classList.add('ai-target');
        t2.classList.add('ai-target');
        aiCursor.style.display = 'block';
        aiCursor.style.left = (t1.offsetLeft) + 'px';
        aiCursor.style.top = (t1.offsetTop) + 'px';
        setTimeout(() => {
            aiCursor.style.left = (t2.offsetLeft) + 'px';
            aiCursor.style.top = (t2.offsetTop) + 'px';
        }, 700);
        setTimeout(() => {
            aiCursor.style.display = 'none';
            t1.classList.remove('ai-target');
            t2.classList.remove('ai-target');
            attemptSwap(t1, t2);
        }, 1600);
    } else {
        log("Düşman hamle bulamadı. Pas geçiyor...", "log-enemy");
        isPlayerTurn = true;
        updateTurnBanner();
        updateUI();
        gridDisplay.classList.remove('locked');
        isProcessing = false;
        startPlayerTimer();
    }
}

function findBestMove() {
    let possibleMoves = [];
    for (let i = 0; i < 64; i++) {
        let r = Math.floor(i / width);
        let c = i % width;
        if (c < width - 1) {
            let score = simulateSwap(i, i + 1);
            if (score > 0) possibleMoves.push({index: i, target: i + 1, score: score});
        }
        if (r < width - 1) {
            let score = simulateSwap(i, i + width);
            if (score > 0) possibleMoves.push({index: i, target: i + width, score: score});
        }
    }
    possibleMoves.sort((a, b) => b.score - a.score);
    return possibleMoves.length > 0 ? possibleMoves[0] : null;
}

function findMinionMove() {
    let makeMistake = Math.random() < 0.30;
    let legalMoves = [];
    for (let i = 0; i < 64; i++) {
        let r = Math.floor(i / width);
        let c = i % width;
        if (c < width - 1) {
            if (simulateSwap(i, i+1) > 0) {
                if (!makeMistake) return {index: i, target: i+1};
                legalMoves.push({index: i, target: i+1});
            }
        }
        if (r < width - 1) {
            if (simulateSwap(i, i+width) > 0) {
                if (!makeMistake) return {index: i, target: i+width};
                legalMoves.push({index: i, target: i+width});
            }
        }
    }
    if (legalMoves.length > 0) return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    return null;
}

function simulateSwap(i1, i2) {
    let tempTypes = tiles.map(t => t.dataset.type);
    let h = tempTypes[i1]; tempTypes[i1] = tempTypes[i2]; tempTypes[i2] = h;
    let score = 0;
    function getMatchLength(types, idx, step) {
        let type = types[idx]; if (!type) return 0;
        let count = 1; let curr = idx + step;
        while(curr >= 0 && curr < 64 && types[curr] === type) {
            if (step === 1 && Math.floor(curr/width) !== Math.floor(idx/width)) break;
            count++; curr += step;
        }
        return count;
    }
    let checkIndices = [i1, i2];
    for (let idx of checkIndices) {
        let r = Math.floor(idx / width), c = idx % width;
        let startC = c; while(startC > 0 && tempTypes[r*width + (startC-1)] === tempTypes[idx]) startC--;
        let hLen = getMatchLength(tempTypes, r*width + startC, 1);
        let startR = r; while(startR > 0 && tempTypes[(startR-1)*width + c] === tempTypes[idx]) startR--;
        let vLen = getMatchLength(tempTypes, startR*width + c, width);
        [hLen, vLen].forEach(len => {
            if (len >= 5) score += 1000;
            else if (len === 4) score += 500;
            else if (len === 3) score += calculateScore(tempTypes[idx]);
        });
    }
    return score;
}

function calculateScore(type) {
    let base = 10;
    if (type === 'skull') base += 25;
    if (type === 'shield' && enemyArmor < 10) base += 20;
    if (type === 'sword') base += 5;
    return base;
}

function useUltimate() {
    if (ultCharge >= 100 && isPlayerTurn && currentState === STATE.PLAYING && !isProcessing) {

        // 1. Lock the game immediately
        isProcessing = true;

        // 2. Apply Effect
        selectedClass.ultEffect(makeSinglePlayerCombatContext());
        ultCharge = 0;

        // 3. Visuals
        log(`ULTİMATE! ${selectedClass.ultName} kullanıldı!`, "log-hit");
        if (typeof playSound === 'function') playSound('ult');
        if (typeof claimDailyQuest === 'function') claimDailyQuest('use_ultimate');
        updateUI(); // Disables button immediately

        // 4. Check Win Condition
        if (enemyHP <= 0) {
            checkWinCondition();
            // If we won, stop here. Do not pass turn.
            return;
        }

        // 5. Pass Turn Logic
        // We use a small delay to let the user see the damage before the turn ends
        setTimeout(() => {
            endTurnLogic();
        }, 600);
    }
}

function updateUI() {
    const pPct = Math.max(0, (playerHP / maxPlayerHP) * 100);
    const ePct = Math.max(0, (enemyHP / maxEnemyHP) * 100);
    const pArmPct = Math.min(100, (playerArmor / maxPlayerHP) * 100);
    const eArmPct = Math.min(100, (enemyArmor / maxEnemyHP) * 100);

    document.getElementById('player-hp-bar').style.width = `${pPct}%`;
    document.getElementById('enemy-hp-bar').style.width = `${ePct}%`;
    document.getElementById('ult-bar').style.width = `${ultCharge}%`;
    document.getElementById('player-armor-bar').style.width = `${pArmPct}%`;
    document.getElementById('enemy-armor-bar').style.width = `${eArmPct}%`;

    let pArmorText = playerArmor > 0 ? ` <span class="armor-text">[+${playerArmor}]</span>` : "";
    let eArmorText = enemyArmor > 0 ? ` <span class="armor-text">[+${enemyArmor}]</span>` : "";

    document.getElementById('hp-text').innerHTML = `${Math.floor(Math.max(0,playerHP))}/${maxPlayerHP}${pArmorText}`;
    document.getElementById('enemy-hp-text').innerHTML = `${Math.floor(Math.max(0,enemyHP))}/${maxEnemyHP}${eArmorText}`;

    document.getElementById('ult-btn').disabled = ultCharge < 100 || !isPlayerTurn || isProcessing;
    document.getElementById('ult-text').innerText = `${Math.floor(ultCharge)}%`;
    // Stat readout (own + enemy) lives in the hover tooltip now (see
    // renderStatsTooltip) - rendered on demand, not every UI tick.
}

function toggleModal(modalId) {
    let m = document.getElementById(modalId);
    if(m.style.display === 'flex') {
        m.style.display = 'none';
        // Closing the PvP modal mid-search shouldn't leave the player sitting
        // in the matchmaking queue until the server's 90s staleness cleanup
        // catches up - cancel immediately so a re-open starts fresh.
        if (modalId === 'pvp-modal') {
            if (typeof pvpCancelQuickMatch === 'function') pvpCancelQuickMatch();
            if (typeof pvpStopWatching === 'function') pvpStopWatching();
        }
        if (modalId === 'friends-modal') {
            if (typeof closeConversation === 'function') closeConversation();
            if (typeof closeTradeComposer === 'function') closeTradeComposer();
        }
    } else {
        // Shop/inventory is a safe-checkpoint thing, not a mid-dungeon
        // thing - you're supposed to be too busy surviving to shop while
        // STATE.PLAYING (fighting) or STATE.REWARD (mid reward-pick / at
        // the boss-checkpoint screen, see showBossCheckpoint). Choosing
        // "Ana Menüye Dön" there sets currentState back to STATE.START,
        // which is what actually unblocks this.
        if (modalId === 'shop-modal' && (currentState === STATE.PLAYING || currentState === STATE.REWARD)) {
            log('Dükkana sadece zindan dışındayken girebilirsin.', 'log-turn');
            return;
        }
        m.style.display = 'flex';
        // Only render history if opening history modal
        if(modalId === 'history-modal') {
            renderHistory();
            if (typeof fetchWallet === 'function') fetchWallet();
        }
        if (modalId === 'shop-modal') {
            if (typeof fetchWallet === 'function') fetchWallet();
            if (typeof renderShop === 'function') renderShop();
            if (typeof renderInventory === 'function') renderInventory();
        }
        if (modalId === 'achievements-modal' && typeof renderAchievements === 'function') {
            renderAchievements();
        }
        if (modalId === 'leaderboard-modal' && typeof renderLeaderboard === 'function') {
            renderLeaderboard();
            if (typeof renderPvpLeaderboard === 'function') renderPvpLeaderboard();
        }
        if (modalId === 'friends-modal' && typeof renderFriendsList === 'function') {
            renderFriendsList();
        }
        if (modalId === 'guild-modal' && typeof renderGuildPanel === 'function') {
            renderGuildPanel();
        }
        if (modalId === 'titles-modal' && typeof renderTitlesPanel === 'function') {
            renderTitlesPanel();
        }
        if (modalId === 'trade-modal' && typeof renderTradeOffers === 'function') {
            renderTradeOffers();
        }
        if (modalId === 'talents-modal' && typeof renderTalentsPanel === 'function') {
            renderTalentsPanel();
        }
        if (modalId === 'daily-login-modal' && typeof fetchDailyLoginStatus === 'function') {
            fetchDailyLoginStatus();
            if (typeof fetchDailyQuestStatus === 'function') fetchDailyQuestStatus();
        }
    }
}

// Live, absolute TILE_STATS readout - unlike renderHistory()'s "what have I
// gained this run" deltas, this is "what are my numbers right now" (base +
// class passive + equipped items + active achievements, already folded
// together by rebuildTileStats()). TILE_STATS is the one pool solo, PvP and
// co-op all read, so the same renderer is reused from all three - see the
// 📊 buttons in the battle header and in pvp-battle/coop-battle.
//
// This used to be a click-to-open modal (openLiveStats/live-stats-modal) -
// switched to a hover tooltip (.stats-peek-wrap's CSS :hover in style.css)
// after testing showed the deliberate open-read-close cycle was quietly
// costing the speed bonus window just by existing. A hover (or a tap on
// touch, see toggleStatsTooltipTouch) costs nothing - the board's still
// right there the whole time.
const STAT_DISPLAY_LABELS = {
    sword: '⚔️ Kılıç', heart: '💖 İyileşme', shield: '🛡️ Kalkan', energy: '⚡ Ult Şarj',
    skull_dmg: '💀 Kafatası Hsr', skull_self_dmg: '☠️ Öz Hasar', ult_dmg: '✨ Ult Gücü',
    lifeSteal: '🩸 Can Çalma%', teamHeal: '💚 Takım Şifa'
};
const ENEMY_STAT_DISPLAY_LABELS = {
    sword: '⚔️ Kılıç', shield: '🛡️ Kalkan', heart: '💖 İyileşme',
    energy: '⚡ Enerji', skull_dmg: '💀 Kafatası', skull_self_dmg: '☠️ Öz Hasar'
};

// `enemyStats` is optional - PvP has no fixed "enemy" stat block (the
// opponent is a live player using their own hidden TILE_STATS, not a
// monster), so its tooltip only ever passes SEN.
function renderStatsTooltip(container, enemyStats) {
    if (!container) return;
    let ownRows = Object.keys(STAT_DISPLAY_LABELS)
        .map(key => `<div>${STAT_DISPLAY_LABELS[key]}: <b>${TILE_STATS[key]}</b></div>`).join('');
    let html = `<div class="stats-tooltip-col"><h5>SEN</h5>${ownRows}</div>`;
    if (enemyStats) {
        let enemyRows = Object.keys(ENEMY_STAT_DISPLAY_LABELS)
            .map(key => `<div>${ENEMY_STAT_DISPLAY_LABELS[key]}: <b>${enemyStats[key]}</b></div>`).join('');
        html += `<div class="stats-tooltip-col enemy"><h5>DÜŞMAN</h5>${enemyRows}</div>`;
    }
    container.innerHTML = html;
}

// Touch devices don't get a real hover state, so a tap toggles the same
// tooltip open for a few seconds instead - one mechanism, two input types.
// `getEnemyStats` is a zero-arg function (not the stats object itself) so
// each tap re-reads whichever mode's enemy pool is current, not a stale
// snapshot from when the button was first wired up.
function toggleStatsTooltipTouch(tooltipId, getEnemyStats) {
    let el = document.getElementById(tooltipId);
    if (!el) return;
    let wasOpen = el.classList.contains('touch-open');
    document.querySelectorAll('.stats-tooltip.touch-open').forEach(t => t.classList.remove('touch-open'));
    if (!wasOpen) {
        renderStatsTooltip(el, getEnemyStats ? getEnemyStats() : null);
        el.classList.add('touch-open');
        setTimeout(() => el.classList.remove('touch-open'), 4000);
    }
}

function renderHistory() {
    // Persistent equipment (weapon/shield/.../trinket + set-bonus progress)
    // shown right on the stats screen, not just buried in the shop modal -
    // this screen's whole title promises "STATLAR & EŞYALAR" (stats AND
    // items), so it should actually show the items, not just this run's
    // temporary reward picks below.
    if (typeof renderEquippedSlotsInto === 'function') renderEquippedSlotsInto('history-equipped-slots');

    const listContainer = document.getElementById('history-list-container');
    const summaryContainer = document.getElementById('total-stats-summary');

    // 1. Render Summary
    summaryContainer.innerHTML = '';
    const statLabels = {
        sword: 'Kılıç', shield: 'Kalkan', heart: 'İyileşme', energy: 'Enerji',
        skull_dmg: 'Kafatası', skull_self_dmg: 'Öz Hasar', ult_dmg: 'Ult', lifeSteal: 'Çalma %', maxHP: 'Maks Can'
    };

    let hasStats = false;
    for(let key in totalStatsGained) {
        if(totalStatsGained[key] > 0) {
            hasStats = true;
            let div = document.createElement('div');
            div.innerHTML = `${statLabels[key] || key}: <b>+${totalStatsGained[key]}</b>`;
            summaryContainer.appendChild(div);
        }
    }
    if(!hasStats) summaryContainer.innerHTML = '<div style="grid-column: span 2; text-align:center;">Henüz eşya toplanmadı.</div>';

    // 2. Render List
    listContainer.innerHTML = '';
    if(pickedRewards.length === 0) {
        listContainer.innerHTML = '<div style="color:#777; text-align:center;">Boş</div>';
        return;
    }

    // Reverse order to show newest first
    [...pickedRewards].reverse().forEach(item => {
        let div = document.createElement('div');
        div.className = `history-item rarity-${item.tier}`;
        div.style.borderColor = `var(--${item.tier})`; // Helper color border

        // Format stats string
        let statStr = Object.entries(item.diff)
            .map(([k, v]) => `${statLabels[k] || k} +${v}`)
            .join(', ');

        div.innerHTML = `
            <div class="history-name">${item.name}</div>
            <div class="history-stats">${statStr}</div>
        `;
        listContainer.appendChild(div);
    });
}

const LOG_MAX_ENTRIES = 60;

function log(msg, cls) {
    let div = document.createElement('div');
    div.innerText = `#${logCounter++} > ${msg}`;
    if(cls) div.classList.add(cls);
    logDisplay.prepend(div);
    // Without a cap, a long session leaves thousands of log divs in the DOM
    // (nothing ever removed old ones), which gets slower to lay out/paint
    // the longer you play. logDisplay.lastChild is always the oldest entry
    // here since new ones are always prepended.
    while (logDisplay.children.length > LOG_MAX_ENTRIES) {
        logDisplay.removeChild(logDisplay.lastChild);
    }

    // The log panel is collapsed by default (see toggleLog) - keep a
    // one-line "latest event" ticker updated so there's still live feedback
    // without permanently costing the screen space of the full history.
    let latestEl = document.getElementById('log-latest');
    if (latestEl) latestEl.innerText = msg;
}

function toggleLog() {
    logDisplay.classList.toggle('expanded');
    document.getElementById('log-toggle').classList.toggle('open');
}

const TUTORIAL_SEEN_KEY = 'pd_tutorial_seen_v1';
const TUTORIAL_TOTAL_STEPS = 5;
let tutorialStep = 1;

function showTutorialStep(n) {
    document.querySelectorAll('.tutorial-step').forEach(el => {
        el.style.display = (parseInt(el.dataset.step, 10) === n) ? 'block' : 'none';
    });
    document.getElementById('tutorial-progress').innerText = `${n} / ${TUTORIAL_TOTAL_STEPS}`;
    document.getElementById('tutorial-back-btn').style.visibility = (n === 1) ? 'hidden' : 'visible';
    document.getElementById('tutorial-next-btn').innerText = (n === TUTORIAL_TOTAL_STEPS) ? 'Başlayalım! ✔' : 'İleri ▶';
}

function tutorialNext() {
    if (tutorialStep >= TUTORIAL_TOTAL_STEPS) {
        closeTutorial(true);
        return;
    }
    tutorialStep++;
    showTutorialStep(tutorialStep);
}

function tutorialBack() {
    if (tutorialStep <= 1) return;
    tutorialStep--;
    showTutorialStep(tutorialStep);
}

function tutorialSkip() {
    closeTutorial(false);
}

function closeTutorial(completed) {
    document.getElementById('tutorial-modal').style.display = 'none';
    localStorage.setItem(TUTORIAL_SEEN_KEY, 'true');
    if (typeof trackEvent === 'function') trackEvent('tutorial_closed', { completed });
}

function replayTutorial() {
    toggleModal('info-modal');
    tutorialStep = 1;
    showTutorialStep(1);
    document.getElementById('tutorial-modal').style.display = 'flex';
}

function maybeShowTutorial() {
    if (localStorage.getItem(TUTORIAL_SEEN_KEY) === 'true') return;
    tutorialStep = 1;
    showTutorialStep(1);
    document.getElementById('tutorial-modal').style.display = 'flex';
    if (typeof trackEvent === 'function') trackEvent('tutorial_started', {});
}

createBoard();
renderClassButtons();
maybeShowTutorial();
