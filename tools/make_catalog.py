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
                2 if slot in ('chest', 'legs') else 1, vis, legacy=True, en=f'{fam["en"][b]} {fam["en_names"][slot]}')

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
        add(f'{wtype}_{b + 1}', 'weapon', names[b], stat, classes, BANDS[b], size, vis, legacy=True, en=WEAPONS_EN[wtype][b])

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
        add(f'{otype}_{b + 1}', 'offhand', names[b], stat, classes, BANDS[b], 2 if otype in ('tower',) else 1, vis, legacy=True, en=OFFHANDS_EN[otype][b])

# ---------------------------------------------------------------- jewelry / belts
BELTS = ['Basit', 'Sağlam', 'Rünlü', 'Soylu', 'Ejder']
BELTS_EN = ['Plain', 'Sturdy', 'Runed', 'Noble', 'Dragon']
for b in range(5):
    add(f'belt_{b + 1}', 'belt', f'{BELTS[b]} Kemer', 'heart', ALL, BANDS[b], 1, legacy=True, en=f'{BELTS_EN[b]} Belt', vis={'slot': 'belt', 'style': 'leather', 'color': ['#6b4a30', '#5a3a22', '#4a3020', '#3a2616', '#2a1a10'][b], 'trim': ['#8a8f96', '#b08a4a', '#c9a24a', '#ffd24a', '#d4a84a'][b]})
    add(f'sash_{b + 1}', 'belt', f'{BELTS[b]} Kuşak', 'energy', ALL, BANDS[b], 1, legacy=True, en=f'{BELTS_EN[b]} Sash', vis={'slot': 'belt', 'style': 'sash', 'color': ['#6a4a2a', '#6a2a2a', '#2a3a6a', '#4a2a6a', '#3a0a0a'][b], 'trim': '#d4a84a', 'pouch': b >= 2})
AMULETS = ['Kemik Kolye', 'Gümüş Muska', 'Rün Kolye', 'Soylu Madalyon', 'Ejder Gözü']
RINGS = ['Bakır Yüzük', 'Gümüş Yüzük', 'Rün Yüzüğü', 'Soylu Mühür', 'Ejder Halkası']
AMULETS_EN = ['Bone Necklace', 'Silver Charm', 'Rune Necklace', 'Noble Medallion', 'Dragon Eye']
RINGS_EN = ['Copper Ring', 'Silver Ring', 'Rune Ring', 'Noble Signet', 'Dragon Band']
for b in range(5):
    add(f'amulet_{b + 1}', 'amulet', AMULETS[b], 'ult_dmg', ALL, BANDS[b], 1, legacy=True, en=AMULETS_EN[b], vis={'slot': 'amulet', 'style': 'pendant', 'color': '#d4a84a', 'glow': ['#eae0c8', '#c9d2dc', '#5fd8ff', '#ffd24a', '#ff5a2a'][b]})
    add(f'ring_{b + 1}', 'ring', RINGS[b], 'lifeSteal' if b % 2 == 0 else 'teamHeal', ALL, BANDS[b], 1, None, legacy=True, en=RINGS_EN[b])


# ============================================================================
# THE 10-TIER CATALOG (v1.39). Every 5 levels brings new bases: 10 tiers per
# family / weapon type, each with its own name, colors and - often - its own
# silhouette (the painter's newer styles: kettle and winged helms, pelts,
# bone masks, brigandine, fur, bone pauldrons, bucklers, skull talismans,
# sabers, flails). The 5-band bases above are kept (legacy) so every item a
# player owns still looks and validates the same; they're never rolled again.
# ============================================================================
BANDS10 = [(1, 5), (6, 10), (11, 15), (16, 20), (21, 25), (26, 30), (31, 35), (36, 40), (41, 45), (46, 50)]

