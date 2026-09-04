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

// Not wired to any UI yet (no shop, no confirmed earning/spending rules) -
// this is here so the shop and reward systems have a single, already-tested
// place to change a player's balance from, instead of each feature writing
// its own Supabase call later.
async function adjustWallet(goldDelta, materialsDelta) {
    if (!currentWallet) await fetchWallet();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;

    const newGold = Math.max(0, (currentWallet?.gold || 0) + goldDelta);
    const newMaterials = Math.max(0, (currentWallet?.materials || 0) + materialsDelta);

    const { data, error } = await sb
        .from('wallets')
        .update({ gold: newGold, materials: newMaterials })
        .eq('player_id', user.id)
        .select('gold, materials')
        .single();

    if (error) {
        console.error('Wallet update failed:', error.message);
        return null;
    }

    currentWallet = data;
    updateWalletUI();
    return data;
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
async function purchaseItem(slot, rarityKey) {
    let rarity = RARITY_DEFS[rarityKey];
    if (!rarity || !rarity.shopAvailable) return false;
    let item = generateItem(slot, rarityKey);
    if (!currentWallet) await fetchWallet();
    if ((currentWallet?.gold || 0) < item.cost) {
        setShopStatus('Yeterli altının yok.');
        return false;
    }

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;

    let updatedWallet = await adjustWallet(-item.cost, 0);
    if (!updatedWallet) { setShopStatus('Satın alma başarısız oldu.'); return false; }

    const { data, error } = await sb.from('player_items').insert({
        player_id: user.id, base_id: item.base_id, slot: item.slot,
        rarity: item.rarity, rolled_stats: item.rolled_stats, set_key: item.set_key
    }).select().single();

    if (error) {
        console.error('Item purchase insert failed:', error.message);
        // Wallet was already charged - refund locally so the player isn't
        // left worse off by a failed insert.
        await adjustWallet(item.cost, 0);
        setShopStatus('Satın alma başarısız oldu, ücret iade edildi.');
        return false;
    }

    currentOwnedItems.push(data);
    setShopStatus(`${item.emoji} ${item.name} satın alındı!`);
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

async function initEconomy() {
    setWalletStatus('Bağlanıyor…');
    const session = await ensureSession();
    if (!session) return;
    await fetchWallet();
    await fetchOwnedItems();
    if (typeof fetchAchievements === 'function') await fetchAchievements();
}

initEconomy();
