"""Generates the combat portraits: 7 hero classes + 5 monsters, as SVG.

Stylized "chibi" vector characters (big head, bold outline, soft shading)
built from one shared body template plus per-character parts: outfit colors,
headgear, face details, weapon/offhand, extras (cape, wings, horns, aura).
Heroes face right (toward the enemy portrait), monsters are mirrored to face
left. graphics.js loads these as single textures and animates them in code
(idle breathing, attack lunge, hit knockback, death) - see CombatStage.

Run: python3 tools/make_characters.py   ->  assets/characters/<key>.svg
"""
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets', 'characters')
O = '#161a24'          # outline color
SW = 4                 # outline width

# ---------------------------------------------------------------- helpers ---
def grad(gid, top, bottom, x2='0', y2='1'):
    return f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>'

def rgrad(gid, inner, outer, cx='40%', cy='35%', r='70%'):
    return f'<radialGradient id="{gid}" cx="{cx}" cy="{cy}" r="{r}"><stop offset="0" stop-color="{inner}"/><stop offset="1" stop-color="{outer}"/></radialGradient>'

def _stroke(sw, extra):
    # A custom stroke color in `extra` replaces the default outline color
    # (two stroke="" attributes would make the SVG invalid XML).
    base = '' if 'stroke="' in extra.replace('stroke-', '') else f'stroke="{O}" '
    return f'{base}stroke-width="{sw}" {extra}'

def P(d, fill, sw=SW, extra=''):
    return f'<path d="{d}" fill="{fill}" {_stroke(sw, extra)} stroke-linejoin="round" stroke-linecap="round"/>'

def C(cx, cy, r, fill, sw=SW, extra=''):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" {_stroke(sw, extra)}/>'

def E(cx, cy, rx, ry, fill, sw=SW, extra=''):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}" {_stroke(sw, extra)}/>'

