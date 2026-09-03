// --- ACHIEVEMENTS (first pass: 8 one-time milestones) ---
// Each one is a permanent, lifetime flag - not a cumulative counter (e.g.
// "won 10 duels") - kept deliberately simple for a first pass, same "small
// and testable, expand later" approach the item/set system used. The
// catalog (name, description, emoji) lives entirely here, client-side -
// supabase/schema.sql's player_achievements table only ever stores WHICH
// achievement ids a player has unlocked.

const ACHIEVEMENT_CATALOG = {
    boss_slayer: { id: 'boss_slayer', emoji: '👹', name: 'Boss Avcısı', desc: 'Solo modda bir boss yendin.' },
    flawless_victory: { id: 'flawless_victory', emoji: '💯', name: 'Kusursuz Zafer', desc: 'Solo modda %100 canla bir zafer kazandın.' },
    first_betrayal: { id: 'first_betrayal', emoji: '🗡️', name: 'İlk Bıçak', desc: 'İlk kez yoldaşına ihanet ettin.' },
    loyal_survivor: { id: 'loyal_survivor', emoji: '🩹', name: 'Sadakatin Bedeli', desc: 'İhanete uğradın ama düelloyu yine de kazandın.' },
    cursed_but_victorious: { id: 'cursed_but_victorious', emoji: '👑', name: 'Lanetli Zafer', desc: 'Kibir Laneti’ni taşıyıp düelloyu yine de kazandın.' },
    mutual_destruction: { id: 'mutual_destruction', emoji: '💀', name: 'Karşılıklı Yıkım', desc: 'Karşılıklı ihanet düellosunu kazandın.' },
    down_and_up: { id: 'down_and_up', emoji: '🧟', name: 'Ayağa Kalkan', desc: 'Co-op’ta bayılıp takım arkadaşınca ayağa kaldırıldın.' },
    dungeon_boss_5: { id: 'dungeon_boss_5', emoji: '🐉', name: 'Zindan Ekibi', desc: 'Co-op’ta bir boss’u sadık kalarak birlikte yendiniz.' }
};

let currentUnlockedAchievements = []; // array of achievement ids

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
// boss win, a betrayal vote, ...) - already-unlocked ids are skipped both
// locally and by the database's own primary key, so calling this twice for
// the same id is harmless.
async function unlockAchievement(id) {
    if (currentUnlockedAchievements.includes(id)) return;
    let def = ACHIEVEMENT_CATALOG[id];
    if (!def) return;

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    currentUnlockedAchievements.push(id); // optimistic - avoids a duplicate insert race from two rapid triggers
    const { error } = await sb.from('player_achievements').insert({ player_id: user.id, achievement_id: id });
    if (error) {
        console.error('Achievement unlock failed:', error.message);
        currentUnlockedAchievements = currentUnlockedAchievements.filter(a => a !== id);
        return;
    }

    showAchievementToast(def);
    if (typeof renderAchievements === 'function') renderAchievements();
}

function showAchievementToast(def) {
    let el = document.createElement('div');
    el.className = 'achievement-toast';
    el.innerHTML = `<b>${def.emoji} BAŞARIM AÇILDI</b><br>${def.name}`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('visible'), 10);
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 3500);
}

function renderAchievements() {
    let container = document.getElementById('achievement-list');
    if (!container) return;
    container.innerHTML = '';

    Object.values(ACHIEVEMENT_CATALOG).forEach(def => {
        let unlocked = currentUnlockedAchievements.includes(def.id);
        let row = document.createElement('div');
        row.className = 'manual-tile';
        row.style.opacity = unlocked ? '1' : '0.4';
        row.innerHTML = `<span class="manual-icon">${unlocked ? def.emoji : '🔒'}</span>
            <div class="manual-desc"><b>${def.name}</b>${def.desc}</div>`;
        container.appendChild(row);
    });
}
