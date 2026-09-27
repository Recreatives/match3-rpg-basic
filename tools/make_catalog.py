#!/usr/bin/env python3
"""The item catalog - ONE source of truth for both languages.

Writes:
  catalog.js                       - the client catalog (items.js reads it)
  supabase/schema.sql (a block)    - the server's reference tables
                                     (item_bases, item_fixed_defs), between
                                     the "BEGIN GENERATED CATALOG" markers

Run after changing anything here:  python3 tools/make_catalog.py

Item model
  slot       weapon, offhand, helmet, shoulder, amulet, chest, gloves, belt,
             legs, boots, ring   (rings go in either of two ring slots)
  band       every base belongs to a level band; an item of that base rolls
             an item level inside the band, and the level is also what a
             character needs to wear it
  classes    who may wear it (weapons and off-hands by type, armor by
             weight: plate / leather / cloth; jewelry and belts: everyone)
  size       1 (1x1) or 2 (1x2, long weapons, chest, legs) in the bag grid
  vis        how it looks on the painted hero (avatar.js layer + colors)
"""
import json, os, re

ROOT = os.path.join(os.path.dirname(__file__), '..')
BANDS = [(1, 10), (10, 20), (20, 30), (30, 40), (40, 50)]
ALL = ['warrior', 'paladin', 'berserker', 'rogue', 'archer', 'mage', 'necromancer']
WEIGHT = {'plate': ['warrior', 'paladin', 'berserker'], 'leather': ['rogue', 'archer', 'berserker'], 'cloth': ['mage', 'necromancer']}

BASES = {}
EN = {}  # Turkish name -> English (goes into EN_DICT at load)


def add(bid, slot, name, stat, classes, band, size=1, vis=None, legacy=False, en=None):
    if en: EN[name] = en
    lo, hi = band
    BASES[bid] = {'slot': slot, 'name': name, 'stat': stat, 'cls': classes, 'min': lo, 'max': hi, 'size': size, 'vis': vis, 'legacy': legacy}