ARMOR10 = {
    'plate': {
        'weight': 'plate',
        'names': {'helmet': 'Miğfer', 'shoulder': 'Omuzluk', 'chest': 'Göğüslük', 'gloves': 'Kolçak', 'legs': 'Dizlik', 'boots': 'Demir Çizme'},
        'en_names': {'helmet': 'Helm', 'shoulder': 'Pauldrons', 'chest': 'Breastplate', 'gloves': 'Vambraces', 'legs': 'Greaves', 'boots': 'Sabatons'},
        'tr': ['Paslı', 'Demir', 'Dövme', 'Çelik', 'Şövalye', 'Muhafız', 'Aslan', 'Kral', 'Ejder', 'Titan'],
        'en': ['Rusty', 'Iron', 'Forged', 'Steel', "Knight's", 'Guardian', 'Lion', "King's", 'Dragon', 'Titan'],
        'stats': {'helmet': 'shield', 'shoulder': 'shield', 'chest': 'heart', 'gloves': 'sword', 'legs': 'heart', 'boots': 'shield'},
        'color': ['#7a7068', '#8a939c', '#7f8a94', '#aab4c0', '#b8c0cc', '#c8ccd4', '#c9a85a', '#d8c890', '#4a4e5a', '#5a5068'],
        'trim': ['#6a5a4a', '#b08a4a', '#9a7a4a', '#d4a84a', '#c9a24a', '#ffd24a', '#ffd24a', '#fff2a8', '#d4a84a', '#ff8a2a'],
        'cloth': ['#5a3a2a', '#7a1a1a', '#3a4a2a', '#1a3a7a', '#5a1a5a', '#e8e4d8', '#8e1b1b', '#1a2a6a', '#3a0a0a', '#2a0a3a'],
        'glow': [None, None, None, None, None, '#ffe08a', '#ffb02a', '#ffe08a', '#ff5a2a', '#c07aff'],
        'styles': {'helmet': ['nasal', 'kettle', 'nasal', 'greathelm', 'winged', 'greathelm', 'kettle', 'winged', 'horned', 'horned'],
                   'shoulder': ['plate', 'plate', 'plate', 'spiked', 'plate', 'spiked', 'plate', 'spiked', 'spiked', 'spiked'],
                   'chest': ['mail', 'brigandine', 'mail', 'plate', 'plate', 'plate', 'brigandine', 'plate', 'plate', 'plate'],
                   'gloves': ['gauntlet'] * 10, 'legs': ['plate'] * 10, 'boots': ['plate'] * 10},
    },
    'mail': {
        'weight': 'plate',
        'names': {'helmet': 'Tolga', 'shoulder': 'Zırh Omuzluk', 'chest': 'Zırh Gömlek', 'gloves': 'Zırh Eldiven', 'legs': 'Zırh Tozluk', 'boots': 'Zırh Çizme'},
        'en_names': {'helmet': 'Coif', 'shoulder': 'Mail Pauldrons', 'chest': 'Hauberk', 'gloves': 'Mail Gloves', 'legs': 'Mail Chausses', 'boots': 'Mail Boots'},
        'tr': ['Kaba', 'Örme', 'Pullu', 'Akıncı', 'Sipahi', 'Bozkır', 'Yıldırım', 'Kurt Başı', 'Gök', 'Hakan'],
        'en': ['Crude', 'Knitted', 'Scaled', "Raider's", "Cavalier's", 'Steppe', 'Lightning', 'Wolfhead', 'Sky', "Khan's"],
        'stats': {'helmet': 'shield', 'shoulder': 'sword', 'chest': 'shield', 'gloves': 'sword', 'legs': 'heart', 'boots': 'energy'},
        'color': ['#6a6a6a', '#7a828a', '#6a7a6a', '#8a8a96', '#9aa0aa', '#7a6a5a', '#a0a8b8', '#6a6a7a', '#8ab0d0', '#c8b070'],
        'trim': ['#5a4a3a', '#8a7a5a', '#9a8a5a', '#b08a4a', '#c9a24a', '#b08a4a', '#ffd24a', '#c9a24a', '#e8f8ff', '#ffd24a'],
        'cloth': ['#4a3a2a', '#3a4a5a', '#2a4a3a', '#7a2a1a', '#2a3a6a', '#6a4a2a', '#1a2a5a', '#3a2a2a', '#2a5a8a', '#6a1a1a'],
        'glow': [None, None, None, None, None, None, '#8adfff', None, '#8adfff', '#ffd24a'],
        'styles': {'helmet': ['nasal', 'kettle', 'nasal', 'kettle', 'winged', 'nasal', 'winged', 'kettle', 'winged', 'greathelm'],
                   'shoulder': ['plate'] * 10,
                   'chest': ['mail', 'mail', 'brigandine', 'mail', 'brigandine', 'mail', 'brigandine', 'mail', 'brigandine', 'mail'],
                   'gloves': ['gauntlet', 'leather', 'gauntlet', 'leather', 'gauntlet', 'leather', 'gauntlet', 'leather', 'gauntlet', 'gauntlet'],
                   'legs': ['plate'] * 10, 'boots': ['leather', 'plate', 'leather', 'plate', 'leather', 'plate', 'leather', 'plate', 'leather', 'plate']},
    },
    'leather': {
        'weight': 'leather',
        'names': {'helmet': 'Başlık', 'shoulder': 'Omuz Pedi', 'chest': 'Deri Zırh', 'gloves': 'Deri Eldiven', 'legs': 'Deri Pantolon', 'boots': 'Deri Çizme'},
        'en_names': {'helmet': 'Cowl', 'shoulder': 'Shoulder Pads', 'chest': 'Leather Armor', 'gloves': 'Leather Gloves', 'legs': 'Leather Pants', 'boots': 'Leather Boots'},
        'tr': ['Yıpranmış', 'Gezgin', 'Haydut', 'Gölge', 'İzci', 'Avcı', 'Suikastçı', 'Kuzgun', 'Gece Kuzgunu', 'Hayalet'],
        'en': ['Worn', 'Wanderer', 'Bandit', 'Shadow', 'Scout', 'Hunter', 'Assassin', 'Raven', 'Nightraven', 'Phantom'],
        'stats': {'helmet': 'energy', 'shoulder': 'energy', 'chest': 'sword', 'gloves': 'lifeSteal', 'legs': 'sword', 'boots': 'energy'},
        'color': ['#6b4a30', '#4a5a3a', '#5a3a2a', '#3a2a4a', '#3a4a2a', '#2e4a2a', '#2a2430', '#22222e', '#1c1c26', '#2a3a3a'],
        'trim': ['#8a6a4a', '#c9a24a', '#8a6a4a', '#c9a24a', '#b08a4a', '#d4a84a', '#9aa0a8', '#c9a24a', '#3fe0c0', '#8adfff'],
        'cloth': [None, None, '#4a1a1a', '#2a1a3a', '#2a3a20', '#243a20', '#1a1a22', '#101018', '#101018', '#1a2a2a'],
        'glow': [None, None, None, None, None, None, '#b05cff', None, '#3fe0c0', '#8adfff'],
        'styles': {'helmet': ['cowl', 'hood', 'cowl', 'hood', 'cowl', 'hood', 'cowl', 'hood', 'cowl', 'hood'],
                   'shoulder': ['leather'] * 10, 'chest': ['leather'] * 10, 'gloves': ['leather'] * 10, 'legs': ['leather'] * 10,
                   'boots': ['leather', 'leather', 'fur', 'leather', 'leather', 'fur', 'leather', 'leather', 'fur', 'leather']},
        'feathers_from': 5,
    },
    'hide': {
        'weight': 'leather',
        'names': {'helmet': 'Post Başlık', 'shoulder': 'Kürk Omuzluk', 'chest': 'Kürk Yelek', 'gloves': 'Post Eldiven', 'legs': 'Post Tozluk', 'boots': 'Kürk Çizme'},
        'en_names': {'helmet': 'Pelt Hood', 'shoulder': 'Fur Mantle', 'chest': 'Fur Vest', 'gloves': 'Hide Gloves', 'legs': 'Hide Leggings', 'boots': 'Fur Boots'},
        'tr': ['Çakal', 'Kurt', 'Ayı', 'Yaban', 'Kabile', 'Savaş Reisi', 'Mamut', 'Kan Ayısı', 'Boz Kurt', 'Kurt Kral'],
        'en': ['Jackal', 'Wolf', 'Bear', 'Wild', 'Tribal', "Warchief's", 'Mammoth', 'Blood Bear', 'Grey Wolf', 'Wolf King'],
        'stats': {'helmet': 'skull_dmg', 'shoulder': 'sword', 'chest': 'heart', 'gloves': 'sword', 'legs': 'heart', 'boots': 'energy'},
        'color': ['#7a6a4a', '#6a6a6a', '#5a3a22', '#6a5a3a', '#7a5a3a', '#4a3020', '#8a7a64', '#5a2a1a', '#9a9a9a', '#e8e4d8'],
        'trim': ['#8a6a4a', '#9a9a9a', '#8a6a4a', '#b08a4a', '#c9a24a', '#d4a84a', '#c9b48a', '#ff8a2a', '#e8f8ff', '#ffd24a'],
        'cloth': ['#9a8a6a', '#8a8a8a', '#6a4a2a', '#8a7a5a', '#a08060', '#6a4a30', '#c9b48a', '#7a3a2a', '#c8c8c8', '#ffffff'],
        'glow': [None, None, None, None, None, '#ff8a2a', None, '#ff3a2a', '#8adfff', '#ffd24a'],
        'styles': {'helmet': ['pelt'] * 10,
                   'shoulder': ['fur', 'fur', 'fur', 'bone', 'fur', 'bone', 'fur', 'bone', 'fur', 'bone'],
                   'chest': ['fur'] * 10, 'gloves': ['leather'] * 10, 'legs': ['leather'] * 10, 'boots': ['fur'] * 10},
    },
    'cloth': {
        'weight': 'cloth',
        'names': {'helmet': 'Kukuleta', 'shoulder': 'Omuz Şalı', 'chest': 'Cübbe', 'gloves': 'Sargı', 'legs': 'Şalvar', 'boots': 'Sandalet'},
        'en_names': {'helmet': 'Hood', 'shoulder': 'Mantle', 'chest': 'Robe', 'gloves': 'Wraps', 'legs': 'Trousers', 'boots': 'Sandals'},
        'tr': ['Keten', 'Çırak', 'Bilge', 'Arkanist', 'Büyücü', 'Kadim', 'Başbüyücü', 'Yıldız', 'Ay', 'Kozmik'],
        'en': ['Linen', 'Apprentice', 'Sage', 'Arcanist', 'Sorcerer', 'Ancient', 'Archmage', 'Star', 'Moon', 'Cosmic'],
        'stats': {'helmet': 'ult_dmg', 'shoulder': 'ult_dmg', 'chest': 'heart', 'gloves': 'energy', 'legs': 'heart', 'boots': 'energy'},
        'color': ['#6b5a44', '#4a4a7a', '#4a5a4a', '#2c3a8a', '#5a2a6a', '#4a2a6a', '#2a2a5a', '#3a1a6a', '#2a3a5a', '#1a1a3a'],
        'trim': ['#8a7a5a', '#c9a24a', '#c9a24a', '#d4a84a', '#d4a84a', '#d4a84a', '#ffd24a', '#e8c35a', '#e8f8ff', '#c890ff'],
        'cloth': [None] * 10,
        'glow': [None, '#8ab0ff', '#8ad08a', '#5fd8ff', '#b05cff', '#b05cff', '#5fd8ff', '#c890ff', '#bff4ff', '#c890ff'],
        'styles': {'helmet': ['hood', 'hood', 'cowl', 'hood', 'circlet', 'hood', 'cowl', 'circlet', 'hood', 'circlet'],
                   'shoulder': ['mantle'] * 10, 'chest': ['robe'] * 10, 'gloves': ['leather'] * 10, 'legs': ['cloth'] * 10, 'boots': ['cloth'] * 10},
    },
    'silk': {
        'weight': 'cloth',
        'names': {'helmet': 'Taç', 'shoulder': 'Şal', 'chest': 'Kaftan', 'gloves': 'İpek Eldiven', 'legs': 'İpek Şalvar', 'boots': 'Terlik'},
        'en_names': {'helmet': 'Circlet', 'shoulder': 'Shawl', 'chest': 'Kaftan', 'gloves': 'Silk Gloves', 'legs': 'Silk Trousers', 'boots': 'Slippers'},
        'tr': ['Pamuk', 'İpek', 'Saray', 'Zümrüt', 'Yakut', 'Safir', 'Mehtap', 'Güneş', 'Simurg', 'Anka'],
        'en': ['Cotton', 'Silk', 'Palace', 'Emerald', 'Ruby', 'Sapphire', 'Moonlit', 'Sun', 'Simurgh', 'Phoenix'],
        'stats': {'helmet': 'energy', 'shoulder': 'ult_dmg', 'chest': 'heart', 'gloves': 'ult_dmg', 'legs': 'energy', 'boots': 'energy'},
        'color': ['#8a7a6a', '#a08aa0', '#7a2a3a', '#1a6a4a', '#8a1a2a', '#1a3a8a', '#3a4a6a', '#b07a1a', '#1a5a6a', '#a03a1a'],
        'trim': ['#c9b48a', '#e8e4d8', '#ffd24a', '#ffd24a', '#ffd24a', '#e8f8ff', '#e8f8ff', '#fff2a8', '#3fe0c0', '#ffb02a'],
        'cloth': [None] * 10,
        'glow': [None, None, '#ffd24a', '#3dff8a', '#ff3a5a', '#5fa8ff', '#bff4ff', '#ffd24a', '#3fe0c0', '#ff8a2a'],
        'styles': {'helmet': ['circlet', 'cowl', 'circlet', 'cowl', 'circlet', 'cowl', 'circlet', 'circlet', 'cowl', 'circlet'],
                   'shoulder': ['mantle'] * 10, 'chest': ['robe'] * 10, 'gloves': ['leather'] * 10, 'legs': ['cloth'] * 10, 'boots': ['cloth'] * 10},
    },
    'shroud': {
        'weight': 'cloth',
        'names': {'helmet': 'Kefen Başlık', 'shoulder': 'Kefen Şalı', 'chest': 'Kefen', 'gloves': 'Kefen Sargı', 'legs': 'Kefen Şalvar', 'boots': 'Kefen Sandalet'},
        'en_names': {'helmet': 'Shroud Hood', 'shoulder': 'Shroud Mantle', 'chest': 'Shroud', 'gloves': 'Shroud Wraps', 'legs': 'Shroud Trousers', 'boots': 'Shroud Sandals'},
        'tr': ['Toprak', 'Mezar', 'Kemik', 'Ruh', 'Hortlak', 'Lanet', 'Kabus', 'Ölüm', 'Ebedi', 'Kıyamet'],
        'en': ['Earthen', 'Grave', 'Bone', 'Soul', 'Ghoul', 'Cursed', 'Nightmare', 'Death', 'Eternal', 'Doom'],
        'stats': {'helmet': 'skull_dmg', 'shoulder': 'lifeSteal', 'chest': 'heart', 'gloves': 'skull_dmg', 'legs': 'heart', 'boots': 'energy'},
        'color': ['#4a4a3a', '#2e3428', '#3a3a2e', '#1e2a1e', '#2a2a22', '#2a1a2a', '#1a1a2a', '#141a14', '#101810', '#1a0a0a'],
        'trim': ['#6a6a5a', '#8ab08a', '#eae0c8', '#8ab08a', '#9a9a7a', '#b05cff', '#7a5aff', '#9aff9a', '#3dff8a', '#ff5a2a'],
        'cloth': [None] * 10,
        'glow': [None, '#7dff7a', '#b8ff9a', '#7dff7a', '#9aff6a', '#b05cff', '#7a5aff', '#3dff8a', '#3dff8a', '#ff3a2a'],
        'styles': {'helmet': ['hood', 'bonemask', 'hood', 'bonemask', 'hood', 'bonemask', 'cowl', 'bonemask', 'hood', 'bonemask'],
                   'shoulder': ['mantle', 'bone', 'mantle', 'bone', 'mantle', 'bone', 'mantle', 'bone', 'mantle', 'bone'],
                   'chest': ['robe'] * 10, 'gloves': ['leather'] * 10, 'legs': ['cloth'] * 10, 'boots': ['cloth'] * 10},
    },
}
for key, fam in ARMOR10.items():
    for t in range(10):
        for slot in ARMOR_SLOTS:
            style = fam['styles'][slot][t]
            av_slot = 'shoulders' if slot == 'shoulder' else slot
            vis = {'slot': av_slot, 'style': style, 'color': fam['color'][t], 'trim': fam['trim'][t]}
            cl = fam['cloth'][t]
            if slot == 'chest' and cl:
                if style in ('plate', 'mail', 'brigandine'): vis['tabard'] = cl
                if t >= 4: vis['cape'] = avcape = cl
                if style == 'fur': vis['fur'] = cl
            if slot == 'helmet' and style in ('greathelm', 'winged') and cl: vis['plume'] = cl
            if slot == 'boots' and style == 'fur': vis['fur'] = fam['cloth'][t] if key == 'hide' else '#8a7a64'
            if slot == 'shoulder' and style == 'leather' and t >= fam.get('feathers_from', 99): vis['feathers'] = True
            if fam['glow'][t]: vis['glow'] = fam['glow'][t]
            add(f'{key}_{slot}_t{t + 1}', slot, f'{fam["tr"][t]} {fam["names"][slot]}', fam['stats'][slot], WEIGHT[fam['weight']], BANDS10[t],
                2 if slot in ('chest', 'legs') else 1, vis, en=f'{fam["en"][t]} {fam["en_names"][slot]}')

