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

async function fetchOwnedItems() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return [];

    const { data, error } = await sb.from('player_items').select('item_id').eq('player_id', user.id);
    if (error) { console.error('Owned items fetch failed:', error.message); return currentOwnedItems; }

    currentOwnedItems = data.map(row => row.item_id);
    if (typeof renderShop === 'function') renderShop();
    return currentOwnedItems;
}

// Not atomic against buying the same item twice from two tabs at once (the
// wallet debit and the item insert are two separate round trips) - an
// acceptable gap for a prototype shop, same rigor level as adjustWallet
// above. player_items' primary key (player_id, item_id) at least guarantees
// a double-insert can't duplicate the item itself.
async function purchaseItem(itemId) {
    let item = ITEM_CATALOG[itemId];
    if (!item) return false;
    if (currentOwnedItems.includes(itemId)) return false;
    if (!currentWallet) await fetchWallet();
    if ((currentWallet?.gold || 0) < item.cost.gold || (currentWallet?.materials || 0) < item.cost.materials) {
        setShopStatus('Yeterli altının/hammadden yok.');
        return false;
    }

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;

    let updatedWallet = await adjustWallet(-item.cost.gold, -item.cost.materials);
    if (!updatedWallet) { setShopStatus('Satın alma başarısız oldu.'); return false; }

    const { error } = await sb.from('player_items').insert({ player_id: user.id, item_id: itemId });
    if (error) {
        console.error('Item purchase insert failed:', error.message);
        // Wallet was already charged - refund locally so the player isn't
        // left worse off by a failed insert (fetchWallet re-syncs after).
        await adjustWallet(item.cost.gold, item.cost.materials);
        setShopStatus('Satın alma başarısız oldu, ücret iade edildi.');
        return false;
    }

    currentOwnedItems.push(itemId);
    setShopStatus(`${item.emoji} ${item.name} satın alındı!`);
    if (typeof renderShop === 'function') renderShop();
    return true;
}

function setShopStatus(text) {
    let el = document.getElementById('shop-status');
    if (el) el.innerText = text;
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