# ---------------------------------------------------------------- armor ------
ARMOR_SLOTS = ['helmet', 'shoulder', 'chest', 'gloves', 'legs', 'boots']
ARMOR = {
    'plate': {
        'en_names': {'helmet': 'Helm', 'shoulder': 'Pauldrons', 'chest': 'Breastplate', 'gloves': 'Vambraces', 'legs': 'Greaves', 'boots': 'Sabatons'},
        'en': ['Rusty', 'Iron', 'Steel', 'Guardian', 'Dragon'],
        'names': {'helmet': 'Miğfer', 'shoulder': 'Omuzluk', 'chest': 'Göğüslük', 'gloves': 'Kolçak', 'legs': 'Dizlik', 'boots': 'Demir Çizme'},
        'stats': {'helmet': 'shield', 'shoulder': 'shield', 'chest': 'heart', 'gloves': 'sword', 'legs': 'heart', 'boots': 'shield'},
        'styles': {'helmet': ['nasal', 'nasal', 'greathelm', 'greathelm', 'horned'], 'shoulder': ['plate', 'plate', 'plate', 'spiked', 'spiked'],
                   'chest': ['mail', 'plate', 'plate', 'plate', 'plate'], 'gloves': ['gauntlet'] * 5, 'legs': ['plate'] * 5, 'boots': ['plate'] * 5},
        'bands': [
            ('Paslı', '#7a7068', '#6a5a4a', {'tabard': '#5a3a2a'}),
            ('Demir', '#8a939c', '#b08a4a', {'tabard': '#7a1a1a', 'plume': '#8e1b1b'}),
            ('Çelik', '#aab4c0', '#d4a84a', {'tabard': '#1a3a7a', 'cape': '#1a2a5a', 'plume': '#1a3a7a'}),
            ('Muhafız', '#c8ccd4', '#ffd24a', {'tabard': '#e8e4d8', 'cape': '#8e1b1b', 'plume': '#e8e4d8'}),
            ('Ejder', '#4a4e5a', '#d4a84a', {'tabard': '#3a0a0a', 'cape': '#4a0808', 'glow': '#ff5a2a'}),
        ],
    },
    'leather': {
        'en_names': {'helmet': 'Cowl', 'shoulder': 'Shoulder Pads', 'chest': 'Leather Armor', 'gloves': 'Leather Gloves', 'legs': 'Leather Pants', 'boots': 'Leather Boots'},
        'en': ['Worn', 'Wanderer', 'Shadow', 'Hunter', 'Nightraven'],
        'names': {'helmet': 'Başlık', 'shoulder': 'Omuz Pedi', 'chest': 'Deri Zırh', 'gloves': 'Deri Eldiven', 'legs': 'Deri Pantolon', 'boots': 'Deri Çizme'},
        'stats': {'helmet': 'energy', 'shoulder': 'energy', 'chest': 'sword', 'gloves': 'lifeSteal', 'legs': 'sword', 'boots': 'energy'},
        'styles': {'helmet': ['cowl'] * 5, 'shoulder': ['leather'] * 5, 'chest': ['leather'] * 5, 'gloves': ['leather'] * 5, 'legs': ['leather'] * 5, 'boots': ['leather'] * 5},
        'bands': [
            ('Yıpranmış', '#6b4a30', '#8a6a4a', {}),
            ('Gezgin', '#4a5a3a', '#c9a24a', {}),
            ('Gölge', '#3a2a4a', '#c9a24a', {'cape': '#2a1a3a'}),
            ('Avcı', '#2e4a2a', '#d4a84a', {'cape': '#243a20', 'feathers': True}),
            ('Gece Kuzgunu', '#1c1c26', '#3fe0c0', {'cape': '#101018', 'feathers': True, 'glow': '#3fe0c0'}),
        ],
    },
    'cloth': {
        'en_names': {'helmet': 'Hood', 'shoulder': 'Mantle', 'chest': 'Robe', 'gloves': 'Wraps', 'legs': 'Trousers', 'boots': 'Sandals'},
        'en': ['Linen', 'Apprentice', 'Arcanist', 'Ancient', 'Starborn'],
        'names': {'helmet': 'Kukuleta', 'shoulder': 'Omuz Şalı', 'chest': 'Cübbe', 'gloves': 'Sargı', 'legs': 'Şalvar', 'boots': 'Sandalet'},
        'stats': {'helmet': 'ult_dmg', 'shoulder': 'ult_dmg', 'chest': 'heart', 'gloves': 'energy', 'legs': 'heart', 'boots': 'energy'},
        'styles': {'helmet': ['hood'] * 5, 'shoulder': ['mantle'] * 5, 'chest': ['robe'] * 5, 'gloves': ['leather'] * 5, 'legs': ['cloth'] * 5, 'boots': ['cloth'] * 5},
        'bands': [
            ('Keten', '#6b5a44', '#8a7a5a', {}),
            ('Çırak', '#4a4a7a', '#c9a24a', {'glow': '#8ab0ff'}),
            ('Arkanist', '#2c3a8a', '#d4a84a', {'glow': '#5fd8ff'}),
            ('Kadim', '#4a2a6a', '#d4a84a', {'glow': '#b05cff'}),
            ('Yıldız', '#3a1a6a', '#e8c35a', {'glow': '#c890ff'}),
        ],
    },
    # a second cloth line in grave colors (the necromancer's taste)
    'shroud': {
        'weight': 'cloth',
        'en_names': {'helmet': 'Shroud Hood', 'shoulder': 'Shroud Mantle', 'chest': 'Shroud', 'gloves': 'Shroud Wraps', 'legs': 'Shroud Trousers', 'boots': 'Shroud Sandals'},
        'en': ['Earthen', 'Grave', 'Bone', 'Soul', 'Death'],
        'names': {'helmet': 'Kefen Başlık', 'shoulder': 'Kefen Şalı', 'chest': 'Kefen', 'gloves': 'Kefen Sargı', 'legs': 'Kefen Şalvar', 'boots': 'Kefen Sandalet'},
        'stats': {'helmet': 'skull_dmg', 'shoulder': 'lifeSteal', 'chest': 'heart', 'gloves': 'skull_dmg', 'legs': 'heart', 'boots': 'energy'},
        'styles': {'helmet': ['hood'] * 5, 'shoulder': ['mantle'] * 5, 'chest': ['robe'] * 5, 'gloves': ['leather'] * 5, 'legs': ['cloth'] * 5, 'boots': ['cloth'] * 5},
        'bands': [
            ('Toprak', '#4a4a3a', '#6a6a5a', {}),
            ('Mezar', '#2e3428', '#8ab08a', {'glow': '#7dff7a'}),
            ('Kemik', '#3a3a2e', '#eae0c8', {'glow': '#b8ff9a'}),
            ('Ruh', '#1e2a1e', '#8ab08a', {'glow': '#7dff7a'}),
            ('Ölüm', '#141a14', '#9aff9a', {'glow': '#3dff8a'}),
        ],
    },
}
for key, fam in ARMOR.items():
    weight = fam.get('weight', key)
    for b, (prefix, color, trim, extra) in enumerate(fam['bands']):
        for slot in ARMOR_SLOTS:
            style = fam['styles'][slot][b]
            av_slot = 'shoulders' if slot == 'shoulder' else slot
            vis = {'slot': av_slot, 'style': style, 'color': color, 'trim': trim}
            if slot == 'chest':
                for k in ('tabard', 'cape'):
                    if k in extra: vis[k] = extra[k]
            if slot == 'helmet' and 'plume' in extra: vis['plume'] = extra['plume']
            if slot == 'shoulder' and extra.get('feathers'): vis['feathers'] = True
            if 'glow' in extra: vis['glow'] = extra['glow']
            add(f'{key}_{slot}_{b + 1}', slot, f'{prefix} {fam["names"][slot]}', fam['stats'][slot], WEIGHT[weight], BANDS[b],
                2 if slot in ('chest', 'legs') else 1, vis, en=f'{fam["en"][b]} {fam["en_names"][slot]}')