WEAPONS10 = {
    # type: (style, classes, stat, size, extra vis, glow, tr names, en names, colors)
    'sword': ('sword', ['warrior', 'paladin'], 'sword', 2, {}, '#8adfff',
              ['Paslı Kılıç', 'Demir Kılıç', 'Asker Kılıcı', 'Çelik Uzun Kılıç', 'Şövalye Kılıcı', 'Muhafız Kılıcı', 'Aslan Pençesi', 'Kral Kılıcı', 'Ejderdiş', 'Titan Kılıcı'],
              ['Rusty Sword', 'Iron Sword', "Soldier's Sword", 'Steel Longsword', "Knight's Sword", 'Guardian Blade', "Lion's Claw", "King's Blade", 'Dragonfang', 'Titan Blade'],
              ['#8a8078', '#a9b4c0', '#b0b8c2', '#c9d2dc', '#d8dde4', '#e8ecf0', '#e8d8a0', '#fff2c0', '#6a7080', '#9a8ab0']),
    'saber': ('saber', ['warrior', 'rogue'], 'sword', 1, {}, '#ffd24a',
              ['Eğri Kılıç', 'Pala', 'Akıncı Palası', 'Bozkır Kılıcı', 'Yatağan', 'Hilal Pala', 'Kurt Dişi Pala', 'Yıldırım Pala', 'Gök Pala', 'Han Kılıcı'],
              ['Curved Sword', 'Saber', "Raider's Saber", 'Steppe Sword', 'Yataghan', 'Crescent Saber', 'Wolftooth Saber', 'Lightning Saber', 'Sky Saber', "Khan's Blade"],
              ['#8a8078', '#a9b4c0', '#b8c0c8', '#c9d2dc', '#d8dde2', '#e8ecf0', '#c9c0b0', '#bff4ff', '#8ab0d0', '#ffd24a']),
    'axe': ('axe', ['warrior', 'berserker'], 'skull_dmg', 1, {}, '#ff8a2a',
            ['Oduncu Baltası', 'El Baltası', 'Demir Balta', 'Savaş Baltası', 'Sakallı Balta', 'Yarıcı', 'Kurt Baltası', 'Kanlı Hilal', 'Fırtına Baltası', 'Kıyamet Hilali'],
            ["Woodcutter's Axe", 'Hatchet', 'Iron Axe', 'Battle Axe', 'Bearded Axe', 'Cleaver', 'Wolf Axe', 'Blood Crescent', 'Storm Axe', 'Doom Crescent'],
            ['#8a8078', '#9a9a9a', '#a9b4c0', '#b8c0c8', '#c0c8d0', '#d8dde2', '#a0a8b0', '#8a3a3a', '#8ab0d0', '#5a1a1a']),
    'greataxe': ('axe', ['berserker'], 'skull_dmg', 2, {'double': True}, '#ff3a2a',
                 ['Ağır Balta', 'Çift Ağızlı Balta', 'Kasap Baltası', 'Cellat Baltası', 'Barbar Baltası', 'Titan Baltası', 'Kan Baltası', 'Mamut Baltası', 'Kıyamet Baltası', 'Dünya Yarıcı'],
                 ['Heavy Axe', 'Double-Bit Axe', "Butcher's Axe", "Headsman's Axe", 'Barbarian Axe', 'Titan Axe', 'Blood Axe', 'Mammoth Axe', 'Doom Axe', 'World Splitter'],
                 ['#8a8078', '#a9b4c0', '#b8c0c8', '#9a9a9a', '#c0c8d0', '#d8dde2', '#7a2a2a', '#c9b48a', '#5a1a1a', '#3a3a4a']),
    'mace': ('mace', ['warrior', 'paladin'], 'sword', 1, {}, '#ffe08a',
             ['Sopa', 'Demir Gürz', 'Çivili Gürz', 'Topuz', 'Yıldız Gürz', 'Muhafız Topuzu', 'Rahip Gürzü', 'Yıkım Gürzü', 'Kutsal Topuz', 'Hükümdar Topuzu'],
             ['Cudgel', 'Iron Mace', 'Spiked Mace', 'Club', 'Morning Star', "Guardian's Mace", "Priest's Mace", 'Ruin Mace', 'Holy Mace', "Sovereign's Mace"],
             ['#7a6a5a', '#8a939c', '#a9b4c0', '#9a8a6a', '#d4a84a', '#c8ccd4', '#e8e4d8', '#5a5f6e', '#fff2c0', '#ffd24a']),
    'flail': ('flail', ['paladin', 'berserker'], 'skull_dmg', 1, {}, '#ff5a2a',
              ['Harman Döveni', 'Zincirli Gürz', 'Demir Döven', 'Çivili Döven', 'Savaş Döveni', 'Kanlı Döven', 'Ruh Döveni', 'Kıyamet Döveni', 'Fırtına Döveni', 'Yargı Döveni'],
              ['Thresher', 'Chain Mace', 'Iron Flail', 'Spiked Flail', 'War Flail', 'Bloody Flail', 'Soul Flail', 'Doom Flail', 'Storm Flail', 'Flail of Judgement'],
              ['#7a6a5a', '#8a939c', '#a9b4c0', '#b8c0c8', '#c8ccd4', '#8a3a3a', '#7a8a9a', '#3a3a4a', '#8ab0d0', '#fff2c0']),
    'hammer': ('hammer', ['paladin'], 'heart', 2, {}, '#fff2a8',
               ['Taş Çekiç', 'Demirci Çekici', 'Savaş Çekici', 'Kutsal Çekiç', 'Tapınak Çekici', 'Işık Çekici', 'Şafak Çekici', 'Melek Çekici', 'Yargı Çekici', 'Cennet Çekici'],
               ['Stone Hammer', "Smith's Hammer", 'War Hammer', 'Holy Hammer', 'Temple Hammer', 'Hammer of Light', 'Dawn Hammer', 'Angel Hammer', 'Hammer of Judgement', "Heaven's Hammer"],
               ['#8a8a80', '#7a7a7a', '#a9b4c0', '#d4a84a', '#c9b48a', '#fff2c0', '#ffd8a0', '#ffffff', '#fff8e0', '#ffe08a']),
    'spear': ('spear', ['warrior'], 'skull_dmg', 2, {}, '#8adfff',
              ['Mızrak', 'Demir Mızrak', 'Kargı', 'Uzun Mızrak', 'Süvari Mızrağı', 'Muhafız Mızrağı', 'Gök Mızrak', 'Ejder Mızrağı', 'Yıldırım Kargı', 'Titan Mızrağı'],
              ['Spear', 'Iron Spear', 'Pike', 'Long Spear', 'Lance', "Guardian's Spear", 'Sky Spear', 'Dragon Spear', 'Lightning Pike', 'Titan Spear'],
              ['#8a8078', '#a9b4c0', '#9a9a9a', '#c9d2dc', '#d8dde2', '#e8ecf0', '#8ab0d0', '#6a7080', '#bff4ff', '#9a8ab0']),
    'dagger': ('dagger', ['rogue'], 'lifeSteal', 1, {}, '#b05cff',
               ['Paslı Hançer', 'Keskin Hançer', 'Haydut Bıçağı', 'Gölge Hançeri', 'Zehirli Diş', 'Suikast Hançeri', 'Kuzgun Gagası', 'Gece Pençesi', 'Hayalet Bıçak', 'Ölüm Fısıltısı'],
               ['Rusty Dagger', 'Keen Dagger', 'Bandit Knife', 'Shadow Dagger', 'Venom Fang', "Assassin's Dagger", 'Raven Beak', 'Night Claw', 'Ghost Blade', 'Death Whisper'],
               ['#8a8078', '#c9d2dc', '#a9a090', '#9a8ab0', '#8ad08a', '#c9d2dc', '#4a4a5a', '#3a3a4a', '#bff4ff', '#2a2a3a']),
    'bow': ('bow', ['archer'], 'energy', 2, {}, '#9aff6a',
            ['Av Yayı', 'Kısa Yay', 'Uzun Yay', 'Kompozit Yay', 'İzci Yayı', 'Avcı Yayı', 'Rüzgar Yayı', 'Şahin Yayı', 'Fırtına Yayı', 'Yıldız Yayı'],
            ['Hunting Bow', 'Short Bow', 'Longbow', 'Composite Bow', "Scout's Bow", "Hunter's Bow", 'Wind Bow', 'Falcon Bow', 'Storm Bow', 'Star Bow'],
            ['#7a5230', '#6a4a2a', '#8a6038', '#5a3a2a', '#4a5a3a', '#3a4a2a', '#3a4a5a', '#5a4a3a', '#2a2a3a', '#3a2a5a']),
    'staff': ('staff', ['mage', 'necromancer'], 'ult_dmg', 2, {}, None,
              ['Budak Asa', 'Çırak Asası', 'Meşe Asa', 'Kristal Asa', 'Büyücü Asası', 'Kadim Asa', 'Başbüyücü Asası', 'Ay Asası', 'Yıldız Asası', 'Kozmik Asa'],
              ['Gnarled Staff', "Apprentice's Staff", 'Oak Staff', 'Crystal Staff', "Sorcerer's Staff", 'Ancient Staff', "Archmage's Staff", 'Moon Staff', 'Star Staff', 'Cosmic Staff'],
              ['#7a5230', '#6a4a2a', '#5a4a2a', '#5a3a4a', '#4a2a4a', '#3a2a4a', '#2a2a4a', '#3a3a5a', '#2a1a3a', '#1a1a2a']),
    'wand': ('wand', ['mage'], 'energy', 1, {}, None,
             ['Dal Değnek', 'Kemik Değnek', 'Rün Değneği', 'Ateş Değneği', 'Buz Değneği', 'Işık Değneği', 'Fırtına Değneği', 'Boşluk Değneği', 'Yıldız Değneği', 'Kader Değneği'],
             ['Twig Wand', 'Bone Wand', 'Rune Wand', 'Fire Wand', 'Frost Wand', 'Wand of Light', 'Storm Wand', 'Void Wand', 'Star Wand', 'Wand of Fate'],
             ['#6a4a2a', '#b8b0a0', '#4a4a6a', '#6a2a1a', '#4a6a8a', '#d4a84a', '#3a4a5a', '#2a1a3a', '#3a2a5a', '#1a1a2a']),
    'scythe': ('scythe', ['necromancer'], 'skull_dmg', 2, {}, None,
               ['Orak', 'Kemik Tırpan', 'Mezar Tırpanı', 'Ruh Tırpanı', 'Hortlak Tırpanı', 'Lanet Tırpanı', 'Kabus Tırpanı', 'Ölüm Tırpanı', 'Ebedi Tırpan', 'Kıyamet Tırpanı'],
               ['Sickle', 'Bone Scythe', 'Grave Scythe', 'Soul Scythe', 'Ghoul Scythe', 'Cursed Scythe', 'Nightmare Scythe', 'Death Scythe', 'Eternal Scythe', 'Doom Scythe'],
               ['#8a8078', '#b8b0a0', '#9aa0a0', '#9ab0a0', '#8a9a8a', '#8a7a9a', '#7a7a9a', '#b8c0c8', '#c8d8c8', '#5a1a1a']),
}
MAGIC_GLOW = {'staff': ['#8ab0ff', '#5fd8ff', '#8ad08a', '#5fd8ff', '#b05cff', '#b05cff', '#5fd8ff', '#bff4ff', '#c890ff', '#c890ff'],
              'wand': ['#8ab0ff', '#b05cff', '#5fd8ff', '#ff8a2a', '#8adfff', '#ffe08a', '#8adfff', '#b05cff', '#c890ff', '#ffd24a'],
              'scythe': [None, '#7dff7a', '#7dff7a', '#3dff8a', '#9aff6a', '#b05cff', '#7a5aff', '#3dff8a', '#3dff8a', '#ff3a2a']}
