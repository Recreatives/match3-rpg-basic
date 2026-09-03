const gridDisplay = document.querySelector('.grid');
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
let TILE_STATS = {
    sword: 6, heart: 4, shield: 5, energy: 12,
    skull_dmg: 25, skull_self_dmg: 12, ult_dmg: 35, lifeSteal: 0
};

// Enemies used to read the player's own TILE_STATS, so every reward the
// player picked up also buffed enemy tile-match damage/healing. Enemies
// now have their own stat pool that scales with level/boss independently.
let ENEMY_TILE_STATS = { sword: 4, heart: 3, shield: 4, energy: 10, skull_dmg: 15, skull_self_dmg: 8 };
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
const CLASSES = {
    WARRIOR: {
        name: "Warrior", emoji: "🛡️",
        desc: "<b>Tank:</b> Gains +2 Bonus Shield. Ult deals dmg based on your Armor.",
        passive: (stats) => { stats.shield += 2; },
        dodgeChance: 0, incomingDmgMult: 1.0,
        ultName: "SHIELD SLAM",
        ultEffect: () => {
            let dmg = TILE_STATS.ult_dmg + playerArmor;
            inflictDamage('enemy', dmg);
            log(`ULT: Shield Slam deals ${dmg} damage!`, "log-hit");
        }
    },
    BERSERKER: {
        name: "Berserker", emoji: "🪓",
        desc: "<b>DPS:</b> +5 Sword/ +15 Skull Dmg, but takes <b>35% MORE DAMAGE</b>.",
        passive: (stats) => { stats.sword += 5; stats.skull_dmg += 15; },
        dodgeChance: 0, incomingDmgMult: 1.25,
        ultName: "BLOOD LUST",
        ultEffect: () => {
            playerHP -= 10;
            inflictDamage('enemy', TILE_STATS.ult_dmg * 2);
            log(`ULT: Blood Lust deals double damage!`, "log-crit");
        }
    },
    ROGUE: {
        name: "Rogue", emoji: "🗡️",
        desc: "<b>Combo:</b> Gains Energy fast. Ult grants an <b>EXTRA TURN</b>.",
        passive: (stats) => { stats.energy += 5; },
        dodgeChance: 0.1, incomingDmgMult: 1.0,
        ultName: "ASSASSINATE",
        ultEffect: () => {
            inflictDamage('enemy', TILE_STATS.ult_dmg);
            extraTurnTriggered = true;
            log(`ULT: Assassinate! Extra Turn!`, "log-match");
        }
    },
    ARCHER: {
        name: "Archer", emoji: "🏹",
        desc: "<b>Piercing:</b> <b>20% Dodge</b>. Ult ignores Armor and deals direct HP damage.",
        passive: (stats) => {},
        dodgeChance: 0.2, incomingDmgMult: 1.0,
        ultName: "PIERCING SHOT",
        ultEffect: () => {
            // Calculate damage: Base Ult Damage + your Sword Stat
            let pierceDmg = TILE_STATS.ult_dmg + (TILE_STATS.sword * 2);

            // Direct HP modification (Bypassing inflictDamage function to skip armor logic)
            if (enemyHP > 0) {
                enemyHP -= pierceDmg;

                // Visuals
                log(`ULT: Piercing Shot ignored Armor! -${pierceDmg} HP`, "log-crit");
                showFloatingText(`-${pierceDmg}`, document.getElementById('enemy-hp-bar'), "#e74c3c");

                // Shake effect
                const grid = document.querySelector('.grid');
                grid.classList.remove('shake');
                void grid.offsetWidth;
                grid.classList.add('shake');

                checkWinCondition();
            }
        }
    },
    MAGE: {
        name: "Mage", emoji: "🧙",
        desc: "<b>Scaling:</b> Ult gains <b>+10 Power</b> every use.",
        passive: (stats) => { stats.energy += 10; stats.sword -= 2; },
        dodgeChance: 0, incomingDmgMult: 1.0,
        ultName: "ARCANE BLAST",
        ultEffect: () => {
            inflictDamage('enemy', TILE_STATS.ult_dmg);
            TILE_STATS.ult_dmg += 10;
            log(`ULT: Power increased to ${TILE_STATS.ult_dmg}!`, "log-match");
        }
    }
};
let selectedClass = null;

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
            const playerBox = document.querySelector('.stat-box div:first-child');
            playerBox.style.color = 'var(--accent)';
            playerBox.innerHTML = `${c.emoji} ${c.name.toUpperCase()}`;
            selectedClass.passive(TILE_STATS);
            document.getElementById('ult-btn').innerText = `USE ${c.ultName} (100%)`;
            updateUI();
            container.style.display = 'none';
            overlayTitle.innerText = `READY, ${c.name.toUpperCase()}?`;
            overlayBtn.style.display = 'block';
        };
        container.appendChild(btn);
    });
}

