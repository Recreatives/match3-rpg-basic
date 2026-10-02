// --- INVENTORY (Diablo-style) ------------------------------------------------------------
// The "🎒 Envanter" tab of the shop modal: the painted hero in the middle
// with the 12 equip slots around it, a stats panel, and a bag grid (this
// character's bag, or the shared stash) where big items take two cells.
// Tapping an item opens a detail sheet: the hero wearing it (try-on), a
// compare against what's worn in that slot, and every action (equip,
// stash / bag, lock, upgrade, scrap, sell).
//
// Everything goes through economy.js's server calls (equip_item,
// move_item, lock_item, ... - supabase/schema.sql section 30); this file
// only draws.

const INV_BAG_SIZE = 60;
const INV_STASH_SIZE = 120;
const INV_DOLL_LEFT = ['helmet', 'shoulder', 'chest', 'gloves', 'belt'];
const INV_DOLL_RIGHT = ['amulet', 'ring1', 'ring2', 'legs', 'boots'];
const INV_DOLL_HANDS = ['weapon', 'offhand'];
const INV_STATS = {
    sword: ['⚔️', 'Saldırı'], heart: ['💖', 'İyileşme'], shield: ['🛡️', 'Zırh'], energy: ['⚡', 'Enerji'],
    skull_dmg: ['💀', 'Kafatası hasarı'], ult_dmg: ['🌟', 'Ult hasarı'], lifeSteal: ['🩸', 'Can çalma'],
    teamHeal: ['💚', 'Takım iyileştirme'], skull_self_dmg: ['☠️', 'Kafatası öz-hasarı']
};

let invTab = 'bag';          // 'bag' | 'stash'
let invSort = 'rarity';      // 'rarity' | 'level' | 'slot' | 'new'
let invFilter = 'all';       // 'all' | 'usable' | an item slot
let invSelectedId = null;    // the item the detail sheet shows

function invActiveId() { return (typeof activeCharacter !== 'undefined' && activeCharacter) ? activeCharacter.id : null; }
function invClassKey() {
    if (typeof selectedClass !== 'undefined' && selectedClass) return selectedClass.name.toLowerCase();
    return (typeof activeCharacter !== 'undefined' && activeCharacter) ? activeCharacter.class_key : 'warrior';
}
function invLevel() { return (typeof activeCharacter !== 'undefined' && activeCharacter) ? activeCharacter.level : undefined; }
function invItems() { return (typeof currentOwnedItems !== 'undefined' && Array.isArray(currentOwnedItems)) ? currentOwnedItems : []; }

// Bag = this character's unworn items (rows from before characters, or an
// offline session, have no character_id and count as the bag); stash =
// the player's items with no character.
function invBagItems() {
    const id = invActiveId();
    return invItems().filter(it => !it.equipped_slot && !it.listed && (!id || !('character_id' in it) || it.character_id === id));
}
function invStashItems() {
    if (!invActiveId()) return [];
    return invItems().filter(it => !it.equipped_slot && !it.listed && 'character_id' in it && it.character_id === null);
}
function invWornIn(slot) { return activeEquippedItems().find(it => it.equipped_slot === slot) || null; }

// What an item would replace: the worn item in its slot (for a ring, the
// empty ring slot if there is one, else the weaker ring).
function invCompareTarget(item) {
    const slots = equipSlotsFor(itemSlotOf(item));
    const worn = slots.map(invWornIn);
    if (worn.some(w => !w)) return null;
    return worn.reduce((a, b) => (itemPower(a) <= itemPower(b) ? a : b));
}

function invUsable(item) { return itemUsableBy(item, invClassKey(), invLevel()); }
function invSellValue(item) { return Math.round((ITEM_SELL_VALUES[item.rarity] || 1) * (1 + ((item.item_level || 1) - 1) * 0.03)); }
function invScrapValue(item) { return (ITEM_SCRAP_VALUES[item.rarity] || 1) + Math.floor((item.item_level || 1) / 10); }

function invStatLine(key, val, delta) {
    const s = INV_STATS[key] || ['•', key];
    const sign = v => (v > 0 ? '+' : '') + v;
    const cls = delta === undefined ? '' : (key === 'skull_self_dmg' ? -delta : delta) > 0 ? ' up' : (key === 'skull_self_dmg' ? -delta : delta) < 0 ? ' down' : '';
    return `<div class="inv-stat${cls}"><span>${s[0]} ${t(s[1])}</span><b>${val === null ? '' : sign(val)}${delta ? ` <i>(${sign(delta)})</i>` : ''}</b></div>`;
}