for wtype, (style, classes, stat, size, extra, glow, tr, en, colors) in WEAPONS10.items():
    for t in range(10):
        vis = dict({'slot': 'weapon', 'style': style, 'color': colors[t], 'trim': ['#8a8f96', '#b08a4a', '#b08a4a', '#c9a24a', '#c9a24a', '#d4a84a', '#ffd24a', '#ffd24a', '#fff2a8', '#ffd24a'][t]}, **extra)
        g = MAGIC_GLOW[wtype][t] if wtype in MAGIC_GLOW else (glow if t >= 5 else None)
        if g: vis['glow'] = g
        add(f'{wtype}_t{t + 1}', 'weapon', tr[t], stat, classes, BANDS10[t], size, vis, en=en[t])

OFFHANDS10 = {
    'kite': ('kite', ['warrior', 'paladin'], 'shield', 1,
             ['Tahta Kalkan', 'Demir Kalkan', 'Armalı Kalkan', 'Asker Kalkanı', 'Şövalye Kalkanı', 'Muhafız Kalkanı', 'Aslan Kalkanı', 'Kral Kalkanı', 'Ejder Pulu Kalkan', 'Titan Kalkanı'],
             ['Wooden Shield', 'Iron Shield', 'Heraldic Shield', "Soldier's Shield", "Knight's Shield", "Guardian's Shield", 'Lion Shield', "King's Shield", 'Dragonscale Shield', 'Titan Shield'],
             ['#6b4a30', '#7a1a1a', '#1a3a7a', '#3a4a2a', '#5a1a5a', '#e8e4d8', '#8e1b1b', '#1a2a6a', '#3a0a0a', '#2a0a3a']),
    'tower': ('tower', ['warrior', 'paladin'], 'heart', 2,
              ['Kapı Kalkanı', 'Kule Kalkanı', 'Kale Kalkanı', 'Sur Kalkanı', 'Burç Kalkanı', 'Muhafız Duvarı', 'Aslan Duvarı', 'Kral Duvarı', 'Dağ Kalkanı', 'Titan Duvarı'],
              ['Door Shield', 'Tower Shield', 'Castle Shield', 'Rampart Shield', 'Bastion Shield', 'Guardian Wall', 'Lion Wall', "King's Wall", 'Mountain Shield', 'Titan Wall'],
              ['#5a4a3a', '#4a5a6a', '#3a4a6a', '#5a5a5a', '#6a5a4a', '#d8d2c0', '#8a6a2a', '#2a3a6a', '#4a4e5a', '#2a2e3a']),
    'buckler': ('buckler', ['warrior', 'paladin', 'berserker'], 'energy', 1,
                ['Tahta Kalkancık', 'Demir Kalkancık', 'Kalkancık', 'Çivili Kalkancık', 'Akıncı Kalkanı', 'Bozkır Kalkanı', 'Kurt Kalkancık', 'Yıldırım Kalkancık', 'Gök Kalkancık', 'Han Kalkanı'],
                ['Wooden Buckler', 'Iron Buckler', 'Buckler', 'Spiked Buckler', "Raider's Shield", 'Steppe Shield', 'Wolf Buckler', 'Lightning Buckler', 'Sky Buckler', "Khan's Shield"],
                ['#7a5230', '#8a939c', '#6a4a2a', '#5a5f66', '#7a2a1a', '#8a6a3a', '#6a6a6a', '#2a3a6a', '#8ab0d0', '#c8b070']),
    'orb': ('orb', ['mage'], 'ult_dmg', 1,
            ['Cam Küre', 'Buz Küresi', 'Ateş Küresi', 'Arkan Küre', 'Kristal Küre', 'Fırtına Küresi', 'Ay Küresi', 'Yıldız Küresi', 'Boşluk Küresi', 'Kozmik Küre'],
            ['Glass Orb', 'Frost Orb', 'Fire Orb', 'Arcane Orb', 'Crystal Orb', 'Storm Orb', 'Moon Orb', 'Star Orb', 'Void Orb', 'Cosmic Orb'],
            ['#8ab0c0', '#8adfff', '#ff8a2a', '#5fd8ff', '#bff4ff', '#8ab0ff', '#e8e4ff', '#ffd24a', '#b05cff', '#c890ff']),
    'tome': ('tome', ['mage', 'necromancer'], 'energy', 1,
             ['Eski Defter', 'Büyü Kitabı', 'Rün Kitabı', 'Bilge Kitabı', 'Kadim Tomar', 'Ay Kitabı', 'Lanet Kitabı', 'Kara Kitap', 'Yıldız Atlası', 'Kader Kitabı'],
             ['Old Notebook', 'Spellbook', 'Rune Book', "Sage's Book", 'Ancient Scroll', 'Moon Book', 'Book of Curses', 'Black Book', 'Star Atlas', 'Book of Fate'],
             ['#6b4a30', '#2c3a8a', '#4a2a6a', '#2a5a3a', '#6a4a1a', '#2a3a5a', '#4a1a2a', '#1a1a22', '#1a2a4a', '#3a1a3a']),
    'lantern': ('lantern', ['necromancer'], 'lifeSteal', 1,
                ['Kandil', 'Mezar Feneri', 'Kemik Feneri', 'Ruh Feneri', 'Hortlak Feneri', 'Hayalet Feneri', 'Lanet Feneri', 'Ölüm Feneri', 'Ebedi Fener', 'Kıyamet Feneri'],
                ['Oil Lamp', 'Grave Lantern', 'Bone Lantern', 'Soul Lantern', 'Ghoul Lantern', 'Ghost Lantern', 'Cursed Lantern', 'Death Lantern', 'Eternal Lantern', 'Doom Lantern'],
                ['#6a5f56', '#5a5f66', '#8a8070', '#4a5a4a', '#5a5a4a', '#3a4a5a', '#4a3a4a', '#2a2a2a', '#3a4a3a', '#3a1a1a']),
    'skull': ('skull', ['necromancer'], 'skull_dmg', 1,
              ['Kuru Kafa', 'Mezar Kafatası', 'Hortlak Kafası', 'Ruh Kafatası', 'Lanetli Kafa', 'Kabus Kafatası', 'Ölü Kral Kafası', 'Ölüm Kafatası', 'Ebedi Kafatası', 'Kıyamet Kafatası'],
              ['Dry Skull', 'Grave Skull', 'Ghoul Head', 'Soul Skull', 'Cursed Skull', 'Nightmare Skull', "Dead King's Skull", 'Death Skull', 'Eternal Skull', 'Doom Skull'],
              ['#eae0c8'] * 10),
    'quiver': ('quiver', ['archer'], 'energy', 1,
               ['Deri Sadak', 'Av Sadağı', 'İzci Sadağı', 'Uzun Sadak', 'Avcı Sadağı', 'Rüzgar Sadağı', 'Şahin Sadağı', 'Fırtına Sadağı', 'Yıldırım Sadağı', 'Yıldız Sadağı'],
               ['Leather Quiver', "Hunter's Quiver", "Scout's Quiver", 'Long Quiver', "Huntsman's Quiver", 'Wind Quiver', 'Falcon Quiver', 'Storm Quiver', 'Lightning Quiver', 'Star Quiver'],
               ['#6b4a30', '#5a3a22', '#4a5a3a', '#4a3a2a', '#3a4a2a', '#3a4a5a', '#5a4a3a', '#2a2a3a', '#2a3a5a', '#3a2a5a']),
    'offdagger': ('dagger', ['rogue'], 'sword', 1,
                  ['Sol El Hançeri', 'Paraçol', 'Haydut Bıçağı', 'Gölge Bıçağı', 'Zehir Dişi', 'Suikast Bıçağı', 'Kuzgun Pençesi', 'Gece Dişi', 'Hayalet Diş', 'Ölüm Dişi'],
                  ['Parrying Dagger', 'Main-Gauche', 'Bandit Blade', 'Shadow Blade', 'Venom Tooth', "Assassin's Blade", 'Raven Claw', 'Night Tooth', 'Ghost Fang', 'Death Fang'],
                  ['#8a8078', '#c9d2dc', '#a9a090', '#9a8ab0', '#8ad08a', '#c9d2dc', '#4a4a5a', '#3a3a4a', '#bff4ff', '#2a2a3a']),
}
OFF_GLOW = {'orb': None, 'tome': '#b05cff', 'lantern': '#7dff7a', 'skull': ['#9a9a7a', '#7dff7a', '#9aff6a', '#7dff7a', '#b05cff', '#7a5aff', '#3dff8a', '#3dff8a', '#3fe0c0', '#ff3a2a']}
for otype, (style, classes, stat, size, tr, en, colors) in OFFHANDS10.items():
    for t in range(10):
        vis = {'slot': 'offhand', 'style': style, 'color': colors[t], 'trim': ['#8a8f96', '#b08a4a', '#b08a4a', '#c9a24a', '#c9a24a', '#ffd24a', '#ffd24a', '#fff2a8', '#d4a84a', '#ffd24a'][t]}
        g = OFF_GLOW.get(otype, 'x')
        if otype == 'orb': vis['glow'] = colors[t]
        elif isinstance(g, list): vis['glow'] = g[t]
        elif g and g != 'x': vis['glow'] = g
        elif t >= 6: vis['glow'] = ['#ffe08a', '#ffb02a', '#8adfff', '#ff5a2a'][t - 6]
        if otype == 'kite': vis['emblem'] = ['#8a8f96', '#e8c35a', '#e8c35a', '#e8e4d8', '#e8c35a', '#ff8a2a', '#ffd24a', '#ffd24a', '#ff8a2a', '#c890ff'][t]
        add(f'{otype}_t{t + 1}', 'offhand', tr[t], stat, classes, BANDS10[t], size, vis, en=en[t])