# ---------------------------------------------------------------- weapons ----
WEAPONS = {
    # type: (painter style, classes, stat, size, names by band, colors by band, extra vis)
    'sword': ('sword', ['warrior', 'paladin'], 'sword', 2, ['Paslı Kılıç', 'Demir Kılıç', 'Çelik Uzun Kılıç', 'Muhafız Kılıcı', 'Ejderdiş'],
              ['#8a8078', '#a9b4c0', '#c9d2dc', '#e8ecf0', '#6a7080'], {}),
    'axe': ('axe', ['warrior', 'berserker'], 'skull_dmg', 1, ['Oduncu Baltası', 'Demir Balta', 'Savaş Baltası', 'Yarıcı', 'Kanlı Hilal'],
            ['#8a8078', '#a9b4c0', '#b8c0c8', '#d8dde2', '#8a3a3a'], {}),
    'greataxe': ('axe', ['berserker'], 'skull_dmg', 2, ['Ağır Balta', 'Çift Ağızlı Balta', 'Kasap Baltası', 'Titan Baltası', 'Kıyamet Baltası'],
                 ['#8a8078', '#a9b4c0', '#b8c0c8', '#d8dde2', '#7a2a2a'], {'double': True}),
    'mace': ('mace', ['warrior', 'paladin'], 'sword', 1, ['Sopa', 'Demir Gürz', 'Çivili Gürz', 'Yıldız Gürz', 'Yıkım Gürzü'],
             ['#7a6a5a', '#8a939c', '#a9b4c0', '#d4a84a', '#5a5f6e'], {}),
    'hammer': ('hammer', ['paladin'], 'heart', 2, ['Taş Çekiç', 'Savaş Çekici', 'Kutsal Çekiç', 'Işık Çekici', 'Yargı Çekici'],
               ['#8a8a80', '#a9b4c0', '#d4a84a', '#fff2c0', '#fff8e0'], {}),
    'spear': ('spear', ['warrior'], 'skull_dmg', 2, ['Mızrak', 'Demir Mızrak', 'Uzun Mızrak', 'Muhafız Mızrağı', 'Ejder Mızrağı'],
              ['#8a8078', '#a9b4c0', '#c9d2dc', '#e8ecf0', '#6a7080'], {}),
    'dagger': ('dagger', ['rogue'], 'lifeSteal', 1, ['Paslı Hançer', 'Keskin Hançer', 'Gölge Hançeri', 'Zehirli Diş', 'Gece Pençesi'],
               ['#8a8078', '#c9d2dc', '#9a8ab0', '#8ad08a', '#3a3a4a'], {}),
    'bow': ('bow', ['archer'], 'energy', 2, ['Av Yayı', 'Uzun Yay', 'Kompozit Yay', 'Rüzgar Yayı', 'Fırtına Yayı'],
            ['#7a5230', '#8a6038', '#5a3a2a', '#3a4a5a', '#2a2a3a'], {}),
    'staff': ('staff', ['mage', 'necromancer'], 'ult_dmg', 2, ['Budak Asa', 'Çırak Asası', 'Kristal Asa', 'Kadim Asa', 'Yıldız Asası'],
              ['#7a5230', '#6a4a2a', '#5a3a4a', '#3a2a4a', '#2a1a3a'], {}),
    'wand': ('wand', ['mage'], 'energy', 1, ['Dal Değnek', 'Kemik Değnek', 'Rün Değneği', 'Işık Değneği', 'Boşluk Değneği'],
             ['#6a4a2a', '#b8b0a0', '#4a4a6a', '#d4a84a', '#2a1a3a'], {}),
    'scythe': ('scythe', ['necromancer'], 'skull_dmg', 2, ['Orak', 'Kemik Tırpan', 'Ruh Tırpanı', 'Mezar Tırpanı', 'Ölüm Tırpanı'],
               ['#8a8078', '#b8b0a0', '#9ab0a0', '#7a8a7a', '#b8c0c8'], {}),
}
WEAPONS_EN = {
    'sword': ['Rusty Sword', 'Iron Sword', 'Steel Longsword', 'Guardian Blade', 'Dragonfang'],
    'axe': ["Woodcutter's Axe", 'Iron Axe', 'Battle Axe', 'Cleaver', 'Blood Crescent'],
    'greataxe': ['Heavy Axe', 'Double-Bit Axe', "Butcher's Axe", 'Titan Axe', 'Doom Axe'],
    'mace': ['Cudgel', 'Iron Mace', 'Spiked Mace', 'Morning Star', 'Ruin Mace'],
    'hammer': ['Stone Hammer', 'War Hammer', 'Holy Hammer', 'Hammer of Light', 'Hammer of Judgement'],
    'spear': ['Spear', 'Iron Spear', 'Long Spear', "Guardian's Spear", 'Dragon Spear'],
    'dagger': ['Rusty Dagger', 'Keen Dagger', 'Shadow Dagger', 'Venom Fang', 'Night Claw'],
    'bow': ['Hunting Bow', 'Longbow', 'Composite Bow', 'Wind Bow', 'Storm Bow'],
    'staff': ['Gnarled Staff', "Apprentice's Staff", 'Crystal Staff', 'Ancient Staff', 'Star Staff'],
    'wand': ['Twig Wand', 'Bone Wand', 'Rune Wand', 'Wand of Light', 'Void Wand'],
    'scythe': ['Sickle', 'Bone Scythe', 'Soul Scythe', 'Grave Scythe', 'Death Scythe'],
}
OFFHANDS_EN = {
    'kite': ['Wooden Shield', 'Iron Shield', 'Heraldic Shield', "Guardian's Shield", 'Dragonscale Shield'],
    'tower': ['Door Shield', 'Tower Shield', 'Castle Shield', 'Rampart Shield', 'Titan Shield'],
    'orb': ['Glass Orb', 'Frost Orb', 'Arcane Orb', 'Storm Orb', 'Star Orb'],
    'tome': ['Old Notebook', 'Spellbook', 'Rune Book', 'Ancient Scroll', 'Black Book'],
    'lantern': ['Oil Lamp', 'Grave Lantern', 'Soul Lantern', 'Ghost Lantern', 'Death Lantern'],
    'quiver': ['Leather Quiver', "Hunter's Quiver", 'Long Quiver', 'Wind Quiver', 'Storm Quiver'],
    'offdagger': ['Parrying Dagger', 'Main-Gauche', 'Shadow Blade', 'Venom Tooth', 'Raven Claw'],
}
GLOWS = [None, None, '#5fa8ff', '#b05cff', '#ff5a2a']
for wtype, (style, classes, stat, size, names, colors, extra) in WEAPONS.items():
    for b in range(5):
        vis = dict({'slot': 'weapon', 'style': style, 'color': colors[b], 'trim': '#d4a84a'}, **extra)
        if b >= 3: vis['glow'] = {'staff': '#c890ff', 'wand': '#c890ff', 'scythe': '#7dff7a', 'bow': '#9aff6a', 'dagger': '#b05cff'}.get(wtype, GLOWS[b])
        if wtype == 'staff': vis['glow'] = ['#8ab0ff', '#5fd8ff', '#5fd8ff', '#b05cff', '#c890ff'][b]
        if wtype == 'scythe': vis['glow'] = [None, '#7dff7a', '#7dff7a', '#3dff8a', '#3dff8a'][b]
        if wtype == 'wand': vis['glow'] = ['#8ab0ff', '#b05cff', '#5fd8ff', '#ffe08a', '#c890ff'][b]
        vis = {k: v for k, v in vis.items() if v is not None}
        add(f'{wtype}_{b + 1}', 'weapon', names[b], stat, classes, BANDS[b], size, vis, en=WEAPONS_EN[wtype][b])

