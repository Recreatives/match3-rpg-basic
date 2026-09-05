// --- ITEM / LOOT SYSTEM (rarity tiers + equip slots) ---
// Every item is one INSTANCE, not a catalog lookup - two players (or the
// same player twice) can own two completely different rolls of "a Blue
// Kılıç." Rarity decides how many stats an item rolls and how strong they
// are (RARITY_DEFS below), not a hand-authored list of a thousand items.
// Two exceptions: Green (Set) gear (small hand-authored sets - a set needs
// specific pieces with a specific shared bonus, which isn't something you
// can roll randomly and still have it mean anything), and Orange/Red/Teal
// gear (UNIQUE_LEGENDARIES) - the same "every roll is different" idea stops
// making sense once an item is rare and exciting enough to want a real
// identity, so those top 3 tiers are each exactly one fixed, hand-named
// item per slot instead of a random roll (the standard "legendaries have a
// name, junk doesn't" split used across the genre).
//
// Equip slots - a real RPG loadout (Silah/Kalkan/Miğfer/Zırh/Omuzluk/
// Eldiven/Çizme/Takı), not a vague "weapon/armor/trinket" bucket: only
// EQUIPPED items apply their stats. Owning a pile of unequipped loot does
// nothing - this is what keeps "many items exist" from turning into "every
// stat approaches infinity forever." A set's bonus only counts pieces that
// are currently EQUIPPED, not merely owned.

const ITEM_SLOTS = ['weapon', 'shield', 'helmet', 'chest', 'shoulder', 'gloves', 'boots', 'trinket'];
const SLOT_LABELS = {
    weapon: 'Silah', shield: 'Kalkan', helmet: 'Miğfer', chest: 'Zırh',
    shoulder: 'Omuzluk', gloves: 'Eldiven', boots: 'Çizme', trinket: 'Takı'
};

// The full procedurally-rollable catalog (grey/white/blue/yellow only - see
// UNIQUE_LEGENDARIES for orange/red/teal). Each slot offers several distinct
// base items with different primary stats, so two items in the same slot
// can support very different builds. 32 bases × 4 rollable rarities already
// gives well over a hundred distinct "name (rarity)" combinations before
// even counting that every roll's exact numbers differ.
const ITEM_BASES = {
    weapon: [
        { id: 'blade', name: 'Kılıç', emoji: '⚔️', primaryStat: 'sword' },
        { id: 'axe', name: 'Balta', emoji: '🪓', primaryStat: 'skull_dmg' },
        { id: 'scepter', name: 'Asa', emoji: '🪄', primaryStat: 'ult_dmg' },
        { id: 'dagger', name: 'Hançer', emoji: '🗡️', primaryStat: 'lifeSteal' },
        { id: 'bow', name: 'Yay', emoji: '🏹', primaryStat: 'energy' },
        { id: 'spear', name: 'Mızrak', emoji: '🔱', primaryStat: 'skull_dmg' },
        { id: 'mace', name: 'Gürz', emoji: '🔨', primaryStat: 'sword' }
    ],
    shield: [
        { id: 'kite_shield', name: 'Kalkan', emoji: '🛡️', primaryStat: 'shield' },
        { id: 'tower_shield', name: 'Kule Kalkanı', emoji: '🏯', primaryStat: 'shield' },
        { id: 'buckler', name: 'Küçük Kalkan', emoji: '🔘', primaryStat: 'shield' },
        { id: 'dragon_shield', name: 'Ejderha Kalkanı', emoji: '🐉', primaryStat: 'heart' }
    ],
    helmet: [
        { id: 'helm', name: 'Miğfer', emoji: '🪖', primaryStat: 'shield' },
        { id: 'hood', name: 'Kukuleta', emoji: '🧢', primaryStat: 'energy' },
        { id: 'crown', name: 'Taç', emoji: '👑', primaryStat: 'ult_dmg' },
        { id: 'skull_mask', name: 'Kafatası Maskesi', emoji: '💀', primaryStat: 'skull_dmg' }
    ],
    chest: [
        { id: 'breastplate', name: 'Göğüslük', emoji: '🥋', primaryStat: 'shield' },
        { id: 'robe', name: 'Cübbe', emoji: '👘', primaryStat: 'heart' },
        { id: 'leather_vest', name: 'Deri Yelek', emoji: '🎽', primaryStat: 'sword' },
        { id: 'scale_armor', name: 'Pul Zırh', emoji: '🐲', primaryStat: 'heart' }
    ],
    shoulder: [
        { id: 'pauldron', name: 'Omuzluk', emoji: '🔰', primaryStat: 'shield' },
        { id: 'spiked_pauldron', name: 'Dikenli Omuzluk', emoji: '📛', primaryStat: 'skull_dmg' },
        { id: 'winged_pauldron', name: 'Kanatlı Omuzluk', emoji: '🦅', primaryStat: 'energy' }
    ],
    gloves: [
        { id: 'gauntlets', name: 'Eldiven', emoji: '🧤', primaryStat: 'sword' },
        { id: 'assassin_gloves', name: 'Suikastçı Eldiveni', emoji: '🥷', primaryStat: 'lifeSteal' },
        { id: 'healing_gloves', name: 'Şifa Eldiveni', emoji: '🩹', primaryStat: 'heart' }
    ],
    boots: [
        { id: 'leather_boots', name: 'Deri Çizme', emoji: '🥾', primaryStat: 'energy' },
        { id: 'wind_boots', name: 'Rüzgar Çizmeleri', emoji: '💨', primaryStat: 'sword' },
        { id: 'earth_boots', name: 'Toprak Çizmeleri', emoji: '🪨', primaryStat: 'shield' }
    ],
    trinket: [
        { id: 'amulet', name: 'Muska', emoji: '📿', primaryStat: 'energy' },
        { id: 'ring', name: 'Yüzük', emoji: '💍', primaryStat: 'lifeSteal' },
        { id: 'charm', name: 'Tılsım', emoji: '🍀', primaryStat: 'teamHeal' },
        { id: 'necklace', name: 'Kolye', emoji: '💠', primaryStat: 'ult_dmg' }
    ]
};

