"""Generates the board tiles: rune medallions, as SVG.

Each tile is a gold-rimmed dark stone medallion with a glowing, colored
emblem (sword / heart / shield / bolt / skull / plus). Vector art, so it's
crisp at every board size and every device pixel ratio, and tiny (~2 KB).
The emblem SHAPES differ per type, so the board still reads without color
(colorblind players); the colored inner glow is a second cue on top.

Writes assets/tiles/<type>.svg AND inlines each one into style.css as a
data: URI in the `.tile[data-type="..."] { background-image: ... }` rules -
inlining means a freshly built board never paints blank cells while 64 new
tile elements wait on image requests (a flash seen in live testing).

Run: python3 tools/make_tiles.py
"""
import os
import re
import urllib.parse

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets', 'tiles')

# type: (emblem light, emblem dark, glow color)
PALETTE = {
    'sword':    ('#ffffff', '#8fa3b8', '#ff6a3d'),
    'heart':    ('#ffc2d6', '#e8336f', '#ff4f8b'),
    'shield':   ('#bfe0ff', '#2f6fd6', '#3d9bff'),
    'energy':   ('#fff7b0', '#f0a400', '#ffd21f'),
    'skull':    ('#fbf6ea', '#b9ab8f', '#a970ff'),
    'teamheal': ('#c8ffdc', '#1fae5a', '#35e07c'),
}

OUTLINE = '#10131a'

EMBLEMS = {
    # Each emblem is drawn in a 100x100 box, centered, and filled with the
    # type's emblem gradient (url(#em)); extra detail layers follow.
    'sword': '''
      <g transform="rotate(45 50 50)" stroke="{o}" stroke-width="3" stroke-linejoin="round">
        <path d="M45 16 L50 5 L55 16 L55 62 L45 62 Z" fill="url(#em)"/>
        <path d="M50 9 L50 60" stroke="#ffffff" stroke-opacity=".7" stroke-width="2"/>
        <rect x="31" y="61" width="38" height="8" rx="4" fill="url(#gold)"/>
        <rect x="46" y="69" width="8" height="16" rx="2" fill="#7a4a24"/>
        <circle cx="50" cy="89" r="5.5" fill="url(#gold)"/>
      </g>''',
    'heart': '''
      <path d="M50 84 C20 64 10 47 16 31 C22 16 41 14 50 28 C59 14 78 16 84 31 C90 47 80 64 50 84Z"
            fill="url(#em)" stroke="{o}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M27 33 C29 25 36 22 42 26" stroke="#ffffff" stroke-opacity=".75" stroke-width="4" fill="none" stroke-linecap="round"/>''',
    'shield': '''
      <path d="M50 11 L80 22 L80 47 C80 67 66 79 50 88 C34 79 20 67 20 47 L20 22 Z"
            fill="url(#em)" stroke="{o}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M50 20 L71 28 L71 47 C71 61 62 70 50 77 Z" fill="#ffffff" fill-opacity=".22"/>
      <path d="M44 33 H56 V45 H66 V55 H56 V70 H44 V55 H34 V45 H44 Z" fill="#ffffff" fill-opacity=".85" stroke="{o}" stroke-width="2"/>''',
    'energy': '''
      <path d="M60 7 L25 56 L46 56 L39 93 L76 41 L55 41 Z"
            fill="url(#em)" stroke="{o}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M56 17 L36 47" stroke="#ffffff" stroke-opacity=".8" stroke-width="3" stroke-linecap="round"/>''',
    'skull': '''
      <path d="M50 12 C29 12 16 27 16 45 C16 58 23 65 30 69 L30 83 L70 83 L70 69 C77 65 84 58 84 45 C84 27 71 12 50 12Z"
            fill="url(#em)" stroke="{o}" stroke-width="3.5" stroke-linejoin="round"/>
      <g fill="{o}">
        <ellipse cx="37" cy="47" rx="9" ry="10"/><ellipse cx="63" cy="47" rx="9" ry="10"/>
        <path d="M50 58 L44 68 L56 68 Z"/>
        <rect x="39" y="74" width="3.5" height="9"/><rect x="48.25" y="74" width="3.5" height="9"/><rect x="57.5" y="74" width="3.5" height="9"/>
      </g>
      <circle cx="37" cy="47" r="3" fill="{glow}"/><circle cx="63" cy="47" r="3" fill="{glow}"/>
      <path d="M28 34 C31 25 38 21 45 21" stroke="#ffffff" stroke-opacity=".7" stroke-width="4" fill="none" stroke-linecap="round"/>''',
    'teamheal': '''
      <path d="M39 14 H61 V39 H86 V61 H61 V86 H39 V61 H14 V39 H39 Z"
            fill="url(#em)" stroke="{o}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M43 19 V41 H19" stroke="#ffffff" stroke-opacity=".7" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>''',
}