OFFHANDS = {
    'kite': ('kite', ['warrior', 'paladin'], 'shield', ['Tahta Kalkan', 'Demir Kalkan', 'Armalı Kalkan', 'Muhafız Kalkanı', 'Ejder Pulu Kalkan'],
             ['#6b4a30', '#7a1a1a', '#1a3a7a', '#e8e4d8', '#3a0a0a']),
    'tower': ('tower', ['warrior', 'paladin'], 'heart', ['Kapı Kalkanı', 'Kule Kalkanı', 'Kale Kalkanı', 'Sur Kalkanı', 'Titan Kalkanı'],
              ['#5a4a3a', '#4a5a6a', '#3a4a6a', '#d8d2c0', '#2a2e3a']),
    'orb': ('orb', ['mage'], 'ult_dmg', ['Cam Küre', 'Buz Küresi', 'Arkan Küre', 'Fırtına Küresi', 'Yıldız Küresi'],
            ['#8ab0c0', '#8adfff', '#5fd8ff', '#b05cff', '#c890ff']),
    'tome': ('tome', ['mage', 'necromancer'], 'energy', ['Eski Defter', 'Büyü Kitabı', 'Rün Kitabı', 'Kadim Tomar', 'Kara Kitap'],
             ['#6b4a30', '#2c3a8a', '#4a2a6a', '#6a4a1a', '#1a1a22']),
    'lantern': ('lantern', ['necromancer'], 'lifeSteal', ['Kandil', 'Mezar Feneri', 'Ruh Feneri', 'Hayalet Feneri', 'Ölüm Feneri'],
                ['#6a5f56', '#5a5f66', '#4a5a4a', '#3a4a5a', '#2a2a2a']),
    'quiver': ('quiver', ['archer'], 'energy', ['Deri Sadak', 'Av Sadağı', 'Uzun Sadak', 'Rüzgar Sadağı', 'Fırtına Sadağı'],
               ['#6b4a30', '#5a3a22', '#4a3a2a', '#3a4a5a', '#2a2a3a']),
    'offdagger': ('dagger', ['rogue'], 'sword', ['Sol El Hançeri', 'Paraçol', 'Gölge Bıçağı', 'Zehir Dişi', 'Kuzgun Pençesi'],
                  ['#8a8078', '#c9d2dc', '#9a8ab0', '#8ad08a', '#3a3a4a']),
}
for otype, (style, classes, stat, names, colors) in OFFHANDS.items():
    for b in range(5):
        vis = {'slot': 'offhand', 'style': style, 'color': colors[b], 'trim': ['#8a8f96', '#b08a4a', '#c9a24a', '#ffd24a', '#d4a84a'][b]}
        glow = {'orb': colors[b], 'tome': '#b05cff', 'lantern': '#7dff7a'}.get(otype)
        if glow: vis['glow'] = glow
        elif b >= 4: vis['glow'] = '#ff5a2a'
        if otype == 'kite': vis['emblem'] = ['#8a8f96', '#e8c35a', '#e8c35a', '#e8c35a', '#ff8a2a'][b]
        add(f'{otype}_{b + 1}', 'offhand', names[b], stat, classes, BANDS[b], 2 if otype in ('tower',) else 1, vis, en=OFFHANDS_EN[otype][b])

# ---------------------------------------------------------------- jewelry / belts
BELTS = ['Basit', 'Sağlam', 'Rünlü', 'Soylu', 'Ejder']
BELTS_EN = ['Plain', 'Sturdy', 'Runed', 'Noble', 'Dragon']
for b in range(5):
    add(f'belt_{b + 1}', 'belt', f'{BELTS[b]} Kemer', 'heart', ALL, BANDS[b], 1, en=f'{BELTS_EN[b]} Belt', vis={'slot': 'belt', 'style': 'leather', 'color': ['#6b4a30', '#5a3a22', '#4a3020', '#3a2616', '#2a1a10'][b], 'trim': ['#8a8f96', '#b08a4a', '#c9a24a', '#ffd24a', '#d4a84a'][b]})
    add(f'sash_{b + 1}', 'belt', f'{BELTS[b]} Kuşak', 'energy', ALL, BANDS[b], 1, en=f'{BELTS_EN[b]} Sash', vis={'slot': 'belt', 'style': 'sash', 'color': ['#6a4a2a', '#6a2a2a', '#2a3a6a', '#4a2a6a', '#3a0a0a'][b], 'trim': '#d4a84a', 'pouch': b >= 2})