// Every rolled stat draws from this pool (skull_self_dmg is a downside stat
// - rolling it REDUCES that value, see rollAffixValue).
const STAT_POOL = ['sword', 'heart', 'shield', 'energy', 'skull_dmg', 'ult_dmg', 'lifeSteal', 'teamHeal', 'skull_self_dmg'];

// affixCount: how many stats an instance rolls (primary stat included) -
// only meaningful for grey/white/blue/yellow; orange/red/teal are fixed
// identities (see UNIQUE_LEGENDARIES) so their affixCount here is descriptive
// only, matching how many stats their unique item actually carries.
// statMult: how strong each roll is, relative to a White item's baseline.
// dropWeight: relative chance in the post-battle loot roll (see rollLootDrop).
// shopAvailable: can this rarity be bought outright, or only ever drop?
// `mark` is a shape badge shown alongside every rarity's color (shop,
// inventory, loot toasts) - color alone isn't accessible to colorblind
// players, and grey/green in particular are a common confusion pair under
// deuteranopia. Shapes roughly track power level too (a plain dot through
// to an aggressive triangle), so the badge alone hints at rarity even with
// color perception removed entirely.
const RARITY_DEFS = {
    grey: { key: 'grey', name: 'Grey', label: 'Adi', color: '#9d9d9d', mark: '●', affixCount: 1, statMult: 0.5, costMult: 0.4, dropWeight: 38, shopAvailable: true },
    white: { key: 'white', name: 'White', label: 'Normal', color: '#e8e8e8', mark: '◐', affixCount: 1, statMult: 1.0, costMult: 1, dropWeight: 30, shopAvailable: true },
    blue: { key: 'blue', name: 'Blue', label: 'Sihirli', color: '#3b82f6', mark: '◆', affixCount: 2, statMult: 1.6, costMult: 2.5, dropWeight: 16, shopAvailable: true },
    yellow: { key: 'yellow', name: 'Yellow', label: 'Nadir', color: '#eab308', mark: '★', affixCount: 4, statMult: 2.4, costMult: 6, dropWeight: 9, shopAvailable: false },
    green: { key: 'green', name: 'Green', label: 'Set', color: '#22c55e', mark: '⬡', affixCount: 0, statMult: 1, costMult: 4, dropWeight: 4, shopAvailable: false, isSet: true },
    orange: { key: 'orange', name: 'Orange', label: 'Efsanevi', color: '#f97316', mark: '✦', affixCount: 2, statMult: 3.2, costMult: 0, dropWeight: 2, shopAvailable: false, isUnique: true },
    red: { key: 'red', name: 'Red', label: 'İlksel Efsanevi', color: '#ef4444', mark: '▲', affixCount: 3, statMult: 4.0, costMult: 0, dropWeight: 0.4, shopAvailable: false, isUnique: true },
    teal: { key: 'teal', name: 'Teal', label: 'Ethereal', color: '#14b8a6', mark: '✧', affixCount: 2, statMult: 3.6, costMult: 0, dropWeight: 0.2, shopAvailable: false, classLocked: true, isUnique: true }
};

