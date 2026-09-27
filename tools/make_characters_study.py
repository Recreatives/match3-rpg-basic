#!/usr/bin/env python3
"""Art-direction study: 'epic' characters in two proportion styles.

  A  epic realistic  - head ~1/6 of the body, thin lines, dark fantasy
  B  epic stylized   - head ~1/4, broad shoulders, bold lines (reads at
                       phone size)

Same designs in both (warrior, mage, minotaur boss) so only the style
differs. Output is rig-compatible with the game (graphics.js): per-part
SVGs + rigs.json in tools/character-study/<A|B>/, previewed by
tools/character-study.html next to the current art. Not used by the game.
"""
import os, json

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, 'character-study')
INK = '#0b0d12'

STYLES = {
    # hy/hr: head center/radius; sy/sw: shoulder y / half width; wy/ww: waist;
    # hipy/hipw: hips; fy: feet; hand: hand y; k: width multiplier; ol: outline
    'A': dict(hy=36, hr=13.5, neck=52, sy=64, sw=25, wy=112, ww=15, hipy=124, hipw=15, fy=238, hand=146, k=1.0, ol=2.2),
    'B': dict(hy=50, hr=21, neck=72, sy=84, sw=31, wy=136, ww=19, hipy=146, hipw=18, fy=238, hand=164, k=1.3, ol=3.2),
}


class Pen:
    def __init__(self, P):
        self.P = P

    def _s(self, sw=None, stroke=None):
        return f'stroke="{stroke or INK}" stroke-width="{self.P["ol"] if sw is None else sw}" stroke-linejoin="round" stroke-linecap="round"'

    def path(self, d, fill, sw=None, stroke=None, op=None):
        o = f' fill-opacity="{op}"' if op is not None else ''
        return f'<path d="{d}" fill="{fill}"{o} {self._s(sw, stroke)}/>'

    def flat(self, d, fill, op=1.0):  # no outline: shading / highlights
        return f'<path d="{d}" fill="{fill}" fill-opacity="{op}"/>'

    def line(self, d, color, w, op=1.0):
        return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-opacity="{op}" stroke-linecap="round" stroke-linejoin="round"/>'

    def circle(self, x, y, r, fill, sw=None, stroke=None):
        return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{fill}" {self._s(sw, stroke)}/>'

    def ell(self, x, y, rx, ry, fill, sw=None, op=None):
        o = f' fill-opacity="{op}"' if op is not None else ''
        return f'<ellipse cx="{x:.1f}" cy="{y:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{fill}"{o} {self._s(sw)}/>'

    def glow(self, x, y, r, color, op=0.45):
        return f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{color}" fill-opacity="{op}" filter="url(#blur)"/>'


def lin(gid, stops, x2=0, y2=1):
    s = ''.join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in stops)
    return f'<linearGradient id="{gid}" x1="0" y1="0" x2="{x2}" y2="{y2}">{s}</linearGradient>'


def rad(gid, inner, outer, cx='40%', cy='35%', r='70%'):
    return f'<radialGradient id="{gid}" cx="{cx}" cy="{cy}" r="{r}"><stop offset="0" stop-color="{inner}"/><stop offset="1" stop-color="{outer}"/></radialGradient>'


COMMON_DEFS = ('<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>'
               + lin('steel', [(0, '#eef2f6'), (.45, '#a9b4c0'), (1, '#3c4550')], 1, 1)
               + lin('steelD', [(0, '#8a96a3'), (1, '#262c34')], 1, 1)
               + lin('gold', [(0, '#fff0b0'), (.5, '#d4a84a'), (1, '#6e4a12')], 1, 1)
               + lin('leather', [(0, '#6b4a30'), (1, '#2a1a10')]))


# ------------------------------------------------------------ body pieces ---
def leg_shape(p, side, w_top=0.78, w_knee=0.62, w_ank=0.46):
    P = p.P
    sgn = -1 if side == 'L' else 1
    hx0 = 100 + sgn * P['hipw'] * 0.55
    spread = sgn * 5 * P['k']
    wt, wk, wa = P['hipw'] * w_top, P['hipw'] * w_knee, P['hipw'] * w_ank
    ky = (P['hipy'] + P['fy']) / 2 + 4
    top, ank = P['hipy'] - 6, P['fy'] - 18
    kx, cx = hx0 + spread * 0.5, hx0 + spread  # knee, ankle x
    # thigh bulges outward, calf swells below the knee
    d = (f'M{hx0-wt:.1f} {top} Q{hx0-wt-3:.1f} {(top+ky)/2:.1f} {kx-wk:.1f} {ky:.1f} Q{kx-wk-2:.1f} {ky+(ank-ky)*0.35:.1f} {cx-wa:.1f} {ank} '
         f'L{cx+wa:.1f} {ank} Q{kx+wk+2:.1f} {ky+(ank-ky)*0.35:.1f} {kx+wk:.1f} {ky:.1f} Q{hx0+wt+3:.1f} {(top+ky)/2:.1f} {hx0+wt:.1f} {top} Z')
    return cx, ky, ank, wk, wa, d


def boot(p, cx, wa, ank, fill):
    fy = p.P['fy']
    d = (f'M{cx-wa-2:.1f} {ank-8} L{cx-wa-3:.1f} {fy} L{cx+wa+11*p.P["k"]:.1f} {fy} '
         f'Q{cx+wa+11*p.P["k"]:.1f} {fy-9} {cx+wa+2:.1f} {fy-12} L{cx+wa+2:.1f} {ank-8} Z')
    return p.path(d, fill)


