// --- AUCTION HALL -------------------------------------------------------------------------
// Players sell items to each other for gold (supabase/schema.sql section
// 33): a fixed price, the first buyer gets it, 5% of the sale is burned, a
// listing runs 48 hours and an unsold item goes back to the seller's
// shared stash. Bought items land in the buyer's shared stash. Reached
// from the town's auction hall only.

const AUCTION_FEE = 0.05;
let auctionTab = 'browse';                 // 'browse' | 'sell' | 'mine'
let auctionFilter = { slot: '', rarity: '', usable: false, sort: 'price' };
let auctionRows = [];
let auctionSellPick = null;                // item id chosen on the sell tab

async function auctionFetch() {
    const f = auctionFilter;
    const { data, error } = await sb.rpc('get_auction_listings', { p_slot: f.slot || null, p_rarity: f.rarity || null, p_min_level: 1, p_max_level: 50, p_sort: f.sort, p_limit: 60, p_offset: 0 });
    if (error) { console.error('get_auction_listings:', error.message); return null; }
    auctionRows = data || [];
    return auctionRows;
}

function auctionStatus(text, bad) {
    const el = document.getElementById('auction-status');
    if (el) { el.textContent = text || ''; el.style.color = bad ? '#f87171' : '#f1c40f'; }
}

function auctionOpen() { auctionTab = 'browse'; auctionSellPick = null; renderAuction(); }

function auctionItemRow(it, extra) {
    const rarity = RARITY_DEFS[it.rarity] || RARITY_DEFS.white;
    const info = itemDisplayInfo(it);
    const row = document.createElement('div');
    row.className = 'auc-row';
    row.style.setProperty('--rc', rarity.color);
    const icon = document.createElement('div');
    icon.className = 'auc-icon';
    icon.innerHTML = typeof invIconHtml === 'function' ? invIconHtml(it, true) : info.emoji;
    const txt = document.createElement('div');
    txt.className = 'auc-txt';
    const cls = typeof itemClasses === 'function' ? itemClasses(it) : null;
    const usable = typeof invUsable === 'function' ? invUsable(it) : true;
    txt.innerHTML = `<b>${info.name}</b><small>${rarity.mark} ${t(rarity.label)} · ${t(SLOT_LABELS[itemSlotOf(it)])} · ${tf('Sv. {n}', { n: it.req_level || it.item_level || 1 })}${usable ? '' : ' · <span class="auc-bad">' + t('sana uygun değil') + '</span>'}</small>`
        + `<small class="auc-stats">${Object.entries(it.rolled_stats || {}).map(([k, v]) => { const s = (typeof INV_STATS !== 'undefined' && INV_STATS[k]) || ['', k]; return `${s[0]} ${v > 0 ? '+' : ''}${v}`; }).join('  ')}</small>`
        + (cls && cls.length < 7 ? `<small class="auc-cls">${cls.map(k => { const d = typeof classDefFor === 'function' ? classDefFor(k) : null; return d ? d.emoji : k; }).join(' ')}</small>` : '');
    row.append(icon, txt);
    if (extra) row.appendChild(extra);
    return row;
}

async function renderAuction() {
    const box = document.getElementById('auction-body');
    if (!box) return;
    ['browse', 'sell', 'mine'].forEach(k => { const b = document.getElementById('auction-tab-' + k); if (b) b.classList.toggle('on', auctionTab === k); });
    const gold = document.getElementById('auction-gold');
    if (gold) gold.textContent = (typeof currentWallet !== 'undefined' && currentWallet) ? currentWallet.gold : '–';
    box.innerHTML = `<p class="inv-muted">${t('Yükleniyor…')}</p>`;
    if (auctionTab === 'browse') return renderAuctionBrowse(box);
    if (auctionTab === 'sell') return renderAuctionSell(box);
    return renderAuctionMine(box);
}