// The hand-authored Green (Set) gear - slotted into the full 8-slot system
// now. Stats are fixed, not rolled - a set needs to mean the same thing
// every time. Every slot has at least one set piece somewhere below.
const ITEM_SETS = {
    berserker_fury: {
        name: "Berserker'ın Öfkesi", bonusDesc: '+10 Ult Gücü', bonus: (s) => { s.ult_dmg += 10; },
        pieces: {
            bloodied_gauntlet: { slot: 'gloves', name: 'Kanlı Eldiven', emoji: '🥊', stats: { sword: 3 } },
            crimson_pauldron: { slot: 'shoulder', name: 'Kızıl Omuzluk', emoji: '🩸', stats: { skull_dmg: 8 } }
        }
    },
    guardian_bulwark: {
        name: 'Muhafızın Kalkanı', bonusDesc: '+%5 Can Çalma', bonus: (s) => { s.lifeSteal += 5; },
        pieces: {
            iron_greaves: { slot: 'boots', name: 'Demir Dizlik', emoji: '🦿', stats: { shield: 3 } },
            oak_shield_charm: { slot: 'trinket', name: 'Meşe Kalkan Tılsımı', emoji: '🌳', stats: { heart: 2 } }
        }
    },
    assassin_kit: {
        name: 'Suikastçının Takımı', bonusDesc: '+5 Enerji (ekstra)', bonus: (s) => { s.energy += 5; },
        pieces: {
            swift_boots: { slot: 'boots', name: 'Çevik Çizmeler', emoji: '🥾', stats: { energy: 3 } },
            shadow_cloak: { slot: 'chest', name: 'Gölge Pelerini', emoji: '🌑', stats: { energy: 3 } },
            venom_vial: { slot: 'weapon', name: 'Zehir Şişesi', emoji: '🧪', stats: { skull_self_dmg: -3 } }
        }
    },
    frost_warden: {
        name: 'Buz Muhafızı', bonusDesc: '+3 Zırh (ekstra)', bonus: (s) => { s.shield += 3; },
        pieces: {
            frozen_crown: { slot: 'helmet', name: 'Donmuş Taç', emoji: '❄️', stats: { shield: 3 } },
            glacier_ward: { slot: 'shield', name: 'Buzul Kalkanı', emoji: '🧊', stats: { heart: 3 } }
        }
    }
};

