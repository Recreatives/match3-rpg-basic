"""Generates the 16x16 pixel-art board tiles in assets/tiles/.

Hand-authored maps (no third-party art): each letter is a palette color,
'.' is transparent. A dark 1px outline is added automatically around every
shape so the tiles read on the board's dark background. Shapes are distinct
on their own (blade / heart / shield / bolt / skull / plus), so the board
still reads without color (colorblind players).

Run: python3 tools/make_tiles.py
"""
from PIL import Image
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'tiles')

PAL = {
    'w': (245, 248, 250), 's': (178, 190, 195), 'd': (99, 110, 114),   # steel light/mid/dark
    'g': (241, 196, 15), 'G': (183, 134, 11),                            # gold
    'b': (140, 90, 55), 'B': (95, 58, 35),                               # leather
    'r': (255, 77, 109), 'R': (196, 30, 70), 'p': (255, 170, 190),       # heart
    'u': (59, 130, 246), 'U': (29, 78, 180), 'l': (147, 197, 253),       # shield blue
    'y': (255, 221, 51), 'Y': (230, 160, 0), 'e': (255, 250, 200),       # energy
    'k': (20, 20, 28),                                                    # sockets
    'm': (230, 230, 220), 'M': (170, 170, 160),                           # bone
    'n': (46, 204, 113), 'N': (30, 140, 75), 'h': (170, 245, 200),        # team heal green
}
OUTLINE = (12, 14, 20, 255)

TILES = {
'sword': [
"................",
"............ww..",
"...........wws..",
"..........wwsd..",
".........wwsd...",
"........wwsd....",
".......wwsd.....",
"..g...wwsd......",
"..gg.wwsd.......",
"...ggwsd........",
"....Ggg.........",
"...bBGgg........",
"..bB...g........",
".bB.............",
"gg..............",
"gg..............",
],
'heart': [
"................",
"................",
"...RRR....RRR...",
"..RrrrR..RrrrR..",
".RrppprRRrrrrrR.",
".RrpprrrrrrrrrR.",
".RrprrrrrrrrrrR.",
".RrrrrrrrrrrrrR.",
"..RrrrrrrrrrrR..",
"...RrrrrrrrrR...",
"....RrrrrrrR....",
".....RrrrrR.....",
"......RrrR......",
".......RR.......",
"................",
"................",
],
'shield': [
"................",
"..UUUUUUUUUUUU..",
"..UllluuuuuuuU..",
"..UluuuuwwuuuU..",
"..UluuuuwwuuuU..",
"..UluuwwwwwwuU..",
"..UluuwwwwwwuU..",
"..UuuuuuwwuuuU..",
"..UuuuuuwwuuuU..",
"...UuuuuwwuuU...",
"...UuuuuuuuuU...",
"....UuuuuuuU....",
".....UuuuuU.....",
"......UuuU......",
".......UU.......",
"................",
],
'energy': [
"................",
".........YYYY...",
"........YyyyY...",
".......YyyyY....",
"......YyeyY.....",
".....YyeyY......",
"....YyeyyYYYY...",
"...YyyyyyyyyY...",
"...YYYYyyyeY....",
"......YyyeY.....",
".....YyyeY......",
"....YyyY........",
"...YyyY.........",
"...YyY..........",
"...YY...........",
"................",
],
'skull': [
"................",
"....MMMMMMMM....",
"...MmmmmmmmmM...",
"..MmmmmmmmmmmM..",
"..MmmmmmmmmmmM..",
"..MmkkkmmkkkmM..",
"..MmkkkmmkkkmM..",
"..MmkkkmmkkkmM..",
"..MmmmmkkmmmmM..",
"...MmmmkkmmmM...",
"....MmmmmmmM....",
"....MmkmkmkM....",
"....MmkmkmkM....",
".....MMMMMM.....",
"................",
"................",
],
'teamheal': [
"................",
"................",
"......NNNN......",
"......NhnN......",
"......NhnN......",
"......NnnN......",
"..NNNNNnnNNNNN..",
"..NhhhhnnnnnnN..",
"..NnnnnnnnnnnN..",
"..NNNNNnnNNNNN..",
"......NnnN......",
"......NnnN......",
"......NnnN......",
"......NNNN......",
"................",
"................",
],
}

def build(rows):
    assert len(rows) == 16 and all(len(r) == 16 for r in rows), rows
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '.':
                px[x, y] = PAL[ch] + (255,)
    # 1px dark outline around every opaque pixel (8-neighborhood)
    out = im.copy(); opx = out.load()
    for y in range(16):
        for x in range(16):
            if px[x, y][3]: continue
            if any(0 <= x + dx < 16 and 0 <= y + dy < 16 and px[x + dx, y + dy][3]
                   for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                opx[x, y] = OUTLINE
    return out

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, rows in TILES.items():
        build(rows).save(os.path.join(OUT, name + '.png'), optimize=True)
    print('wrote', len(TILES), 'tiles to', os.path.abspath(OUT))
