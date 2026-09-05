// --- PERSISTENT ECONOMY (Supabase) ---
// Foundation for the multiplayer betrayal system's shared wallet (gold +
// materials survive between runs - see supabase/schema.sql). Kept in its own
// file, separate from game.js, since it's a different concern (persistence)
// from the match-3/combat logic.
//
// Identity uses Supabase Anonymous Auth: no signup screen, each browser gets
// a real auth.uid() the first time it loads, and Supabase remembers the
// session in localStorage on its own after that. A database trigger
// (handle_new_user in schema.sql) creates the matching players + wallets
// rows automatically the moment that identity is created.

const SUPABASE_URL = 'https://quvwzyrfpsmgwxecwuzo.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yZKlVLpQq41mWwiLdSadgw_xtgqBe36';

// `supabase` (lowercase, global) is the CDN library's own namespace - our
// client instance is named `sb` so the two don't collide.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

let currentWallet = null; // { gold, materials } once loaded
let currentOwnedItems = []; // array of item ids, see items.js for what they mean

async function ensureSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) return session;

    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
        console.error('Anonymous sign-in failed:', error.message);
        setWalletStatus('Bağlantı hatası');
        return null;
    }
    return data.session;
}

async function fetchWallet() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;

    const { data, error } = await sb
        .from('wallets')
        .select('gold, materials')
        .eq('player_id', user.id)
        .single();

    if (error) {
        console.error('Wallet fetch failed:', error.message);
        setWalletStatus('Yüklenemedi');
        return null;
    }

    currentWallet = data;
    updateWalletUI();
    setWalletStatus('');
    return data;
}

// Grants gold/materials - only ever positive amounts now (kill rewards,
// PvP's small loyal_survivor bonus). Purchases and betrayal payouts have
// their own dedicated functions below/in schema.sql. This used to be a
// plain `.update()` the client fully controlled (any player could set their
// own gold to anything non-negative via devtools, since RLS only checked
// row ownership, not the value); it's now the earn_currency() security
// definer RPC (supabase/schema.sql), which enforces a hard ceiling per call
// server-side regardless of what the client claims it earned.
async function adjustWallet(goldDelta, materialsDelta) {
    const { data, error } = await sb.rpc('earn_currency', {
        p_gold: goldDelta || 0, p_materials: materialsDelta || 0
    });
    if (error) {
        console.error('earn_currency failed:', error.message);
        return null;
    }

    currentWallet = data[0];
    updateWalletUI();
    return currentWallet;
}

// Betrayal PvP currency steal (see supabase/schema.sql's resolve_betrayal).
// Called ONLY by the winning client - the loser's client never calls this,
// it just sees the resulting balance next time it fetches its own wallet.
// A security definer Postgres function does the actual transfer since RLS
// correctly blocks a client from writing to someone else's wallet row.
async function resolveBetrayal(winnerId, loserId, lossPercent) {
    const { error } = await sb.rpc('resolve_betrayal', {
        winner_id: winnerId, loser_id: loserId, loss_percent: lossPercent
    });
    if (error) { console.error('resolve_betrayal failed:', error.message); return false; }
    await fetchWallet();
    return true;
}

// currentOwnedItems holds full row objects now (id, base_id, slot, rarity,
// rolled_stats, set_key, equipped_slot) - a rarity/loot system means two
// items can share a base_id but have completely different rolled stats, so
// "which ids I own" (the old shape) isn't enough anymore.
async function fetchOwnedItems() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return [];

    const { data, error } = await sb.from('player_items').select('*').eq('player_id', user.id);
    if (error) { console.error('Owned items fetch failed:', error.message); return currentOwnedItems; }

    currentOwnedItems = data;
    if (typeof renderShop === 'function') renderShop();
    if (typeof renderInventory === 'function') renderInventory();
    return currentOwnedItems;
}