async function renderAuctionBrowse(box) {
    const rows = await auctionFetch();
    box.innerHTML = '';
    const tools = document.createElement('div');
    tools.className = 'inv-tools auc-tools';
    const sel = (id, options, value, on) => {
        const s = document.createElement('select'); s.id = id;
        options.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; s.appendChild(o); });
        s.value = value; s.onchange = () => { on(s.value); renderAuction(); }; return s;
    };
    tools.appendChild(sel('auction-slot', [['', t('Bütün yuvalar')]].concat(ITEM_SLOTS.map(s => [s, t(SLOT_LABELS[s])])), auctionFilter.slot, v => { auctionFilter.slot = v; }));
    tools.appendChild(sel('auction-rarity', [['', t('Bütün nadirlikler')]].concat(Object.keys(RARITY_DEFS).map(k => [k, RARITY_DEFS[k].mark + ' ' + t(RARITY_DEFS[k].label)])), auctionFilter.rarity, v => { auctionFilter.rarity = v; }));
    tools.appendChild(sel('auction-sort', [['price', t('En ucuz')], ['price_desc', t('En pahalı')], ['level', t('En yüksek seviye')], ['new', t('En yeni')]], auctionFilter.sort, v => { auctionFilter.sort = v; }));
    box.appendChild(tools);
    const lab = document.createElement('label');
    lab.className = 'auc-check';
    lab.innerHTML = `<input type="checkbox" id="auction-usable" ${auctionFilter.usable ? 'checked' : ''}> ${t('Sadece kullanabildiklerim')}`;
    lab.querySelector('input').onchange = ev => { auctionFilter.usable = ev.target.checked; renderAuction(); };
    box.appendChild(lab);
    if (!rows) { box.insertAdjacentHTML('beforeend', `<p class="inv-muted">${t('Müzayede yüklenemedi.')}</p>`); return; }
    const myId = (typeof activeCharacter !== 'undefined' && activeCharacter) ? activeCharacter.player_id : null;
    const list = rows.filter(r => !auctionFilter.usable || (typeof invUsable === 'function' && invUsable(r)));
    if (!list.length) { box.insertAdjacentHTML('beforeend', `<p class="inv-muted">${t('Şu an bu aramaya uyan ilan yok.')}</p>`); return; }
    const wrap = document.createElement('div'); wrap.className = 'auc-list'; wrap.id = 'auction-list';
    const gold = (typeof currentWallet !== 'undefined' && currentWallet) ? currentWallet.gold : 0;
    list.forEach(r => {
        const buy = document.createElement('div'); buy.className = 'auc-buy';
        const price = document.createElement('b'); price.textContent = `🪙 ${r.price}`;
        const btn = document.createElement('button');
        btn.className = 'action-btn auc-act'; btn.textContent = t('Satın al');
        btn.disabled = r.price > gold || r.seller_player === myId;
        if (r.seller_player === myId) btn.textContent = t('Senin ilanın');
        btn.onclick = async () => {
            if (!confirm(tf('{name} - {price} altına satın alınsın mı?', { name: itemDisplayInfo(r).name, price: r.price }))) return;
            btn.disabled = true;
            const ok = await auctionBuy(r.id);
            if (ok) renderAuction(); else btn.disabled = false;
        };
        const who = document.createElement('small'); who.className = 'auc-seller'; who.textContent = r.seller_name || '';
        buy.append(price, who, btn);
        wrap.appendChild(auctionItemRow(r, buy));
    });
    box.appendChild(wrap);
}

function auctionSellable() {
    const id = typeof invActiveId === 'function' ? invActiveId() : null;
    return (typeof currentOwnedItems !== 'undefined' ? currentOwnedItems : []).filter(it => !it.equipped_slot && !it.locked && !it.listed && (!id || !('character_id' in it) || it.character_id === id || it.character_id === null));
}

function renderAuctionSell(box) {
    box.innerHTML = '';
    const items = auctionSellable();
    if (!items.length) { box.innerHTML = `<p class="inv-muted">${t('Satabileceğin bir eşya yok (kuşanılan ve kilitli eşyalar satılamaz).')}</p>`; return; }
    const grid = document.createElement('div'); grid.className = 'inv-grid auc-grid'; grid.id = 'auction-sell-grid';
    items.forEach(it => {
        const c = document.createElement('button'); c.type = 'button';
        c.className = 'inv-cell rarity-' + it.rarity + (auctionSellPick === it.id ? ' selected' : '');
        c.style.setProperty('--rc', RARITY_DEFS[it.rarity].color);
        c.dataset.itemId = it.id;
        c.innerHTML = invIconHtml(it, true) + `<span class="inv-lvl">${it.item_level || 1}</span>`;
        c.onclick = () => { auctionSellPick = it.id; renderAuctionSell(box); };
        grid.appendChild(c);
    });
    box.appendChild(grid);
    const it = items.find(x => x.id === auctionSellPick);
    if (!it) { box.insertAdjacentHTML('beforeend', `<p class="inv-muted">${t('Satmak istediğin eşyayı seç.')}</p>`); return; }
    const form = document.createElement('div'); form.className = 'auc-sell';
    const suggest = Math.max(1, Math.round((typeof invSellValue === 'function' ? invSellValue(it) : 10) * 3));
    form.appendChild(auctionItemRow(it));
    form.insertAdjacentHTML('beforeend', `<label class="auc-price">${t('Fiyat')} 🪙 <input id="auction-price" type="number" min="1" max="1000000" step="1" value="${suggest}"></label><p class="inv-muted" id="auction-net"></p>`);
    const go = document.createElement('button'); go.className = 'action-btn primary'; go.id = 'auction-list-btn'; go.textContent = t('İlana koy (48 saat)');
    form.appendChild(go);
    box.appendChild(form);
    const priceEl = document.getElementById('auction-price'), net = document.getElementById('auction-net');
    const upd = () => { const p = Math.max(0, parseInt(priceEl.value, 10) || 0); net.textContent = tf('Komisyon %5: {fee} · Satılınca eline geçecek: {net} altın', { fee: Math.floor(p * AUCTION_FEE), net: p - Math.floor(p * AUCTION_FEE) }); };
    priceEl.oninput = upd; upd();
    go.onclick = async () => {
        const p = parseInt(priceEl.value, 10);
        if (!(p >= 1 && p <= 1000000)) { auctionStatus(t('Fiyat 1 ile 1.000.000 arasında olmalı.'), true); return; }
        go.disabled = true;
        const ok = await auctionList(it.id, p);
        go.disabled = false;
        if (ok) { auctionSellPick = null; auctionTab = 'mine'; renderAuction(); }
    };
}