// Orange/Red/Teal never roll randomly - each slot has exactly one fixed
// identity per tier (name + emoji + fixed stats), the standard "legendaries
// have a name, everything below doesn't" split. Values scale roughly with
// RARITY_DEFS' statMult (orange 3.2x / red 4.0x / teal 3.6x of a White
// item's baseline), same as a rolled item's power at that tier would - they
// just don't vary roll to roll. Teal is flagged classLocked in RARITY_DEFS
// (not yet enforced anywhere - purely descriptive for now, same as before).
const UNIQUE_LEGENDARIES = {
    orange: {
        weapon: { id: 'uniq_nights_lament', name: 'Gecenin Ağıtı', emoji: '⚔️', stats: { sword: 8, lifeSteal: 6 } },
        shield: { id: 'uniq_shield_of_eternity', name: 'Sonsuzluk Kalkanı', emoji: '🛡️', stats: { shield: 7, heart: 7 } },
        helmet: { id: 'uniq_oracles_crown', name: 'Kahinin Tacı', emoji: '👑', stats: { ult_dmg: 16, energy: 10 } },
        chest: { id: 'uniq_dragonheart_plate', name: 'Ejderha Yürek Zırhı', emoji: '🐉', stats: { shield: 7, heart: 7 } },
        shoulder: { id: 'uniq_storm_eagle_pauldrons', name: 'Fırtına Kartalı Omuzluğu', emoji: '🦅', stats: { energy: 10, sword: 8 } },
        gloves: { id: 'uniq_butchers_claws', name: 'Kasabın Pençeleri', emoji: '🩸', stats: { skull_dmg: 14, lifeSteal: 6 } },
        boots: { id: 'uniq_windwalkers', name: 'Rüzgar Yürüyüşü', emoji: '💨', stats: { energy: 10, sword: 8 } },
        trinket: { id: 'uniq_ring_of_ancient_wisdom', name: 'Kadim Bilgelik Halkası', emoji: '💍', stats: { ult_dmg: 16, teamHeal: 6 } }
    },
    red: {
        weapon: { id: 'uniq_world_eater', name: 'Dünya Yiyen', emoji: '⚔️', stats: { sword: 10, skull_dmg: 18, lifeSteal: 8 } },
        shield: { id: 'uniq_the_last_wall', name: 'Son Duvar', emoji: '🛡️', stats: { shield: 9, heart: 9, energy: 13 } },
        helmet: { id: 'uniq_starfall_helm', name: 'Yıldız Düşüren Miğfer', emoji: '☄️', stats: { ult_dmg: 20, energy: 13, shield: 9 } },
        chest: { id: 'uniq_titans_hide', name: "Titan'ın Derisi", emoji: '🗿', stats: { shield: 9, heart: 9, sword: 10 } },
        shoulder: { id: 'uniq_doomwings', name: 'Kıyamet Kanatları', emoji: '🔥', stats: { energy: 13, skull_dmg: 18, sword: 10 } },
        gloves: { id: 'uniq_the_throatreaver', name: 'Boğazlayıcı', emoji: '☠️', stats: { skull_dmg: 18, lifeSteal: 8, sword: 10 } },
        boots: { id: 'uniq_timestep_striders', name: 'Zaman Adımı', emoji: '⏳', stats: { energy: 13, sword: 10, ult_dmg: 20 } },
        trinket: { id: 'uniq_eternity_core', name: 'Sonsuzluk Çekirdeği', emoji: '💠', stats: { ult_dmg: 20, energy: 13, teamHeal: 8 } }
    },
    teal: {
        weapon: { id: 'uniq_whisper_of_the_void', name: 'Hiçliğin Fısıltısı', emoji: '🌌', stats: { ult_dmg: 18, lifeSteal: 7 } },
        shield: { id: 'uniq_shattered_time_aegis', name: 'Kırık Zaman Kalkanı', emoji: '⏱️', stats: { shield: 8, energy: 12 } },
        helmet: { id: 'uniq_astral_sight', name: 'Astral Görüş', emoji: '👁️', stats: { energy: 12, ult_dmg: 18 } },
        chest: { id: 'uniq_shroud_of_shadows', name: 'Gölge Örtüsü', emoji: '🌑', stats: { shield: 8, lifeSteal: 7 } },
        shoulder: { id: 'uniq_cosmic_wings', name: 'Kozmik Kanatlar', emoji: '✨', stats: { energy: 12, skull_dmg: 16 } },
        gloves: { id: 'uniq_soul_rending_claws', name: 'Ruh Emici Pençeler', emoji: '👻', stats: { skull_dmg: 16, lifeSteal: 7 } },
        boots: { id: 'uniq_voidstep', name: 'Boşluk Adımı', emoji: '🕳️', stats: { energy: 12, sword: 9 } },
        trinket: { id: 'uniq_eye_of_infinity', name: 'Sonsuzluk Gözü', emoji: '♾️', stats: { ult_dmg: 18, teamHeal: 7 } }
    }
};