TIER_TR = ['Basit', 'Sağlam', 'Perçinli', 'Rünlü', 'Asker', 'Soylu', 'Muhafız', 'Kral', 'Ejder', 'Titan']
TIER_EN = ['Plain', 'Sturdy', 'Riveted', 'Runed', "Soldier's", 'Noble', "Guardian's", "King's", 'Dragon', 'Titan']
TRIMS10 = ['#8a8f96', '#b08a4a', '#9a7a4a', '#c9a24a', '#b08a4a', '#d4a84a', '#ffd24a', '#fff2a8', '#d4a84a', '#ff8a2a']
for t in range(10):
    add(f'belt_t{t + 1}', 'belt', f'{TIER_TR[t]} Kemer', 'heart', ALL, BANDS10[t], 1, en=f'{TIER_EN[t]} Belt',
        vis={'slot': 'belt', 'style': 'leather', 'color': ['#6b4a30', '#5a3a22', '#4a3020', '#5a2a1a', '#3a2616', '#4a3a2a', '#2a1a10', '#3a1a10', '#2a1a1a', '#1a1010'][t], 'trim': TRIMS10[t], 'pouch': t % 3 == 1})
    add(f'sash_t{t + 1}', 'belt', f'{TIER_TR[t]} Kuşak', 'energy', ALL, BANDS10[t], 1, en=f'{TIER_EN[t]} Sash',
        vis={'slot': 'belt', 'style': 'sash', 'color': ['#6a4a2a', '#6a2a2a', '#2a3a6a', '#4a2a6a', '#2a5a3a', '#7a1a2a', '#1a3a7a', '#5a1a5a', '#3a0a0a', '#1a1a3a'][t], 'trim': TRIMS10[t], 'pouch': t >= 3})
    add(f'chainbelt_t{t + 1}', 'belt', f'{TIER_TR[t]} Zincir Kemer', 'shield', ALL, BANDS10[t], 1, en=f'{TIER_EN[t]} Chain Belt',
        vis={'slot': 'belt', 'style': 'chain', 'color': ['#7a7068', '#8a939c', '#7f8a94', '#aab4c0', '#9aa0aa', '#c8ccd4', '#c9a85a', '#d8c890', '#4a4e5a', '#ffd24a'][t], 'trim': TRIMS10[t]})
