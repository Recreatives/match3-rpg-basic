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

// Display-only mirrors of supabase/schema.sql's item_scrap_values /
// item_upgrade_costs - the actual amounts are enforced server-side
// (scrap_item/upgrade_item), these just label the buttons correctly. Keep
// in sync with that file if the numbers ever change.
const ITEM_SCRAP_VALUES = { grey: 1, white: 2, blue: 4, yellow: 8, green: 15, orange: 15, red: 15, teal: 15 };
const ITEM_UPGRADE_COSTS = {
    grey: { to: 'white', gold: 20, materials: 2 },
    white: { to: 'blue', gold: 50, materials: 5 },
    blue: { to: 'yellow', gold: 120, materials: 12 }
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
        weapon: { id: 'uniq_nights_lament', name: 'Gecenin Ağıtı', emoji: '⚔️', stats: { sword: 8, lifeSteal: 6 }, passiveDesc: 'Kan Zırhı: Kılıç eşleşmelerinde verdiğin hasarın %20\'si kadar ekstra Zırh kazanırsın.' },
        shield: { id: 'uniq_shield_of_eternity', name: 'Sonsuzluk Kalkanı', emoji: '🛡️', stats: { shield: 7, heart: 7 }, passiveDesc: 'Sonsuz Dayanıklılık: Kalkan eşleşmelerinde kazandığın Zırh\'ın %25\'i kadar da can kazanırsın.' },
        helmet: { id: 'uniq_oracles_crown', name: 'Kahinin Tacı', emoji: '👑', stats: { ult_dmg: 16, energy: 10 }, passiveDesc: 'Kehanet: Enerji eşleşmelerinde kazandığın ult dolumunun %20\'si kadar ekstra ult dolumu kazanırsın.' },
        chest: { id: 'uniq_dragonheart_plate', name: 'Ejderha Yürek Zırhı', emoji: '🐉', stats: { shield: 7, heart: 7 }, passiveDesc: 'Ejderha Kalbi: Kalp eşleşmelerinde iyileştiğin canın %20\'si kadar da Zırh kazanırsın.' },
        shoulder: { id: 'uniq_storm_eagle_pauldrons', name: 'Fırtına Kartalı Omuzluğu', emoji: '🦅', stats: { energy: 10, sword: 8 }, passiveDesc: 'Fırtına Hızı: Kılıç eşleşmelerinde verdiğin hasarın %15\'i kadar ult dolumu kazanırsın.' },
        gloves: { id: 'uniq_butchers_claws', name: 'Kasabın Pençeleri', emoji: '🩸', stats: { skull_dmg: 14, lifeSteal: 6 }, passiveDesc: 'Kasap İçgüdüsü: Kafatası eşleşmelerinde kendine verdiğin hasarın %50\'si kadar can kazanırsın.' },
        boots: { id: 'uniq_windwalkers', name: 'Rüzgar Yürüyüşü', emoji: '💨', stats: { energy: 10, sword: 8 }, passiveDesc: 'Rüzgar Adımı: Enerji eşleşmelerinde kazandığın ult dolumunun %15\'i kadar Zırh kazanırsın.' },
        trinket: { id: 'uniq_ring_of_ancient_wisdom', name: 'Kadim Bilgelik Halkası', emoji: '💍', stats: { ult_dmg: 16, teamHeal: 6 }, passiveDesc: 'Kadim Bilgelik: Ultimate kullandığında ekstra %10 ult dolumu kazanırsın.' }
    },
    red: {
        weapon: { id: 'uniq_world_eater', name: 'Dünya Yiyen', emoji: '⚔️', stats: { sword: 10, skull_dmg: 18, lifeSteal: 8 }, passiveDesc: 'Çaresiz Öfke: Canın %50\'nin altındayken Kafatası hasarın %50 artar.' },
        shield: { id: 'uniq_the_last_wall', name: 'Son Duvar', emoji: '🛡️', stats: { shield: 9, heart: 9, energy: 13 }, passiveDesc: 'Son Savunma: Canın %30\'un altındayken Kalkan eşleşmelerinden %50 daha fazla Zırh kazanırsın.' },
        helmet: { id: 'uniq_starfall_helm', name: 'Yıldız Düşüren Miğfer', emoji: '☄️', stats: { ult_dmg: 20, energy: 13, shield: 9 }, passiveDesc: 'Yıldız Yağmuru: Ultimate kullandığında rakibine ekstra doğrudan hasar verirsin.' },
        chest: { id: 'uniq_titans_hide', name: "Titan'ın Derisi", emoji: '🗿', stats: { shield: 9, heart: 9, sword: 10 }, passiveDesc: 'Titan Zırhı: Kılıç eşleşmelerinde verdiğin hasarın %15\'i kadar can kazanırsın.' },
        shoulder: { id: 'uniq_doomwings', name: 'Kıyamet Kanatları', emoji: '🔥', stats: { energy: 13, skull_dmg: 18, sword: 10 }, passiveDesc: 'Kıyamet: Kafatası eşleşmelerinde verdiğin hasar her zaman %20 artar.' },
        gloves: { id: 'uniq_the_throatreaver', name: 'Boğazlayıcı', emoji: '☠️', stats: { skull_dmg: 18, lifeSteal: 8, sword: 10 }, passiveDesc: 'Boğaz Kesen: Kafatası eşleşmelerinde rakibe verdiğin hasarın %25\'i kadar can kazanırsın.' },
        boots: { id: 'uniq_timestep_striders', name: 'Zaman Adımı', emoji: '⏳', stats: { energy: 13, sword: 10, ult_dmg: 20 }, passiveDesc: 'Zaman Bükümü: Ultimate kullandığında ekstra %20 ult dolumu kazanırsın.' },
        trinket: { id: 'uniq_eternity_core', name: 'Sonsuzluk Çekirdeği', emoji: '💠', stats: { ult_dmg: 20, energy: 13, teamHeal: 8 }, passiveDesc: 'Sonsuzluk Çekirdeği: Ultimate kullandığında maksimum canının %15\'i kadar iyileşirsin.' }
    },
    teal: {
        weapon: { id: 'uniq_whisper_of_the_void', name: 'Hiçliğin Fısıltısı', emoji: '🌌', stats: { ult_dmg: 18, lifeSteal: 7 }, passiveDesc: 'Boşluk Yankısı: Ultimate kullandığında maksimum canının %10\'u kadar iyileşirsin.' },
        shield: { id: 'uniq_shattered_time_aegis', name: 'Kırık Zaman Kalkanı', emoji: '⏱️', stats: { shield: 8, energy: 12 }, passiveDesc: 'Kırık Zaman: Kalkan eşleşmelerinde kazandığın Zırh\'ın %20\'si kadar ult dolumu kazanırsın.' },
        helmet: { id: 'uniq_astral_sight', name: 'Astral Görüş', emoji: '👁️', stats: { energy: 12, ult_dmg: 18 }, passiveDesc: 'Astral Görüş: Enerji eşleşmelerinde kazandığın ult dolumunun %25\'i kadar ekstra ult dolumu kazanırsın.' },
        chest: { id: 'uniq_shroud_of_shadows', name: 'Gölge Örtüsü', emoji: '🌑', stats: { shield: 8, lifeSteal: 7 }, passiveDesc: 'Gölge Örtüsü: Kılıç eşleşmelerinde verdiğin hasarın %15\'i kadar can kazanırsın.' },
        shoulder: { id: 'uniq_cosmic_wings', name: 'Kozmik Kanatlar', emoji: '✨', stats: { energy: 12, skull_dmg: 16 }, passiveDesc: 'Kozmik Rüzgar: Kafatası eşleşmelerinde kendine gelen hasar %30 azalır.' },
        gloves: { id: 'uniq_soul_rending_claws', name: 'Ruh Emici Pençeler', emoji: '👻', stats: { skull_dmg: 16, lifeSteal: 7 }, passiveDesc: 'Ruh Emme: Kafatası eşleşmelerinde rakibe verdiğin hasarın %20\'si kadar can kazanırsın.' },
        boots: { id: 'uniq_voidstep', name: 'Boşluk Adımı', emoji: '🕳️', stats: { energy: 12, sword: 9 }, passiveDesc: 'Boşluk Sıçraması: Kılıç eşleşmelerinde verdiğin hasarın %20\'si kadar ult dolumu kazanırsın.' },
        trinket: { id: 'uniq_eye_of_infinity', name: 'Sonsuzluk Gözü', emoji: '♾️', stats: { ult_dmg: 18, teamHeal: 7 }, passiveDesc: 'Sonsuzluk Gözü: Ultimate kullandığında ekstra %15 ult dolumu kazanırsın.' }
    }
};