// Only grey/white/blue are ever shop-purchasable (RARITY_DEFS.shopAvailable,
// items.js) - yellow/green/orange/red/teal only ever come from
// awardLootDrop. Rolls a brand new instance on every purchase, same item
// bought twice will NOT be identical.
//
// This used to be three separate client-driven steps (roll the item, deduct
// gold, insert the row) - nothing actually forced them to happen together,
// so a client could just insert the item directly and skip the deduction
// entirely (RLS only checked "is this my row," never "did they pay").
// purchase_item() (supabase/schema.sql) now does the cost lookup, gold
// deduction and item roll atomically server-side - the client only ever
// gets back the finished row or an error, never a chance to supply its own
// stats or skip payment.
async function purchaseItem(slot, rarityKey) {
    let rarity = RARITY_DEFS[rarityKey];
    if (!rarity || !rarity.shopAvailable) return false;

    const { data, error } = await sb.rpc('purchase_item', { p_slot: slot, p_rarity: rarityKey });
    if (error) {
        console.error('purchase_item failed:', error.message);
        setShopStatus(error.message.includes('insufficient gold') ? 'Yeterli altının yok.' : 'Satın alma başarısız oldu.');
        return false;
    }

    currentOwnedItems.push(data);
    await fetchWallet();
    let info = typeof itemDisplayInfo === 'function' ? itemDisplayInfo(data) : { name: data.base_id, emoji: '' };
    setShopStatus(`${info.emoji} ${info.name} satın alındı!`);
    if (typeof renderShop === 'function') renderShop();
    if (typeof renderInventory === 'function') renderInventory();
    return true;
}

// Puts an item in its slot, bumping out whatever was equipped there before
// (only one item per slot). Not atomic across two tabs, same rigor level as
// the rest of this prototype's economy calls.
async function equipItem(itemRowId) {
    let item = currentOwnedItems.find(it => it.id === itemRowId);
    if (!item) return false;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;

    let previouslyEquipped = currentOwnedItems.find(it => it.slot === item.slot && it.equipped_slot === item.slot);
    if (previouslyEquipped) {
        await sb.from('player_items').update({ equipped_slot: null }).eq('id', previouslyEquipped.id).eq('player_id', user.id);
        previouslyEquipped.equipped_slot = null;
    }

    const { error } = await sb.from('player_items').update({ equipped_slot: item.slot }).eq('id', itemRowId).eq('player_id', user.id);
    if (error) { console.error('Equip failed:', error.message); return false; }
    item.equipped_slot = item.slot;
    if (typeof renderInventory === 'function') renderInventory();
    return true;
}

async function unequipItem(itemRowId) {
    let item = currentOwnedItems.find(it => it.id === itemRowId);
    if (!item) return false;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;

    const { error } = await sb.from('player_items').update({ equipped_slot: null }).eq('id', itemRowId).eq('player_id', user.id);
    if (error) { console.error('Unequip failed:', error.message); return false; }
    item.equipped_slot = null;
    if (typeof renderInventory === 'function') renderInventory();
    return true;
}

// Called after a solo/PvP/co-op victory - rolls one random item (any
// rarity, including the ones the shop never sells) and adds it straight to
// the inventory, unequipped. Shows a toast the same way an achievement does.
async function awardLootDrop() {
    let item = rollLootDrop(currentOwnedItems);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;

    const { data, error } = await sb.from('player_items').insert({
        player_id: user.id, base_id: item.base_id, slot: item.slot,
        rarity: item.rarity, rolled_stats: item.rolled_stats, set_key: item.set_key
    }).select().single();

    if (error) { console.error('Loot drop insert failed:', error.message); return null; }
    currentOwnedItems.push(data);
    if (typeof renderInventory === 'function') renderInventory();
    if (typeof showLootToast === 'function') showLootToast(item);
    return data;
}

function setShopStatus(text) {
    let el = document.getElementById('shop-status');
    if (el) el.innerText = text;
}

// Top players by gold, via the get_leaderboard security definer function
// (see supabase/schema.sql) - RLS alone would only ever let a client read
// its OWN wallet, so comparing across players needs that one trusted,
// narrowly-scoped read path (display name + gold only, nothing else).
async function fetchLeaderboard(limit) {
    const { data, error } = await sb.rpc('get_leaderboard', { limit_count: limit || 10 });
    if (error) { console.error('Leaderboard fetch failed:', error.message); return []; }
    return data;
}

// players.display_name is nullable and defaults to null (shown as
// "İsimsiz Kahraman" on the leaderboard) - RLS's existing "update own player
// row" policy already covers this, no new policy or RPC needed.
async function setDisplayName(name) {
    const trimmed = (name || '').trim().slice(0, 24);
    if (!trimmed) return false;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;

    const { error } = await sb.from('players').update({ display_name: trimmed }).eq('id', user.id);
    if (error) { console.error('Display name update failed:', error.message); return false; }
    return true;
}