def R(x, y, w, h, rx, fill, sw=SW, extra=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" {_stroke(sw, extra)}/>'

def shine(d, op=.35):
    return f'<path d="{d}" fill="#ffffff" fill-opacity="{op}"/>'

# ----------------------------------------------------------- body template ---
def leg(side, pants, boots):
    if side == 'L':
        return P('M78 186 L76 226 L96 226 L98 186 Z', pants) + P('M70 222 Q70 236 86 236 L99 236 L99 222 Z', boots)
    return P('M102 186 L104 226 L124 226 L122 186 Z', pants) + P('M101 222 L101 236 L114 236 Q130 236 130 222 Z', boots)

def legs(pants, boots):
    return leg('L', pants, boots) + leg('R', pants, boots)

def torso(fill, belt=None):
    s = P('M66 132 Q64 120 80 116 L120 116 Q136 120 134 132 L128 194 Q100 202 72 194 Z', fill)
    s += shine('M74 128 Q76 121 86 120 L92 120 L84 180 Q76 178 74 170 Z', .18)
    if belt:
        s += P('M70 176 Q100 184 130 176 L129 188 Q100 196 71 188 Z', belt, 3)
        s += R(93, 177, 14, 11, 2, '#e8c35a', 2.5)
    return s

def arm(side, sleeve, skin, glove=None):
    # side: 'L' (viewer's left) or 'R'
    if side == 'L':
        s = P('M70 128 Q52 136 48 166 L62 170 Q66 148 78 140 Z', sleeve)
        s += C(55, 172, 10, glove or skin)
    else:
        s = P('M130 128 Q148 136 152 166 L138 170 Q134 148 122 140 Z', sleeve)
        s += C(145, 172, 10, glove or skin)
    return s

def head(skin, cy=82, r=46):
    s = C(100, cy, r, 'url(#skin)')
    s += shine(f'M70 {cy-18} Q76 {cy-38} 98 {cy-42} Q80 {cy-30} 74 {cy-10} Z', .28)
    return s

def ears(skin, pointy=False, big=False):
    if pointy:
        w = 34 if big else 20
        return (P(f'M58 80 L{58-w} {66-w//3} L60 96 Z', 'url(#skin)') + P(f'M142 80 L{142+w} {66-w//3} L140 96 Z', 'url(#skin)'))
    return E(55, 88, 7, 10, 'url(#skin)', 3) + E(145, 88, 7, 10, 'url(#skin)', 3)

def eyes(iris='#2b2f3a', glow=None, y=88, angry=False, closed=False):
    if glow:
        return (E(82, y, 8, 6, glow, 3) + E(118, y, 8, 6, glow, 3)
                + f'<ellipse cx="82" cy="{y}" rx="12" ry="9" fill="{glow}" fill-opacity=".35"/>'
                + f'<ellipse cx="118" cy="{y}" rx="12" ry="9" fill="{glow}" fill-opacity=".35"/>')
    s = E(82, y, 9, 11, '#ffffff', 3) + E(118, y, 9, 11, '#ffffff', 3)
    s += C(84, y + 2, 5.5, iris, 0) + C(120, y + 2, 5.5, iris, 0)
    s += C(86, y - 1, 2, '#ffffff', 0) + C(122, y - 1, 2, '#ffffff', 0)
    if angry:
        s += P(f'M70 {y-16} L92 {y-9}', 'none', 4.5) + P(f'M130 {y-16} L108 {y-9}', 'none', 4.5)
    else:
        s += P(f'M72 {y-17} Q82 {y-22} 92 {y-17}', 'none', 3.5) + P(f'M108 {y-17} Q118 {y-22} 128 {y-17}', 'none', 3.5)
    return s

def mouth(kind='smile', y=110):
    if kind == 'smile':
        return P(f'M92 {y} Q100 {y+7} 108 {y}', 'none', 3.5)
    if kind == 'grim':
        return P(f'M91 {y+2} L109 {y+2}', 'none', 3.5)
    if kind == 'shout':
        return P(f'M90 {y-2} Q100 {y+14} 110 {y-2} Z', '#6b1a1a', 3)
    if kind == 'fangs':
        return (P(f'M86 {y} Q100 {y+10} 114 {y}', '#5a1414', 3)
                + P(f'M90 {y+1} L93 {y+8} L96 {y+2}Z', '#ffffff', 2) + P(f'M104 {y+2} L107 {y+8} L110 {y+1}Z', '#ffffff', 2))
    return ''

def blush():
    return '<ellipse cx="72" cy="102" rx="7" ry="4" fill="#ff7a7a" fill-opacity=".35"/><ellipse cx="128" cy="102" rx="7" ry="4" fill="#ff7a7a" fill-opacity=".35"/>'

def shadow():
    return '<ellipse cx="100" cy="238" rx="58" ry="9" fill="#000" fill-opacity=".35"/>'

# ---------------------------------------------------------------- weapons ---
def sword(x=150, y=172, blade='url(#steel)', long=True):
    L = 92 if long else 60
    return (P(f'M{x-6} {y-6} L{x-6} {y-6-L} L{x} {y-16-L} L{x+6} {y-6-L} L{x+6} {y-6} Z', blade)
            + f'<path d="M{x} {y-12-L} L{x} {y-10}" stroke="#ffffff" stroke-opacity=".6" stroke-width="2.5"/>'
            + R(x - 18, y - 10, 36, 9, 4, 'url(#gold)', 3) + R(x - 4, y - 2, 8, 16, 2, '#6b4122', 3) + C(x, y + 17, 5, 'url(#gold)', 3))

def axe(x=150, y=172, double=True):
    s = R(x - 4, y - 96, 8, 112, 3, '#7a4a24', 3)
    s += P(f'M{x+2} {y-94} Q{x+40} {y-102} {x+42} {y-64} Q{x+26} {y-70} {x+2} {y-66} Z', 'url(#steel)')
    if double:
        s += P(f'M{x-2} {y-94} Q{x-40} {y-102} {x-42} {y-64} Q{x-26} {y-70} {x-2} {y-66} Z', 'url(#steel)')
    return s

def dagger(x, y, flip=False):
    k = -1 if flip else 1
    return (P(f'M{x} {y} L{x+k*26} {y-34} L{x+k*30} {y-30} L{x+k*6} {y+4} Z', 'url(#steel)')
            + R(x - 8, y - 2, 16, 6, 3, 'url(#gold)', 2.5))

def staff(x=150, y=172, top='orb', glow='#5bc8ff'):
    s = R(x - 4, y - 104, 8, 128, 3, '#6b4122', 3)
    if top == 'orb':
        s += f'<circle cx="{x}" cy="{y-112}" r="24" fill="{glow}" fill-opacity=".3"/>' + C(x, y - 112, 13, 'url(#orb)', 3)
        s += C(x - 4, y - 116, 4, '#ffffff', 0, 'fill-opacity=".8"')
    else:  # skull
        s += f'<circle cx="{x}" cy="{y-112}" r="24" fill="{glow}" fill-opacity=".3"/>'
        s += P(f'M{x-13} {y-110} Q{x-14} {y-128} {x} {y-128} Q{x+14} {y-128} {x+13} {y-110} L{x+8} {y-100} L{x-8} {y-100} Z', '#ece3cf', 3)
        s += C(x - 5, y - 114, 3.5, glow, 0) + C(x + 5, y - 114, 3.5, glow, 0)
    return s

def hammer(x=150, y=172):
    return (R(x - 4, y - 90, 8, 106, 3, '#6b4122', 3) + R(x - 24, y - 112, 48, 28, 6, 'url(#gold)', 3.5)
            + P(f'M{x-24} {y-104} L{x+24} {y-104}', 'none', 2.5) + C(x, y - 98, 5, '#fff3c4', 2))

def bow(x=48, y=150):
    return (P(f'M{x+6} {y-70} Q{x-26} {y} {x+6} {y+70}', 'none', 7) + P(f'M{x+6} {y-70} Q{x-26} {y} {x+6} {y+70}', 'none', 3.5, 'stroke="#9a6433"')
            + f'<path d="M{x+6} {y-70} L{x+6} {y+70}" stroke="#e8e0cc" stroke-width="1.8"/>')

def round_shield(x=52, y=160, fill='url(#shieldblue)', emblem='#e8c35a'):
    return (C(x, y, 30, fill, 4) + C(x, y, 22, 'none', 2.5, f'stroke="{emblem}"') + C(x, y, 7, emblem, 3)
            + shine(f'M{x-22} {y-8} Q{x-16} {y-24} {x} {y-26} Q{x-12} {y-18} {x-16} {y-4} Z', .3))

def sun_shield(x=52, y=162):
    s = P(f'M{x} {y-34} L{x+28} {y-24} L{x+28} {y} Q{x+26} {y+24} {x} {y+36} Q{x-26} {y+24} {x-28} {y} L{x-28} {y-24} Z', '#f4f1ea')
    s += C(x, y, 11, 'url(#gold)', 3)
    for dx, dy in [(0, -20), (0, 20), (-18, 0), (18, 0)]:
        s += P(f'M{x+dx*0.62} {y+dy*0.62} L{x+dx} {y+dy}', 'none', 3, 'stroke="#c99a2e"')
    return s

# ------------------------------------------------------------- characters ---
# Every character is a RIG: separate parts, each drawn in place in the same
# 200x250 box, rotated at runtime around its joint (graphics.js). Parts:
#   back  - behind everything (cape, wings, tail, quiver); fixed to the body
#   legL, legR - pivot at the hip
#   torso - pivot at the waist; carries head and both arms with it
#   head  - pivot at the neck
#   armL  - viewer's-left arm + off-hand (shield / bow / dagger); shoulder pivot
#   armR  - viewer's-right arm + weapon; shoulder pivot
# Heroes and monsters are all drawn facing right; graphics.js mirrors
# monsters at runtime so their joints animate the same way.
DEFS_COMMON = (grad('steel', '#ffffff', '#8b9aa9', '1', '1') + grad('gold', '#ffe89a', '#b07a16')
               + rgrad('orb', '#e8fbff', '#2aa8ff') + grad('shieldblue', '#4f8fe8', '#1f3f8a'))
PART_ORDER = ['back', 'legL', 'legR', 'torso', 'head', 'armL', 'armR']
PIVOTS = {'legL': (88, 190), 'legR': (112, 190), 'torso': (100, 196), 'head': (100, 124),
          'armL': (72, 134), 'armR': (128, 134)}

def svg_wrap(defs, body, skin, size=(200, 250), mirror=False, with_shadow=False, scale=None):
    inner = body
    if scale:
        inner = f'<g transform="translate(100 250) scale({scale}) translate(-100 -250)">{inner}</g>'
    if mirror:
        inner = f'<g transform="translate(200 0) scale(-1 1)">{inner}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250" width="{size[0]}" height="{size[1]}">'
            f'<defs>{DEFS_COMMON}{rgrad("skin", skin[0], skin[1], "40%", "30%", "75%")}{defs}</defs>'
            f'{shadow() if with_shadow else ""}{inner}</svg>')