// Procedural flavor names - a rolled item used to just show up as
// "{base name} ({rarity})" (e.g. "Balta (Sihirli)"), which reads as
// exactly what it is under the hood (a base + a rarity multiplier) rather
// than as loot worth getting excited about. Each base's primaryStat picks
// which pool its prefix comes from, so the name still hints at what the
// item is good for ("Cellat Baltası" on a skull_dmg weapon reads right).
// Multi-word prefixes are deliberately avoided so "{prefix} {base.name}"
// never reads awkwardly regardless of which base it lands on.
const ITEM_PREFIXES = {
    sword:      ['Keskin', 'Kanlı', 'Yırtıcı', 'Vahşi', 'Parlayan', 'Öfkeli'],
    skull_dmg:  ['Cellat', 'Kasap', 'Kıyıcı', 'Acımasız', 'Vahşet', 'Kanlı'],
    ult_dmg:    ['Arkane', 'Kadim', 'Büyülü', 'Kozmik', 'Gizemli', 'Ejderha'],
    lifeSteal:  ['Vampirik', 'Açgözlü', 'Solgun', 'Gölge', 'Karanlık', 'Ruhsuz'],
    energy:     ['Şimşek', 'Elektrikli', 'Çakan', 'Rüzgar', 'Fırtınalı', 'Volt'],
    shield:     ['Demir', 'Çelik', 'Sarsılmaz', 'Granit', 'Kale', 'Ejder'],
    heart:      ['Şifa', 'Yaşam', 'Diriliş', 'Kutsal', 'Işıltılı', 'Umut'],
    teamHeal:   ['Dost', 'Birlik', 'Kutsanmış', 'Dayanışma', 'Paylaşılan', 'Sadık']
};