def plate_leg(p, side, thigh='url(#steel)', shin='url(#steel)'):
    cx, ky, ank, wk, wa, d = leg_shape(p, side)
    s = p.path(d, thigh)
    s += p.flat(f'M{cx+wk*0.2:.1f} {p.P["hipy"]} L{cx+wk:.1f} {ky:.1f} L{cx+wa:.1f} {ank} L{cx+wa*0.2:.1f} {ank} Z', '#000', .25)
    s += p.ell(cx - (2.5 if side == 'R' else -2.5) * p.P['k'], ky, wk * 1.05, wk * 0.85, 'url(#steel)')  # knee cop
    s += p.line(f'M{cx-wk*0.5:.1f} {ky+wk*2:.1f} L{cx+wk*0.5:.1f} {ky+wk*2:.1f}', INK, p.P['ol'] * 0.7, .6)
    s += boot(p, cx, wa, ank, 'url(#steelD)')
    return s


def cloth_leg(p, side, fill, bootfill='url(#leather)'):
    cx, ky, ank, wk, wa, d = leg_shape(p, side)
    s = p.path(d, fill)
    s += p.flat(f'M{cx+wk*0.2:.1f} {p.P["hipy"]} L{cx+wk:.1f} {ky:.1f} L{cx+wa:.1f} {ank} L{cx+wa*0.2:.1f} {ank} Z', '#000', .25)
    s += boot(p, cx, wa, ank, bootfill)
    return s


def torso_outline(p, sw_mul=1.0, ww_mul=1.0):
    P = p.P
    sw, ww, hw = P['sw'] * sw_mul, P['ww'] * ww_mul, P['hipw']
    sy, wy, hy = P['sy'], P['wy'], P['hipy']
    return (f'M{100-sw+5:.1f} {sy-7:.1f} Q100 {sy-15:.1f} {100+sw-5:.1f} {sy-7:.1f} L{100+sw:.1f} {sy+6:.1f} '
            f'Q{100+sw-1:.1f} {(sy+wy)/2:.1f} {100+ww:.1f} {wy} L{100+hw:.1f} {hy+6} Q100 {hy+12} {100-hw:.1f} {hy+6} '
            f'L{100-ww:.1f} {wy} Q{100-sw+1:.1f} {(sy+wy)/2:.1f} {100-sw:.1f} {sy+6:.1f} Z')


def arm_geom(p, side, reach=0.0):
    P = p.P
    sgn = -1 if side == 'L' else 1
    ax, ay = 100 + sgn * (P['sw'] - 4), P['sy'] + 2
    hx, hy = ax + sgn * (7 * P['k'] + reach), P['hand']
    ex, ey = ax + sgn * 5 * P['k'], (ay + hy) / 2
    return ax, ay, ex, ey, hx, hy, sgn


def limb(p, ax, ay, ex, ey, hx, hy, wu, we, ww, fill):
    # shoulder -> (bicep bulge) -> elbow -> (forearm swell) -> wrist
    def at(t):  # point along the arm's center line
        if t <= 0.5:
            u = t / 0.5
            return ax + (ex - ax) * u, ay + (ey - ay) * u
        u = (t - 0.5) / 0.5
        return ex + (hx - ex) * u, ey + (hy - 4 - ey) * u
    widths = [(0, wu), (0.25, wu * 1.08), (0.5, we * 0.85), (0.7, we * 1.02), (1, ww)]
    L = [(at(t)[0] - w, at(t)[1]) for t, w in widths]
    R = [(at(t)[0] + w, at(t)[1]) for t, w in widths]
    d = f'M{L[0][0]:.1f} {L[0][1]:.1f} '
    for i in range(1, 5):
        mx, my = (L[i - 1][0] + L[i][0]) / 2 - 0.6, (L[i - 1][1] + L[i][1]) / 2
        d += f'Q{L[i-1][0]:.1f} {L[i-1][1]:.1f} {mx:.1f} {my:.1f} ' if i > 1 else ''
    d += f'L{L[4][0]:.1f} {L[4][1]:.1f} L{R[4][0]:.1f} {R[4][1]:.1f} '
    for i in range(3, -1, -1):
        mx, my = (R[i + 1][0] + R[i][0]) / 2 + 0.6, (R[i + 1][1] + R[i][1]) / 2
        d += f'Q{R[i+1][0]:.1f} {R[i+1][1]:.1f} {mx:.1f} {my:.1f} ' if i < 3 else ''
    d += f'L{R[0][0]:.1f} {R[0][1]:.1f} Z'
    return p.path(d, fill)


def plate_arm(p, side, pauldron='url(#steel)'):
    P, k = p.P, p.P['k']
    ax, ay, ex, ey, hx, hy, sgn = arm_geom(p, side)
    s = limb(p, ax, ay, ex, ey, hx, hy, 7 * k, 6 * k, 5 * k, 'url(#steel)')
    s += p.ell(ex, ey, 5.5 * k, 4.5 * k, 'url(#steel)')  # elbow cop
    s += p.path(f'M{hx-6*k:.1f} {hy-16*k:.1f} L{hx+6*k:.1f} {hy-16*k:.1f} L{hx+5.5*k:.1f} {hy-3:.1f} L{hx-5.5*k:.1f} {hy-3:.1f} Z', 'url(#steelD)')  # gauntlet cuff
    s += p.circle(hx, hy + 1, 5.2 * k, 'url(#steelD)')  # fist
    # layered pauldron
    for i, r in enumerate([12, 10, 8]):
        yy = ay - 5 + i * 5 * k
        s += p.path(f'M{ax-r*k:.1f} {yy+3*k:.1f} Q{ax:.1f} {yy-8*k:.1f} {ax+r*k:.1f} {yy+3*k:.1f} Q{ax:.1f} {yy+1:.1f} {ax-r*k:.1f} {yy+3*k:.1f} Z', pauldron)
    s += p.flat(f'M{ax-9*k:.1f} {ay-4:.1f} Q{ax-2:.1f} {ay-11*k:.1f} {ax+4*k:.1f} {ay-8*k:.1f} Q{ax-2:.1f} {ay-5:.1f} {ax-9*k:.1f} {ay-4:.1f} Z', '#fff', .45)
    return s, hx, hy