function rollAffixValue(stat, mult) {
    const baseRange = { sword: 2, heart: 2, shield: 2, energy: 3, skull_dmg: 4, ult_dmg: 5, lifeSteal: 2, teamHeal: 2, skull_self_dmg: 2 };
    let rolled = Math.max(1, Math.round((baseRange[stat] || 2) * mult * (0.8 + Math.random() * 0.4)));
    return stat === 'skull_self_dmg' ? -rolled : rolled; // a downside stat - more of it is worse, so rolling it REDUCES self-damage
}

// Generates one new item INSTANCE. For 'green', pass a specific setKey +
// pieceId (sets aren't randomly rolled); orange/red/teal ignore any opts and
// always return that slot's one fixed UNIQUE_LEGENDARIES entry; everything
// else rolls a fresh base + stats.
function generateItem(slot, rarityKey, opts) {
    let rarity = RARITY_DEFS[rarityKey];
    opts = opts || {};

    if (rarity.isSet) {
        let set = ITEM_SETS[opts.setKey];
        let piece = set.pieces[opts.pieceId];
        return {
            base_id: opts.pieceId, slot: piece.slot, rarity: rarityKey,
            name: piece.name, emoji: piece.emoji,
            rolled_stats: Object.assign({}, piece.stats),
            set_key: opts.setKey,
            cost: null // never shop-purchasable
        };
    }

    if (rarity.isUnique) {
        let uniq = UNIQUE_LEGENDARIES[rarityKey][slot];
        return {
            base_id: uniq.id, slot, rarity: rarityKey,
            name: uniq.name, emoji: uniq.emoji,
            rolled_stats: Object.assign({}, uniq.stats),
            set_key: null,
            cost: null // never shop-purchasable, fixed identity - not rolled
        };
    }

    let bases = ITEM_BASES[slot];
    let base = opts.baseId ? bases.find(b => b.id === opts.baseId) : bases[Math.floor(Math.random() * bases.length)];
    let stats = {};
    stats[base.primaryStat] = rollAffixValue(base.primaryStat, rarity.statMult);
    let pool = STAT_POOL.filter(s => s !== base.primaryStat);
    for (let i = 0; i < rarity.affixCount - 1 && pool.length > 0; i++) {
        let stat = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        stats[stat] = (stats[stat] || 0) + rollAffixValue(stat, rarity.statMult * 0.6); // secondary affixes roll a bit weaker
    }

    return {
        base_id: base.id, slot, rarity: rarityKey,
        name: `${base.name} (${rarity.label})`, emoji: base.emoji,
        rolled_stats: stats, set_key: null,
        cost: rarity.shopAvailable ? Math.round(20 * rarity.costMult) : null
    };
}