// Deterministic per item INSTANCE (not persisted - re-derived from content
// that's already stable) so the same item shows the same name on every
// render, including right after a fresh roll before it has a DB id yet,
// while two different rolls of the same base+rarity still usually get
// different prefixes. Not cryptographic, just needs to vary with content.
function stableItemSeed(item) {
    let str = (item.base_id || '') + JSON.stringify(item.rolled_stats || {});
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}

// Same per-stat baseline rollAffixValue already uses to scale a roll by
// rarity - reused here to normalize each stat's contribution to "power"
// (a +5 ult_dmg and a +2 sword roll should count for roughly the same
// amount, since +5 is a big ult_dmg roll but +2 is a big sword roll).
const STAT_POWER_BASE = { sword: 2, heart: 2, shield: 2, energy: 3, skull_dmg: 4, ult_dmg: 5, lifeSteal: 2, teamHeal: 2, skull_self_dmg: 2 };

// A single at-a-glance number for "how good is this item" - not used for
// any game-rule math (equip bonuses always come from rolled_stats
// directly), purely a display convenience so a player can compare two
// items or track their own equipped total without reading every stat line.
function itemPower(item) {
    let power = 0;
    Object.entries(item.rolled_stats || {}).forEach(([stat, value]) => {
        let base = STAT_POWER_BASE[stat] || 2;
        // skull_self_dmg is a downside stat stored as a negative roll (see
        // rollAffixValue) - more negative is better, so flip its sign
        // before normalizing, same as every other (positive-is-better) stat.
        let magnitude = stat === 'skull_self_dmg' ? -value : value;
        power += (magnitude / base) * 10;
    });
    return Math.max(0, Math.round(power));
}

function totalEquippedPower(ownedItems) {
    return (ownedItems || []).filter(it => it.equipped_slot).reduce((sum, it) => sum + itemPower(it), 0);
}

// Checks by base_id (stable across every roll of that item, unlike the
// row's own uuid) whether the CURRENT player has it equipped right now -
// the one thing every flagship-legendary passive below needs to know
// before doing anything extra. Deliberately global (not scoped to any one
// mode's own state) so game.js/coop.js/pvp.js can all call the exact same
// check and a passive behaves identically no matter which mode it's used
// in.
function hasEquippedItem(baseId) {
    return (typeof currentOwnedItems !== 'undefined' ? currentOwnedItems : []).some(it => it.base_id === baseId && it.equipped_slot);
}