def robe_arm(p, side, fill, skin='url(#skin)'):
    k = p.P['k']
    ax, ay, ex, ey, hx, hy, sgn = arm_geom(p, side)
    s = limb(p, ax, ay, ex, ey, hx, hy - 6, 7 * k, 7.5 * k, 8.5 * k, fill)
    # wide bell sleeve opening
    s += p.path(f'M{hx-9*k:.1f} {hy-12:.1f} L{hx+9*k:.1f} {hy-12:.1f} L{hx+11*k:.1f} {hy-1:.1f} L{hx-11*k:.1f} {hy-1:.1f} Z', fill)
    s += p.line(f'M{hx-11*k:.1f} {hy-1:.1f} L{hx+11*k:.1f} {hy-1:.1f}', '#d4a84a', 1.6 * k)
    s += p.circle(hx, hy + 3, 4.6 * k, skin)
    return s, hx, hy + 3


def rot(svg, deg, x, y):
    return f'<g transform="rotate({deg} {x:.1f} {y:.1f})">{svg}</g>'


# -------------------------------------------------------------- weapons ----
def longsword(p, hx, hy):
    k = p.P['k']
    L = 70 * (1.0 if k == 1 else 0.95)
    w = 3.4 * k
    s = p.path(f'M{hx-w:.1f} {hy-6:.1f} L{hx-w:.1f} {hy-6-L:.1f} L{hx:.1f} {hy-14-L:.1f} L{hx+w:.1f} {hy-6-L:.1f} L{hx+w:.1f} {hy-6:.1f} Z', 'url(#steel)')
    s += p.line(f'M{hx:.1f} {hy-10:.1f} L{hx:.1f} {hy-10-L:.1f}', '#ffffff', 1.1 * k, .7)  # fuller shine
    s += p.path(f'M{hx-12*k:.1f} {hy-9:.1f} Q{hx:.1f} {hy-4:.1f} {hx+12*k:.1f} {hy-9:.1f} L{hx+12*k:.1f} {hy-4:.1f} Q{hx:.1f} {hy+1:.1f} {hx-12*k:.1f} {hy-4:.1f} Z', 'url(#gold)')
    s += p.path(f'M{hx-2*k:.1f} {hy-4:.1f} L{hx+2*k:.1f} {hy-4:.1f} L{hx+2*k:.1f} {hy+9*k:.1f} L{hx-2*k:.1f} {hy+9*k:.1f} Z', '#3a2616')
    s += p.circle(hx, hy + 11 * k, 3 * k, 'url(#gold)')
    return s


def kite_shield(p, x, y):
    k = p.P['k']
    w, h = 17 * k, 30 * k
    d = f'M{x-w:.1f} {y-h*0.55:.1f} Q{x:.1f} {y-h*0.72:.1f} {x+w:.1f} {y-h*0.55:.1f} L{x+w*0.92:.1f} {y+h*0.1:.1f} Q{x+w*0.6:.1f} {y+h*0.7:.1f} {x:.1f} {y+h:.1f} Q{x-w*0.6:.1f} {y+h*0.7:.1f} {x-w*0.92:.1f} {y+h*0.1:.1f} Z'
    s = p.path(d, 'url(#shieldred)')
    s += p.path(d.replace('M', 'M', 1), 'none', p.P['ol'] * 1.6, '#c9a24a')
    # heraldic lion-ish emblem: a gold chevron + sun
    s += p.line(f'M{x-w*0.6:.1f} {y+h*0.05:.1f} L{x:.1f} {y-h*0.3:.1f} L{x+w*0.6:.1f} {y+h*0.05:.1f}', '#e8c35a', 3 * k)
    s += p.circle(x, y + h * 0.35, 4.5 * k, 'url(#gold)', 1.2)
    s += p.flat(f'M{x-w*0.8:.1f} {y-h*0.5:.1f} Q{x-w*0.3:.1f} {y-h*0.62:.1f} {x:.1f} {y-h*0.62:.1f} L{x-w*0.6:.1f} {y+h*0.3:.1f} Z', '#fff', .18)
    return s


def crystal_staff(p, hx, hy):
    k = p.P['k']
    top = hy - 96 * (1 if k == 1 else 0.9)
    s = p.path(f'M{hx-2.2*k:.1f} {hy+34*k:.1f} L{hx-2.6*k:.1f} {top+10:.1f} L{hx+2.6*k:.1f} {top+10:.1f} L{hx+2.2*k:.1f} {hy+34*k:.1f} Z', 'url(#wood)')
    # claw holding the crystal
    s += p.path(f'M{hx-8*k:.1f} {top+12:.1f} Q{hx-10*k:.1f} {top-2:.1f} {hx-4*k:.1f} {top-8*k:.1f} L{hx:.1f} {top+6:.1f} L{hx+4*k:.1f} {top-8*k:.1f} Q{hx+10*k:.1f} {top-2:.1f} {hx+8*k:.1f} {top+12:.1f} Z', 'url(#wood)')
    s += p.glow(hx, top - 2, 14 * k, '#5fd8ff', .7)
    s += p.path(f'M{hx:.1f} {top-16*k:.1f} L{hx+6*k:.1f} {top-3:.1f} L{hx:.1f} {top+8:.1f} L{hx-6*k:.1f} {top-3:.1f} Z', 'url(#crystal)', 1.4)
    s += p.flat(f'M{hx:.1f} {top-14*k:.1f} L{hx-4*k:.1f} {top-3:.1f} L{hx:.1f} {top-5:.1f} Z', '#fff', .8)
    return s