SKIN_LIGHT = ('#ffe0c4', '#e8a878')
SKIN_TAN = ('#f2c08f', '#c98450')
SKIN_PALE = ('#e9e6f2', '#a8a3c0')
SKIN_GOBLIN = ('#a6e06a', '#4f8a2a')

def rig(defs, skin, parts, monster=False, scale=None, pivots=None):
    return {'defs': defs, 'skin': skin, 'parts': parts, 'monster': monster, 'scale': scale,
            'pivots': dict(PIVOTS, **(pivots or {}))}

def warrior():
    d = grad('armor', '#e9eef3', '#7d8b99') + grad('cape', '#e0433b', '#7d1510')
    torso_ = torso('url(#armor)', '#7a4a24') + P('M84 122 L116 122 L112 150 L88 150 Z', '#c0312a', 3)
    head_ = (head('') + eyes('#2a4d7a') + mouth('grim')
             + P('M52 84 Q52 30 100 30 Q148 30 148 84 L136 84 Q134 58 100 56 Q66 58 64 84 Z', 'url(#armor)')
             + P('M96 56 L104 56 L104 96 L96 96 Z', 'url(#armor)', 3)
             + P('M100 30 Q104 8 128 4 Q116 16 118 28 Q110 22 100 30 Z', '#e0433b', 3))
    return rig(d, SKIN_LIGHT, {
        'back': P('M62 128 Q40 180 54 232 L146 232 Q160 180 138 128 Z', 'url(#cape)'),
        'legL': leg('L', '#4a5563', '#3a3f4a'), 'legR': leg('R', '#4a5563', '#3a3f4a'),
        'torso': torso_, 'head': head_,
        'armL': arm('L', 'url(#armor)', 'url(#skin)', 'url(#armor)') + round_shield(50, 166),
        'armR': sword(152, 172) + arm('R', 'url(#armor)', 'url(#skin)', 'url(#armor)'),
    })