// Weighted-random rarity + slot pick for a post-battle drop. Only rarities
// with dropWeight > 0 can ever drop (grey through teal, all of them really -
// see RARITY_DEFS). Green (Set) picks a random still-incomplete piece from a
// random set if the player has one, otherwise a random piece from any set.
function rollLootDrop(ownedItems) {
    let totalWeight = Object.values(RARITY_DEFS).reduce((sum, r) => sum + r.dropWeight, 0);
    let roll = Math.random() * totalWeight;
    let rarityKey = 'grey';
    for (let key in RARITY_DEFS) {
        roll -= RARITY_DEFS[key].dropWeight;
        if (roll <= 0) { rarityKey = key; break; }
    }

    if (RARITY_DEFS[rarityKey].isSet) {
        let setKeys = Object.keys(ITEM_SETS);
        let setKey = setKeys[Math.floor(Math.random() * setKeys.length)];
        let pieceIds = Object.keys(ITEM_SETS[setKey].pieces);
        let ownedBaseIds = new Set((ownedItems || []).map(it => it.base_id));
        let missing = pieceIds.filter(id => !ownedBaseIds.has(id));
        let pieceId = (missing.length > 0 ? missing : pieceIds)[Math.floor(Math.random() * (missing.length > 0 ? missing.length : pieceIds.length))];
        return generateItem(ITEM_SETS[setKey].pieces[pieceId].slot, rarityKey, { setKey, pieceId });
    }

    let slot = ITEM_SLOTS[Math.floor(Math.random() * ITEM_SLOTS.length)];
    return generateItem(slot, rarityKey);
}

// DB rows only ever store base_id/slot/rarity/rolled_stats/set_key (see
// economy.js's inserts) - name/emoji are re-derived here rather than also
// persisted, since they're fully determined by those fields anyway.
function itemDisplayInfo(item) {
    if (item.set_key) {
        let piece = ITEM_SETS[item.set_key].pieces[item.base_id];
        return { name: piece.name, emoji: piece.emoji };
    }
    let rarity = RARITY_DEFS[item.rarity];
    if (rarity && rarity.isUnique) {
        let uniq = UNIQUE_LEGENDARIES[item.rarity][item.slot];
        return { name: uniq.name, emoji: uniq.emoji };
    }
    let base = ITEM_BASES[item.slot].find(b => b.id === item.base_id);
    return { name: base ? base.name : item.base_id, emoji: base ? base.emoji : '❓' };
}

function formatRolledStats(stats) {
    return Object.entries(stats || {}).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ');
}

function switchShopTab(tab) {
    let shopBtn = document.getElementById('shop-tab-btn');
    let invBtn = document.getElementById('inventory-tab-btn');
    let shopDiv = document.getElementById('shop-items');
    let invDiv = document.getElementById('inventory-list');
    let showShop = tab === 'shop';
    shopDiv.style.display = showShop ? 'block' : 'none';
    invDiv.style.display = showShop ? 'none' : 'block';
    shopBtn.style.background = showShop ? '' : '#555';
    shopBtn.style.color = showShop ? '' : '#ccc';
    invBtn.style.background = showShop ? '#555' : '';
    invBtn.style.color = showShop ? '#ccc' : '';
}

// --- SHOP UI (buy a fresh random roll, grey/white/blue only) -------------------

function renderShop() {
    let container = document.getElementById('shop-items');
    if (!container) return;
    container.innerHTML = '';

    ITEM_SLOTS.forEach(slot => {
        let section = document.createElement('div');
        section.className = 'modal-section';
        let header = document.createElement('h4');
        header.innerText = SLOT_LABELS[slot];
        section.appendChild(header);

        ['grey', 'white', 'blue'].forEach(rarityKey => {
            let rarity = RARITY_DEFS[rarityKey];
            let row = document.createElement('div');
            row.className = 'manual-tile';
            row.style.justifyContent = 'space-between';

            let desc = document.createElement('div');
            desc.className = 'manual-desc';
            desc.style.color = rarity.color;
            desc.innerHTML = `<b>${rarity.mark} ${rarity.name}</b> ${rarity.label} - rastgele ${rarity.affixCount} stat`;
            row.appendChild(desc);

            let btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.style.width = 'auto'; btn.style.margin = '0'; btn.style.flexShrink = '0';
            btn.innerText = `🪙${Math.round(20 * rarity.costMult)}`;
            btn.onclick = () => purchaseItem(slot, rarityKey);
            row.appendChild(btn);

            section.appendChild(row);
        });
        container.appendChild(section);
    });
}

// --- INVENTORY UI (equip slots + full item list) --------------------------------