function handleOverlayClick() {
    if (currentState === STATE.START || currentState === STATE.GAMEOVER) {
        if (!selectedClass) {
            renderClassButtons();
            overlayTitle.innerText = "SELECT YOUR HERO";
            return;
        }
        resetGame();
        startLevel();
    }
}

function resetGame() {
    playerHP = 100; maxPlayerHP = 100; playerArmor = 0; ultCharge = 0;
    level = 1; logCounter = 1;
    TILE_STATS = { sword: 6, heart: 4, shield: 5, energy: 12, skull_dmg: 25, skull_self_dmg: 12, ult_dmg: 35, lifeSteal: 0 };
    ENEMY_TILE_STATS = getEnemyStatsForLevel(1, false);

    // Reset History
    pickedRewards = [];
    totalStatsGained = {
        sword: 0, shield: 0, heart: 0, energy: 0,
        skull_dmg: 0, skull_self_dmg: 0, ult_dmg: 0, lifeSteal: 0, maxHP: 0
    };

    if (selectedClass) selectedClass.passive(TILE_STATS);
    isProcessing = false;
    extraTurnTriggered = false;
    gridDisplay.classList.remove('shake');
    enemySprite.classList.remove('dying');
    log("Game Reset.", "log-turn");
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
    enemyArmor = 0;

    let isBoss = (level % 5 === 0);
    let name = isBoss ? `BOSS Lvl ${level}` : `Minion Lvl ${level}`;
    document.getElementById('enemy-name').innerText = name;
    document.getElementById('enemy-sprite').innerText = isBoss ? '👹' : ['👾','👺','👻','🤖'][level % 4];
    ENEMY_TILE_STATS = getEnemyStatsForLevel(level, isBoss);

    if(isBoss) log("WARNING: BOSS BATTLE!", "log-crit");

    turnBanner.innerText = "PLAYER TURN";
    turnBanner.className = "turn-indicator turn-player";
    isPlayerTurn = true;
    isProcessing = false;
    extraTurnTriggered = false;

    createBoard();
    updateUI();
    startPlayerTimer();
    log(`LEVEL ${level} START`, "log-turn");
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
        log("ENEMY DEFEATED!", "log-crit");
        gridDisplay.classList.add('shake');
        setTimeout(() => { gridDisplay.classList.remove('shake'); winLevel(); }, 1500);
    } else {
        gridDisplay.classList.add('shake');
        setTimeout(() => { gridDisplay.classList.remove('shake'); gameOver(); }, 1500);
    }
}

function winLevel() {
    if (currentState === STATE.REWARD) return;
    currentState = STATE.REWARD;

    // Calculate Reward Picks
    // NOTE: order matters here - the <=0.01 case must be checked before
    // <=0.10, otherwise it is unreachable (0.01 also satisfies <=0.10).
    let hpPercent = (playerHP / maxPlayerHP);
    if (hpPercent <= 0.01) { rewardPicksLeft = 5; log("MIRACLE! Pick 5 Rewards!", "log-crit"); }
    else if (hpPercent <= 0.10) { rewardPicksLeft = 3; log("DESPERATE WIN! Pick 3 Rewards!", "log-match"); }
    else if (hpPercent >= 1.0) { rewardPicksLeft = 3; log("FLAWLESS! Pick 3 Rewards!", "log-hit"); }
    else if (hpPercent >= 0.75) { rewardPicksLeft = 2; log("DECENT WIN! Pick 2 Rewards!", "log-match"); }
    else { rewardPicksLeft = 1; log("Level Complete! Pick 1 Reward.", "log-hit"); }

    // Boss Bonus: an extra pick for clearing a boss level (Lvl 5, 10...)
    if (level % 5 === 0) {
        rewardPicksLeft += 1;
        log("BOSS BONUS! +1 Reward!", "log-crit");
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
    } else {
        overlayTitle.innerText = `READY FOR LEVEL ${level + 1}?`;
        rewardArea.style.display = 'none';
        overlayBtn.innerText = "START NEXT LEVEL";
        overlayBtn.style.display = 'block';
        overlayBtn.onclick = () => {
            let missingHP = maxPlayerHP - playerHP;
            let healed = Math.ceil(missingHP * LEVEL_CLEAR_HEAL_PERCENT);
            if (healed > 0) {
                playerHP = Math.min(playerHP + healed, maxPlayerHP);
                log(`Rest before battle: +${healed} HP`, 'log-heal');
            }
            level++;
            startLevel();
        };
    }
}