def berserker():
    d = grad('fur', '#b98a5a', '#6b4526') + grad('horn', '#fffbea', '#c9b98f')
    torso_ = (P('M66 132 Q64 120 80 116 L120 116 Q136 120 134 132 L128 194 Q100 202 72 194 Z', 'url(#skin)')
              + P('M84 150 Q100 158 116 150', 'none', 2.5) + P('M100 132 L100 150', 'none', 2.5)
              + P('M70 176 Q100 184 130 176 L129 190 Q100 198 71 190 Z', '#3f2a1a', 3))
    head_ = (head('') + P('M58 92 Q60 140 100 140 Q140 140 142 92 Q128 116 100 116 Q72 116 58 92 Z', '#b5431d')
             + eyes('#3b2a1a', angry=True) + mouth('shout', 112)
             + P('M72 96 L80 102 M120 102 L128 96', 'none', 3.5, 'stroke="#2f7ae0"')
             + P('M54 76 Q54 36 100 36 Q146 36 146 76 L138 70 Q100 56 62 70 Z', '#6d7784')
             + P('M56 62 Q28 50 26 18 Q44 36 64 44 Z', 'url(#horn)', 3.5) + P('M144 62 Q172 50 174 18 Q156 36 136 44 Z', 'url(#horn)', 3.5))
    return rig(d, SKIN_TAN, {
        'legL': leg('L', '#5a3a26', '#3a2718'), 'legR': leg('R', '#5a3a26', '#3a2718'),
        'torso': torso_, 'head': head_,
        'armL': arm('L', 'url(#skin)', 'url(#skin)') + P('M60 120 Q66 104 84 110 L88 128 Q70 134 60 120 Z', 'url(#fur)', 3),
        'armR': axe(156, 176, double=False) + arm('R', 'url(#skin)', 'url(#skin)') + P('M140 120 Q134 104 116 110 L112 128 Q130 134 140 120 Z', 'url(#fur)', 3),
    })

