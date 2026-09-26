"""Generates the board tiles as detailed SVG icons on colored medallions.

Each tile = a saturated medallion in the type's own hue (thin gold rim,
soft inner glow) carrying a semi-realistic painted-style icon: crossed
ornate steel swords with jeweled hilts, a faceted ruby heart, a riveted steel-and-blue heater shield
with a gold cross, a crackling lightning bolt, a shaded skull with glowing
sockets, and a green healing potion (co-op's teamheal). Colors AND shapes
differ per type, so the board reads at a glance and for colorblind players.

Vector, so crisp at every size / pixel ratio. Writes assets/tiles/<t>.svg
and inlines each into style.css as a data: URI (a new board never paints
blank cells waiting on image requests).

Run: python3 tools/make_tiles.py  (also: --preview writes tools/tiles-board.html)
"""
import math
import os
import re
import sys
import urllib.parse

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets', 'tiles')
INK = '#0d1016'

# medallion tint per type: (light, mid, dark). Hues are spread around the
# color wheel (pink-red, orange, yellow, green, blue, purple) and kept
# saturated, so every type reads by color alone at a glance - its icon
# shape is the second, colorblind-safe cue.
DISC = {
    'heart':    ('#ff5c8a', '#c4144a', '#4a0418'),
    'sword':    ('#ff9a3c', '#c2520a', '#4a1a02'),
    'energy':   ('#ffe24a', '#c79a00', '#4a3500'),
    'teamheal': ('#4fe88a', '#12994a', '#033a18'),
    'shield':   ('#4f9dff', '#1653c4', '#051c4a'),
    'skull':    ('#b77bff', '#6a2cc4', '#22074a'),
}
GLOW = {'sword': '#ffd08a', 'heart': '#ffb3c8', 'shield': '#b8dcff', 'energy': '#fff3a8', 'skull': '#e2c8ff', 'teamheal': '#bfffd6'}


def _blade(rot):
    """One ornate sword, pointing up-left/up-right after `rot` degrees."""
    return f'''
<g transform="rotate({rot} 50 50)">
  <path d="M50 0 L60 13 L60 60 L40 60 L40 13 Z" fill="{INK}"/>
  <path d="M50 3 L50 58 L42.5 58 L42.5 14 Z" fill="url(#bladeL)"/>
  <path d="M50 3 L57.5 14 L57.5 58 L50 58 Z" fill="url(#bladeR)"/>
  <path d="M50 12 L50 55" stroke="#2f3944" stroke-width="2.4"/>
  <path d="M50 12 L50 55" stroke="#aebbc8" stroke-width=".9"/>
  <path d="M45 15 L45 54" stroke="#ffffff" stroke-opacity=".95" stroke-width="1.4"/>
  <path d="M21 60 Q24 52 32 55 L44 57 Q50 53 56 57 L68 55 Q76 52 79 60 Q76 68 68 65 L56 63 Q50 67 44 63 L32 65 Q24 68 21 60 Z" fill="url(#gold)" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>
  <circle cx="22.5" cy="60" r="3" fill="url(#gem)" stroke="{INK}" stroke-width="1.2"/>
  <circle cx="77.5" cy="60" r="3" fill="url(#gem)" stroke="{INK}" stroke-width="1.2"/>
  <path d="M44 55 L50 49 L56 55 L50 61 Z" fill="url(#gem)" stroke="{INK}" stroke-width="1.6"/>
  <rect x="45" y="65" width="10" height="19" rx="2.5" fill="url(#grip)" stroke="{INK}" stroke-width="2.4"/>
  <path d="M45 69 L55 72 M45 74 L55 77 M45 79 L55 82" stroke="#2a1206" stroke-width="1.5"/>
  <path d="M43 86 Q50 82 57 86 L55 94 Q50 97 45 94 Z" fill="url(#gold)" stroke="{INK}" stroke-width="2.4" stroke-linejoin="round"/>
</g>'''