AMULETS = ['Kemik Kolye', 'Gümüş Muska', 'Rün Kolye', 'Soylu Madalyon', 'Ejder Gözü']
RINGS = ['Bakır Yüzük', 'Gümüş Yüzük', 'Rün Yüzüğü', 'Soylu Mühür', 'Ejder Halkası']
AMULETS_EN = ['Bone Necklace', 'Silver Charm', 'Rune Necklace', 'Noble Medallion', 'Dragon Eye']
RINGS_EN = ['Copper Ring', 'Silver Ring', 'Rune Ring', 'Noble Signet', 'Dragon Band']
for b in range(5):
    add(f'amulet_{b + 1}', 'amulet', AMULETS[b], 'ult_dmg', ALL, BANDS[b], 1, en=AMULETS_EN[b], vis={'slot': 'amulet', 'style': 'pendant', 'color': '#d4a84a', 'glow': ['#eae0c8', '#c9d2dc', '#5fd8ff', '#ffd24a', '#ff5a2a'][b]})
    add(f'ring_{b + 1}', 'ring', RINGS[b], 'lifeSteal' if b % 2 == 0 else 'teamHeal', ALL, BANDS[b], 1, None, en=RINGS_EN[b])

# ---------------------------------------------------------------- legacy -----
# The 32 bases items were rolled from before this catalog. Kept valid (band
# 1) so every item a player already owns still loads, equips and validates;
# never rolled again.
LEGACY = {
    'blade': ('weapon', 'Kılıç', 'sword', ['warrior', 'paladin'], 2, {'slot': 'weapon', 'style': 'sword', 'color': '#c9d2dc', 'trim': '#d4a84a'}),
    'axe': ('weapon', 'Balta', 'skull_dmg', ['warrior', 'berserker'], 1, {'slot': 'weapon', 'style': 'axe', 'color': '#b8c0c8'}),
    'scepter': ('weapon', 'Asa', 'ult_dmg', ['mage', 'necromancer'], 2, {'slot': 'weapon', 'style': 'staff', 'color': '#7a5230', 'glow': '#5fd8ff'}),
    'dagger': ('weapon', 'Hançer', 'lifeSteal', ['rogue'], 1, {'slot': 'weapon', 'style': 'dagger', 'color': '#c9d2dc'}),
    'bow': ('weapon', 'Yay', 'energy', ['archer'], 2, {'slot': 'weapon', 'style': 'bow', 'color': '#7a5230'}),
    'spear': ('weapon', 'Mızrak', 'skull_dmg', ['warrior'], 2, {'slot': 'weapon', 'style': 'spear', 'color': '#c9d2dc'}),
    'mace': ('weapon', 'Gürz', 'sword', ['warrior', 'paladin'], 1, {'slot': 'weapon', 'style': 'mace', 'color': '#a9b4c0'}),
    'kite_shield': ('offhand', 'Kalkan', 'shield', ['warrior', 'paladin'], 1, {'slot': 'offhand', 'style': 'kite', 'color': '#9c1f1a', 'trim': '#c9a24a'}),
    'tower_shield': ('offhand', 'Kule Kalkanı', 'shield', ['warrior', 'paladin'], 2, {'slot': 'offhand', 'style': 'tower', 'color': '#3a4a6a', 'trim': '#aab4c0'}),
    'buckler': ('offhand', 'Küçük Kalkan', 'shield', ['warrior', 'paladin'], 1, {'slot': 'offhand', 'style': 'kite', 'color': '#6b4a30', 'trim': '#8a8f96'}),
    'dragon_shield': ('offhand', 'Ejderha Kalkanı', 'heart', ['warrior', 'paladin'], 2, {'slot': 'offhand', 'style': 'tower', 'color': '#2a5a3a', 'trim': '#d4a84a'}),
    'helm': ('helmet', 'Miğfer', 'shield', WEIGHT['plate'], 1, {'slot': 'helmet', 'style': 'nasal', 'color': '#aab4c0', 'trim': '#d4a84a'}),
    'hood': ('helmet', 'Kukuleta', 'energy', WEIGHT['cloth'] + ['rogue', 'archer'], 1, {'slot': 'helmet', 'style': 'hood', 'color': '#34438e', 'trim': '#d4a84a'}),
    'crown': ('helmet', 'Taç', 'ult_dmg', ALL, 1, {'slot': 'helmet', 'style': 'circlet', 'color': '#d4a84a'}),
    'skull_mask': ('helmet', 'Kafatası Maskesi', 'skull_dmg', ALL, 1, {'slot': 'helmet', 'style': 'cowl', 'color': '#3a3242', 'trim': '#eae0c8'}),
    'breastplate': ('chest', 'Göğüslük', 'shield', WEIGHT['plate'], 2, {'slot': 'chest', 'style': 'plate', 'color': '#aab4c0', 'trim': '#d4a84a', 'tabard': '#8e1b1b'}),
    'robe': ('chest', 'Cübbe', 'heart', WEIGHT['cloth'], 2, {'slot': 'chest', 'style': 'robe', 'color': '#2c3a8a', 'trim': '#d4a84a'}),
    'leather_vest': ('chest', 'Deri Yelek', 'sword', WEIGHT['leather'], 2, {'slot': 'chest', 'style': 'leather', 'color': '#6b4a30', 'trim': '#c9a24a'}),
    'scale_armor': ('chest', 'Pul Zırh', 'heart', WEIGHT['plate'], 2, {'slot': 'chest', 'style': 'mail', 'color': '#7a8a7a', 'trim': '#d4a84a', 'tabard': '#2a4a3a'}),
    'pauldron': ('shoulder', 'Omuzluk', 'shield', WEIGHT['plate'], 1, {'slot': 'shoulders', 'style': 'plate', 'color': '#aab4c0', 'trim': '#d4a84a'}),
    'spiked_pauldron': ('shoulder', 'Dikenli Omuzluk', 'skull_dmg', WEIGHT['plate'], 1, {'slot': 'shoulders', 'style': 'spiked', 'color': '#7a7f88', 'trim': '#d4a84a'}),
    'winged_pauldron': ('shoulder', 'Kanatlı Omuzluk', 'energy', WEIGHT['leather'], 1, {'slot': 'shoulders', 'style': 'leather', 'color': '#4a4a5a', 'feathers': True}),
    'gauntlets': ('gloves', 'Eldiven', 'sword', WEIGHT['plate'], 1, {'slot': 'gloves', 'style': 'gauntlet', 'color': '#aab4c0'}),
    'assassin_gloves': ('gloves', 'Suikastçı Eldiveni', 'lifeSteal', WEIGHT['leather'], 1, {'slot': 'gloves', 'style': 'leather', 'color': '#2a2430'}),
    'healing_gloves': ('gloves', 'Şifa Eldiveni', 'heart', ALL, 1, {'slot': 'gloves', 'style': 'leather', 'color': '#e8e0cc'}),
    'leather_boots': ('boots', 'Deri Çizme', 'energy', ALL, 1, {'slot': 'boots', 'style': 'leather', 'color': '#5a3a22'}),
    'wind_boots': ('boots', 'Rüzgar Çizmeleri', 'sword', ALL, 1, {'slot': 'boots', 'style': 'leather', 'color': '#4a6a8a'}),
    'earth_boots': ('boots', 'Toprak Çizmeleri', 'shield', WEIGHT['plate'], 1, {'slot': 'boots', 'style': 'plate', 'color': '#8a7a5a'}),
    'amulet': ('amulet', 'Muska', 'energy', ALL, 1, {'slot': 'amulet', 'style': 'pendant', 'color': '#d4a84a'}),
    'ring': ('ring', 'Yüzük', 'lifeSteal', ALL, 1, None),
    'charm': ('amulet', 'Tılsım', 'teamHeal', ALL, 1, {'slot': 'amulet', 'style': 'pendant', 'color': '#3a8a3a', 'glow': '#3dff8a'}),
    'necklace': ('amulet', 'Kolye', 'ult_dmg', ALL, 1, {'slot': 'amulet', 'style': 'pendant', 'color': '#d4a84a', 'glow': '#5fd8ff'}),
}
LEGACY_SLOT = {'weapon': 'weapon', 'offhand': 'shield', 'helmet': 'helmet', 'chest': 'chest', 'shoulder': 'shoulder', 'gloves': 'gloves', 'boots': 'boots', 'amulet': 'trinket', 'ring': 'trinket'}
for bid, (slot, name, stat, classes, size, vis) in LEGACY.items():
    add(bid, slot, name, stat, classes, BANDS[0], size, vis, legacy=True)