def great_axe(p, hx, hy):
    k = p.P['k']
    top = hy - 92 * (1 if k == 1 else 0.9)
    s = p.path(f'M{hx-2.8*k:.1f} {hy+26*k:.1f} L{hx-2.8*k:.1f} {top:.1f} L{hx+2.8*k:.1f} {top:.1f} L{hx+2.8*k:.1f} {hy+26*k:.1f} Z', 'url(#wood)')
    for sgn in (-1, 1):
        s += p.path(f'M{hx:.1f} {top+6:.1f} Q{hx+sgn*16*k:.1f} {top-6*k:.1f} {hx+sgn*26*k:.1f} {top-14*k:.1f} '
                    f'Q{hx+sgn*20*k:.1f} {top+12*k:.1f} {hx+sgn*26*k:.1f} {top+34*k:.1f} Q{hx+sgn*14*k:.1f} {top+22*k:.1f} {hx:.1f} {top+26*k:.1f} Z', 'url(#steel)')
        s += p.line(f'M{hx+sgn*25*k:.1f} {top-12*k:.1f} Q{hx+sgn*19*k:.1f} {top+12*k:.1f} {hx+sgn*25*k:.1f} {top+32*k:.1f}', '#ffffff', 1.3 * k, .8)
    s += p.path(f'M{hx-4*k:.1f} {top-4:.1f} L{hx:.1f} {top-14*k:.1f} L{hx+4*k:.1f} {top-4:.1f} Z', 'url(#steelD)')
    s += p.circle(hx, top + 14 * k, 3.4 * k, 'url(#gold)', 1.2)
    return s


# ------------------------------------------------------------ characters ---
def warrior(P):
    p = Pen(P)
    k = P['k']
    defs = (lin('tabard', [(0, '#b3261e'), (1, '#4a0c0c')]) + lin('cape', [(0, '#7a1616'), (1, '#240505')])
            + lin('shieldred', [(0, '#9c1f1a'), (1, '#3e0808')], 1, 1) + rad('visor', '#ffd27a', '#ff7a1a'))
    sy, fy = P['sy'], P['fy']
    back = p.path(f'M{100-P["sw"]+2:.1f} {sy-4:.1f} Q{100-P["sw"]*1.9:.1f} {(sy+fy)/2:.1f} {100-P["sw"]*1.35:.1f} {fy-4} '
                  f'L{100+P["sw"]*1.2:.1f} {fy-8} Q{100+P["sw"]*1.5:.1f} {(sy+fy)/2:.1f} {100+P["sw"]-2:.1f} {sy-4:.1f} Z', 'url(#cape)')
    back += p.line(f'M{100-P["sw"]*0.8:.1f} {sy+20} Q{100-P["sw"]*1.3:.1f} {(sy+fy)/2:.1f} {100-P["sw"]*1.05:.1f} {fy-8}', '#000', 2 * k, .35)
    back += p.line(f'M{100+P["sw"]*0.4:.1f} {sy+26} Q{100+P["sw"]*0.8:.1f} {(sy+fy)/2+10:.1f} {100+P["sw"]*0.7:.1f} {fy-10}', '#000', 2 * k, .3)

    t = p.path(torso_outline(p), 'url(#steel)')
    t += p.flat(f'M100 {sy-10} L{100+P["sw"]:.1f} {sy+6} Q{100+P["sw"]-1:.1f} {(sy+P["wy"])/2:.1f} {100+P["ww"]:.1f} {P["wy"]} L100 {P["wy"]} Z', '#000', .22)
    t += p.line(f'M100 {sy-8} L100 {P["wy"]-2}', INK, P['ol'] * 0.8, .7)  # breastplate ridge
    t += p.line(f'M{100-P["sw"]*0.7:.1f} {sy+10} Q100 {sy+22*k:.1f} {100+P["sw"]*0.7:.1f} {sy+10}', INK, P['ol'] * 0.6, .5)
    # tabard + belt
    wy, hy_, ww = P['wy'], P['hipy'], P['ww']
    t += p.path(f'M{100-ww+2:.1f} {wy+4} L{100+ww-2:.1f} {wy+4} L{100+ww-4:.1f} {hy_+46*k:.1f} L100 {hy_+54*k:.1f} L{100-ww+4:.1f} {hy_+46*k:.1f} Z', 'url(#tabard)')
    t += p.line(f'M{100-ww+4:.1f} {hy_+44*k:.1f} L100 {hy_+52*k:.1f} L{100+ww-4:.1f} {hy_+44*k:.1f}', '#c9a24a', 1.6 * k)
    t += p.path(f'M{100-ww-2:.1f} {wy-2} Q100 {wy+4} {100+ww+2:.1f} {wy-2} L{100+ww+2:.1f} {wy+6} Q100 {wy+12} {100-ww-2:.1f} {wy+6} Z', 'url(#leather)')
    t += p.path(f'M{96:.1f} {wy} L104 {wy} L104 {wy+8} L96 {wy+8} Z', 'url(#gold)', 1.2)
    t += p.path(f'M{100-7*k:.1f} {sy-6} L{100+7*k:.1f} {sy-6} L{100+6*k:.1f} {P["neck"]-2} L{100-6*k:.1f} {P["neck"]-2} Z', 'url(#steelD)')  # gorget

    # great helm with a glowing visor slit and a crest
    hx, hyy, r = 100, P['hy'], P['hr']
    h = p.path(f'M{hx-r:.1f} {hyy+r*0.9:.1f} L{hx-r*1.02:.1f} {hyy-r*0.2:.1f} Q{hx-r:.1f} {hyy-r*1.25:.1f} {hx:.1f} {hyy-r*1.3:.1f} '
               f'Q{hx+r:.1f} {hyy-r*1.25:.1f} {hx+r*1.08:.1f} {hyy-r*0.2:.1f} L{hx+r*1.02:.1f} {hyy+r*0.9:.1f} Q{hx:.1f} {hyy+r*1.25:.1f} {hx-r:.1f} {hyy+r*0.9:.1f} Z', 'url(#steel)')
    h += p.flat(f'M{hx+r*0.2:.1f} {hyy-r*1.2:.1f} Q{hx+r:.1f} {hyy-r:.1f} {hx+r*1.05:.1f} {hyy:.1f} L{hx+r:.1f} {hyy+r*0.9:.1f} Q{hx+r*0.5:.1f} {hyy+r:.1f} {hx+r*0.3:.1f} {hyy+r:.1f} Z', '#000', .22)
    h += p.glow(hx + r * 0.25, hyy - r * 0.05, r * 0.7, '#ff9a3a', .55)
    h += p.path(f'M{hx-r*0.75:.1f} {hyy-r*0.18:.1f} L{hx+r*0.95:.1f} {hyy-r*0.18:.1f} L{hx+r*0.95:.1f} {hyy+r*0.05:.1f} L{hx-r*0.75:.1f} {hyy+r*0.05:.1f} Z', 'url(#visor)', P['ol'] * 0.7)
    h += p.path(f'M{hx+r*0.05:.1f} {hyy+r*0.05:.1f} L{hx+r*0.2:.1f} {hyy+r*0.05:.1f} L{hx+r*0.2:.1f} {hyy+r*0.7:.1f} L{hx+r*0.05:.1f} {hyy+r*0.7:.1f} Z', '#1a1206', P['ol'] * 0.5)
    for i in range(3):  # breathing holes
        h += p.circle(hx + r * 0.55, hyy + r * (0.3 + i * 0.18), r * 0.05, INK, 0)
    h += p.line(f'M{hx-r*0.2:.1f} {hyy-r*1.28:.1f} L{hx-r*0.2:.1f} {hyy+r*1.1:.1f}', '#c9a24a', 1.4 * k, .9)
    # plume crest sweeping back
    h += p.path(f'M{hx-r*0.1:.1f} {hyy-r*1.28:.1f} Q{hx-r*0.9:.1f} {hyy-r*2.4:.1f} {hx-r*2.6:.1f} {hyy-r*1.1:.1f} '
                f'Q{hx-r*1.6:.1f} {hyy-r*1.2:.1f} {hx-r*1.3:.1f} {hyy-r*0.6:.1f} Q{hx-r*0.6:.1f} {hyy-r*1.3:.1f} {hx-r*0.1:.1f} {hyy-r*1.28:.1f} Z', 'url(#tabard)')

    armL, lx, ly = plate_arm(p, 'L')
    armL += kite_shield(p, lx - 2 * k, ly - 4 * k)
    armR_body, rx, ry = plate_arm(p, 'R')
    armR = rot(longsword(p, rx, ry), 24, rx, ry) + armR_body
    return defs, {'back': back, 'legL': plate_leg(p, 'L'), 'legR': plate_leg(p, 'R'), 'torso': t, 'head': h, 'armL': armL, 'armR': armR}


