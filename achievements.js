// --- ACHIEVEMENTS (8 milestones, now stat-granting and resettable) ---
// Two separate ideas share this one catalog:
//
//   currentUnlockedAchievements - LIFETIME record, permanent, never removed.
//   "Have I ever done this?" - stored in supabase's player_achievements,
//   shown in the 🏆 modal as your history/bragging rights.
//
//   currentActiveAchievements - THIS RUN's buffs, client-side only, reset to
//   empty on any defeat (solo game over, a co-op party wipe, losing a PvP
//   duel). "Am I currently benefiting from this?" A lifetime-unlocked
//   achievement's stat bonus only applies while it's also active - dying
//   costs you the buff even though the achievement itself stays on your
//   permanent record, and re-triggering the same moment (e.g. another boss
//   kill) re-activates it for the new run.
//
// The catalog (name, description, emoji, stat bonus) lives entirely here -
// the database only ever stores WHICH achievement ids are on someone's
// lifetime record, never which ones are currently active (that's per-run,
// not worth persisting).

const ACHIEVEMENT_CATALOG = {
    boss_slayer: { id: 'boss_slayer', emoji: '👹', name: 'Boss Avcısı', desc: 'Solo modda bir boss yendin.', bonusDesc: '+2 Kılıç', bonus: (s) => { s.sword += 2; } },
    flawless_victory: { id: 'flawless_victory', emoji: '💯', name: 'Kusursuz Zafer', desc: 'Solo modda %100 canla bir zafer kazandın.', bonusDesc: '+5 Kalkan', bonus: (s) => { s.shield += 5; } },
    first_betrayal: { id: 'first_betrayal', emoji: '🗡️', name: 'İlk Bıçak', desc: 'İlk kez yoldaşına ihanet ettin.', bonusDesc: '+5 Kafatası Hasarı', bonus: (s) => { s.skull_dmg += 5; } },
    loyal_survivor: { id: 'loyal_survivor', emoji: '🩹', name: 'Sadakatin Bedeli', desc: 'İhanete uğradın ama düelloyu yine de kazandın.', bonusDesc: '+3 Kalp', bonus: (s) => { s.heart += 3; } },
    cursed_but_victorious: { id: 'cursed_but_victorious', emoji: '👑', name: 'Lanetli Zafer', desc: 'Kibir Laneti’ni taşıyıp düelloyu yine de kazandın.', bonusDesc: '+8 Ult Gücü', bonus: (s) => { s.ult_dmg += 8; } },
    mutual_destruction: { id: 'mutual_destruction', emoji: '💀', name: 'Karşılıklı Yıkım', desc: 'Karşılıklı ihanet düellosunu kazandın.', bonusDesc: '+%3 Can Çalma', bonus: (s) => { s.lifeSteal += 3; } },
    down_and_up: { id: 'down_and_up', emoji: '🧟', name: 'Ayağa Kalkan', desc: 'Co-op’ta bayılıp takım arkadaşınca ayağa kaldırıldın.', bonusDesc: '+3 Takım İyileştirme', bonus: (s) => { s.teamHeal += 3; } },
    dungeon_boss_5: { id: 'dungeon_boss_5', emoji: '🐉', name: 'Zindan Ekibi', desc: 'Co-op’ta bir boss’u sadık kalarak birlikte yendiniz.', bonusDesc: '+3 Enerji', bonus: (s) => { s.energy += 3; } }
};

let currentUnlockedAchievements = []; // lifetime record - permanent, from the database
let currentActiveAchievements = []; // this run's buffs - client-side, reset on any defeat

async function fetchAchievements() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return [];

    const { data, error } = await sb.from('player_achievements').select('achievement_id').eq('player_id', user.id);
    if (error) { console.error('Achievements fetch failed:', error.message); return currentUnlockedAchievements; }

    currentUnlockedAchievements = data.map(row => row.achievement_id);
    if (typeof renderAchievements === 'function') renderAchievements();
    return currentUnlockedAchievements;
}

// Safe to call speculatively every time the triggering moment happens (a
// boss win, a betrayal vote, ...). Always re-activates the buff for the
// current run (even if it was already on the lifetime record and got reset
// by an earlier defeat) - only the ONE-TIME permanent-record insert is
// guarded against repeating.
async function unlockAchievement(id) {
    let def = ACHIEVEMENT_CATALOG[id];
    if (!def) return;

    let alreadyLifetime = currentUnlockedAchievements.includes(id);
    if (!currentActiveAchievements.includes(id)) {
        currentActiveAchievements.push(id);
        showAchievementToast(def, alreadyLifetime);
        if (typeof renderAchievements === 'function') renderAchievements();
    }
    if (alreadyLifetime) return; // permanent record already has this - nothing left to persist

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    currentUnlockedAchievements.push(id); // optimistic - avoids a duplicate insert race from two rapid triggers
    const { error } = await sb.from('player_achievements').insert({ player_id: user.id, achievement_id: id });
    if (error) {
        console.error('Achievement unlock failed:', error.message);
        currentUnlockedAchievements = currentUnlockedAchievements.filter(a => a !== id);
        return;
    }
    if (typeof renderAchievements === 'function') renderAchievements();
}

// Called on any defeat (solo game over, a co-op party wipe, losing a PvP
// duel) - the buffs go away, the lifetime record (currentUnlockedAchievements)
// does not. Re-earning the same achievement later re-activates it.
function resetActiveAchievements() {
    if (currentActiveAchievements.length === 0) return;
    currentActiveAchievements = [];
    if (typeof renderAchievements === 'function') renderAchievements();
}

// Called once per run start (game.js's resetGame and its class-selection
// handler), same call sites items.js's applyEquippedItemBonuses uses - both
// just mutate the same TILE_STATS object.
function applyActiveAchievementBonuses(stats, activeIds) {
    (activeIds || []).forEach(id => {
        let def = ACHIEVEMENT_CATALOG[id];
        if (def && def.bonus) def.bonus(stats);
    });
}

function showAchievementToast(def, isReactivation) {
    let el = document.createElement('div');
    el.className = 'achievement-toast';
    el.innerHTML = `<b>${def.emoji} ${isReactivation ? t('BAŞARIM YENİDEN AKTİF') : t('BAŞARIM AÇILDI')}</b><br>${t(def.name)} (${t(def.bonusDesc)})`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('visible'), 10);
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 3500);
}

function renderAchievements() {
    let container = document.getElementById('achievement-list');
    if (!container) return;
    container.innerHTML = '';

    Object.values(ACHIEVEMENT_CATALOG).forEach(def => {
        let lifetime = currentUnlockedAchievements.includes(def.id);
        let active = currentActiveAchievements.includes(def.id);
        let row = document.createElement('div');
        row.className = 'manual-tile';
        row.style.opacity = lifetime ? '1' : '0.4';
        let statusTag = !lifetime ? '' : (active
            ? ` <span style="color:#2ecc71;">● ${t('AKTİF')}</span>`
            : ` <span style="color:#e74c3c;">○ ${t('pasif - tekrar kazan')}</span>`);
        row.innerHTML = `<span class="manual-icon">${lifetime ? def.emoji : '🔒'}</span>
            <div class="manual-desc"><b>${t(def.name)}</b>${statusTag}<br>${t(def.desc)}<br><span style="color:#f1c40f;">${t(def.bonusDesc)}</span></div>`;
        container.appendChild(row);
    });
}