def icon_sword():
    # crossed pair of ornate swords + a glint where they cross
    return f'''
<defs>
  <linearGradient id="bladeL" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd9e3"/></linearGradient>
  <linearGradient id="bladeR" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#95a3b2"/><stop offset="1" stop-color="#5a6674"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b8"/><stop offset=".45" stop-color="#e8b43a"/><stop offset="1" stop-color="#8a5208"/></linearGradient>
  <linearGradient id="grip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9a5a2e"/><stop offset="1" stop-color="#4a2410"/></linearGradient>
  <radialGradient id="gem" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#bfe3ff"/><stop offset=".5" stop-color="#1f7ae0"/><stop offset="1" stop-color="#062a5a"/></radialGradient>
</defs>
<g transform="translate(50 50) scale(.92) translate(-50 -50)">
{_blade(-38)}
{_blade(38)}
</g>
<path d="M50 20 l2.6 7 7 2.6 -7 2.6 -2.6 7 -2.6 -7 -7 -2.6 7 -2.6Z" fill="#ffffff"/>'''


def icon_heart():
    # a faceted ruby: an outer heart plus facet polygons in varied tones
    return f'''
<defs>
  <radialGradient id="ruby" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#ff8aa6"/><stop offset=".45" stop-color="#e3143f"/><stop offset="1" stop-color="#6a0016"/></radialGradient>
</defs>
<path d="M50 90 C16 68 5 48 11 30 C17 12 40 10 50 25 C60 10 83 12 89 30 C95 48 84 68 50 90Z" fill="url(#ruby)" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<g stroke="#5a0012" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round">
  <path d="M50 25 L36 40 L50 55 L64 40 Z" fill="#ff5c7c" fill-opacity=".55"/>
  <path d="M36 40 L19 34 L22 52 Z" fill="#ff9fb3" fill-opacity=".5"/>
  <path d="M64 40 L81 34 L78 52 Z" fill="#b8002a" fill-opacity=".45"/>
  <path d="M36 40 L22 52 L50 55 Z" fill="#f02a56" fill-opacity=".4"/>
  <path d="M64 40 L78 52 L50 55 Z" fill="#9a0022" fill-opacity=".45"/>
  <path d="M22 52 L50 86 L50 55 Z" fill="#c8002e" fill-opacity=".35"/>
  <path d="M78 52 L50 86 L50 55 Z" fill="#7a0018" fill-opacity=".45"/>
</g>
<path d="M20 30 Q24 19 35 18" stroke="#fff" stroke-opacity=".9" stroke-width="3.2" fill="none" stroke-linecap="round"/>
<path d="M66 20 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z" fill="#fff" fill-opacity=".95"/>'''


def icon_shield():
    rivets = ''.join(f'<circle cx="{x}" cy="{y}" r="2.1" fill="#f4f6f8" stroke="{INK}" stroke-width="1.1"/>'
                     for x, y in [(22, 22), (78, 22), (20, 46), (80, 46), (34, 74), (66, 74)])
    return f'''
<defs>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2f5f8"/><stop offset=".5" stop-color="#9aa6b3"/><stop offset="1" stop-color="#4a5460"/></linearGradient>
  <linearGradient id="field" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f9bff"/><stop offset=".6" stop-color="#1a4fb8"/><stop offset="1" stop-color="#0a2466"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".5" stop-color="#e2b23e"/><stop offset="1" stop-color="#8a5a0e"/></linearGradient>
</defs>
<path d="M50 6 L86 18 L86 46 C86 70 70 84 50 94 C30 84 14 70 14 46 L14 18 Z" fill="url(#rim)" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M50 14 L78 24 L78 46 C78 65 65 77 50 85 C35 77 22 65 22 46 L22 24 Z" fill="url(#field)" stroke="{INK}" stroke-width="2"/>
<path d="M50 14 L78 24 L78 46 C78 65 65 77 50 85 Z" fill="#000" fill-opacity=".18"/>
<path d="M44 24 H56 V40 H70 V52 H56 V76 H44 V52 H30 V40 H44 Z" fill="url(#gold)" stroke="{INK}" stroke-width="2.2" stroke-linejoin="round"/>
<path d="M46 26 V40 M32 42 H44" stroke="#fff" stroke-opacity=".75" stroke-width="1.6"/>
{rivets}
<path d="M26 26 Q34 20 46 18" stroke="#fff" stroke-opacity=".7" stroke-width="2.4" fill="none" stroke-linecap="round"/>'''