def rogue():
    d = grad('hood', '#6b4fa0', '#2a1c4a') + grad('leather', '#4b3a5e', '#221832')
    head_ = (head('') + P('M58 96 Q60 132 100 134 Q140 132 142 96 Z', '#2a1c4a') + eyes('#6a2b9a', angry=True, y=86)
             + P('M46 98 Q40 26 100 22 Q160 26 154 98 Q146 64 100 60 Q54 64 46 98 Z', 'url(#hood)')
             + P('M46 98 Q52 122 64 130 L70 118 Q58 110 56 96 Z', 'url(#hood)', 3) + P('M154 98 Q148 122 136 130 L130 118 Q142 110 144 96 Z', 'url(#hood)', 3))
    return rig(d, SKIN_LIGHT, {
        'legL': leg('L', '#2b2238', '#18121f'), 'legR': leg('R', '#2b2238', '#18121f'),
        'torso': torso('url(#leather)', '#5a3a22') + P('M72 140 L128 176 M128 140 L72 176', 'none', 3, 'stroke="#8e6fc0"'),
        'head': head_,
        'armL': arm('L', 'url(#leather)', 'url(#skin)', '#2b2238') + dagger(54, 172, flip=True),
        'armR': arm('R', 'url(#leather)', 'url(#skin)', '#2b2238') + dagger(146, 172),
    })

def archer():
    d = grad('green', '#6fbf5a', '#2c6a2a') + grad('leather', '#a0703f', '#5a3a1c')
    back = (R(126, 96, 22, 66, 6, '#7a4a24', 3.5, 'transform="rotate(18 137 129)"')
            + ''.join(P(f'M{130+i*5} 98 L{128+i*5} 80 L{134+i*5} 86 Z', '#e8e0cc', 2) for i in range(3)))
    head_ = (head('') + P('M68 60 Q100 44 132 60 L128 70 Q100 60 72 70 Z', '#c98a3a', 3) + eyes('#2d6b2a') + mouth('smile') + blush()
             + P('M50 90 Q44 24 100 22 Q156 24 150 90 Q144 56 100 52 Q56 56 50 90 Z', 'url(#green)')
             + P('M150 70 Q176 76 184 60 Q170 90 148 92 Z', 'url(#green)', 3))
    return rig(d, SKIN_LIGHT, {
        'back': back,
        'legL': leg('L', '#3f5a2a', '#4a2f18'), 'legR': leg('R', '#3f5a2a', '#4a2f18'),
        'torso': torso('url(#leather)', '#3a2616'), 'head': head_,
        'armL': bow(40, 152) + arm('L', 'url(#green)', 'url(#skin)'),
        'armR': arm('R', 'url(#green)', 'url(#skin)'),
    })

def robe_torso(fill, trim):
    return (P('M64 132 Q62 120 80 116 L120 116 Q138 120 136 132 L150 232 L50 232 Z', fill)
            + P('M96 118 L104 118 L108 232 L92 232 Z', trim, 3))