def tile_svg(kind):
    light, dark, glow = PALETTE[kind]
    emblem = EMBLEMS[kind].format(o=OUTLINE, glow=glow)
    rivets = ''.join(
        '<circle cx="%.2f" cy="%.2f" r="1.9" fill="#fff3c4" stroke="#5a3b08" stroke-width=".8"/>' % (
            50 + 42.6 * __import__('math').cos(a), 50 + 42.6 * __import__('math').sin(a))
        for a in [i * 3.14159265 / 4 + 3.14159265 / 8 for i in range(8)])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<defs>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff0b8"/><stop offset=".35" stop-color="#e2b54b"/><stop offset=".7" stop-color="#a8761c"/><stop offset="1" stop-color="#5b3a08"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe89a"/><stop offset="1" stop-color="#b07a16"/></linearGradient>
  <radialGradient id="stone" cx="42%" cy="35%" r="75%">
    <stop offset="0" stop-color="#56616d"/><stop offset=".6" stop-color="#2b333c"/><stop offset="1" stop-color="#151a20"/>
  </radialGradient>
  <radialGradient id="halo" cx="50%" cy="52%" r="50%">
    <stop offset="0" stop-color="{glow}" stop-opacity=".75"/><stop offset=".55" stop-color="{glow}" stop-opacity=".22"/><stop offset="1" stop-color="{glow}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="em" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{light}"/><stop offset="1" stop-color="{dark}"/></linearGradient>
  <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<circle cx="50" cy="52.5" r="46" fill="#000" fill-opacity=".45"/>
<circle cx="50" cy="50" r="46" fill="url(#rim)" stroke="#3a2504" stroke-width="1.5"/>
<circle cx="50" cy="50" r="42.6" fill="none" stroke="#fff6d0" stroke-opacity=".35" stroke-width="1"/>
{rivets}
<circle cx="50" cy="50" r="38.5" fill="url(#stone)" stroke="#120d05" stroke-width="2.2"/>
<circle cx="50" cy="50" r="38.5" fill="url(#halo)"/>
<circle cx="50" cy="50" r="33" fill="none" stroke="{glow}" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="3 4"/>
<g transform="translate(50 51) scale(.6) translate(-50 -50)">{emblem}</g>
<path d="M21 42 A30 30 0 0 1 56 14 A36 30 0 0 0 21 42Z" fill="url(#shine)"/>
</svg>'''


def data_uri(svg):
    compact = re.sub(r'\s+', ' ', svg).replace('> <', '><').strip()
    # '#', '%', '(', ')' and '"' must be percent-encoded: an unencoded '#'
    # ends a URL (fragment), and parens/quotes would end the CSS url("...").
    return 'data:image/svg+xml,' + urllib.parse.quote(compact, safe=" =:/,.-_';")


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        if old.endswith('.png'):
            os.remove(os.path.join(OUT, old))
    css_path = os.path.join(ROOT, 'style.css')
    css = open(css_path).read()
    for kind in PALETTE:
        svg = tile_svg(kind)
        open(os.path.join(OUT, kind + '.svg'), 'w').write(svg)
        uri = data_uri(svg)
        css, n = re.subn(r'(\.tile\[data-type="%s"\] \{ background-image: url\()[^)]*(\); \})' % kind,
                         lambda m: m.group(1) + '"' + uri + '"' + m.group(2), css, count=1)
        assert n == 1, kind
    open(css_path, 'w').write(css)
    print('wrote', len(PALETTE), 'rune tiles to', os.path.abspath(OUT), '+ inlined into style.css')