// One passive per Orange/Red/Teal item (24 total) - a Diablo-style "every
// legendary does something a plain stat roll can't" pass, on top of the
// flat stats those items already carry. Each entry's own passiveDesc
// (UNIQUE_LEGENDARIES above) is the single source of truth for the
// player-facing text; this registry only holds the MECHANIC.
//
// `hook` picks which combat moment triggers it - one of:
//   'sword' / 'shield' / 'heart' / 'energy' - fires right after that tile
//     type resolves. payload = { amount } (the value just applied).
//   'skull' - payload = { dmgToOpponent, recoil }, both mutable BEFORE
//     they're applied (an effect can return early having changed either).
//   'ultimate' - fires right after the class ultimate itself resolves.
//     No payload.
// `ctx` is the same makeSinglePlayerCombatContext()/makeCoopCombatContext()/
// makePvpCombatContext() every class ultEffect already uses (game.js/
// coop.js/pvp.js) - reused rather than inventing a second interface, so a
// passive's own-HP/add-armor/etc calls behave identically in every mode
// for the exact same reason class ultimates already do.
//
// `effect` returns a log string when it wants one printed (armor/heal/
// energy/direct-damage gains that would otherwise be invisible), or
// null/undefined when the effect only reshapes a skull payload - those
// already show up in the normal "Kafatası! Hasar: X / Kendine: Y" line,
// so a second log line would just be noise.
const UNIQUE_PASSIVES = {
    // --- Orange (Efsanevi) ---------------------------------------------------
    uniq_nights_lament: { // Gecenin Ağıtı - Kan Zırhı
        hook: 'sword',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.2); if (b <= 0) return null; ctx.addArmor(b); return tf('✨ Kan Zırhı: +{b} Zırh', { b }); }
    },
    uniq_shield_of_eternity: { // Sonsuzluk Kalkanı - Sonsuz Dayanıklılık
        hook: 'shield',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.25); if (b <= 0) return null; ctx.healSelf(b); return tf('✨ Sonsuz Dayanıklılık: +{b} can', { b }); }
    },
    uniq_oracles_crown: { // Kahinin Tacı - Kehanet
        hook: 'energy',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.2); if (b <= 0) return null; ctx.addEnergy(b); return tf('✨ Kehanet: +{b}% ult', { b }); }
    },
    uniq_dragonheart_plate: { // Ejderha Yürek Zırhı - Ejderha Kalbi
        hook: 'heart',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.2); if (b <= 0) return null; ctx.addArmor(b); return tf('✨ Ejderha Kalbi: +{b} Zırh', { b }); }
    },
    uniq_storm_eagle_pauldrons: { // Fırtına Kartalı Omuzluğu - Fırtına Hızı
        hook: 'sword',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.15); if (b <= 0) return null; ctx.addEnergy(b); return tf('✨ Fırtına Hızı: +{b}% ult', { b }); }
    },
    uniq_butchers_claws: { // Kasabın Pençeleri - Kasap İçgüdüsü
        hook: 'skull',
        effect: (ctx, p) => { let b = Math.floor(p.recoil * 0.5); if (b <= 0) return null; ctx.healSelf(b); return tf('✨ Kasap İçgüdüsü: +{b} can', { b }); }
    },
    uniq_windwalkers: { // Rüzgar Yürüyüşü - Rüzgar Adımı
        hook: 'energy',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.15); if (b <= 0) return null; ctx.addArmor(b); return tf('✨ Rüzgar Adımı: +{b} Zırh', { b }); }
    },
    uniq_ring_of_ancient_wisdom: { // Kadim Bilgelik Halkası - Kadim Bilgelik
        hook: 'ultimate',
        effect: (ctx) => { ctx.addEnergy(10); return t('✨ Kadim Bilgelik: +10% ult'); }
    },

    // --- Red (İlksel Efsanevi) ------------------------------------------------
    uniq_world_eater: { // Dünya Yiyen - Çaresiz Öfke
        hook: 'skull',
        effect: (ctx, p) => { if (ctx.getSelfHP() < ctx.getMaxHP() * 0.5) p.dmgToOpponent = Math.floor(p.dmgToOpponent * 1.5); return null; }
    },
    uniq_the_last_wall: { // Son Duvar - Son Savunma
        hook: 'shield',
        effect: (ctx, p) => {
            if (ctx.getSelfHP() >= ctx.getMaxHP() * 0.3) return null;
            let b = Math.floor(p.amount * 0.5); if (b <= 0) return null;
            ctx.addArmor(b); return tf('✨ Son Savunma: +{b} Zırh', { b });
        }
    },
    uniq_starfall_helm: { // Yıldız Düşüren Miğfer - Yıldız Yağmuru
        hook: 'ultimate',
        effect: (ctx) => {
            let dmg = Math.floor((typeof TILE_STATS !== 'undefined' ? TILE_STATS.ult_dmg : 0) * 0.2);
            if (dmg <= 0) return null;
            ctx.dealDirectDamageToOpponent(dmg); return tf('✨ Yıldız Yağmuru: {dmg} ekstra hasar', { dmg });
        }
    },
    uniq_titans_hide: { // Titan'ın Derisi - Titan Zırhı
        hook: 'sword',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.15); if (b <= 0) return null; ctx.healSelf(b); return tf('✨ Titan Zırhı: +{b} can', { b }); }
    },
    uniq_doomwings: { // Kıyamet Kanatları - Kıyamet
        hook: 'skull',
        effect: (ctx, p) => { p.dmgToOpponent = Math.floor(p.dmgToOpponent * 1.2); return null; }
    },
    uniq_the_throatreaver: { // Boğazlayıcı - Boğaz Kesen
        hook: 'skull',
        effect: (ctx, p) => { let b = Math.floor(p.dmgToOpponent * 0.25); if (b <= 0) return null; ctx.healSelf(b); return tf('✨ Boğaz Kesen: +{b} can', { b }); }
    },
    uniq_timestep_striders: { // Zaman Adımı - Zaman Bükümü
        hook: 'ultimate',
        effect: (ctx) => { ctx.addEnergy(20); return t('✨ Zaman Bükümü: +20% ult'); }
    },
    uniq_eternity_core: { // Sonsuzluk Çekirdeği - Sonsuzluk Çekirdeği
        hook: 'ultimate',
        effect: (ctx) => { let heal = Math.floor(ctx.getMaxHP() * 0.15); if (heal <= 0) return null; ctx.healSelf(heal); return tf('✨ Sonsuzluk Çekirdeği: +{heal} can', { heal }); }
    },

    // --- Teal (Ethereal) -------------------------------------------------------
    uniq_whisper_of_the_void: { // Hiçliğin Fısıltısı - Boşluk Yankısı
        hook: 'ultimate',
        effect: (ctx) => { let heal = Math.floor(ctx.getMaxHP() * 0.1); if (heal <= 0) return null; ctx.healSelf(heal); return tf('✨ Boşluk Yankısı: +{heal} can', { heal }); }
    },
    uniq_shattered_time_aegis: { // Kırık Zaman Kalkanı - Kırık Zaman
        hook: 'shield',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.2); if (b <= 0) return null; ctx.addEnergy(b); return tf('✨ Kırık Zaman: +{b}% ult', { b }); }
    },
    uniq_astral_sight: { // Astral Görüş - Astral Görüş
        hook: 'energy',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.25); if (b <= 0) return null; ctx.addEnergy(b); return tf('✨ Astral Görüş: +{b}% ult', { b }); }
    },
    uniq_shroud_of_shadows: { // Gölge Örtüsü - Gölge Örtüsü
        hook: 'sword',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.15); if (b <= 0) return null; ctx.healSelf(b); return tf('✨ Gölge Örtüsü: +{b} can', { b }); }
    },
    uniq_cosmic_wings: { // Kozmik Kanatlar - Kozmik Rüzgar
        hook: 'skull',
        effect: (ctx, p) => { p.recoil = Math.floor(p.recoil * 0.7); return null; }
    },
    uniq_soul_rending_claws: { // Ruh Emici Pençeler - Ruh Emme
        hook: 'skull',
        effect: (ctx, p) => { let b = Math.floor(p.dmgToOpponent * 0.2); if (b <= 0) return null; ctx.healSelf(b); return tf('✨ Ruh Emme: +{b} can', { b }); }
    },
    uniq_voidstep: { // Boşluk Adımı - Boşluk Sıçraması
        hook: 'sword',
        effect: (ctx, p) => { let b = Math.floor(p.amount * 0.2); if (b <= 0) return null; ctx.addEnergy(b); return tf('✨ Boşluk Sıçraması: +{b}% ult', { b }); }
    },
    uniq_eye_of_infinity: { // Sonsuzluk Gözü - Sonsuzluk Gözü
        hook: 'ultimate',
        effect: (ctx) => { ctx.addEnergy(15); return t('✨ Sonsuzluk Gözü: +15% ult'); }
    }
};