# ---------------------------------------------------------------- fixed ------
# Set pieces (green) and uniques (orange / red / teal): fixed stats, a slot,
# who may wear them, the level needed and how they look.
FIXED = {
    # sets
    'bloodied_gauntlet': ('green', 'gloves', {'sword': 3}, ALL, 20, {'slot': 'gloves', 'style': 'gauntlet', 'color': '#8a2a2a', 'trim': '#d4a84a', 'glow': '#ff3a2a'}),
    'crimson_pauldron': ('green', 'shoulder', {'skull_dmg': 8}, ALL, 20, {'slot': 'shoulders', 'style': 'spiked', 'color': '#8a2a2a', 'trim': '#d4a84a', 'glow': '#ff3a2a'}),
    'iron_greaves': ('green', 'boots', {'shield': 3}, ALL, 20, {'slot': 'boots', 'style': 'plate', 'color': '#6a7080', 'trim': '#b08a4a', 'glow': '#3dff8a'}),
    'oak_shield_charm': ('green', 'amulet', {'heart': 2}, ALL, 20, {'slot': 'amulet', 'style': 'pendant', 'color': '#6b4a30', 'glow': '#3dff8a'}),
    'swift_boots': ('green', 'boots', {'energy': 3}, ALL, 20, {'slot': 'boots', 'style': 'leather', 'color': '#2a2a3a', 'trim': '#b05cff', 'glow': '#b05cff'}),
    'shadow_cloak': ('green', 'chest', {'energy': 3}, ALL, 20, {'slot': 'chest', 'style': 'leather', 'color': '#1c1c26', 'trim': '#b05cff', 'cape': '#101018', 'glow': '#b05cff'}),
    'venom_vial': ('green', 'weapon', {'skull_self_dmg': -3}, ['rogue'], 20, {'slot': 'weapon', 'style': 'dagger', 'color': '#8ad08a', 'glow': '#3dff8a'}),
    'frozen_crown': ('green', 'helmet', {'shield': 3}, ALL, 20, {'slot': 'helmet', 'style': 'circlet', 'color': '#bff4ff', 'glow': '#62e6ff'}),
    'glacier_ward': ('green', 'offhand', {'heart': 3}, ['warrior', 'paladin'], 20, {'slot': 'offhand', 'style': 'kite', 'color': '#8adfff', 'trim': '#e8f8ff', 'emblem': '#ffffff', 'glow': '#62e6ff'}),
    # orange (level 30)
    'uniq_nights_lament': ('orange', 'weapon', {'sword': 8, 'lifeSteal': 6}, ['rogue'], 30, {'slot': 'weapon', 'style': 'dagger', 'color': '#2a2a3a', 'glow': '#ff3a5a', 'fx': 'blood'}),
    'uniq_shield_of_eternity': ('orange', 'offhand', {'shield': 7, 'heart': 7}, ['warrior', 'paladin'], 30, {'slot': 'offhand', 'style': 'kite', 'color': '#e8e4d8', 'trim': '#ffd24a', 'emblem': '#ff8a2a', 'glow': '#ff8a2a'}),
    'uniq_oracles_crown': ('orange', 'helmet', {'ult_dmg': 16, 'energy': 10}, ALL, 30, {'slot': 'helmet', 'style': 'circlet', 'color': '#ffd24a', 'glow': '#ff8a2a', 'fx': 'stars'}),
    'uniq_dragonheart_plate': ('orange', 'chest', {'shield': 7, 'heart': 7}, WEIGHT['plate'], 30, {'slot': 'chest', 'style': 'plate', 'color': '#8a3a2a', 'trim': '#ffd24a', 'tabard': '#3a0a0a', 'cape': '#5a0a0a', 'glow': '#ff8a2a', 'fx': 'ember'}),
    'uniq_storm_eagle_pauldrons': ('orange', 'shoulder', {'energy': 10, 'sword': 8}, ALL, 30, {'slot': 'shoulders', 'style': 'leather', 'color': '#3a4a6a', 'feathers': True, 'glow': '#8adfff', 'fx': 'spark'}),
    'uniq_butchers_claws': ('orange', 'gloves', {'skull_dmg': 14, 'lifeSteal': 6}, ALL, 30, {'slot': 'gloves', 'style': 'gauntlet', 'color': '#6a2a2a', 'glow': '#ff3a2a', 'fx': 'blood'}),
    'uniq_windwalkers': ('orange', 'boots', {'energy': 10, 'sword': 8}, ALL, 30, {'slot': 'boots', 'style': 'leather', 'color': '#4a6a8a', 'trim': '#e8f8ff', 'glow': '#8adfff'}),
    'uniq_ring_of_ancient_wisdom': ('orange', 'ring', {'ult_dmg': 16, 'teamHeal': 6}, ALL, 30, None),
    # teal (level 38)
    'uniq_whisper_of_the_void': ('teal', 'weapon', {'ult_dmg': 18, 'lifeSteal': 7}, ['mage', 'necromancer'], 38, {'slot': 'weapon', 'style': 'staff', 'color': '#1a1a2a', 'glow': '#9a5cff', 'fx': 'void'}),
    'uniq_shattered_time_aegis': ('teal', 'offhand', {'shield': 8, 'energy': 12}, ['warrior', 'paladin'], 38, {'slot': 'offhand', 'style': 'tower', 'color': '#1a3a3a', 'trim': '#3fe0c0', 'glow': '#3fe0c0', 'fx': 'void'}),
    'uniq_astral_sight': ('teal', 'helmet', {'energy': 12, 'ult_dmg': 18}, ALL, 38, {'slot': 'helmet', 'style': 'hood', 'color': '#1a2a3a', 'trim': '#3fe0c0', 'glow': '#3fe0c0', 'fx': 'stars'}),
    'uniq_shroud_of_shadows': ('teal', 'chest', {'shield': 8, 'lifeSteal': 7}, ALL, 38, {'slot': 'chest', 'style': 'leather', 'color': '#101018', 'trim': '#3fe0c0', 'cape': '#08080e', 'glow': '#3fe0c0', 'fx': 'void'}),
    'uniq_cosmic_wings': ('teal', 'shoulder', {'energy': 12, 'skull_dmg': 16}, ALL, 38, {'slot': 'shoulders', 'style': 'mantle', 'color': '#1a2a4a', 'trim': '#3fe0c0', 'glow': '#3fe0c0', 'fx': 'stars'}),
    'uniq_soul_rending_claws': ('teal', 'gloves', {'skull_dmg': 16, 'lifeSteal': 7}, ALL, 38, {'slot': 'gloves', 'style': 'leather', 'color': '#1a1a2a', 'glow': '#3fe0c0', 'fx': 'void'}),
    'uniq_voidstep': ('teal', 'boots', {'energy': 12, 'sword': 9}, ALL, 38, {'slot': 'boots', 'style': 'leather', 'color': '#101018', 'trim': '#3fe0c0', 'glow': '#3fe0c0'}),
    'uniq_eye_of_infinity': ('teal', 'amulet', {'ult_dmg': 18, 'teamHeal': 7}, ALL, 38, {'slot': 'amulet', 'style': 'pendant', 'color': '#3fe0c0', 'glow': '#3fe0c0', 'fx': 'stars'}),
    # red (level 45)
    'uniq_world_eater': ('red', 'weapon', {'sword': 10, 'skull_dmg': 18, 'lifeSteal': 8}, ['berserker'], 45, {'slot': 'weapon', 'style': 'axe', 'double': True, 'color': '#5a1a1a', 'glow': '#ff2a1a', 'fx': 'blood'}),
    'uniq_the_last_wall': ('red', 'offhand', {'shield': 9, 'heart': 9, 'energy': 13}, ['warrior', 'paladin'], 45, {'slot': 'offhand', 'style': 'tower', 'color': '#3a0a0a', 'trim': '#ffd24a', 'glow': '#ff3a2a', 'fx': 'ember'}),
    'uniq_starfall_helm': ('red', 'helmet', {'ult_dmg': 20, 'energy': 13, 'shield': 9}, ALL, 45, {'slot': 'helmet', 'style': 'horned', 'color': '#2a2e3a', 'glow': '#ff5a2a', 'fx': 'stars'}),
    'uniq_titans_hide': ('red', 'chest', {'shield': 9, 'heart': 9, 'sword': 10}, ALL, 45, {'slot': 'chest', 'style': 'mail', 'color': '#5a4a3a', 'trim': '#ffd24a', 'tabard': '#3a0a0a', 'glow': '#ff3a2a', 'fx': 'ember'}),
    'uniq_doomwings': ('red', 'shoulder', {'energy': 13, 'skull_dmg': 18, 'sword': 10}, ALL, 45, {'slot': 'shoulders', 'style': 'spiked', 'color': '#2a1a1a', 'trim': '#ff5a2a', 'glow': '#ff3a2a', 'fx': 'ember'}),
    'uniq_the_throatreaver': ('red', 'gloves', {'skull_dmg': 18, 'lifeSteal': 8, 'sword': 10}, ALL, 45, {'slot': 'gloves', 'style': 'gauntlet', 'color': '#3a0a0a', 'glow': '#ff2a1a', 'fx': 'blood'}),
    'uniq_timestep_striders': ('red', 'boots', {'energy': 13, 'sword': 10, 'ult_dmg': 20}, ALL, 45, {'slot': 'boots', 'style': 'plate', 'color': '#3a3a4a', 'trim': '#ffd24a', 'glow': '#ffd24a', 'fx': 'spark'}),
    'uniq_eternity_core': ('red', 'amulet', {'ult_dmg': 20, 'energy': 13, 'teamHeal': 8}, ALL, 45, {'slot': 'amulet', 'style': 'pendant', 'color': '#ff5a2a', 'glow': '#ff3a2a', 'fx': 'ember'}),
}
LEGACY_FIXED_SLOT = {  # where these lived before (the migration maps old rows)
    'glacier_ward': 'shield', 'uniq_shield_of_eternity': 'shield', 'uniq_shattered_time_aegis': 'shield', 'uniq_the_last_wall': 'shield',
    'oak_shield_charm': 'trinket', 'uniq_ring_of_ancient_wisdom': 'trinket', 'uniq_eye_of_infinity': 'trinket', 'uniq_eternity_core': 'trinket',
    'venom_vial': 'weapon',
}