def mage(P):
    p = Pen(P)
    k = P['k']
    defs = (lin('robe', [(0, '#34438e'), (1, '#0f1330')]) + lin('robeD', [(0, '#222c66'), (1, '#090b1e')])
            + lin('wood', [(0, '#7a5230'), (1, '#2e1a0c')]) + lin('crystal', [(0, '#e9fdff'), (.5, '#5fd8ff'), (1, '#1a5aa8')], 1, 1)
            + rad('skin', '#e8c3a0', '#8a5a3c') + lin('beard', [(0, '#ffffff'), (1, '#a9a7b4')]))
    sy, fy, ww = P['sy'], P['fy'], P['ww']
    back = p.path(f'M{100-P["sw"]+3:.1f} {sy-4} Q{100-P["sw"]*1.6:.1f} {(sy+fy)/2:.1f} {100-P["sw"]*1.3:.1f} {fy-2} L{100+P["sw"]*1.1:.1f} {fy-2} Q{100+P["sw"]*1.3:.1f} {(sy+fy)/2:.1f} {100+P["sw"]-3:.1f} {sy-4} Z', 'url(#robeD)')
    # legs: only the boots peek out under the robe
    def bootonly(side):
        cx, ky, ank, wk, wa, d = leg_shape(p, side)
        return boot(p, cx, wa, ank, 'url(#leather)') + p.path(f'M{cx-wa:.1f} {ank-30} L{cx+wa:.1f} {ank-30} L{cx+wa:.1f} {ank-6} L{cx-wa:.1f} {ank-6} Z', 'url(#robeD)')
    # robe: torso widening to the floor
    t = p.path(f'M{100-P["sw"]+5:.1f} {sy-7} Q100 {sy-15} {100+P["sw"]-5:.1f} {sy-7} L{100+P["sw"]:.1f} {sy+6} '
               f'Q{100+ww+2:.1f} {P["wy"]:.1f} {100+ww*1.9:.1f} {fy-16} Q100 {fy-10} {100-ww*1.9:.1f} {fy-16} Q{100-ww-2:.1f} {P["wy"]:.1f} {100-P["sw"]:.1f} {sy+6} Z', 'url(#robe)')
    t += p.flat(f'M100 {sy-10} L{100+P["sw"]:.1f} {sy+6} Q{100+ww+2:.1f} {P["wy"]:.1f} {100+ww*1.9:.1f} {fy-16} L100 {fy-12} Z', '#000', .28)
    # gold rune trim down the front + hem
    t += p.line(f'M100 {sy+2} L100 {fy-12}', '#d4a84a', 2.4 * k)
    for i in range(4):
        y = P['wy'] + 12 + i * (fy - P['wy'] - 30) / 4
        t += p.path(f'M{100-3*k:.1f} {y:.1f} L100 {y-4*k:.1f} L{100+3*k:.1f} {y:.1f} L100 {y+4*k:.1f} Z', '#ffe08a', 0.8)
    t += p.line(f'M{100-ww*1.85:.1f} {fy-17} Q100 {fy-11} {100+ww*1.85:.1f} {fy-17}', '#d4a84a', 2.2 * k)
    t += p.path(f'M{100-ww-1:.1f} {P["wy"]-3} Q100 {P["wy"]+3} {100+ww+1:.1f} {P["wy"]-3} L{100+ww+1:.1f} {P["wy"]+4} Q100 {P["wy"]+10} {100-ww-1:.1f} {P["wy"]+4} Z', 'url(#leather)')
    t += p.glow(100 - ww * 0.6, P['wy'] + 12, 3 * k, '#5fd8ff', .9) + p.circle(100 - ww * 0.6, P['wy'] + 12, 2.2 * k, '#bff4ff', 0.8)
    # hooded head: shadowed face, glowing eyes, long beard
    hx, hyy, r = 100, P['hy'], P['hr']
    h = p.path(f'M{hx-r*1.25:.1f} {hyy+r*1.3:.1f} Q{hx-r*1.45:.1f} {hyy-r*0.6:.1f} {hx-r*0.2:.1f} {hyy-r*1.35:.1f} '
               f'Q{hx+r*0.4:.1f} {hyy-r*1.9:.1f} {hx+r*0.7:.1f} {hyy-r*2.3:.1f} Q{hx+r*1.2:.1f} {hyy-r*0.9:.1f} {hx+r*1.3:.1f} {hyy+r*1.3:.1f} Z', 'url(#robe)')
    h += p.path(f'M{hx-r*0.85:.1f} {hyy+r*1.05:.1f} Q{hx-r*0.95:.1f} {hyy-r*0.55:.1f} {hx+r*0.05:.1f} {hyy-r*0.8:.1f} Q{hx+r*1.0:.1f} {hyy-r*0.55:.1f} {hx+r*0.95:.1f} {hyy+r*1.05:.1f} Z', '#07080f', P['ol'] * 0.6)
    h += p.path(f'M{hx-r*0.5:.1f} {hyy+r*0.35:.1f} Q{hx:.1f} {hyy-r*0.1:.1f} {hx+r*0.6:.1f} {hyy+r*0.35:.1f} L{hx+r*0.55:.1f} {hyy+r*0.7:.1f} L{hx-r*0.45:.1f} {hyy+r*0.7:.1f} Z', 'url(#skin)', 0)
    for ex in (-0.35, 0.4):
        h += p.glow(hx + r * ex, hyy + r * 0.15, r * 0.35, '#5fd8ff', .8)
        h += p.path(f'M{hx+r*(ex-0.2):.1f} {hyy+r*0.15:.1f} L{hx+r*(ex+0.22):.1f} {hyy+r*0.08:.1f} L{hx+r*(ex+0.18):.1f} {hyy+r*0.22:.1f} Z', '#dffbff', 0)
    h += p.path(f'M{hx-r*0.55:.1f} {hyy+r*0.55:.1f} Q{hx:.1f} {hyy+r*0.8:.1f} {hx+r*0.65:.1f} {hyy+r*0.55:.1f} Q{hx+r*0.55:.1f} {hyy+r*1.9:.1f} {hx+r*0.05:.1f} {hyy+r*2.7:.1f} Q{hx-r*0.45:.1f} {hyy+r*1.9:.1f} {hx-r*0.55:.1f} {hyy+r*0.55:.1f} Z', 'url(#beard)')
    h += p.line(f'M{hx:.1f} {hyy+r*0.9:.1f} Q{hx+r*0.05:.1f} {hyy+r*1.7:.1f} {hx+r*0.02:.1f} {hyy+r*2.4:.1f}', '#8a889a', 1 * k, .8)
    armL, lx, ly = robe_arm(p, 'L', 'url(#robe)')
    armL += p.glow(lx, ly - 2, 8 * k, '#5fd8ff', .6)
    armR_body, rx, ry = robe_arm(p, 'R', 'url(#robe)')
    armR = rot(crystal_staff(p, rx, ry), 10, rx, ry) + armR_body
    return defs, {'back': back, 'legL': bootonly('L'), 'legR': bootonly('R'), 'torso': t, 'head': h, 'armL': armL, 'armR': armR}