async function renderLeaderboard() {
    let container = document.getElementById('leaderboard-list');
    if (!container) return;
    container.innerHTML = '<p style="color:#7f8c8d; font-size:0.8rem;">Yükleniyor…</p>';

    let rows = await fetchLeaderboard(10);
    if (rows.length === 0) {
        container.innerHTML = '<p style="color:#7f8c8d; font-size:0.8rem;">Henüz kimse altın kazanmadı.</p>';
        return;
    }

    container.innerHTML = '';
    rows.forEach((row, i) => {
        let div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `<span class="history-name">#${i + 1} ${row.display_name}</span><span class="history-stats">🪙 ${row.gold}</span>`;
        container.appendChild(div);
    });
}

async function submitDisplayName() {
    let input = document.getElementById('display-name-input');
    if (!input) return;
    let ok = await setDisplayName(input.value);
    let status = document.getElementById('leaderboard-name-status');
    if (status) status.innerText = ok ? 'Kaydedildi!' : 'Kaydedilemedi.';
    if (ok) renderLeaderboard();
}

function updateWalletUI() {
    if (!currentWallet) return;
    // Two separate displays (Loot/Stats modal, Shop modal) show the same
    // numbers under different element ids - update whichever are present.
    ['wallet-gold', 'wallet-gold-shop'].forEach(id => { let el = document.getElementById(id); if (el) el.innerText = currentWallet.gold; });
    ['wallet-materials', 'wallet-materials-shop'].forEach(id => { let el = document.getElementById(id); if (el) el.innerText = currentWallet.materials; });
}

function setWalletStatus(text) {
    let el = document.getElementById('wallet-status');
    if (el) el.innerText = text;
}

// --- DAILY LOGIN REWARD ----------------------------------------------------
// Read-only fetch for "can I claim today" UI state - claim_daily_reward()
// (supabase/schema.sql) is the only thing that ever actually writes
// last_claim_date/streak_count, this just informs the button's label before
// the player clicks it. Comparing against the CLIENT's own local date is an
// approximation (a player exactly at midnight in a timezone that disagrees
// with the server's could see a stale "claim" button for a few minutes) -
// acceptable for a casual reward, and claim_daily_reward() itself is the
// real source of truth regardless (a stale button just means the RPC call
// fails with "already claimed today" instead of the button never appearing).
let currentDailyLogin = null;

async function fetchDailyLoginStatus() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;

    const { data, error } = await sb.from('daily_login').select('last_claim_date, streak_count').eq('player_id', user.id).maybeSingle();
    if (error) { console.error('Daily login fetch failed:', error.message); return null; }

    currentDailyLogin = data; // null if never claimed before - that's a valid "claim available" state
    if (typeof updateDailyLoginUI === 'function') updateDailyLoginUI();
    return data;
}

async function claimDailyReward() {
    const { data, error } = await sb.rpc('claim_daily_reward');
    if (error) {
        console.error('claim_daily_reward failed:', error.message);
        return { ok: false, alreadyClaimed: error.message.includes('already claimed') };
    }

    const result = data[0];
    currentWallet = currentWallet ? { ...currentWallet, gold: result.new_gold } : { gold: result.new_gold, materials: 0 };
    updateWalletUI();
    await fetchDailyLoginStatus();
    return { ok: true, streak: result.new_streak, reward: result.reward_gold };
}

function dailyLoginCanClaimToday() {
    if (!currentDailyLogin || !currentDailyLogin.last_claim_date) return true;
    let todayStr = new Date().toISOString().slice(0, 10);
    return currentDailyLogin.last_claim_date !== todayStr;
}

function updateDailyLoginUI() {
    let canClaim = dailyLoginCanClaimToday();
    let streak = currentDailyLogin ? currentDailyLogin.streak_count : 0;
    let streakEl = document.getElementById('daily-login-streak');
    let btn = document.getElementById('daily-login-claim-btn');
    let topBarBtn = document.getElementById('daily-login-btn');
    if (streakEl) streakEl.innerText = `Seri: ${streak} gün`;
    if (btn) {
        btn.disabled = !canClaim;
        btn.innerText = canClaim ? 'Ödülü Al' : 'Bugün zaten aldın, yarın gel!';
        btn.style.opacity = canClaim ? '1' : '0.6';
    }
    // A quiet dot on the top-bar button so a claimable reward is noticeable
    // without having to open the modal first.
    if (topBarBtn) topBarBtn.innerHTML = canClaim ? '🎁 Günlük Ödül <span style="color:#e74c3c;">●</span>' : '🎁 Günlük Ödül';
}