AMULETS10 = ['Kemik Kolye', 'Diş Kolye', 'Gümüş Muska', 'Rün Kolye', 'Nazar Boncuğu', 'Soylu Madalyon', 'Ay Tılsımı', 'Güneş Madalyonu', 'Ejder Gözü', 'Yıldız Kalbi']
AMULETS10_EN = ['Bone Necklace', 'Fang Necklace', 'Silver Charm', 'Rune Necklace', 'Evil Eye Bead', 'Noble Medallion', 'Moon Talisman', 'Sun Medallion', 'Dragon Eye', 'Star Heart']
AMULET_GLOW = ['#eae0c8', '#e8e4d8', '#c9d2dc', '#5fd8ff', '#3a7ae8', '#ffd24a', '#bff4ff', '#ffb02a', '#ff5a2a', '#c890ff']
RINGS_A = ['Bakır Yüzük', 'Demir Halka', 'Gümüş Yüzük', 'Rün Yüzüğü', 'Kan Yüzüğü', 'Soylu Mühür', 'Ay Halkası', 'Ejder Halkası', 'Yıldız Halkası', 'Kader Mührü']
RINGS_A_EN = ['Copper Ring', 'Iron Band', 'Silver Ring', 'Rune Ring', 'Blood Ring', 'Noble Signet', 'Moon Band', 'Dragon Band', 'Star Band', 'Signet of Fate']
RINGS_B = ['Örgü Halka', 'Dost Yüzüğü', 'Şifa Halkası', 'Bilge Yüzüğü', 'Rahip Mührü', 'Kutsal Halka', 'Melek Yüzüğü', 'Işık Halkası', 'Cennet Mührü', 'Birlik Halkası']
RINGS_B_EN = ['Braided Band', 'Friendship Ring', 'Band of Healing', "Sage's Ring", "Priest's Signet", 'Holy Band', 'Angel Ring', 'Band of Light', "Heaven's Signet", 'Band of Unity']
RING_GLOW_A = ['#c97a4a', '#9a9a9a', '#c9d2dc', '#5fd8ff', '#ff3a3a', '#ffd24a', '#bff4ff', '#ff5a2a', '#ffe08a', '#c890ff']
RING_GLOW_B = ['#8ad08a', '#3dff8a', '#7dff9a', '#5fd8ff', '#ffe08a', '#fff2a8', '#ffffff', '#ffe08a', '#bff4ff', '#3fe0c0']
for t in range(10):
    add(f'amulet_t{t + 1}', 'amulet', AMULETS10[t], 'ult_dmg' if t % 2 == 0 else 'teamHeal', ALL, BANDS10[t], 1, en=AMULETS10_EN[t],
        vis={'slot': 'amulet', 'style': 'pendant', 'color': '#d4a84a', 'glow': AMULET_GLOW[t]})
    # rings aren't painted on the hero (too small) - the vis only colors their icon
    add(f'ring_t{t + 1}', 'ring', RINGS_A[t], 'lifeSteal', ALL, BANDS10[t], 1, en=RINGS_A_EN[t], vis={'slot': 'ring', 'style': 'band', 'color': '#d4a84a', 'trim': TRIMS10[t], 'glow': RING_GLOW_A[t]})
    add(f'healring_t{t + 1}', 'ring', RINGS_B[t], 'teamHeal', ALL, BANDS10[t], 1, en=RINGS_B_EN[t], vis={'slot': 'ring', 'style': 'band', 'color': '#c9d2dc', 'trim': TRIMS10[t], 'glow': RING_GLOW_B[t]})

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
           f'const CATALOG_BANDS = {json.dumps(BANDS10)};\n'
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