def mage():
    d = grad('robe', '#4f7fe0', '#1d2f7a') + grad('hat', '#5a86ea', '#1a2a6e')
    head_ = (head('') + eyes('#2b6ad6') + mouth('smile') + blush()
             + P('M64 104 Q100 150 136 104 Q124 124 100 126 Q76 124 64 104 Z', '#f2f0ea', 3)
             + P('M40 66 Q100 50 160 66 Q152 78 100 72 Q48 78 40 66 Z', 'url(#hat)')
             + P('M62 66 Q84 34 96 -8 Q116 20 132 22 Q124 40 138 66 Z', 'url(#hat)')
             + '<path d="M104 30 l3 6 6 1 -5 4 1 6 -5 -3 -5 3 1 -6 -5 -4 6 -1Z" fill="#ffe46a"/>'
             + '<path d="M82 52 l2 4 4 .5 -3 3 .7 4 -3.7 -2 -3.7 2 .7 -4 -3 -3 4 -.5Z" fill="#ffe46a"/>')
    return rig(d, SKIN_LIGHT, {
        'torso': robe_torso('url(#robe)', '#e8c35a'), 'head': head_,
        'armL': arm('L', 'url(#robe)', 'url(#skin)'),
        'armR': staff(152, 172, 'orb', '#5bc8ff') + arm('R', 'url(#robe)', 'url(#skin)'),
    })

def necromancer():
    d = grad('robe', '#3a2f4a', '#120d1a') + grad('trim', '#b57bff', '#5a2aa0')
    head_ = (head('') + P('M74 106 Q100 118 126 106', 'none', 2.5, 'stroke="#7a6f96"') + eyes(glow='#c58bff', y=88) + mouth('grim', 112)
             + P('M44 104 Q36 22 100 18 Q164 22 156 104 Q146 60 100 56 Q54 60 44 104 Z', 'url(#robe)')
             + P('M44 104 Q36 22 100 18 Q164 22 156 104', 'none', 3, 'stroke="#b57bff"'))
    return rig(d, SKIN_PALE, {
        'torso': robe_torso('url(#robe)', 'url(#trim)'), 'head': head_,
        'armL': arm('L', 'url(#robe)', 'url(#skin)') + '<circle cx="46" cy="170" r="16" fill="#b57bff" fill-opacity=".35"/>' + C(46, 170, 7, '#d9b8ff', 2),
        'armR': staff(152, 172, 'skull', '#b57bff') + arm('R', 'url(#robe)', 'url(#skin)'),
    })

def paladin():
    d = grad('armor', '#fff6d6', '#c9a13f') + grad('tabard', '#ffffff', '#cfd6e2')
    head_ = ('<ellipse cx="100" cy="30" rx="36" ry="9" fill="none" stroke="#ffe46a" stroke-width="5" stroke-opacity=".9"/>'
             + head('') + P('M56 84 Q52 36 100 34 Q148 36 144 84 Q132 60 100 58 Q68 60 56 84 Z', '#f2c94c')
             + eyes('#2a6fd0') + mouth('smile') + blush()
             + P('M58 76 Q66 62 80 60', 'none', 3) + P('M142 76 Q134 62 120 60', 'none', 3))
    return rig(d, SKIN_LIGHT, {
        'legL': leg('L', '#8a6a2a', '#5a4418'), 'legR': leg('R', '#8a6a2a', '#5a4418'),
        'torso': torso('url(#armor)', '#7a4a24') + P('M84 122 L116 122 L114 190 L86 190 Z', 'url(#tabard)', 3)
                 + P('M96 136 H104 V148 H114 V156 H104 V176 H96 V156 H86 V148 H96 Z', '#e8c35a', 2),
        'head': head_,
        'armL': arm('L', 'url(#armor)', 'url(#skin)', 'url(#armor)') + sun_shield(50, 166),
        'armR': hammer(152, 176) + arm('R', 'url(#armor)', 'url(#skin)', 'url(#armor)'),
    })

def goblin():
    d = grad('rag', '#9a6b3f', '#5a3a1c')
    return rig(d, SKIN_GOBLIN, {
        'legL': leg('L', 'url(#skin)', '#5a3a1c'), 'legR': leg('R', 'url(#skin)', '#5a3a1c'),
        'torso': torso('url(#rag)', '#3f2a1a'),
        'head': ears('', pointy=True, big=True) + head('', cy=86, r=44) + eyes('#c83a1a', angry=True, y=90) + mouth('fangs', 110) + P('M96 98 Q100 106 104 98', 'none', 3),
        'armL': arm('L', 'url(#skin)', 'url(#skin)'),
        'armR': R(146, 90, 16, 84, 7, '#8a5a2a', 3.5, 'transform="rotate(12 154 132)"') + C(160, 92, 16, '#8a5a2a', 3.5) + arm('R', 'url(#skin)', 'url(#skin)'),
    }, monster=True)