async function renderAuctionMine(box) {
    const { data, error } = await sb.rpc('get_my_listings');
    box.innerHTML = '';
    if (error) { box.innerHTML = `<p class="inv-muted">${t('Müzayede yüklenemedi.')}</p>`; return; }
    if (!data || !data.length) { box.innerHTML = `<p class="inv-muted">${t('Henüz ilanın yok.')}</p>`; return; }
    const STATUS = { active: t('Satışta'), sold: t('Satıldı'), cancelled: t('Geri çekildi'), expired: t('Süresi doldu (depoya döndü)') };
    const wrap = document.createElement('div'); wrap.className = 'auc-list'; wrap.id = 'auction-mine';
    data.forEach(r => {
        const side = document.createElement('div'); side.className = 'auc-buy';
        const price = document.createElement('b'); price.textContent = `🪙 ${r.price}`;
        const st = document.createElement('small'); st.className = 'auc-state ' + r.status; st.textContent = STATUS[r.status] || r.status;
        side.append(price, st);
        if (r.status === 'sold') { const n = document.createElement('small'); n.textContent = tf('+{net} altın', { net: r.price - Math.floor(r.price * AUCTION_FEE) }); side.appendChild(n); }
        if (r.status === 'active') {
            const c = document.createElement('button'); c.className = 'action-btn auc-act'; c.textContent = t('Geri çek');
            c.onclick = async () => { c.disabled = true; if (await auctionCancel(r.id)) renderAuction(); else c.disabled = false; };
            side.appendChild(c);
        }
        wrap.appendChild(auctionItemRow(r, side));
    });
    box.appendChild(wrap);
}

async function auctionList(itemId, price) {
    const { data, error } = await sb.rpc('list_item', { p_item_id: itemId, p_price: price });
    if (error) {
        const m = error.message;
        auctionStatus(/locked/.test(m) ? t('Kilitli eşya.') : /unequip/.test(m) ? t('Önce çıkarman lazım.') : /20 active/.test(m) ? t('En fazla 20 aktif ilanın olabilir.') : t('İlana konamadı.'), true);
        return false;
    }
    const it = currentOwnedItems.find(x => x.id === itemId);
    if (it) { it.listed = true; it.character_id = null; }
    auctionStatus(tf('📜 İlana kondu: {price} altın.', { price: data.price }));
    if (typeof renderInventory === 'function') renderInventory();
    return true;
}

async function auctionBuy(listingId) {
    const { data, error } = await sb.rpc('buy_listing', { p_listing_id: listingId });
    if (error) {
        const m = error.message;
        auctionStatus(/insufficient/.test(m) ? t('Yeterli altının yok.') : /no longer/.test(m) ? t('Bu ilan artık satışta değil.') : t('Satın alınamadı.'), true);
        return false;
    }
    auctionStatus(tf('✅ Satın aldın! Eşya ortak deponda.', {}));
    if (typeof fetchWallet === 'function') await fetchWallet();
    if (typeof fetchOwnedItems === 'function') await fetchOwnedItems();
    if (typeof playSound === 'function') playSound('gold');
    return !!data;
}

async function auctionCancel(listingId) {
    const { data, error } = await sb.rpc('cancel_listing', { p_listing_id: listingId });
    if (error) { auctionStatus(t('Geri çekilemedi.'), true); return false; }
    const it = currentOwnedItems.find(x => x.id === data.item_id);
    if (it) { it.listed = false; it.character_id = null; }
    auctionStatus(t('İlan geri çekildi; eşya ortak deponda.'));
    if (typeof renderInventory === 'function') renderInventory();
    return true;
}

function switchAuctionTab(tab) { auctionTab = tab; auctionStatus(''); renderAuction(); }
