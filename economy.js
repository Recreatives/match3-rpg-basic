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

function updateWalletUI() {
    let goldEl = document.getElementById('wallet-gold');
    let matEl = document.getElementById('wallet-materials');
    if (!currentWallet || !goldEl || !matEl) return;
    goldEl.innerText = currentWallet.gold;
    matEl.innerText = currentWallet.materials;
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
}

initEconomy();