def golem():
    d = grad('rock', '#a9b2bc', '#4b535c') + grad('moss', '#7fc46a', '#2f6a2a')
    return rig(d, ('#a9b2bc', '#4b535c'), {
        'legL': P('M70 194 L66 232 L98 232 L98 194 Z', 'url(#rock)'),
        'legR': P('M102 194 L102 232 L134 232 L130 194 Z', 'url(#rock)'),
        'torso': (P('M52 128 L66 108 L134 108 L148 128 L140 200 L60 200 Z', 'url(#rock)')
                  + P('M80 130 L96 150 L88 176 M122 124 L112 146 L124 168', 'none', 3)
                  + P('M52 128 Q70 116 84 124 L80 136 Q64 132 52 128 Z', 'url(#moss)', 3)),
        'head': (P('M58 60 L78 30 L122 30 L142 60 L136 106 L64 106 Z', 'url(#rock)')
                 + P('M70 34 Q90 22 104 30 L98 42 Q84 36 72 44 Z', 'url(#moss)', 3)
                 + eyes(glow='#62f5ff', y=74) + P('M84 94 L116 94', 'none', 4)),
        'armL': P('M40 132 L60 124 L64 176 L36 180 Z', 'url(#rock)') + R(30, 172, 34, 26, 8, 'url(#rock)', 4),
        'armR': P('M160 132 L140 124 L136 176 L164 180 Z', 'url(#rock)') + R(136, 172, 34, 26, 8, 'url(#rock)', 4),
    }, monster=True, pivots={'armL': (56, 128), 'armR': (144, 128), 'head': (100, 108), 'legL': (84, 196), 'legR': (116, 196)})

def imp():
    d = grad('wing', '#5a1b2a', '#240810')
    return rig(d, ('#ff6a4a', '#9a1f1a'), {
        'back': (P('M70 128 Q20 96 12 50 Q40 70 52 60 Q50 90 76 116 Z', 'url(#wing)') + P('M130 128 Q180 96 188 50 Q160 70 148 60 Q150 90 124 116 Z', 'url(#wing)')
                 + P('M120 196 Q170 214 176 176 Q182 170 186 180 Q180 226 118 210 Z', 'url(#skin)', 3.5)),
        'legL': leg('L', 'url(#skin)', '#3a0e14'), 'legR': leg('R', 'url(#skin)', '#3a0e14'),
        'torso': torso('url(#skin)'),
        'head': (ears('', pointy=True) + head('', cy=86, r=42)
                 + P('M70 52 Q58 26 66 6 Q76 30 88 44 Z', '#2a0a0e', 3.5) + P('M130 52 Q142 26 134 6 Q124 30 112 44 Z', '#2a0a0e', 3.5)
                 + eyes('#ffcf33', angry=True, y=90) + mouth('fangs', 108)),
        'armL': arm('L', 'url(#skin)', 'url(#skin)'),
        'armR': arm('R', 'url(#skin)', 'url(#skin)') + P('M134 172 L162 150 M138 178 L168 162 M140 184 L170 176', 'none', 3.5, 'stroke="#f2e6c8"'),
    }, monster=True)

def wraith():
    d = rgrad('ghost', '#d9c2ff', '#4b2a86', '50%', '35%', '80%') + grad('hood', '#3a2466', '#120a24')
    return rig(d, ('#d9c2ff', '#4b2a86'), {
        'back': '<ellipse cx="100" cy="130" rx="86" ry="100" fill="#8a5cff" fill-opacity=".14"/>',
        'torso': (P('M56 110 Q52 160 60 200 Q70 224 80 206 Q90 232 100 210 Q110 232 120 206 Q130 224 140 200 Q148 160 144 110 Z', 'url(#ghost)', 4, 'fill-opacity=".92"')
                  + P('M60 150 Q100 166 140 150', 'none', 4, 'stroke="#9aa1b3" stroke-dasharray="8 5"')),
        'head': (P('M44 104 Q36 22 100 18 Q164 22 156 104 Q146 132 100 132 Q54 132 44 104 Z', 'url(#hood)')
                 + E(100, 90, 38, 34, '#070410', 0) + eyes(glow='#c58bff', y=88)),
        'armL': P('M56 128 Q30 150 34 186 Q46 170 60 172 Z', 'url(#ghost)', 3.5),
        'armR': P('M144 128 Q170 150 166 186 Q154 170 140 172 Z', 'url(#ghost)', 3.5),
    }, monster=True, pivots={'armL': (58, 132), 'armR': (142, 132), 'head': (100, 126)})