def minotaur(P):
    P = dict(P, sw=P['sw'] * 1.25, ww=P['ww'] * 1.2, hipw=P['hipw'] * 1.15, hr=P['hr'] * 1.1)
    p = Pen(P)
    k = P['k']
    defs = (lin('fur', [(0, '#7a4428'), (1, '#2a120a')]) + rad('skin', '#9a5a3a', '#3a1a0e') + lin('horn', [(0, '#f4ead2'), (1, '#6e5a3a')], 1, 1)
            + lin('wood', [(0, '#5a3a22'), (1, '#1e1008')]) + lin('loin', [(0, '#3a3f46'), (1, '#121418')]))
    sy, fy = P['sy'], P['fy']
    back = p.path(f'M{100-P["sw"]*0.7:.1f} {sy-10} Q100 {sy-26*k:.1f} {100+P["sw"]*0.7:.1f} {sy-10} L{100+P["sw"]*0.5:.1f} {sy+12} L{100-P["sw"]*0.5:.1f} {sy+12} Z', 'url(#fur)')  # mane hump

    def hoof_leg(side):
        cx, ky, ank, wk, wa, d = leg_shape(p, side, 0.9, 0.7, 0.5)
        s = p.path(d, 'url(#fur)')
        s += p.flat(f'M{cx+wk*0.2:.1f} {P["hipy"]} L{cx+wk:.1f} {ky:.1f} L{cx+wa:.1f} {ank} L{cx+wa*0.2:.1f} {ank} Z', '#000', .28)
        s += p.line(f'M{cx-wk*0.6:.1f} {ky-10} l3 5 m4 -6 l3 5', INK, 1.2 * k, .5)
        s += p.path(f'M{cx-wa-3:.1f} {ank-2} L{cx+wa+6*k:.1f} {ank-2} L{cx+wa+8*k:.1f} {fy} L{cx-wa-4:.1f} {fy} Z', '#1a1410')  # hoof
        s += p.line(f'M{cx+1:.1f} {ank} L{cx+1:.1f} {fy}', '#000', 1.4, .6)
        return s
    t = p.path(torso_outline(p), 'url(#skin)')
    t += p.flat(f'M100 {sy-12} L{100+P["sw"]:.1f} {sy+6} Q{100+P["sw"]-1:.1f} {(sy+P["wy"])/2:.1f} {100+P["ww"]:.1f} {P["wy"]} L100 {P["wy"]} Z', '#000', .25)
    # muscles
    t += p.line(f'M{100-P["sw"]*0.75:.1f} {sy+14*k:.1f} Q{100-P["sw"]*0.3:.1f} {sy+22*k:.1f} 100 {sy+14*k:.1f} Q{100+P["sw"]*0.3:.1f} {sy+22*k:.1f} {100+P["sw"]*0.75:.1f} {sy+14*k:.1f}', INK, 1.4 * k, .55)
    for i in range(3):
        y = sy + 26 * k + i * 9 * k
        t += p.line(f'M{100-6*k:.1f} {y:.1f} L{100+6*k:.1f} {y:.1f}', INK, 1.1 * k, .4)
    t += p.line(f'M100 {sy+16*k:.1f} L100 {P["wy"]-2}', INK, 1.1 * k, .45)
    # cross strap with iron studs + belt + loincloth
    t += p.path(f'M{100-P["sw"]+4:.1f} {sy} L{100-P["sw"]+12*k:.1f} {sy-4} L{100+P["ww"]+2:.1f} {P["wy"]-2} L{100+P["ww"]-6:.1f} {P["wy"]+4} Z', 'url(#leather)')
    for i in range(3):
        f = (i + 1) / 4
        t += p.circle(100 - P['sw'] + 8 + (P['ww'] + P['sw'] - 8) * f, sy + (P['wy'] - sy) * f, 1.8 * k, '#8a8f96', 0.8)
    wy, ww, hy_ = P['wy'], P['ww'], P['hipy']
    t += p.path(f'M{100-ww-2:.1f} {wy-2} Q100 {wy+4} {100+ww+2:.1f} {wy-2} L{100+ww+2:.1f} {wy+7} Q100 {wy+13} {100-ww-2:.1f} {wy+7} Z', 'url(#leather)')
    t += p.path(f'M{100-ww+3:.1f} {wy+6} L{100+ww-3:.1f} {wy+6} L{100+ww-6:.1f} {hy_+36*k:.1f} L{100-ww+6:.1f} {hy_+36*k:.1f} Z', 'url(#loin)')
    t += p.circle(100, wy + 3, 4.2 * k, '#8a8f96')  # skull buckle
    # bull head: broad skull, thick crescent horns, heavy brow, big muzzle
    hx, hyy, r = 100, P['hy'], P['hr'] * 1.25
    h = ''
    for sgn in (-1, 1):
        h += p.path(f'M{hx+sgn*r*0.72:.1f} {hyy-r*0.66:.1f} Q{hx+sgn*r*2.1:.1f} {hyy-r*0.5:.1f} {hx+sgn*r*2.3:.1f} {hyy-r*1.3:.1f} '
                    f'Q{hx+sgn*r*1.6:.1f} {hyy-r*0.75:.1f} {hx+sgn*r*0.8:.1f} {hyy-r*0.18:.1f} Z', 'url(#horn)')
        h += p.line(f'M{hx+sgn*r*1.2:.1f} {hyy-r*0.62:.1f} l{sgn*r*0.12:.1f} {r*0.18:.1f} M{hx+sgn*r*1.55:.1f} {hyy-r*0.85:.1f} l{sgn*r*0.14:.1f} {r*0.12:.1f}', '#6e5a3a', 1.2 * k, .8)
        h += p.path(f'M{hx+sgn*r*0.85:.1f} {hyy-r*0.1:.1f} L{hx+sgn*r*1.5:.1f} {hyy-r*0.2:.1f} L{hx+sgn*r*1.0:.1f} {hyy+r*0.3:.1f} Z', 'url(#skin)')  # ears
    h += p.path(f'M{hx-r:.1f} {hyy-r*0.55:.1f} Q{hx:.1f} {hyy-r*1.2:.1f} {hx+r:.1f} {hyy-r*0.55:.1f} Q{hx+r*1.1:.1f} {hyy+r*0.2:.1f} {hx+r*0.72:.1f} {hyy+r*0.7:.1f} '
                f'L{hx+r*0.64:.1f} {hyy+r*1.3:.1f} Q{hx:.1f} {hyy+r*1.62:.1f} {hx-r*0.64:.1f} {hyy+r*1.3:.1f} L{hx-r*0.72:.1f} {hyy+r*0.7:.1f} Q{hx-r*1.1:.1f} {hyy+r*0.2:.1f} {hx-r:.1f} {hyy-r*0.55:.1f} Z', 'url(#skin)')
    h += p.flat(f'M{hx+r*0.1:.1f} {hyy-r*0.9:.1f} Q{hx+r*1.0:.1f} {hyy-r*0.5:.1f} {hx+r*0.72:.1f} {hyy+r*0.7:.1f} L{hx+r*0.64:.1f} {hyy+r*1.3:.1f} Q{hx+r*0.3:.1f} {hyy+r*1.5:.1f} {hx+r*0.2:.1f} {hyy+r*1.45:.1f} Z', '#000', .22)
    h += p.path(f'M{hx-r*0.55:.1f} {hyy-r*0.9:.1f} Q{hx:.1f} {hyy-r*1.35:.1f} {hx+r*0.55:.1f} {hyy-r*0.9:.1f} Q{hx:.1f} {hyy-r*0.55:.1f} {hx-r*0.55:.1f} {hyy-r*0.9:.1f} Z', 'url(#fur)', P['ol'] * 0.6)  # forelock
    h += p.ell(hx, hyy + r * 1.08, r * 0.6, r * 0.4, '#b07a5a')  # muzzle
    h += p.ell(hx - r * 0.24, hyy + r * 1.05, r * 0.11, r * 0.08, INK, 0) + p.ell(hx + r * 0.24, hyy + r * 1.05, r * 0.11, r * 0.08, INK, 0)
    h += f'<circle cx="{hx:.1f}" cy="{hyy+r*1.32:.1f}" r="{r*0.24:.1f}" fill="none" stroke="#d4a84a" stroke-width="{2.2*k:.1f}"/>'
    for ex in (-0.4, 0.4):
        h += p.glow(hx + r * ex, hyy + r * 0.2, r * 0.36, '#ff4a1a', .85)
        h += p.path(f'M{hx+r*(ex-0.18):.1f} {hyy+r*0.14:.1f} L{hx+r*(ex+0.2):.1f} {hyy+r*0.14:.1f} L{hx+r*ex:.1f} {hyy+r*0.3:.1f} Z', '#ffd27a', 0)
    h += p.path(f'M{hx-r*0.78:.1f} {hyy-r*0.05:.1f} Q{hx-r*0.3:.1f} {hyy+r*0.08:.1f} {hx:.1f} {hyy+r*0.22:.1f} Q{hx+r*0.3:.1f} {hyy+r*0.08:.1f} {hx+r*0.78:.1f} {hyy-r*0.05:.1f} L{hx+r*0.72:.1f} {hyy-r*0.22:.1f} Q{hx:.1f} {hyy-r*0.12:.1f} {hx-r*0.72:.1f} {hyy-r*0.22:.1f} Z', '#2a120a', 0)  # brow

    def brute_arm(side):
        ax, ay, ex, ey, hx2, hy2, sgn = arm_geom(p, side)
        s = limb(p, ax, ay, ex, ey, hx2, hy2, 9 * k, 7.5 * k, 6.5 * k, 'url(#skin)')
        s += p.flat(f'M{ax:.1f} {ay:.1f} L{ax+sgn*8*k:.1f} {ay+2:.1f} L{hx2+sgn*6*k:.1f} {hy2-6:.1f} L{hx2:.1f} {hy2-6:.1f} Z', '#000', .22)
        s += p.path(f'M{hx2-7*k:.1f} {hy2-18*k:.1f} L{hx2+7*k:.1f} {hy2-18*k:.1f} L{hx2+6.5*k:.1f} {hy2-5:.1f} L{hx2-6.5*k:.1f} {hy2-5:.1f} Z', 'url(#steelD)')  # iron bracer
        s += p.circle(hx2, hy2 + 1, 6.5 * k, 'url(#skin)')
        s += p.path(f'M{ax-11*k:.1f} {ay+4:.1f} Q{ax:.1f} {ay-11*k:.1f} {ax+11*k:.1f} {ay+4:.1f} Q{ax:.1f} {ay:.1f} {ax-11*k:.1f} {ay+4:.1f} Z', 'url(#steelD)')  # spiked pauldron
        s += p.path(f'M{ax-3*k:.1f} {ay-6*k:.1f} L{ax:.1f} {ay-15*k:.1f} L{ax+3*k:.1f} {ay-6*k:.1f} Z', 'url(#steel)', 1)
        return s, hx2, hy2
    armL, lx, ly = brute_arm('L')
    armL += p.line(f'M{lx:.1f} {ly+6:.1f} q-4 8 0 14 q4 6 0 12', '#8a8f96', 2.2 * k)  # hanging chain
    armR_body, rx, ry = brute_arm('R')
    armR = rot(great_axe(p, rx, ry), 20, rx, ry) + armR_body
    return defs, {'back': back, 'legL': hoof_leg('L'), 'legR': hoof_leg('R'), 'torso': t, 'head': h, 'armL': armL, 'armR': armR}