# ---------------------------------------------------------------- output -----
def write_js():
    bases = {bid: {k: v for k, v in b.items() if not (k == 'legacy' and not v) and v is not None} for bid, b in BASES.items()}
    fixed = {fid: {'rarity': r, 'slot': s, 'stats': st, 'cls': c, 'req': lv, 'vis': v} for fid, (r, s, st, c, lv, v) in FIXED.items()}
    out = ('// GENERATED by tools/make_catalog.py - edit that file and re-run it, not this one.\n'
           '// The item catalog: every base (slot, level band, who may wear it, bag size,\n'
           '// how it looks worn) and every fixed item (sets and uniques). The same data\n'
           "// is written into supabase/schema.sql's reference tables.\n"
           f'const CATALOG_BANDS = {json.dumps(BANDS)};\n'
           f'const CATALOG_BASES = {json.dumps(bases, ensure_ascii=False, separators=(",", ":"))};\n'
           f'const CATALOG_FIXED = {json.dumps(fixed, ensure_ascii=False, separators=(",", ":"))};\n'
           f'const CATALOG_LEGACY_SLOT = {json.dumps(LEGACY_SLOT)};\n'
           '// English names for the catalog (the Turkish name is the key, like every EN_DICT entry)\n'
           f'if (typeof EN_DICT !== "undefined") Object.assign(EN_DICT, {json.dumps(EN, ensure_ascii=False, separators=(",", ":"))});\n')
    open(os.path.join(ROOT, 'catalog.js'), 'w').write(out)


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def write_sql():
    rows = []
    for bid, b in BASES.items():
        cls = 'array[' + ','.join(sql_str(c) for c in b['cls']) + ']::text[]'
        rows.append(f"    ({sql_str(b['slot'])}, {sql_str(bid)}, {sql_str(b['stat'])}, {cls}, {b['min']}, {b['max']}, {'true' if b['legacy'] else 'false'})")
    frows = []
    for fid, (r, s, st, c, lv, v) in FIXED.items():
        cls = 'array[' + ','.join(sql_str(x) for x in c) + ']::text[]'
        frows.append(f"    ({sql_str(r)}, {sql_str(fid)}, {sql_str(json.dumps(st, separators=(',', ':')))}, {sql_str(s)}, {cls}, {lv})")
    block = ('-- BEGIN GENERATED CATALOG (tools/make_catalog.py - do not edit by hand)\n'
             'delete from public.item_bases;\n'
             'insert into public.item_bases (slot, base_id, primary_stat, classes, min_level, max_level, legacy) values\n'
             + ',\n'.join(rows) + ';\n'
             'delete from public.item_fixed_defs;\n'
             'insert into public.item_fixed_defs (rarity, base_id, rolled_stats, slot, classes, req_level) values\n'
             + ',\n'.join(frows) + ';\n'
             '-- END GENERATED CATALOG\n')
    p = os.path.join(ROOT, 'supabase', 'schema.sql')
    s = open(p).read()
    if '-- BEGIN GENERATED CATALOG' in s:
        s = re.sub(r'-- BEGIN GENERATED CATALOG.*?-- END GENERATED CATALOG\n', lambda m: block, s, flags=re.S)
    else:
        print('schema.sql has no GENERATED CATALOG markers yet - add them where the catalog belongs')
        return
    open(p, 'w').write(s)


if __name__ == '__main__':
    write_js()
    write_sql()
    print(len(BASES), 'bases,', len(FIXED), 'fixed items')