def icon_energy():
    return f'''
<defs>
  <linearGradient id="bolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#fff27a"/><stop offset="1" stop-color="#ff9a00"/></linearGradient>
  <radialGradient id="aura"><stop offset="0" stop-color="#ffe45a" stop-opacity=".75"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient>
</defs>
<circle cx="50" cy="50" r="42" fill="url(#aura)"/>
<path d="M20 30 L28 36 L24 40 M78 62 L86 66 L80 72 M72 18 L78 12 M22 76 L16 82" stroke="#fff6b0" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M62 4 L22 58 L46 58 L37 96 L80 38 L56 38 Z" fill="url(#bolt)" stroke="{INK}" stroke-width="3.6" stroke-linejoin="round"/>
<path d="M58 12 L32 52 L44 52" stroke="#ffffff" stroke-width="2.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M56 38 L80 38 L50 80" stroke="#c46800" stroke-opacity=".6" stroke-width="2" fill="none"/>'''


def icon_skull():
    return f'''
<defs>
  <radialGradient id="bone" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#fffdf5"/><stop offset=".6" stop-color="#e2d6bb"/><stop offset="1" stop-color="#9c8a68"/></radialGradient>
  <radialGradient id="socket" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#e3c6ff"/><stop offset=".35" stop-color="#9b4dff"/><stop offset="1" stop-color="#140820"/></radialGradient>
</defs>
<path d="M50 8 C26 8 12 25 12 45 C12 59 19 67 28 71 L28 86 Q28 92 34 92 L66 92 Q72 92 72 86 L72 71 C81 67 88 59 88 45 C88 25 74 8 50 8Z" fill="url(#bone)" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M50 8 C74 8 88 25 88 45 C88 59 81 67 72 71 L72 86 Q72 92 66 92 L60 92 Q72 60 50 8Z" fill="#6a5a3e" fill-opacity=".22"/>
<path d="M30 52 Q36 34 46 44 Q46 60 34 60 Q28 58 30 52Z" fill="url(#socket)" stroke="{INK}" stroke-width="2.4"/>
<path d="M70 52 Q64 34 54 44 Q54 60 66 60 Q72 58 70 52Z" fill="url(#socket)" stroke="{INK}" stroke-width="2.4"/>
<path d="M50 60 L44 72 Q50 75 56 72 Z" fill="#2a1d10" stroke="{INK}" stroke-width="1.8" stroke-linejoin="round"/>
<path d="M34 80 H66 M38 76 V92 M44 76 V92 M50 76 V92 M56 76 V92 M62 76 V92" stroke="{INK}" stroke-width="2" stroke-opacity=".85"/>
<path d="M60 12 L56 22 L61 27 L57 34" stroke="#5a4a30" stroke-width="1.6" fill="none"/>
<path d="M24 34 Q30 18 44 14" stroke="#fff" stroke-opacity=".85" stroke-width="3" fill="none" stroke-linecap="round"/>'''


def icon_teamheal():
    # a green healing potion (co-op teammate heal)
    return f'''
<defs>
  <linearGradient id="liquid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9dffc2"/><stop offset=".5" stop-color="#1fcf64"/><stop offset="1" stop-color="#067a34"/></linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity=".5"/><stop offset=".4" stop-color="#ffffff" stop-opacity=".08"/><stop offset="1" stop-color="#ffffff" stop-opacity=".25"/></linearGradient>
  <linearGradient id="cork" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a36a"/><stop offset="1" stop-color="#7a4a22"/></linearGradient>
</defs>
<path d="M40 22 L40 36 Q16 46 16 66 Q16 92 50 92 Q84 92 84 66 Q84 46 60 36 L60 22 Z" fill="#dff7ea" fill-opacity=".25" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>
<path d="M19 62 Q34 54 50 62 Q66 70 81 62 Q84 90 50 90 Q16 90 19 62Z" fill="url(#liquid)"/>
<circle cx="38" cy="74" r="3" fill="#dfffe9" fill-opacity=".8"/><circle cx="58" cy="80" r="2" fill="#dfffe9" fill-opacity=".8"/><circle cx="50" cy="68" r="1.6" fill="#dfffe9" fill-opacity=".8"/>
<path d="M40 22 L40 36 Q16 46 16 66 Q16 92 50 92 Q84 92 84 66 Q84 46 60 36 L60 22 Z" fill="url(#glass)"/>
<rect x="36" y="10" width="28" height="14" rx="4" fill="url(#cork)" stroke="{INK}" stroke-width="3"/>
<path d="M44 58 H56 M50 52 V64" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
<path d="M24 58 Q26 48 36 42" stroke="#fff" stroke-opacity=".85" stroke-width="3" fill="none" stroke-linecap="round"/>'''