# ----------------------------------------------------------------- output ---
PART_ORDER = ['back', 'legL', 'legR', 'torso', 'head', 'armL', 'armR']
CHARS = {'warrior': (warrior, False, 1.0), 'mage': (mage, False, 1.0), 'monster_boss': (minotaur, True, 1.06)}


def pivots(P, key):
    if key == 'monster_boss':
        P = dict(P, sw=P['sw'] * 1.25, hipw=P['hipw'] * 1.15)
    return {'legL': [100 - P['hipw'] * 0.55, P['hipy'] - 2], 'legR': [100 + P['hipw'] * 0.55, P['hipy'] - 2],
            'torso': [100, P['hipy'] + 2], 'head': [100, P['neck']],
            'armL': [100 - P['sw'] + 4, P['sy'] + 2], 'armR': [100 + P['sw'] - 4, P['sy'] + 2]}


def wrap(defs, body, scale=1.0, mirror=False, size=(200, 250), shadow=False):
    inner = body
    if scale != 1.0:
        inner = f'<g transform="translate(100 250) scale({scale}) translate(-100 -250)">{inner}</g>'
    if mirror:
        inner = f'<g transform="translate(200 0) scale(-1 1)">{inner}</g>'
    sh = '<ellipse cx="100" cy="240" rx="56" ry="8" fill="#000" fill-opacity=".4"/>' if shadow else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250" width="{size[0]}" height="{size[1]}">'
            f'<defs>{COMMON_DEFS}{defs}</defs>{sh}{inner}</svg>')