// Called at every relevant combat moment (sword/skull/shield/heart/energy
// match resolution, and right after a class ultimate resolves) in all
// three modes - checks every currently EQUIPPED item for a passive
// matching this hook and runs it, logging whatever message (if any) the
// effect returns. A player with no legendary equipped (or one whose
// passive is for a different hook) costs one array scan and nothing else.
function triggerPassiveHook(hookName, ctx, payload) {
    (typeof currentOwnedItems !== 'undefined' ? currentOwnedItems : [])
        .filter(it => it.equipped_slot)
        .forEach(it => {
            let passive = UNIQUE_PASSIVES[it.base_id];
            if (!passive || passive.hook !== hookName) return;
            let msg = passive.effect(ctx, payload || {});
            if (msg) ctx.log(msg, 'log-armor');
        });
}

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

    // itemDisplayInfo needs base_id/rolled_stats/slot to pick the same
    // prefix this item will show everywhere else - built inline rather
    // than calling it with the object below, since that object doesn't
    // exist yet until after this call.
    let flavorName = itemDisplayInfo({ base_id: base.id, slot, rolled_stats: stats }).name;

    return {
        base_id: base.id, slot, rarity: rarityKey,
        name: `${flavorName} (${t(rarity.label)})`, emoji: base.emoji,
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
        return { name: t(piece.name), emoji: piece.emoji };
    }
    let rarity = RARITY_DEFS[item.rarity];
    if (rarity && rarity.isUnique) {
        let uniq = UNIQUE_LEGENDARIES[item.rarity][item.slot];
        return { name: t(uniq.name), emoji: uniq.emoji, passiveDesc: uniq.passiveDesc ? t(uniq.passiveDesc) : null };
    }
    let base = ITEM_BASES[item.slot] && ITEM_BASES[item.slot].find(b => b.id === item.base_id);
    if (!base) return { name: item.base_id, emoji: '❓' };
    let prefixPool = ITEM_PREFIXES[base.primaryStat];
    let prefix = prefixPool ? prefixPool[stableItemSeed(item) % prefixPool.length] : null;
    return { name: prefix ? `${t(prefix)} ${t(base.name)}` : t(base.name), emoji: base.emoji };
}