// The hero as an <img>, wearing what's worn - with one item swapped in
// when trying something on.
function invFigureImg(tryOn, cssClass) {
    let items = activeEquippedItems().slice();
    if (tryOn) {
        const into = invCompareTarget(tryOn);
        const slot = into ? into.equipped_slot : equipSlotsFor(itemSlotOf(tryOn)).find(s => !invWornIn(s));
        items = items.filter(it => it.equipped_slot !== slot && it.id !== tryOn.id).concat([Object.assign({}, tryOn, { equipped_slot: slot })]);
    }
    const look = typeof heroCurrentLook === 'function' ? heroCurrentLook() : null;
    return typeof charPortraitImg === 'function' ? charPortraitImg(invClassKey(), look, items, cssClass || 'inv-figure-img') : document.createElement('img');
}

// An item's icon: the drawn icon when the painter has one (avItemIcon,
// avatar.js), else its emoji.
function invIconHtml(item, square) {
    if (typeof avItemIcon === 'function') {
        const svg = avItemIcon(item, { square: !!square });
        if (svg) return `<img class="inv-icon" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
    }
    return `<span class="inv-emoji">${itemDisplayInfo(item).emoji}</span>`;
}

function renderInventory() {
    const container = document.getElementById('inventory-list');
    if (!container) return;
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'inv';
    wrap.id = 'inv-root';

    // --- the paper doll
    const doll = document.createElement('div');
    doll.className = 'inv-doll';
    doll.id = 'inv-doll';
    const slotBtn = slot => {
        const it = invWornIn(slot);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'inv-slot' + (it ? ' filled rarity-' + it.rarity : '') + (it && invSelectedId === it.id ? ' selected' : '');
        b.id = 'inv-slot-' + slot;
        b.title = t(SLOT_LABELS[slot]);
        b.innerHTML = it ? invIconHtml(it, true) : `<span class="inv-slot-empty">${SLOT_EMOJI[slot === 'ring1' || slot === 'ring2' ? 'ring' : slot]}</span>`;
        if (it) b.style.setProperty('--rc', RARITY_DEFS[it.rarity].color);
        b.onclick = () => { if (it) invSelect(it.id); };
        return b;
    };
    const left = document.createElement('div'); left.className = 'inv-col';
    INV_DOLL_LEFT.forEach(s => left.appendChild(slotBtn(s)));
    const right = document.createElement('div'); right.className = 'inv-col';
    INV_DOLL_RIGHT.forEach(s => right.appendChild(slotBtn(s)));
    const fig = document.createElement('div');
    fig.className = 'inv-figure';
    fig.id = 'inv-figure';
    const selected = invItems().find(it => it.id === invSelectedId);
    fig.appendChild(invFigureImg(selected && !selected.equipped_slot && invUsable(selected) ? selected : null));
    const power = document.createElement('div');
    power.className = 'inv-power';
    power.textContent = tf('💎 Toplam Güç: {n}', { n: totalEquippedPower(invItems()) });
    fig.appendChild(power);
    const hands = document.createElement('div'); hands.className = 'inv-hands';
    INV_DOLL_HANDS.forEach(s => hands.appendChild(slotBtn(s)));
    fig.appendChild(hands);
    doll.append(left, fig, right);
    wrap.appendChild(doll);

    // --- stats (sum of what's worn) and set progress
    const totals = {};
    activeEquippedItems().forEach(it => Object.entries(it.rolled_stats || {}).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + v; }));
    const stats = document.createElement('div');
    stats.className = 'inv-stats';
    stats.id = 'inv-stats';
    const keys = Object.keys(INV_STATS).filter(k => totals[k]);
    stats.innerHTML = keys.length ? keys.map(k => invStatLine(k, totals[k])).join('') : `<p class="inv-muted">${t('Henüz bir şey kuşanmadın.')}</p>`;
    const sets = getSetProgress(activeEquippedItems());
    Object.values(sets).forEach(p => {
        const d = document.createElement('div');
        d.className = 'inv-set' + (p.isActive ? ' on' : '');
        d.textContent = `${p.isActive ? '✅' : '⏳'} ${t(p.name)} (${p.equippedCount}/${p.totalCount}) - ${t(p.bonusDesc)}`;
        stats.appendChild(d);
    });
    const warn = document.createElement('p');
    warn.className = 'inv-muted inv-death-note';
    warn.textContent = t('⚠️ Solo koşuda ölür ya da PvP maçı kaybedersen kuşandığın eşyalardan biri rastgele kaybolur.');
    stats.appendChild(warn);
    wrap.appendChild(stats);

    // --- bag / stash tabs, sort and filter
    const bag = invBagItems(), stash = invStashItems();
    const tabs = document.createElement('div');
    tabs.className = 'inv-tabs';
    [['bag', `🎒 ${t('Çanta')} ${bag.length}/${INV_BAG_SIZE}`], ['stash', `🏛️ ${t('Ortak Depo')} ${stash.length}/${INV_STASH_SIZE}`]].forEach(([key, label]) => {
        if (key === 'stash' && !invActiveId()) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'inv-tab-' + key;
        b.className = 'inv-tab' + (invTab === key ? ' on' : '');
        b.textContent = label;
        b.onclick = () => { invTab = key; invSelectedId = null; renderInventory(); };
        tabs.appendChild(b);
    });
    wrap.appendChild(tabs);

    const tools = document.createElement('div');
    tools.className = 'inv-tools';
    const sel = (id, options, value, onChange) => {
        const s = document.createElement('select');
        s.id = id;
        options.forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; s.appendChild(o); });
        s.value = value;
        s.onchange = () => { onChange(s.value); renderInventory(); };
        return s;
    };
    tools.appendChild(sel('inv-sort', [['rarity', t('Nadirlik')], ['level', t('Seviye')], ['slot', t('Yuva')], ['new', t('En yeni')]], invSort, v => { invSort = v; }));
    tools.appendChild(sel('inv-filter', [['all', t('Hepsi')], ['usable', t('Kullanabildiklerim')]].concat(ITEM_SLOTS.map(s => [s, t(SLOT_LABELS[s])])), invFilter, v => { invFilter = v; }));
    wrap.appendChild(tools);

    // --- the grid
    const rarityOrder = Object.keys(RARITY_DEFS);
    let list = (invTab === 'stash' ? stash : bag).slice();
    if (invFilter === 'usable') list = list.filter(invUsable);
    else if (invFilter !== 'all') list = list.filter(it => itemSlotOf(it) === invFilter);
    const bySlot = it => ITEM_SLOTS.indexOf(itemSlotOf(it));
    const sorters = {
        rarity: (a, b) => rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity) || (b.item_level || 1) - (a.item_level || 1),
        level: (a, b) => (b.item_level || 1) - (a.item_level || 1) || rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity),
        slot: (a, b) => bySlot(a) - bySlot(b) || rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity),
        new: (a, b) => String(b.acquired_at || b.id).localeCompare(String(a.acquired_at || a.id))
    };
    list.sort(sorters[invSort] || sorters.rarity);

    const grid = document.createElement('div');
    grid.className = 'inv-grid';
    grid.id = 'inv-grid';
    list.forEach(it => {
        const c = document.createElement('button');
        c.type = 'button';
        const usable = invUsable(it);
        const target = invCompareTarget(it);
        const better = usable && (!target || itemPower(it) > itemPower(target));
        c.className = 'inv-cell rarity-' + it.rarity + (itemSize(it) === 2 ? ' tall' : '') + (usable ? '' : ' unusable') + (invSelectedId === it.id ? ' selected' : '');
        c.style.setProperty('--rc', RARITY_DEFS[it.rarity].color);
        c.dataset.itemId = it.id;
        c.innerHTML = invIconHtml(it)
            + `<span class="inv-lvl">${it.item_level || 1}</span>`
            + (it.locked ? '<span class="inv-lock">🔒</span>' : '')
            + (better ? '<span class="inv-better">▲</span>' : '');
        c.onclick = () => invSelect(it.id);
        grid.appendChild(c);
    });
    if (!list.length) {
        const p = document.createElement('p');
        p.className = 'inv-muted';
        p.textContent = invTab === 'stash' ? t('Ortak depon boş. Çantandan eşya koyduğunda bütün karakterlerin görür (seviyesi yetenler kullanabilir).') : t('Henüz eşyan yok.');
        grid.appendChild(p);
    }
    wrap.appendChild(grid);

    // --- the detail sheet
    const detail = document.createElement('div');
    detail.className = 'inv-detail';
    detail.id = 'inv-detail';
    if (selected) invFillDetail(detail, selected);
    else detail.style.display = 'none';
    wrap.appendChild(detail);

    container.appendChild(wrap);
}

function invSelect(id) {
    invSelectedId = invSelectedId === id ? null : id;
    renderInventory();
    const d = document.getElementById('inv-detail');
    if (d && invSelectedId && d.scrollIntoView) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function invFillDetail(box, it) {
    const rarity = RARITY_DEFS[it.rarity];
    const info = itemDisplayInfo(it);
    const usable = invUsable(it);
    const worn = !!it.equipped_slot;
    const target = worn ? null : invCompareTarget(it);
    const cls = itemClasses(it);
    const req = itemReqLevel(it);
    const lvl = invLevel();
    box.style.setProperty('--rc', rarity.color);

    const head = document.createElement('div');
    head.className = 'inv-detail-head';
    const figWrap = document.createElement('div');
    figWrap.className = 'inv-detail-fig';
    figWrap.appendChild(worn || !usable ? (() => { const d = document.createElement('div'); d.className = 'inv-detail-icon'; d.innerHTML = invIconHtml(it, true); return d; })() : invFigureImg(it, 'inv-tryon-img'));
    const txt = document.createElement('div');
    txt.className = 'inv-detail-txt';
    const classNames = cls && cls.length < 7 ? cls.map(k => { const d = typeof classDefFor === 'function' ? classDefFor(k) : null; return d ? d.emoji + ' ' + d.name : k; }).join(', ') : t('Bütün sınıflar');
    txt.innerHTML = `<b class="inv-name">${info.name}</b>`
        + `<div class="inv-sub">${rarity.mark} ${t(rarity.label)} · ${t(SLOT_LABELS[itemSlotOf(it)])} · ${tf('Eşya seviyesi {n}', { n: it.item_level || 1 })}</div>`
        + `<div class="inv-sub${lvl !== undefined && req > lvl ? ' bad' : ''}">${tf('Gereken seviye {n}', { n: req })}</div>`
        + `<div class="inv-sub${usable || (lvl !== undefined && req > lvl) ? '' : ' bad'}">${classNames}</div>`
        + (worn ? `<div class="inv-sub good">✔ ${t('Kuşanıldı')}</div>` : !usable ? '' : `<div class="inv-sub">${t('Solda: bunu giymiş halin')}</div>`);
    head.append(figWrap, txt);
    box.appendChild(head);

    // stats, with the change against what it would replace
    const stats = document.createElement('div');
    stats.className = 'inv-detail-stats';
    const mine = it.rolled_stats || {}, theirs = (target && target.rolled_stats) || {};
    const keys = Object.keys(INV_STATS).filter(k => mine[k] || (!worn && theirs[k]));
    stats.innerHTML = keys.map(k => invStatLine(k, mine[k] || 0, worn ? undefined : (mine[k] || 0) - (theirs[k] || 0))).join('')
        + `<div class="inv-stat power"><span>💎 ${t('Güç')}</span><b>${itemPower(it)}${!worn && target ? ` <i>(${itemPower(it) - itemPower(target) >= 0 ? '+' : ''}${itemPower(it) - itemPower(target)})</i>` : ''}</b></div>`
        + (info.passiveDesc ? `<div class="inv-passive">✨ ${info.passiveDesc}</div>` : '')
        + (it.set_key ? `<div class="inv-passive set">⬡ ${t(ITEM_SETS[it.set_key].name)} - ${t(ITEM_SETS[it.set_key].bonusDesc)}</div>` : '')
        + (!worn && target ? `<div class="inv-muted">${tf('Karşılaştırma: {name}', { name: itemDisplayInfo(target).name })}</div>` : '');
    box.appendChild(stats);

    // actions
    const acts = document.createElement('div');
    acts.className = 'inv-actions';
    const act = (id, label, fn, opts) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'inv-act-' + id;
        b.className = 'action-btn inv-act' + (opts && opts.cls ? ' ' + opts.cls : '');
        b.textContent = label;
        if (opts && opts.disabled) b.disabled = true;
        b.onclick = async () => { b.disabled = true; await fn(); invAfterAction(it.id); };
        acts.appendChild(b);
    };
    const inStash = 'character_id' in it && it.character_id === null && !!invActiveId();
    if (worn) act('unequip', t('ÇIKAR'), () => unequipItem(it.id));
    else act('equip', t('KUŞAN'), () => equipItem(it.id), { cls: 'primary', disabled: !usable });
    if (!worn && invActiveId()) {
        if (inStash) act('bag', t('Çantaya al'), () => moveItem(it.id, 'bag'));
        else act('stash', t('Depoya koy'), () => moveItem(it.id, 'stash'));
    }
    if (invActiveId()) act('lock', it.locked ? t('🔓 Kilidi aç') : t('🔒 Kilitle'), () => lockItem(it.id, !it.locked));
    if (!worn && !it.locked) {
        const uc = ITEM_UPGRADE_COSTS[it.rarity];
        if (uc) act('upgrade', `⬆️ ${uc.gold}🪙 ${uc.materials}🪨`, () => upgradeItem(it.id), { cls: 'upgrade' });
        act('scrap', `♻️ +${invScrapValue(it)}🪨`, () => scrapItem(it.id), { cls: 'scrap' });
        act('sell', `💰 +${invSellValue(it)}🪙`, () => sellItem(it.id), { cls: 'sell' });
    }
    box.appendChild(acts);
}

// After an action: keep the sheet on the item if it still exists.
function invAfterAction(id) {
    if (!invItems().some(it => it.id === id)) invSelectedId = null;
    renderInventory();
}