def minotaur():
    d = grad('fur', '#8a3a2a', '#3a120c') + grad('horn', '#fffbea', '#b3a27a') + grad('plate', '#5f6772', '#23282f')
    return rig(d, ('#b5523a', '#5a1a10'), {
        'legL': leg('L', 'url(#fur)', '#1c0a06'), 'legR': leg('R', 'url(#fur)', '#1c0a06'),
        'torso': (P('M58 132 Q56 114 78 110 L122 110 Q144 114 142 132 L134 196 Q100 206 66 196 Z', 'url(#skin)')
                  + P('M66 132 L134 132 L130 160 L70 160 Z', 'url(#plate)', 3.5) + P('M70 176 Q100 186 130 176 L129 190 Q100 200 71 190 Z', '#2a120c', 3)),
        'head': (P('M58 60 Q16 52 8 14 Q34 34 60 36 Z', 'url(#horn)', 4) + P('M142 60 Q184 52 192 14 Q166 34 140 36 Z', 'url(#horn)', 4)
                 + ears('', pointy=True) + head('', cy=82, r=46)
                 + E(100, 108, 24, 16, '#c88a6a', 3.5) + C(92, 108, 3, O, 0) + C(108, 108, 3, O, 0)
                 + C(100, 124, 6, 'none', 3, 'stroke="#e8c35a"') + eyes(glow='#ff5a2a', y=80) + P('M68 66 L92 74 M132 66 L108 74', 'none', 5)),
        'armL': arm('L', 'url(#skin)', 'url(#skin)'),
        'armR': axe(156, 176, double=False) + arm('R', 'url(#skin)', 'url(#skin)'),
    }, monster=True, scale=1.08, pivots={'head': (100, 120)})

CHARACTERS = {
    'warrior': warrior, 'berserker': berserker, 'rogue': rogue, 'archer': archer,
    'mage': mage, 'necromancer': necromancer, 'paladin': paladin,
    'monster_normal': goblin, 'monster_armored': golem, 'monster_swift': imp,
    'monster_drain': wraith, 'monster_boss': minotaur,
}

if __name__ == '__main__':
    import json
    os.makedirs(OUT, exist_ok=True)
    rigs = {}
    for key, fn in CHARACTERS.items():
        r = fn()
        present = [p for p in PART_ORDER if r['parts'].get(p)]
        body = ''.join(r['parts'][p] for p in present)
        # combined portrait (previews, menus), monsters mirrored to face left
        open(os.path.join(OUT, key + '.svg'), 'w').write(
            svg_wrap(r['defs'], body, r['skin'], (400, 500), mirror=r['monster'], with_shadow=True, scale=r['scale']))
        os.makedirs(os.path.join(OUT, key), exist_ok=True)
        for p in present:
            open(os.path.join(OUT, key, p + '.svg'), 'w').write(
                svg_wrap(r['defs'], r['parts'][p], r['skin'], (200, 250), scale=r['scale']))
        sc = r['scale'] or 1
        piv = {k: [round(100 + (x - 100) * sc, 1), round(250 + (y - 250) * sc, 1)] for k, (x, y) in r['pivots'].items()}
        rigs[key] = {'parts': present, 'pivots': piv, 'monster': r['monster']}
    open(os.path.join(OUT, 'rigs.json'), 'w').write(json.dumps(rigs, indent=1))
    print('wrote', len(CHARACTERS), 'rigged characters to', os.path.abspath(OUT))