function formatRolledStats(stats) {
    return Object.entries(stats || {}).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ');
}

// 3 tabs as of the prestige panel - each {tab name: [button id, panel id]}.
// Kept data-driven rather than one if/else per tab so adding a 4th later
// is a one-line addition here, not another branch to keep in sync.
const SHOP_TABS = {
    shop: ['shop-tab-btn', 'shop-items'],
    inventory: ['inventory-tab-btn', 'inventory-list'],
    prestige: ['prestige-tab-btn', 'prestige-panel']
};

function switchShopTab(tab) {
    Object.entries(SHOP_TABS).forEach(([name, [btnId, panelId]]) => {
        let btn = document.getElementById(btnId);
        let panel = document.getElementById(panelId);
        let active = name === tab;
        if (panel) panel.style.display = active ? 'block' : 'none';
        if (btn) { btn.style.background = active ? '' : '#555'; btn.style.color = active ? '' : '#ccc'; }
    });
    if (tab === 'prestige' && typeof renderPrestigePanel === 'function') renderPrestigePanel();
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
        header.innerText = t(SLOT_LABELS[slot]);
        section.appendChild(header);

        ['grey', 'white', 'blue'].forEach(rarityKey => {
            let rarity = RARITY_DEFS[rarityKey];
            let row = document.createElement('div');
            row.className = 'manual-tile';
            row.style.justifyContent = 'space-between';

            let desc = document.createElement('div');
            desc.className = 'manual-desc';
            desc.style.color = rarity.color;
            desc.innerHTML = `<b>${rarity.mark} ${rarity.name}</b> ${t(rarity.label)} - ${tf('rastgele {n} stat', { n: rarity.affixCount })}`;
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

// One entry per set that has AT LEAST ONE equipped piece (owning pieces
// unequipped doesn't count - same rule applyEquippedItemBonuses, items.js,
// already enforces for the actual bonus). Shared by the equipped-slots
// section and every individual set-item row, so "how many pieces until the
// bonus kicks in" is answered in both places instead of a player having to
// infer it from the set's name alone.
function getSetProgress(ownedItems) {
    let progress = {};
    Object.entries(ITEM_SETS).forEach(([setKey, set]) => {
        let totalCount = Object.keys(set.pieces).length;
        let equippedCount = (ownedItems || []).filter(it => it.set_key === setKey && it.equipped_slot).length;
        if (equippedCount > 0) {
            progress[setKey] = { equippedCount, totalCount, isActive: equippedCount === totalCount, name: set.name, bonusDesc: set.bonusDesc };
        }
    });
    return progress;
}

// Renders the 8 equip slots (weapon/shield/.../trinket) into the given
// container id - shared by the Envanter tab and the Loot/Stats screen, so
// a player doesn't have to open the shop modal just to see what they
// currently have on. Returns nothing; safe to call even if the container
// doesn't exist on the current page (Loot/Stats markup only exists once).
function renderEquippedSlotsInto(containerId) {
    let container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    let setProgress = getSetProgress(currentOwnedItems);
    let setKeys = Object.keys(setProgress);
    if (setKeys.length > 0) {
        let setSummary = document.createElement('div');
        setSummary.style.cssText = 'font-size:0.8rem; margin-bottom:8px; padding:8px; background:rgba(34,197,94,0.08); border-left:3px solid #22c55e; border-radius:4px;';
        setSummary.innerHTML = setKeys.map(key => {
            let p = setProgress[key];
            let icon = p.isActive ? '✅' : '⏳';
            let suffix = p.isActive
                ? ` - <span style="color:#22c55e;">${tf('aktif: {desc}', { desc: t(p.bonusDesc) })}</span>`
                : ` - ${tf('tümü kuşanılınca: {desc}', { desc: t(p.bonusDesc) })}`;
            return `${icon} <b>${t(p.name)}</b> (${p.equippedCount}/${p.totalCount})${suffix}`;
        }).join('<br>');
        container.appendChild(setSummary);
    }

    let header = document.createElement('h4');
    header.innerHTML = `${t('Kuşanılanlar')} <span style="color:var(--accent); font-size:0.85rem;">${tf('💎 Toplam Güç: {n}', { n: totalEquippedPower(currentOwnedItems) })}</span>`;
    container.appendChild(header);

    ITEM_SLOTS.forEach(slot => {
        let equipped = currentOwnedItems.find(it => it.equipped_slot === slot);
        let row = document.createElement('div');
        row.className = 'manual-tile';
        if (equipped) {
            let rarity = RARITY_DEFS[equipped.rarity];
            let info = itemDisplayInfo(equipped);
            let passiveLine = info.passiveDesc ? `<br><span style="color:#f97316; font-style:italic;">✨ ${info.passiveDesc}</span>` : '';
            row.innerHTML = `<span class="manual-icon">${info.emoji}</span>
                <div class="manual-desc" style="color:${rarity.color};"><b>${t(SLOT_LABELS[slot])}: ${info.name} (${rarity.mark} ${t(rarity.label)})</b>${formatRolledStats(equipped.rolled_stats)} · 💎${itemPower(equipped)}${passiveLine}</div>`;
        } else {
            row.innerHTML = `<span class="manual-icon">➖</span><div class="manual-desc" style="color:#7f8c8d;"><b>${t(SLOT_LABELS[slot])}: ${t('Boş')}</b></div>`;
        }
        container.appendChild(row);
    });
}

function renderInventory() {
    let container = document.getElementById('inventory-list');
    if (!container) return;
    container.innerHTML = '';

    let slotsDiv = document.createElement('div');
    slotsDiv.className = 'modal-section';
    slotsDiv.id = 'inventory-equipped-slots';
    container.appendChild(slotsDiv);
    renderEquippedSlotsInto('inventory-equipped-slots');

    let listDiv = document.createElement('div');
    listDiv.className = 'modal-section';
    listDiv.innerHTML = `<h4>${t('Envanter')}</h4>`;
    if (currentOwnedItems.length === 0) {
        listDiv.innerHTML += `<p style="color:#7f8c8d; font-size:0.8rem;">${t('Henüz eşyan yok.')}</p>`;
    }

    function buildInventoryRow(item) {
        let rarity = RARITY_DEFS[item.rarity];
        let info = itemDisplayInfo(item);
        let row = document.createElement('div');
        row.className = 'manual-tile';
        // Wraps onto its own second row (desc above, buttons below) instead
        // of overflowing past the modal's edge once an item picks up its
        // 3rd action button (KUŞAN/ÇIKAR + upgrade + scrap) - flex's
        // default nowrap let both sides keep their full natural width and
        // just spill out sideways.
        row.style.justifyContent = 'space-between';
        row.style.flexWrap = 'wrap';
        row.style.rowGap = '6px';

        let desc = document.createElement('div');
        desc.className = 'manual-desc';
        desc.style.color = rarity.color;
        // flex-basis:100% (not just a min width) FORCES this onto its own
        // full-width line whenever the row wraps, rather than leaving it to
        // flex's default auto-sizing to decide how much of the row each
        // side gets - that auto-sizing is exactly what let btnWrap keep
        // claiming its full 3-button width below and spill past the card
        // edge instead of actually wrapping. Same flex-basis:100% on
        // btnWrap below for the same reason.
        desc.style.flex = '1 1 100%';
        desc.style.minWidth = '0';
        let setLine = '';
        if (item.set_key) {
            let set = ITEM_SETS[item.set_key];
            let totalCount = Object.keys(set.pieces).length;
            let equippedCount = currentOwnedItems.filter(it => it.set_key === item.set_key && it.equipped_slot).length;
            // Tells a player exactly how close they are to the bonus, right
            // on the item itself - previously this only said the set's NAME,
            // with no indication of how many pieces it needs or what
            // equipping them all actually does.
            setLine = ' · ' + tf('Set: {name} ({eq}/{total}) → {bonus}', { name: t(set.name), eq: equippedCount, total: totalCount, bonus: t(set.bonusDesc) });
        }
        let passiveLine = info.passiveDesc ? `<br><span style="color:#f97316; font-style:italic;">✨ ${info.passiveDesc}</span>` : '';
        desc.innerHTML = `<b>${info.emoji} ${info.name} (${rarity.mark} ${t(rarity.label)}) · 💎${itemPower(item)}</b>${formatRolledStats(item.rolled_stats)}${setLine}${passiveLine}`;
        row.appendChild(desc);

        let btnWrap = document.createElement('div');
        btnWrap.style.display = 'flex'; btnWrap.style.gap = '4px'; btnWrap.style.flexWrap = 'wrap';
        btnWrap.style.flex = '1 1 100%'; btnWrap.style.minWidth = '0';

        let btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.style.width = 'auto'; btn.style.margin = '0';
        if (item.equipped_slot) { btn.innerText = t('ÇIKAR'); btn.onclick = () => unequipItem(item.id); }
        else { btn.innerText = t('KUŞAN'); btn.onclick = () => equipItem(item.id); }
        btnWrap.appendChild(btn);

        // Scrap/upgrade only make sense for an item that's just sitting in
        // the bag - an equipped item stays put until you take it off
        // (scrap_item/upgrade_item, supabase/schema.sql, enforce this
        // server-side too, this just avoids offering a button that would
        // fail).
        if (!item.equipped_slot) {
            if (ITEM_UPGRADE_COSTS[item.rarity]) {
                let uc = ITEM_UPGRADE_COSTS[item.rarity];
                let upBtn = document.createElement('button');
                upBtn.className = 'action-btn';
                upBtn.style.width = 'auto'; upBtn.style.margin = '0'; upBtn.style.background = '#8e44ad';
                upBtn.innerText = `⬆️ ${uc.gold}🪙 ${uc.materials}🪨`;
                upBtn.onclick = () => upgradeItem(item.id);
                btnWrap.appendChild(upBtn);
            }
            let scrapBtn = document.createElement('button');
            scrapBtn.className = 'action-btn';
            scrapBtn.style.width = 'auto'; scrapBtn.style.margin = '0'; scrapBtn.style.background = '#7f8c8d';
            scrapBtn.innerText = `♻️ +${ITEM_SCRAP_VALUES[item.rarity] || 1}🪨`;
            scrapBtn.title = t('Hurdaya çevir');
            scrapBtn.onclick = () => scrapItem(item.id);
            btnWrap.appendChild(scrapBtn);
        }
        row.appendChild(btnWrap);
        return row;
    }

    // Grouped by slot (Silah/Kalkan/Miğfer/...) instead of one flat list
    // sorted only by rarity - a bag of 15 mixed items in rarity order made
    // it hard to find "which shields do I have" at a glance. Within each
    // slot, still highest rarity first. Slots with nothing in them are
    // skipped entirely rather than shown empty, unlike the equipped-slots
    // list above (which always shows all 8 to make gaps in a loadout
    // obvious) - here an empty section would just be noise.
    let rarityOrder = Object.keys(RARITY_DEFS);
    ITEM_SLOTS.forEach(slot => {
        let itemsInSlot = currentOwnedItems
            .filter(it => it.slot === slot)
            .sort((a, b) => rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity));
        if (itemsInSlot.length === 0) return;

        let slotHeader = document.createElement('div');
        slotHeader.style.cssText = 'font-size:0.75rem; color:#7f8c8d; text-transform:uppercase; letter-spacing:0.5px; margin:12px 0 4px; font-weight:bold;';
        slotHeader.innerText = `${t(SLOT_LABELS[slot])} (${itemsInSlot.length})`;
        listDiv.appendChild(slotHeader);

        itemsInSlot.forEach(item => listDiv.appendChild(buildInventoryRow(item)));
    });
    container.appendChild(listDiv);
}

function showLootToast(item) {
    let rarity = RARITY_DEFS[item.rarity];
    let el = document.createElement('div');
    el.className = 'achievement-toast';
    el.style.borderColor = rarity.color;
    el.innerHTML = `<b style="color:${rarity.color};">${item.emoji} ${rarity.mark} ${tf('{rarity} DÜŞTÜ', { rarity: t(rarity.label) })}</b><br>${item.name}${item.set_key || (RARITY_DEFS[item.rarity] && RARITY_DEFS[item.rarity].isUnique) ? '' : ` · 💎${itemPower(item)}`}`;
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