// --- DAILY QUESTS ------------------------------------------------------------
// Three fixed quests (same for everyone, no rotation), each a single
// real-gameplay-event claim rather than a tracked counter - see
// supabase/schema.sql's claim_daily_quest for why. Trigger call sites live
// in game.js (boss kill, useUltimate), pvp.js (match win, pvpUseUltimate)
// and coop.js (boss kill, coopUseUltimate) - all three modes share the same
// three quest keys, so winning any of them (or using any class's ult in any
// mode) can complete a quest.
const DAILY_QUEST_DEFS = {
    kill_boss: { label: 'Bir boss öldür', emoji: '👹' },
    win_pvp: { label: 'Bir PvP maçı kazan', emoji: '🗡️' },
    use_ultimate: { label: 'Bir Ultimate kullan', emoji: '✨' }
};
let currentDailyQuests = {}; // { quest_key: true } for ones already claimed today

async function fetchDailyQuestStatus() {
    // Render the static quest list immediately from whatever
    // currentDailyQuests already holds (empty on first call, meaning "all
    // pending") - the list showing up right away, correct or not yet
    // confirmed, beats staying blank while the network round trip is in
    // flight or if it fails outright.
    if (typeof updateDailyQuestUI === 'function') updateDailyQuestUI();

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    let todayStr = new Date().toISOString().slice(0, 10);

    const { data, error } = await sb.from('daily_quests').select('quest_key').eq('player_id', user.id).eq('quest_date', todayStr);
    if (error) { console.error('Daily quest fetch failed:', error.message); return; }

    currentDailyQuests = {};
    (data || []).forEach(row => { currentDailyQuests[row.quest_key] = true; });
    if (typeof updateDailyQuestUI === 'function') updateDailyQuestUI();
}

// Called from the actual gameplay moment (boss kill / PvP win / ult use) in
// all three modes - silent and best-effort. A player who already claimed
// today just sees nothing happen, which is correct; the local
// currentDailyQuests check skips the round trip entirely once claimed this
// session, same as economy.js's other "don't bother the network for
// something we already know" checks.
async function claimDailyQuest(questKey) {
    if (currentDailyQuests[questKey]) return;
    const { data, error } = await sb.rpc('claim_daily_quest', { p_quest_key: questKey });
    if (error) { console.error('claim_daily_quest failed:', error.message); return; }

    const result = data[0];
    currentDailyQuests[questKey] = true;
    if (typeof updateDailyQuestUI === 'function') updateDailyQuestUI();

    if (!result.already_claimed) {
        await fetchWallet();
        let def = DAILY_QUEST_DEFS[questKey];
        let el = document.createElement('div');
        el.className = 'achievement-toast';
        el.innerHTML = `<b>${def.emoji} GÖREV TAMAMLANDI</b><br>${def.label} (+${result.quest_gold} 🪙)`;
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('visible'), 10);
        setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 3500);
    }
}

function updateDailyQuestUI() {
    let container = document.getElementById('daily-quest-list');
    if (!container) return;
    container.innerHTML = Object.keys(DAILY_QUEST_DEFS).map(key => {
        let def = DAILY_QUEST_DEFS[key];
        let done = !!currentDailyQuests[key];
        return `<div class="manual-tile" style="opacity:${done ? '0.6' : '1'};">
            <span class="manual-icon">${done ? '✅' : def.emoji}</span>
            <div class="manual-desc"><b>${def.label}</b>${done ? 'Tamamlandı (+15 🪙)' : 'Beklemede'}</div>
        </div>`;
    }).join('');
}

async function handleClaimDailyReward() {
    let result = await claimDailyReward();
    let status = document.getElementById('daily-login-status');
    if (!result.ok) {
        if (status) status.innerText = result.alreadyClaimed ? 'Bugün zaten aldın, yarın tekrar gel!' : 'Bir hata oldu, tekrar dene.';
        return;
    }
    if (status) status.innerText = `+${result.reward} 🪙 kazandın! (${result.streak}. gün serisi)`;
}

async function initEconomy() {
    setWalletStatus('Bağlanıyor…');
    const session = await ensureSession();
    // Flush whatever logClientError (index.html) queued before `sb` existed -
    // that queue is the only reason any error from before this point isn't
    // already lost. Runs regardless of whether the session succeeded, since
    // a failed session is itself exactly the kind of thing worth reporting.
    if (window.__pendingClientErrors && window.__pendingClientErrors.length) {
        const pending = window.__pendingClientErrors;
        window.__pendingClientErrors = [];
        pending.forEach(entry => sb.from('client_errors').insert(entry).then(() => {}, () => {}));
    }
    if (!session) return;
    await fetchWallet();
    await fetchOwnedItems();
    await fetchDailyLoginStatus();
    await fetchDailyQuestStatus();
    if (typeof fetchAchievements === 'function') await fetchAchievements();
}

initEconomy();