ICONS = {'sword': icon_sword, 'heart': icon_heart, 'shield': icon_shield,
         'energy': icon_energy, 'skull': icon_skull, 'teamheal': icon_teamheal}


def tile_svg(kind):
    l, m, d = DISC[kind]
    glow = GLOW[kind]
    icon = ICONS[kind]()
    # icon defs must be unique per document; each icon only uses its own ids
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs>
  <radialGradient id="disc" cx="45%" cy="38%" r="70%"><stop offset="0" stop-color="{l}"/><stop offset=".6" stop-color="{m}"/><stop offset="1" stop-color="{d}"/></radialGradient>
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffeaa0"/><stop offset=".5" stop-color="#b8892c"/><stop offset="1" stop-color="#4a2f06"/></linearGradient>
  <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="{glow}" stop-opacity=".45"/><stop offset="1" stop-color="{glow}" stop-opacity="0"/></radialGradient>
</defs>
<circle cx="50" cy="52" r="47" fill="#000" fill-opacity=".45"/>
<circle cx="50" cy="50" r="47" fill="url(#ring)"/>
<circle cx="50" cy="50" r="44" fill="url(#disc)" stroke="#0a0c10" stroke-width="1.5"/>
<circle cx="50" cy="50" r="40" fill="url(#halo)"/>
<g transform="translate(50 50) scale(.84) translate(-50 -50)">{icon}</g>
</svg>'''


def data_uri(svg):
    compact = re.sub(r'\s+', ' ', svg).replace('> <', '><').strip()
    # '#', '%', '(', ')' and '"' must be percent-encoded: an unencoded '#'
    # ends a URL (fragment), and parens/quotes would end the CSS url("...").
    return 'data:image/svg+xml,' + urllib.parse.quote(compact, safe=" =:/,.-_';")


def write_preview():
    import random
    rnd = random.Random(7)
    kinds = list(ICONS)
    cells = ''.join(f'<img src="../assets/tiles/{rnd.choice(kinds[:5] if rnd.random() > .12 else kinds)}.svg">' for _ in range(64))
    html = f'''<!doctype html><html><head><meta charset="utf-8"><title>Taş tahtası</title><style>
body{{margin:0;background:#0e141b;padding:12px;font:14px sans-serif;color:#dde}}
.b{{display:grid;grid-template-columns:repeat(8,var(--t));background:radial-gradient(ellipse at 50% 35%,#3e5568,#34495e 60%,#29394a);border:4px solid #1a252f;border-radius:8px;width:max-content;padding:2px;margin-bottom:12px}}
.b img{{width:var(--t);height:var(--t);display:block}}</style></head><body>
<div>Telefon boyutu (40px)</div><div class="b" style="--t:40px">{cells}</div>
<div>Büyük (64px)</div><div class="b" style="--t:64px">{cells}</div></body></html>'''
    open(os.path.join(ROOT, 'tools', 'tiles-board.html'), 'w').write(html)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        if old.endswith('.png'):
            os.remove(os.path.join(OUT, old))
    for kind in ICONS:
        open(os.path.join(OUT, kind + '.svg'), 'w').write(tile_svg(kind))
    if '--preview' in sys.argv:
        write_preview()
        print('wrote tools/tiles-board.html')
        sys.exit(0)
    css_path = os.path.join(ROOT, 'style.css')
    css = open(css_path).read()
    for kind in ICONS:
        uri = data_uri(tile_svg(kind))
        css, n = re.subn(r'(\.tile\[data-type="%s"\] \{ background-image: url\()[^)]*(\); \})' % kind,
                         lambda m: m.group(1) + '"' + uri + '"' + m.group(2), css, count=1)
        assert n == 1, kind
    open(css_path, 'w').write(css)
    print('wrote', len(ICONS), 'tiles to', os.path.abspath(OUT), '+ inlined into style.css')