if __name__ == '__main__':
    for style, P in STYLES.items():
        d = os.path.join(OUT, style)
        rigs = {}
        for key, (fn, monster, scale) in CHARS.items():
            defs, parts = fn(P)
            present = [n for n in PART_ORDER if parts.get(n)]
            open(os.path.join(d, key + '.svg') if os.path.isdir(d) else (os.makedirs(d, exist_ok=True) or os.path.join(d, key + '.svg')), 'w').write(
                wrap(defs, ''.join(parts[n] for n in present), scale, monster, (400, 500), True))
            os.makedirs(os.path.join(d, key), exist_ok=True)
            for n in present:
                open(os.path.join(d, key, n + '.svg'), 'w').write(wrap(defs, parts[n], scale))
            piv = {n: [round(100 + (x - 100) * scale, 1), round(250 + (y - 250) * scale, 1)] for n, (x, y) in pivots(P, key).items()}
            hand = [round(7 * P['k'] * scale, 1), round((P['hand'] - P['sy'] - 2) * scale, 1)]
            rigs[key] = {'parts': present, 'pivots': piv, 'monster': monster, 'hand': hand}
        open(os.path.join(d, 'rigs.json'), 'w').write(json.dumps(rigs, indent=1))
    print('wrote study to', os.path.abspath(OUT))