function generateRewards() {
    rewardArea.innerHTML = '';

    const REWARDS = [
        // === COMMON (40%) - 1 Stat ===
        { tier: 'common', name: 'Whetstone', desc: 'Sword +1', fn: () => TILE_STATS.sword += 1 },
        { tier: 'common', name: 'Leather Patch', desc: 'Shield +1', fn: () => TILE_STATS.shield += 1 },
        { tier: 'common', name: 'Herb Mix', desc: 'Heal +1', fn: () => TILE_STATS.heart += 1 },
        { tier: 'common', name: 'Meditation', desc: 'Energy +1', fn: () => TILE_STATS.energy += 1 },
        { tier: 'common', name: 'Bone Shard', desc: 'Skull Dmg +6/ Self Dmg +3', fn: () => { TILE_STATS.skull_dmg += 6; TILE_STATS.skull_self_dmg += 3; } },
        { tier: 'common', name: 'Minor Charge', desc: 'Ult Dmg +10', fn: () => TILE_STATS.ult_dmg += 10 },
        { tier: 'common', name: 'Leech Seed', desc: 'Life Steal +1%', fn: () => TILE_STATS.lifeSteal += 1 },

        // === UNCOMMON (30%) - 1 Stat (Stronger) ===
        { tier: 'uncommon', name: 'Steel Sword', desc: 'Sword +2', fn: () => TILE_STATS.sword += 2 },
        { tier: 'uncommon', name: 'Iron Plate', desc: 'Shield +2', fn: () => TILE_STATS.shield += 2 },
        { tier: 'uncommon', name: 'Potion', desc: 'Heal +2', fn: () => TILE_STATS.heart += 2 },
        { tier: 'uncommon', name: 'Focus', desc: 'Energy +2', fn: () => TILE_STATS.energy += 2 },
        { tier: 'uncommon', name: 'Skull Idol', desc: 'Skull +10/ Self Dmg +5', fn: () => { TILE_STATS.skull_dmg += 10; TILE_STATS.skull_self_dmg += 5; } },
        { tier: 'uncommon', name: 'Mana Crystal', desc: 'Ult Dmg +20', fn: () => TILE_STATS.ult_dmg += 20 },
        { tier: 'uncommon', name: 'Bat Wing', desc: 'Life Steal +2%', fn: () => TILE_STATS.lifeSteal += 2 },

        // === RARE (15%) - 1 Stat (Big) ===
        { tier: 'rare', name: 'Diamond Blade', desc: 'Sword +3', fn: () => TILE_STATS.sword += 3 },
        { tier: 'rare', name: 'Tower Shield', desc: 'Shield +3', fn: () => TILE_STATS.shield += 3 },
        { tier: 'rare', name: 'Elixir', desc: 'Heal +3', fn: () => TILE_STATS.heart += 3 },
        { tier: 'rare', name: 'Deep Focus', desc: 'Energy +3', fn: () => TILE_STATS.energy += 3 },
        { tier: 'rare', name: 'Cursed Skull', desc: 'Skull +14/ Self Dmg +7', fn: () => { TILE_STATS.skull_dmg += 14; TILE_STATS.skull_self_dmg += 7; } },
        { tier: 'rare', name: 'Spell Book', desc: 'Ult Dmg +35', fn: () => TILE_STATS.ult_dmg += 35 },
        { tier: 'rare', name: 'Vampire Tooth', desc: 'Life Steal +3%', fn: () => TILE_STATS.lifeSteal += 3 },

        // === EPIC (10%) - 2 Stats (Enriched Pool) ===
        { tier: 'epic', name: 'Paladin Set', desc: 'Sword +3 & Shield +3', fn: () => { TILE_STATS.sword += 3; TILE_STATS.shield += 3; } },
        { tier: 'epic', name: 'Blood Mage', desc: 'Ult +30 & Steal +3%', fn: () => { TILE_STATS.ult_dmg += 30; TILE_STATS.lifeSteal += 3; } },
        { tier: 'epic', name: 'Berserker Soul', desc: 'Skull Dmg +20(Self Dmg +10) & Sword +4', fn: () => { TILE_STATS.skull_dmg += 20; TILE_STATS.skull_self_dmg += 10; TILE_STATS.sword += 4; } },
        { tier: 'epic', name: 'Monk Vow', desc: 'Heal +4 & Energy +4', fn: () => { TILE_STATS.heart += 4; TILE_STATS.energy += 4; } },
        { tier: 'epic', name: 'Stone Skin', desc: 'Shield +4 & HP +30', fn: () => { TILE_STATS.shield += 4; maxPlayerHP += 30; playerHP += 30; } },
        { tier: 'epic', name: 'Crimson Edge', desc: 'Sword +4 & Steal +3%', fn: () => { TILE_STATS.sword += 4; TILE_STATS.lifeSteal += 3; } },
        { tier: 'epic', name: 'Storm Caller', desc: 'Energy +4 & Ult +25', fn: () => { TILE_STATS.energy += 4; TILE_STATS.ult_dmg += 25; } },
        { tier: 'epic', name: 'Iron Heart', desc: 'Shield +4 & Heal +4', fn: () => { TILE_STATS.shield += 4; TILE_STATS.heart += 4; } },
        { tier: 'epic', name: 'Necromancer', desc: 'Skull Dmg +24 (Self Dmg +12) & Steal +3%', fn: () => { TILE_STATS.skull_dmg += 24; TILE_STATS.skull_self_dmg += 12; TILE_STATS.lifeSteal += 3; } },
        { tier: 'epic', name: 'Gladiator', desc: 'Sword +4 & Energy +3', fn: () => { TILE_STATS.sword += 4; TILE_STATS.energy += 3; } },
        { tier: 'epic', name: 'Giant Strength', desc: 'Max HP +40 & Sword +3', fn: () => { maxPlayerHP += 40; playerHP += 40; TILE_STATS.sword += 3; } },

        // === LEGENDARY (5%) - 3 Stats ===
        { tier: 'legendary', name: 'God Slayer', desc: 'Sword +5, Ult +40, Energy +3', fn: () => { TILE_STATS.sword += 5; TILE_STATS.ult_dmg += 40; TILE_STATS.energy += 3; } },
        { tier: 'legendary', name: 'Immortality', desc: 'Shield +5, Heal +5, Max HP +50', fn: () => { TILE_STATS.shield += 5; TILE_STATS.heart += 5; maxPlayerHP+=50; playerHP+=50; } },
        { tier: 'legendary', name: 'Demon Lord', desc: 'Skull Dmg +30(Self Dmg +15), Steal +5%, Sword +4', fn: () => { TILE_STATS.skull_dmg += 30; TILE_STATS.skull_self_dmg += 15; TILE_STATS.lifeSteal += 5; TILE_STATS.sword += 4; } },
        { tier: 'legendary', name: 'Archmage', desc: 'Energy +5, Ult +30, Shield +4', fn: () => { TILE_STATS.energy += 5; TILE_STATS.ult_dmg += 30; TILE_STATS.shield += 4; } },
        { tier: 'legendary', name: 'Trinity', desc: 'Sword +3, Shield +3, Heal +3', fn: () => { TILE_STATS.sword += 3; TILE_STATS.shield += 3; TILE_STATS.heart += 3; } },
        { tier: 'legendary', name: 'Titan Blood', desc: 'Max HP +40, Heal +4, Sword +3', fn: () => { maxPlayerHP += 40; playerHP += 40; TILE_STATS.heart += 4; TILE_STATS.sword += 3; } },
        { tier: 'legendary', name: 'Vampire King', desc: 'Life Steal +4%, Skull Dmg +20(Self Dmg +10), Energy +3', fn: () => { TILE_STATS.lifeSteal += 4; TILE_STATS.skull_dmg += 20; TILE_STATS.skull_self_dmg += 10; TILE_STATS.energy += 3; } },
        { tier: 'legendary', name: 'Juggernaut', desc: 'Max HP +60, Shield +4, Sword +2', fn: () => { maxPlayerHP += 60; playerHP += 60; TILE_STATS.shield += 4; TILE_STATS.sword += 2; } }
    ];

    for (let i = 0; i < 3; i++) {
        let rand = Math.random();
        let chosenTier = 'common';

        if (rand < 0.05) chosenTier = 'legendary';
        else if (rand < 0.15) chosenTier = 'epic';
        else if (rand < 0.30) chosenTier = 'rare';
        else if (rand < 0.60) chosenTier = 'uncommon';

        let pool = REWARDS.filter(r => r.tier === chosenTier);
        if(pool.length === 0) pool = REWARDS.filter(r => r.tier === 'common');

        let reward = pool[Math.floor(Math.random() * pool.length)];

        let btn = document.createElement('button');
        btn.className = `reward-btn rarity-${reward.tier}`;
        btn.innerHTML = `<b>${reward.name} <span style="font-size:0.7em; text-transform:uppercase; opacity:0.8;">(${reward.tier})</span></b><small>${reward.desc}</small>`;
        btn.onclick = () => {
            // --- SNAPSHOT STATS BEFORE ---
            let prevStats = { ...TILE_STATS, maxHP: maxPlayerHP };

            // Apply Reward
            reward.fn();

            // --- SNAPSHOT STATS AFTER ---
            let newStats = { ...TILE_STATS, maxHP: maxPlayerHP };

            // Calculate Difference for History
            let diff = {};
            for(let key in newStats) {
                let d = newStats[key] - prevStats[key];
                if(d !== 0) diff[key] = d;
            }

            // Save to History
            pickedRewards.push({ name: reward.name, tier: reward.tier, desc: reward.desc, diff: diff });

            // Update Global Total Stats
            for(let key in diff) {
                totalStatsGained[key] = (totalStatsGained[key] || 0) + diff[key];
            }

            log(`Picked: ${reward.name}`, "log-heal");
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
    currentState = STATE.GAMEOVER;
    overlayTitle.innerText = "GAME OVER";
    overlayBtn.innerText = "TRY AGAIN";
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

function checkForMatches(isInitial) {
    if (!isInitial && currentState !== STATE.PLAYING) return false;
    let matchesFound = false;
    let hRuns = [], vRuns = [];

    // Horizontal
    for (let r = 0; r < width; r++) {
        let count = 1;
        for (let c = 0; c < width; c++) {
            let i = r * width + c;
            if (c < width-1 && tiles[i].dataset.type !== '' && tiles[i].dataset.type === tiles[i+1].dataset.type) {
                count++;
            } else {
                if (count >= 3) {
                    let indices = [];
                    for(let k=0; k<count; k++) indices.push(i-k);
                    hRuns.push({indices: indices, type: tiles[i].dataset.type});
                    matchesFound = true;
                }
                count = 1;
            }
        }
    }
    // Vertical
    for (let c = 0; c < width; c++) {
        let count = 1;
        for (let r = 0; r < width; r++) {
            let i = r * width + c;
            if (r < width-1 && tiles[i].dataset.type !== '' && tiles[i].dataset.type === tiles[i+width].dataset.type) {
                count++;
            } else {
                if (count >= 3) {
                    let indices = [];
                    for(let k=0; k<count; k++) indices.push(i-(k*width));
                    vRuns.push({indices: indices, type: tiles[i].dataset.type});
                    matchesFound = true;
                }
                count = 1;
            }
        }
    }

    // NEW: Merge intersections
    let finalGroups = mergeIntersectingMatches(hRuns, vRuns);

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
    let shapeLabel = '3';
    let multiplier = 1;
    let isCross = (group.subShape === 'cross');

    // --- FIXED PRIORITY LOGIC ---

    // 1. Check for Massive Matches FIRST (Rare & Powerful)
    if (count >= 7) {
        shapeLabel = '7!!';
        multiplier = 4;
        if (isPlayerTurn) ultCharge += 90;
        extraTurnTriggered = true;
    }
    else if (count === 6) {
        shapeLabel = '6!';
        multiplier = 3.5;
        if (isPlayerTurn) ultCharge += 60;
        extraTurnTriggered = true;
    }
    // 2. Then check for 5 (Straight Line usually beats Cross in Match-3 logic)
    else if (count === 5 && !isCross) {
        shapeLabel = '5';
        multiplier = 3;
        if(isPlayerTurn) ultCharge += 30;
        extraTurnTriggered = true;
    }
    // 3. Then check for Crosses (L / T Shapes of 5 tiles)
    else if (isCross) {
        shapeLabel = 'CROSS';
        multiplier = 2.5;
        extraTurnTriggered = true;
    }
    // 4. Finally, standard matches
    else if (count === 4) {
        shapeLabel = '4';
        multiplier = 2;
        extraTurnTriggered = true;
    }
    else {
        // Default Match 3
        multiplier = 1;
    }

    // Speed Bonus: the player's own moves (and any chain reaction they
    // trigger) are further scaled by how fast the swap was made.
    let finalMultiplier = isPlayerTurn ? multiplier * currentMoveTimeMultiplier : multiplier;

    // --- VISUALS & LOGS ---
    if (!isInitial && finalMultiplier > 1) { // Only log if it's special
        let user = isPlayerTurn ? "Player" : "Enemy";
        let displayMult = Math.round(finalMultiplier * 10) / 10;

        log(`${user}: ${shapeLabel} Match! (x${displayMult})`, "log-match");

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

    let user = isPlayerTurn ? "Player" : "Enemy";
    let target = isPlayerTurn ? 'enemy' : 'player';
    let stats = isPlayerTurn ? TILE_STATS : ENEMY_TILE_STATS;

    if (type === 'sword') {
        let baseVal = Math.floor(stats.sword * multiplier);
        inflictDamage(target, baseVal);
        log(`${user} Atk ${baseVal}`, isPlayerTurn ? 'log-hit' : 'log-enemy');

    } else if (type === 'heart') {
        let baseVal = Math.floor(stats.heart * multiplier);
        if (isPlayerTurn) playerHP = Math.min(playerHP + baseVal, maxPlayerHP);
        else enemyHP = Math.min(enemyHP + baseVal, maxEnemyHP);
        log(`${user} Heal +${baseVal}`, 'log-heal');

    } else if (type === 'shield') {
        let baseVal = Math.floor(stats.shield * multiplier);
        if (isPlayerTurn) playerArmor += baseVal;
        else enemyArmor += baseVal;
        log(`${user} Armor +${baseVal}`, 'log-armor');

    } else if (type === 'energy') {
        let baseVal = Math.floor(stats.energy * multiplier);
        if (isPlayerTurn) {
            ultCharge = Math.min(ultCharge + baseVal, 100);
            log(`Ult +${baseVal}%`, 'log-hit');
        } else {
            let absorb = Math.floor(baseVal / 2);
            enemyHP = Math.min(enemyHP + absorb, maxEnemyHP);
            log(`Enemy Absorbs ${absorb}`, "log-enemy");
        }

    } else if (type === 'skull') {
        let dmgToOpponent = Math.floor(stats.skull_dmg * multiplier);
        let recoil = Math.floor(stats.skull_self_dmg * multiplier);

        let self = isPlayerTurn ? 'player' : 'enemy';
        inflictDamage(target, dmgToOpponent);
        inflictDamage(self, recoil);
        log(`Skull! Dmg: ${dmgToOpponent} / Self: ${recoil}`, 'log-crit');
    }

    checkWinCondition();
    updateUI();
}

function inflictDamage(targetStr, amount) {
    // Dodge
    if (targetStr === 'player' && selectedClass && selectedClass.dodgeChance > 0) {
        if (Math.random() < selectedClass.dodgeChance) {
            showFloatingText("DODGE!", document.getElementById('player-hp-bar'), "#2ecc71");
            log("DODGED!", "log-heal");
            return;
        }
    }
    // Vulnerability
    if (targetStr === 'player' && selectedClass && selectedClass.incomingDmgMult) {
        amount = Math.floor(amount * selectedClass.incomingDmgMult);
    }

    // Life Steal
    if (targetStr === 'enemy' && isPlayerTurn && TILE_STATS.lifeSteal > 0) {
        let heal = Math.floor(amount * (TILE_STATS.lifeSteal / 100));
        if (heal > 0) {
            playerHP = Math.min(playerHP + heal, maxPlayerHP);
            log(`Life Steal +${heal}`, 'log-heal');
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
    if (!chainReaction && !isInitial) endTurnLogic();
}

function endTurnLogic() {
    if (currentState !== STATE.PLAYING) return;
    if (enemyHP <= 0 || playerHP <= 0) return;

    if (extraTurnTriggered) {
        log(isPlayerTurn ? ">> EXTRA TURN!" : ">> ENEMY EXTRA TURN!", "log-turn");
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
        turnBanner.innerText = "PLAYER TURN";
        turnBanner.className = "turn-indicator turn-player";
    } else {
        turnBanner.innerText = "ENEMY TURN";
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
        aiCursor.style.display = 'block';
        aiCursor.style.left = (t1.offsetLeft) + 'px';
        aiCursor.style.top = (t1.offsetTop) + 'px';
        setTimeout(() => {
            aiCursor.style.left = (t2.offsetLeft) + 'px';
            aiCursor.style.top = (t2.offsetTop) + 'px';
        }, 500);
        setTimeout(() => {
            aiCursor.style.display = 'none';
            attemptSwap(t1, t2);
        }, 1000);
    } else {
        log("Enemy found no moves. Passing...", "log-enemy");
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
        selectedClass.ultEffect();
        ultCharge = 0;

        // 3. Visuals
        log(`ULTIMATE! ${selectedClass.ultName} used!`, "log-hit");
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

    // Stats Display
    document.getElementById('stat-sword').innerText = TILE_STATS.sword;
    document.getElementById('stat-shield').innerText = TILE_STATS.shield;
    document.getElementById('stat-heart').innerText = TILE_STATS.heart;
    document.getElementById('stat-energy').innerText = TILE_STATS.energy;
    document.getElementById('stat-skull').innerText = TILE_STATS.skull_dmg;
    document.getElementById('stat-self-dmg').innerText = TILE_STATS.skull_self_dmg
    document.getElementById('stat-ult').innerText = TILE_STATS.ult_dmg;
    document.getElementById('stat-lifesteal').innerText = TILE_STATS.lifeSteal + "%";
    document.getElementById('ult-text').innerText = `${Math.floor(ultCharge)}%`;

    // Enemy Stats Display (separate pool - see ENEMY_TILE_STATS)
    document.getElementById('enemy-stat-sword').innerText = ENEMY_TILE_STATS.sword;
    document.getElementById('enemy-stat-shield').innerText = ENEMY_TILE_STATS.shield;
    document.getElementById('enemy-stat-heart').innerText = ENEMY_TILE_STATS.heart;
    document.getElementById('enemy-stat-energy').innerText = ENEMY_TILE_STATS.energy;
    document.getElementById('enemy-stat-skull').innerText = ENEMY_TILE_STATS.skull_dmg;
    document.getElementById('enemy-stat-self-dmg').innerText = ENEMY_TILE_STATS.skull_self_dmg;
}

function toggleModal(modalId) {
    let m = document.getElementById(modalId);
    if(m.style.display === 'flex') {
        m.style.display = 'none';
    } else {
        m.style.display = 'flex';
        // Only render history if opening history modal
        if(modalId === 'history-modal') {
            renderHistory();
            if (typeof fetchWallet === 'function') fetchWallet();
        }
    }
}

function renderHistory() {
    const listContainer = document.getElementById('history-list-container');
    const summaryContainer = document.getElementById('total-stats-summary');

    // 1. Render Summary
    summaryContainer.innerHTML = '';
    const statLabels = {
        sword: 'Sword', shield: 'Shield', heart: 'Heal', energy: 'Energy',
        skull_dmg: 'Skull', skull_self_dmg: 'Self Dmg', ult_dmg: 'Ult', lifeSteal: 'Steal %', maxHP: 'Max HP'
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
    if(!hasStats) summaryContainer.innerHTML = '<div style="grid-column: span 2; text-align:center;">No items collected yet.</div>';

    // 2. Render List
    listContainer.innerHTML = '';
    if(pickedRewards.length === 0) {
        listContainer.innerHTML = '<div style="color:#777; text-align:center;">Empty</div>';
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

createBoard();
renderClassButtons();