function renderInventory() {
    let container = document.getElementById('inventory-list');
    if (!container) return;
    container.innerHTML = '';

    let slotsDiv = document.createElement('div');
    slotsDiv.className = 'modal-section';
    slotsDiv.innerHTML = '<h4>Kuşanılanlar</h4>';
    ITEM_SLOTS.forEach(slot => {
        let equipped = currentOwnedItems.find(it => it.equipped_slot === slot);
        let row = document.createElement('div');
        row.className = 'manual-tile';
        if (equipped) {
            let rarity = RARITY_DEFS[equipped.rarity];
            let info = itemDisplayInfo(equipped);
            row.innerHTML = `<span class="manual-icon">${info.emoji}</span>
                <div class="manual-desc" style="color:${rarity.color};"><b>${rarity.mark} ${SLOT_LABELS[slot]}: ${info.name}</b>${formatRolledStats(equipped.rolled_stats)}</div>`;
        } else {
            row.innerHTML = `<span class="manual-icon">➖</span><div class="manual-desc" style="color:#7f8c8d;"><b>${SLOT_LABELS[slot]}: Boş</b></div>`;
        }
        slotsDiv.appendChild(row);
    });
    container.appendChild(slotsDiv);

    let listDiv = document.createElement('div');
    listDiv.className = 'modal-section';
    listDiv.innerHTML = '<h4>Envanter</h4>';
    if (currentOwnedItems.length === 0) {
        listDiv.innerHTML += '<p style="color:#7f8c8d; font-size:0.8rem;">Henüz eşyan yok.</p>';
    }

    let rarityOrder = Object.keys(RARITY_DEFS);
    currentOwnedItems.slice()
        .sort((a, b) => rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity))
        .forEach(item => {
            let rarity = RARITY_DEFS[item.rarity];
            let info = itemDisplayInfo(item);
            let row = document.createElement('div');
            row.className = 'manual-tile';
            row.style.justifyContent = 'space-between';

            let desc = document.createElement('div');
            desc.className = 'manual-desc';
            desc.style.color = rarity.color;
            desc.innerHTML = `<b>${info.emoji} ${rarity.mark} ${rarity.name} ${info.name}</b>${formatRolledStats(item.rolled_stats)}${item.set_key ? ` · Set: ${ITEM_SETS[item.set_key].name}` : ''}`;
            row.appendChild(desc);

            let btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.style.width = 'auto'; btn.style.margin = '0'; btn.style.flexShrink = '0';
            if (item.equipped_slot) { btn.innerText = 'ÇIKAR'; btn.onclick = () => unequipItem(item.id); }
            else { btn.innerText = 'KUŞAN'; btn.onclick = () => equipItem(item.id); }
            row.appendChild(btn);

            listDiv.appendChild(row);
        });
    container.appendChild(listDiv);
}

function showLootToast(item) {
    let rarity = RARITY_DEFS[item.rarity];
    let el = document.createElement('div');
    el.className = 'achievement-toast';
    el.style.borderColor = rarity.color;
    el.innerHTML = `<b style="color:${rarity.color};">${item.emoji} ${rarity.mark} ${rarity.name} DÜŞTÜ</b><br>${item.name}`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('visible'), 10);
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 400); }, 3500);
}

// Applies every EQUIPPED item's stats, then any completed set bonus (only
// counting EQUIPPED pieces - owning the rest of a set does nothing). Called
// once per run start, after the class passive - items stack on top the same
// way a passive does, both just mutating the same TILE_STATS object.
function applyEquippedItemBonuses(stats, ownedItems) {
    let equipped = (ownedItems || []).filter(it => it.equipped_slot);
    equipped.forEach(it => {
        Object.entries(it.rolled_stats || {}).forEach(([stat, val]) => { stats[stat] = (stats[stat] || 0) + val; });
    });

    let equippedBaseIds = new Set(equipped.map(it => it.base_id));
    Object.entries(ITEM_SETS).forEach(([setKey, set]) => {
        let allEquipped = Object.keys(set.pieces).every(pieceId => equippedBaseIds.has(pieceId));
        if (allEquipped) set.bonus(stats);
    });
}
