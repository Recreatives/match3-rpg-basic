// --- ITEM / SET SYSTEM (first pass: 3 small sets) ---
// The design doc's own scope note for v1: "2-3 küçük set ile başla". Buying
// an item is permanent (no sell path yet) and its bonus applies to every
// mode that reads TILE_STATS - single-player, PvP, and co-op all already
// share that one global stat pool, so a purchase here is felt everywhere
// without any of those files needing to know items exist at all.
//
// The catalog (costs, bonuses, which items form a set) lives entirely here,
// client-side - supabase/schema.sql's player_items table only ever stores
// WHICH item ids a player owns, never what those ids mean.

const ITEM_CATALOG = {
    bloodied_gauntlet: { id: 'bloodied_gauntlet', name: 'Kanlı Eldiven', emoji: '🥊', cost: { gold: 40, materials: 10 }, set: 'berserker_fury', desc: '+3 Kılıç', bonus: (s) => { s.sword += 3; } },
    crimson_pauldron: { id: 'crimson_pauldron', name: 'Kızıl Omuzluk', emoji: '🩸', cost: { gold: 40, materials: 10 }, set: 'berserker_fury', desc: '+8 Kafatası Hasarı', bonus: (s) => { s.skull_dmg += 8; } },

    iron_greaves: { id: 'iron_greaves', name: 'Demir Dizlik', emoji: '🦿', cost: { gold: 40, materials: 10 }, set: 'guardian_bulwark', desc: '+3 Kalkan', bonus: (s) => { s.shield += 3; } },
    oak_shield_charm: { id: 'oak_shield_charm', name: 'Meşe Kalkan Tılsımı', emoji: '🌳', cost: { gold: 40, materials: 10 }, set: 'guardian_bulwark', desc: '+2 Kalp', bonus: (s) => { s.heart += 2; } },

    swift_boots: { id: 'swift_boots', name: 'Çevik Çizmeler', emoji: '🥾', cost: { gold: 35, materials: 8 }, set: 'assassin_kit', desc: '+3 Enerji', bonus: (s) => { s.energy += 3; } },
    shadow_cloak: { id: 'shadow_cloak', name: 'Gölge Pelerini', emoji: '🌑', cost: { gold: 35, materials: 8 }, set: 'assassin_kit', desc: '+3 Enerji', bonus: (s) => { s.energy += 3; } },
    venom_vial: { id: 'venom_vial', name: 'Zehir Şişesi', emoji: '🧪', cost: { gold: 35, materials: 8 }, set: 'assassin_kit', desc: '-3 Kafatası Öz-Hasarı', bonus: (s) => { s.skull_self_dmg = Math.max(0, s.skull_self_dmg - 3); } }
};

const ITEM_SETS = {
    berserker_fury: { name: "Berserker'ın Öfkesi", pieces: ['bloodied_gauntlet', 'crimson_pauldron'], desc: '+10 Ult Gücü', bonus: (s) => { s.ult_dmg += 10; } },
    guardian_bulwark: { name: 'Muhafızın Kalkanı', pieces: ['iron_greaves', 'oak_shield_charm'], desc: '+%5 Can Çalma', bonus: (s) => { s.lifeSteal += 5; } },
    assassin_kit: { name: 'Suikastçının Takımı', pieces: ['swift_boots', 'shadow_cloak', 'venom_vial'], desc: '+5 Enerji (ekstra)', bonus: (s) => { s.energy += 5; } }
};

// Called once per run start (game.js's resetGame), after the class passive
// has already been applied - items stack on top the same way a class
// passive does, both just mutating the same TILE_STATS object.
function applyOwnedItemBonuses(stats, ownedItemIds) {
    let owned = new Set(ownedItemIds || []);
    Object.values(ITEM_CATALOG).forEach(item => { if (owned.has(item.id)) item.bonus(stats); });
    Object.values(ITEM_SETS).forEach(set => { if (set.pieces.every(id => owned.has(id))) set.bonus(stats); });
}

// --- SHOP UI -------------------------------------------------------------------

function renderShop() {
    let container = document.getElementById('shop-items');
    if (!container) return;
    container.innerHTML = '';

    Object.values(ITEM_SETS).forEach(set => {
        let ownedCount = set.pieces.filter(id => currentOwnedItems.includes(id)).length;
        let complete = ownedCount === set.pieces.length;

        let setDiv = document.createElement('div');
        setDiv.className = 'modal-section';

        let header = document.createElement('h4');
        header.innerText = `${set.name} ${complete ? '✅' : `(${ownedCount}/${set.pieces.length})`}`;
        setDiv.appendChild(header);

        let setBonusLine = document.createElement('p');
        setBonusLine.style.fontSize = '0.8rem';
        setBonusLine.style.color = complete ? '#2ecc71' : '#7f8c8d';
        setBonusLine.innerText = `Set Bonusu: ${set.desc}${complete ? ' (AKTİF)' : ''}`;
        setDiv.appendChild(setBonusLine);

        set.pieces.forEach(id => {
            let item = ITEM_CATALOG[id];
            let owned = currentOwnedItems.includes(id);

            let row = document.createElement('div');
            row.className = 'manual-tile';
            row.style.justifyContent = 'space-between';

            let desc = document.createElement('div');
            desc.className = 'manual-desc';
            desc.innerHTML = `<b>${item.emoji} ${item.name}</b>${item.desc} · 🪙${item.cost.gold} 🪨${item.cost.materials}`;
            row.appendChild(desc);

            let btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.style.width = 'auto';
            btn.style.margin = '0';
            btn.style.flexShrink = '0';
            if (owned) {
                btn.innerText = 'SAHİPSİN';
                btn.disabled = true;
            } else {
                btn.innerText = 'SATIN AL';
                btn.onclick = () => purchaseItem(id);
            }
            row.appendChild(btn);

            setDiv.appendChild(row);
        });

        container.appendChild(setDiv);
    });
}
