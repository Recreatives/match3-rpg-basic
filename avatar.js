// --- AVATARS: layered, procedurally painted characters (style C) ------------------
// A hero is data - body type + gender + appearance + equipped items - and
// this file paints it as the same seven jointed parts the combat arena
// animates (back, legL, legR, torso, head, armL, armR). Every item is its
// own layer on the part it belongs to (a helmet on the head, a cuirass on
// the torso with sleeves on the arms, greaves on the legs, a shield on the
// off-hand arm...), drawn from the skeleton's measurements, so any item on
// any body lines up and moves with the animation without a hand-drawn
// image per combination. The inventory icon of an item is painted by the
// same code (avItemIcon), so the bag shows exactly what the hero wears.
//
// Art direction "style C" (see tools/character-study.html): head ~1/5 of
// the body, medium outline, dark-fantasy palette, stern faces.
// Coordinates: a 200x250 box, feet at y=238, facing right.

const AV_INK = '#0b0d12';
const AV_BASE = { hy: 43, hr: 17, neck: 62, sy: 74, sw: 28, wy: 124, ww: 17, hipy: 135, hipw: 16.5, fy: 238, hand: 155, k: 1.15, ol: 2.7 };
const AV_BODIES = {
    heavy_m: { sw: 31, ww: 19, hipw: 17.5, k: 1.22 },
    heavy_f: { sw: 26.5, ww: 14.5, hipw: 18, k: 1.08, hy: 45, hr: 16.5, female: true },
    agile_m: { sw: 27, ww: 16, hipw: 16, k: 1.08 },
    agile_f: { sw: 23.5, ww: 13, hipw: 16.5, k: 1.0, hy: 45, hr: 16.5, female: true },
    robed_m: { sw: 26.5, ww: 16, hipw: 16, k: 1.06 },
    robed_f: { sw: 23.5, ww: 13, hipw: 16.5, k: 1.0, hy: 45, hr: 16.5, female: true },
};
const AV_CLASS_BODY = { warrior: 'heavy', paladin: 'heavy', berserker: 'heavy', rogue: 'agile', archer: 'agile', mage: 'robed', necromancer: 'robed' };
const AV_SKINS = [['#f3d2b3', '#b98460'], ['#e8b98f', '#a86e46'], ['#c98c5e', '#7a4a2a'], ['#9a6440', '#56321c'], ['#6e4428', '#3a2010']];
const AV_HAIR_COLORS = ['#1f1b1a', '#4a2e1a', '#8a3a1c', '#c9a060', '#e6e2da', '#9a2418'];
const AV_HAIR = { m: ['short', 'long', 'topknot', 'shaved'], f: ['long', 'braid', 'bun', 'bob'] };
const AV_BEARDS = ['none', 'stubble', 'full', 'braided'];

// --- small helpers --------------------------------------------------------------
const avN = v => Math.round(v * 10) / 10;
function avHex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function avMix(c, t, amt) {
    const a = avHex(c), b = avHex(t);
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amt).toString(16).padStart(2, '0')).join('');
}
const avLight = (c, a) => avMix(c, '#ffffff', a);
const avDark = (c, a) => avMix(c, '#000000', a);

// One painting session: a pen bound to the body's proportions plus the
// gradient definitions the drawing needed (collected, then emitted in <defs>).
function avSession(P) {
    const defs = {};
    const st = (sw, stroke) => `stroke="${stroke || AV_INK}" stroke-width="${sw === undefined || sw === null ? P.ol : sw}" stroke-linejoin="round" stroke-linecap="round"`;
    const S = {
        P,
        lin(c1, c2, diag) {
            const id = 'g' + (c1 + c2 + (diag ? 'd' : 'v')).replace(/#/g, '');
            if (!defs[id]) defs[id] = `<linearGradient id="${id}" x1="0" y1="0" x2="${diag ? 1 : 0}" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
            return `url(#${id})`;
        },
        metal(c) {
            const id = 'm' + c.replace('#', '');
            if (!defs[id]) defs[id] = `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${avLight(c, 0.75)}"/><stop offset=".45" stop-color="${c}"/><stop offset="1" stop-color="${avDark(c, 0.6)}"/></linearGradient>`;
            return `url(#${id})`;
        },
        cloth(c) { return S.lin(avLight(c, 0.12), avDark(c, 0.45)); },
        skin(sk) { return S.radial(sk[0], sk[1]); },
        radial(c1, c2) {
            const id = 'r' + (c1 + c2).replace(/#/g, '');
            if (!defs[id]) defs[id] = `<radialGradient id="${id}" cx="40%" cy="32%" r="75%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>`;
            return `url(#${id})`;
        },
        path: (d, fill, sw, stroke) => `<path d="${d}" fill="${fill}" ${st(sw, stroke)}/>`,
        flat: (d, fill, op) => `<path d="${d}" fill="${fill}" fill-opacity="${op === undefined ? 1 : op}"/>`,
        line: (d, color, w, op) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${avN(w)}" stroke-opacity="${op === undefined ? 1 : op}" stroke-linecap="round" stroke-linejoin="round"/>`,
        circle: (x, y, r, fill, sw) => `<circle cx="${avN(x)}" cy="${avN(y)}" r="${avN(r)}" fill="${fill}" ${st(sw)}/>`,
        ell: (x, y, rx, ry, fill, sw) => `<ellipse cx="${avN(x)}" cy="${avN(y)}" rx="${avN(rx)}" ry="${avN(ry)}" fill="${fill}" ${st(sw)}/>`,
        glow: (x, y, r, color, op) => `<circle cx="${avN(x)}" cy="${avN(y)}" r="${avN(r)}" fill="${color}" fill-opacity="${op === undefined ? 0.45 : op}" filter="url(#avblur)"/>`,
        rot: (svg, deg, x, y) => `<g transform="rotate(${deg} ${avN(x)} ${avN(y)})">${svg}</g>`,
        defs: () => '<filter id="avblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>' + Object.values(defs).join(''),
    };
    return S;
}

function avGeom(bodyKey) { return Object.assign({}, AV_BASE, AV_BODIES[bodyKey] || {}); }

// --- skeleton geometry ------------------------------------------------------------
function avLeg(P, side, wTop, wKnee, wAnk) {
    const sgn = side === 'L' ? -1 : 1;
    // fighting stance: front (right) foot forward, back foot set behind
    const hx0 = 100 + sgn * P.hipw * 0.55, spread = (side === 'L' ? -7 : 9) * P.k;
    const wt = P.hipw * (wTop || 0.78), wk = P.hipw * (wKnee || 0.62), wa = P.hipw * (wAnk || 0.46);
    const ky = (P.hipy + P.fy) / 2 + 4, top = P.hipy - 6, ank = P.fy - 18;
    const kx = hx0 + spread * 0.5, cx = hx0 + spread;
    const d = `M${avN(hx0 - wt)} ${top} Q${avN(hx0 - wt - 3)} ${avN((top + ky) / 2)} ${avN(kx - wk)} ${avN(ky)} Q${avN(kx - wk - 2)} ${avN(ky + (ank - ky) * 0.35)} ${avN(cx - wa)} ${ank} ` +
        `L${avN(cx + wa)} ${ank} Q${avN(kx + wk + 2)} ${avN(ky + (ank - ky) * 0.35)} ${avN(kx + wk)} ${avN(ky)} Q${avN(hx0 + wt + 3)} ${avN((top + ky) / 2)} ${avN(hx0 + wt)} ${top} Z`;
    return { sgn, hx0, kx, cx, ky, top, ank, wt, wk, wa, d };
}

function avTorsoPath(P, grow) {
    const g = grow || 0;
    const sw = P.sw + g, ww = P.ww + g, hw = P.hipw + g, sy = P.sy - g * 0.5, wy = P.wy, hy = P.hipy;
    if (P.female) {
        return `M${avN(100 - sw + 5)} ${avN(sy - 7)} Q100 ${avN(sy - 14)} ${avN(100 + sw - 5)} ${avN(sy - 7)} L${avN(100 + sw)} ${avN(sy + 5)} ` +
            `Q${avN(100 + sw + 1)} ${avN(sy + 20)} ${avN(100 + ww + 3)} ${avN(sy + 30)} Q${avN(100 + ww - 1)} ${avN(wy - 6)} ${avN(100 + ww)} ${wy} ` +
            `Q${avN(100 + hw + 4)} ${avN((wy + hy) / 2)} ${avN(100 + hw + 1)} ${hy + 6} Q100 ${hy + 12} ${avN(100 - hw - 1)} ${hy + 6} ` +
            `Q${avN(100 - hw - 4)} ${avN((wy + hy) / 2)} ${avN(100 - ww)} ${wy} Q${avN(100 - ww + 1)} ${avN(wy - 6)} ${avN(100 - ww - 3)} ${avN(sy + 30)} ` +
            `Q${avN(100 - sw - 1)} ${avN(sy + 20)} ${avN(100 - sw)} ${avN(sy + 5)} Z`;
    }
    return `M${avN(100 - sw + 5)} ${avN(sy - 7)} Q100 ${avN(sy - 15)} ${avN(100 + sw - 5)} ${avN(sy - 7)} L${avN(100 + sw)} ${avN(sy + 6)} ` +
        `Q${avN(100 + sw - 1)} ${avN((sy + wy) / 2)} ${avN(100 + ww)} ${wy} L${avN(100 + hw)} ${hy + 6} Q100 ${hy + 12} ${avN(100 - hw)} ${hy + 6} ` +
        `L${avN(100 - ww)} ${wy} Q${avN(100 - sw + 1)} ${avN((sy + wy) / 2)} ${avN(100 - sw)} ${avN(sy + 6)} Z`;
}

// Arm poses, as (upper arm, forearm) angles from hanging straight down,
// positive = toward the enemy (+x). A fighter never stands with its arms
// dangling: the weapon hand is up and ready, a shield is held across the
// body, a bow is held out at chest height with an arrow on the string.
const AV_ARM_POSES = {
    hang: [4, 6], ready: [8, 46], guard: [12, 84], bowhold: [62, 74], nock: [-22, 100], staff: [10, 40], hold: [16, 30], cast: [16, 92],
};
function avArm(P, side) {
    const sgn = side === 'L' ? -1 : 1;
    const ax = 100 + sgn * (P.sw - 4), ay = P.sy + 2;
    const pose = (P.armPose && P.armPose[side]) || 'hang';
    const [a1, a2] = AV_ARM_POSES[pose] || AV_ARM_POSES.hang;
    const len = (P.hand - ay) / 2;
    const r1 = a1 * Math.PI / 180, r2 = a2 * Math.PI / 180;
    // a hanging arm splays a little outward instead
    const out = pose === 'hang' ? sgn : 1;
    const ex = ax + out * Math.sin(r1) * len + (pose === 'hang' ? sgn * 2 * P.k : 0), ey = ay + Math.cos(r1) * len;
    const hx = ex + out * Math.sin(r2) * len + (pose === 'hang' ? sgn * 2 * P.k : 0), hy = ey + Math.cos(r2) * len;
    const dx = hx - ex, dy = hy - ey, dl = Math.hypot(dx, dy) || 1;
    return { sgn, pose, ax, ay, ex, ey, hx, hy, wx: hx - dx / dl * 4, wy: hy - dy / dl * 4, fdx: dx / dl, fdy: dy / dl };
}

// center line of the limb at t (0 shoulder, 0.5 elbow, 1 wrist)
function avLimbAt(A, t) {
    return t <= 0.5 ? [A.ax + (A.ex - A.ax) * t / 0.5, A.ay + (A.ey - A.ay) * t / 0.5]
        : [A.ex + (A.wx - A.ex) * (t - 0.5) / 0.5, A.ey + (A.wy - A.ey) * (t - 0.5) / 0.5];
}
function avLimbWidth(wu, we, ww, t) {
    const W = [[0, wu], [0.25, wu * 1.08], [0.5, we * 0.85], [0.7, we * 1.02], [1, ww]];
    for (let i = 1; i < W.length; i++) if (t <= W[i][0]) { const u = (t - W[i - 1][0]) / (W[i][0] - W[i - 1][0]); return W[i - 1][1] + (W[i][1] - W[i - 1][1]) * u; }
    return ww;
}
// a muscular limb: shoulder -> bicep -> elbow -> forearm -> wrist, its
// width laid out perpendicular to the bone (so a bent arm stays solid).
// `from`/`to` (0..1) draw only a section (a sleeve, a glove cuff).
function avLimbPath(A, wu, we, ww, from, to) {
    const a = from || 0, b = to === undefined ? 1 : to, n = 10;
    const Lp = [], Rp = [];
    for (let i = 0; i <= n; i++) {
        const t = a + (b - a) * i / n, [x, y] = avLimbAt(A, t);
        const [x2, y2] = avLimbAt(A, Math.min(1, t + 0.02)), [x1, y1] = avLimbAt(A, Math.max(0, t - 0.02));
        let tx = x2 - x1, ty = y2 - y1; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const w = avLimbWidth(wu, we, ww, t);
        Lp.push([x + ty * w, y - tx * w]); Rp.push([x - ty * w, y + tx * w]);
    }
    let d = `M${avN(Lp[0][0])} ${avN(Lp[0][1])}`;
    for (let i = 1; i <= n; i++) d += ` L${avN(Lp[i][0])} ${avN(Lp[i][1])}`;
    for (let i = n; i >= 0; i--) d += ` L${avN(Rp[i][0])} ${avN(Rp[i][1])}`;
    return d + ' Z';
}
// a line straight across the limb at the wrist (cuff trims)
function avWristLine(A, w) {
    const nx = -A.fdy, ny = A.fdx;
    return `M${avN(A.wx + nx * w)} ${avN(A.wy + ny * w)} L${avN(A.wx - nx * w)} ${avN(A.wy - ny * w)}`;
}

// --- body, face, hair ---------------------------------------------------------------
function avFace(S, look) {
    const P = S.P, hx = 100, hy = P.hy, r = P.hr, f = P.female;
    const skin = AV_SKINS[look.skin || 0];
    let s = '';
    // ears behind the head
    s += S.ell(hx - r * 0.9, hy + r * 0.15, r * 0.18, r * 0.28, S.skin(skin), P.ol * 0.7) + S.ell(hx + r * 0.95, hy + r * 0.15, r * 0.16, r * 0.26, S.skin(skin), P.ol * 0.7);
    const jaw = f ? 0.38 : 0.48, chin = f ? 1.08 : 1.12;
    s += S.path(`M${avN(hx - r * 0.9)} ${avN(hy - r * 0.2)} Q${avN(hx - r * 0.95)} ${avN(hy - r * 1.05)} ${hx} ${avN(hy - r * 1.08)} Q${avN(hx + r * 0.97)} ${avN(hy - r * 1.05)} ${avN(hx + r * 0.94)} ${avN(hy - r * 0.2)} ` +
        `Q${avN(hx + r * 0.9)} ${avN(hy + r * 0.6)} ${avN(hx + r * jaw)} ${avN(hy + r * 0.95)} Q${avN(hx + r * 0.05)} ${avN(hy + r * chin)} ${avN(hx - r * jaw)} ${avN(hy + r * 0.95)} Q${avN(hx - r * 0.9)} ${avN(hy + r * 0.6)} ${avN(hx - r * 0.9)} ${avN(hy - r * 0.2)} Z`, S.skin(skin));
    s += S.flat(`M${avN(hx + r * 0.35)} ${avN(hy - r * 0.9)} Q${avN(hx + r)} ${avN(hy - r * 0.5)} ${avN(hx + r * 0.9)} ${avN(hy + r * 0.5)} Q${avN(hx + r * 0.6)} ${avN(hy + r)} ${avN(hx + r * 0.3)} ${avN(hy + r)} Q${avN(hx + r * 0.7)} ${avN(hy + r * 0.3)} ${avN(hx + r * 0.35)} ${avN(hy - r * 0.9)} Z`, '#000', 0.14);
    // eyes (turned a little toward the right), stern brows
    const ey = hy + r * 0.08;
    [-0.3, 0.46].forEach(o => {
        const x = hx + r * o, w = r * 0.19;
        s += S.path(`M${avN(x - w)} ${avN(ey)} Q${avN(x)} ${avN(ey - r * 0.13)} ${avN(x + w)} ${avN(ey)} Q${avN(x)} ${avN(ey + r * 0.1)} ${avN(x - w)} ${avN(ey)} Z`, '#f4efe6', P.ol * 0.45);
        s += S.circle(x + r * 0.04, ey, r * 0.075, look.eyeColor || '#3a2a1c', 0);
        if (f) s += S.line(`M${avN(x + w)} ${avN(ey)} l${avN(r * 0.08)} ${avN(-r * 0.08)}`, AV_INK, P.ol * 0.5);
        const b = f ? `M${avN(x - w)} ${avN(ey - r * 0.2)} Q${avN(x)} ${avN(ey - r * 0.3)} ${avN(x + w * 1.1)} ${avN(ey - r * 0.2)}`
            : `M${avN(x - w * 1.2)} ${avN(ey - r * (o < 0 ? 0.28 : 0.2))} L${avN(x + w * 1.1)} ${avN(ey - r * (o < 0 ? 0.2 : 0.28))}`;
        s += S.line(b, AV_HAIR_COLORS[look.hairColor || 0] === '#e6e2da' ? '#8a8578' : AV_INK, f ? P.ol * 0.55 : P.ol * 0.95);
    });
    s += S.line(`M${avN(hx + r * 0.14)} ${avN(hy + r * 0.12)} L${avN(hx + r * 0.24)} ${avN(hy + r * 0.45)} L${avN(hx + r * 0.06)} ${avN(hy + r * 0.5)}`, avDark(skin[1], 0.35), P.ol * 0.5);
    s += f ? S.path(`M${avN(hx - r * 0.12)} ${avN(hy + r * 0.72)} Q${avN(hx + r * 0.1)} ${avN(hy + r * 0.66)} ${avN(hx + r * 0.3)} ${avN(hy + r * 0.72)} Q${avN(hx + r * 0.1)} ${avN(hy + r * 0.82)} ${avN(hx - r * 0.12)} ${avN(hy + r * 0.72)} Z`, '#a85a52', P.ol * 0.35)
        : S.line(`M${avN(hx - r * 0.16)} ${avN(hy + r * 0.72)} Q${avN(hx + r * 0.06)} ${avN(hy + r * 0.68)} ${avN(hx + r * 0.3)} ${avN(hy + r * 0.74)}`, avDark(skin[1], 0.4), P.ol * 0.6);
    return s;
}

function avHairBack(S, look) {
    const P = S.P, hx = 100, hy = P.hy, r = P.hr, c = AV_HAIR_COLORS[look.hairColor || 0], fill = S.lin(avLight(c, 0.15), avDark(c, 0.35));
    const style = look.hair;
    if (style === 'long' && !P.female) return S.path(`M${avN(hx - r)} ${avN(hy - r * 0.5)} Q${avN(hx - r * 1.2)} ${avN(hy + r * 0.8)} ${avN(hx - r * 1.05)} ${avN(hy + r * 1.7)} L${avN(hx + r * 1.0)} ${avN(hy + r * 1.6)} Q${avN(hx + r * 1.15)} ${avN(hy + r * 0.7)} ${avN(hx + r)} ${avN(hy - r * 0.5)} Z`, fill);
    if (style === 'long') return S.path(`M${avN(hx - r)} ${avN(hy - r * 0.5)} Q${avN(hx - r * 1.35)} ${avN(hy + r)} ${avN(hx - r * 1.2)} ${avN(hy + r * 2.4)} Q${avN(hx)} ${avN(hy + r * 2.7)} ${avN(hx + r * 1.15)} ${avN(hy + r * 2.3)} Q${avN(hx + r * 1.3)} ${avN(hy + r)} ${avN(hx + r)} ${avN(hy - r * 0.5)} Z`, fill);
    if (style === 'bob') return S.path(`M${avN(hx - r)} ${avN(hy - r * 0.5)} Q${avN(hx - r * 1.25)} ${avN(hy + r * 0.6)} ${avN(hx - r * 1.05)} ${avN(hy + r * 1.05)} L${avN(hx + r * 1.05)} ${avN(hy + r * 1.0)} Q${avN(hx + r * 1.2)} ${avN(hy + r * 0.5)} ${avN(hx + r)} ${avN(hy - r * 0.5)} Z`, fill);
    if (style === 'braid') {
        let s = '';
        for (let i = 0; i < 6; i++) s += S.ell(hx - r * 0.95 + i * 0.4, hy + r * (0.6 + i * 0.36), r * (0.26 - i * 0.02), r * 0.22, fill, P.ol * 0.6);
        return s + S.circle(hx - r * 0.95 + 2.4, hy + r * 2.75, r * 0.12, '#b08a3a', P.ol * 0.5);
    }
    if (style === 'bun') return S.circle(hx - r * 0.55, hy - r * 0.95, r * 0.42, fill);
    if (style === 'topknot') return S.circle(hx - r * 0.2, hy - r * 1.2, r * 0.3, fill) + S.path(`M${avN(hx - r * 0.35)} ${avN(hy - r * 1.02)} L${avN(hx - r * 0.05)} ${avN(hy - r * 1.02)}`, 'none', P.ol * 1.4, '#8a2a1a');
    return '';
}

function avHairFront(S, look) {
    const P = S.P, hx = 100, hy = P.hy, r = P.hr, c = AV_HAIR_COLORS[look.hairColor || 0], fill = S.lin(avLight(c, 0.2), avDark(c, 0.3));
    if (look.hair === 'shaved') return S.flat(`M${avN(hx - r * 0.9)} ${avN(hy - r * 0.3)} Q${avN(hx - r * 0.95)} ${avN(hy - r * 1.05)} ${hx} ${avN(hy - r * 1.08)} Q${avN(hx + r * 0.97)} ${avN(hy - r * 1.05)} ${avN(hx + r * 0.94)} ${avN(hy - r * 0.3)} Q${hx} ${avN(hy - r * 0.8)} ${avN(hx - r * 0.9)} ${avN(hy - r * 0.3)} Z`, c, 0.25);
    const fringe = P.female
        ? `Q${avN(hx + r * 0.9)} ${avN(hy - r * 0.55)} ${avN(hx + r * 0.2)} ${avN(hy - r * 0.62)} Q${avN(hx - r * 0.5)} ${avN(hy - r * 0.45)} ${avN(hx - r * 0.98)} ${avN(hy + r * 0.3)}`
        : `Q${avN(hx + r * 0.7)} ${avN(hy - r * 0.72)} ${avN(hx + r * 0.1)} ${avN(hy - r * 0.7)} Q${avN(hx - r * 0.6)} ${avN(hy - r * 0.7)} ${avN(hx - r * 0.97)} ${avN(hy - r * 0.1)}`;
    return S.path(`M${avN(hx - r * 0.97)} ${avN(hy - r * 0.1)} Q${avN(hx - r * 1.08)} ${avN(hy - r * 1.22)} ${hx} ${avN(hy - r * 1.24)} Q${avN(hx + r * 1.08)} ${avN(hy - r * 1.2)} ${avN(hx + r * 0.97)} ${avN(hy - r * 0.15)} ${fringe} Z`, fill);
}

function avBeard(S, look) {
    if (S.P.female || !look.beard || look.beard === 'none') return '';
    const P = S.P, hx = 100, hy = P.hy, r = P.hr, c = AV_HAIR_COLORS[look.hairColor || 0];
    if (look.beard === 'stubble') return S.flat(`M${avN(hx - r * 0.9)} ${avN(hy + r * 0.3)} Q${avN(hx - r * 0.8)} ${avN(hy + r * 1.1)} ${avN(hx + r * 0.05)} ${avN(hy + r * 1.14)} Q${avN(hx + r * 0.9)} ${avN(hy + r * 1.05)} ${avN(hx + r * 0.94)} ${avN(hy + r * 0.3)} Q${avN(hx + r * 0.6)} ${avN(hy + r * 0.85)} ${hx} ${avN(hy + r * 0.85)} Q${avN(hx - r * 0.6)} ${avN(hy + r * 0.85)} ${avN(hx - r * 0.9)} ${avN(hy + r * 0.3)} Z`, c, 0.45);
    const fill = S.lin(avLight(c, 0.15), avDark(c, 0.3));
    let s = S.path(`M${avN(hx - r * 0.92)} ${avN(hy + r * 0.2)} Q${avN(hx - r * 0.95)} ${avN(hy + r * 1.3)} ${avN(hx + r * 0.05)} ${avN(hy + r * 1.55)} Q${avN(hx + r * 1.0)} ${avN(hy + r * 1.25)} ${avN(hx + r * 0.96)} ${avN(hy + r * 0.2)} Q${avN(hx + r * 0.7)} ${avN(hy + r * 0.62)} ${avN(hx + r * 0.08)} ${avN(hy + r * 0.62)} Q${avN(hx - r * 0.6)} ${avN(hy + r * 0.62)} ${avN(hx - r * 0.92)} ${avN(hy + r * 0.2)} Z`, fill, P.ol * 0.8);
    s += S.line(`M${avN(hx - r * 0.12)} ${avN(hy + r * 0.74)} Q${avN(hx + r * 0.08)} ${avN(hy + r * 0.7)} ${avN(hx + r * 0.3)} ${avN(hy + r * 0.76)}`, AV_INK, P.ol * 0.5);
    if (look.beard === 'braided') {
        for (let i = 0; i < 3; i++) s += S.ell(hx + r * 0.05, hy + r * (1.6 + i * 0.32), r * 0.16, r * 0.18, fill, P.ol * 0.55);
        s += S.circle(hx + r * 0.05, hy + r * 2.5, r * 0.1, '#b08a3a', P.ol * 0.5);
    }
    return s;
}

// --- ITEM PAINTERS ------------------------------------------------------------------
// An item: { slot, style, tier (1 plain, 2 trimmed, 3 ornate), color (main),
// trim, glow (optional color) }. Each painter returns layers keyed by part.

function avTrimLine(S, d, item, w) { return item.tier >= 2 ? S.line(d, item.trim || '#c9a24a', w) : ''; }
function avGem(S, x, y, r, item) {
    if (item.tier < 3) return '';
    const c = item.glow || '#e83a3a';
    return S.glow(x, y, r * 2.2, c, 0.6) + S.path(`M${avN(x)} ${avN(y - r)} L${avN(x + r)} ${avN(y)} L${avN(x)} ${avN(y + r)} L${avN(x - r)} ${avN(y)} Z`, S.lin(avLight(c, 0.5), avDark(c, 0.3)), S.P.ol * 0.45);
}

const AV_PAINT = {
    // ---- head ----
    helmet(S, it) {
        const P = S.P, hx = 100, hy = P.hy, r = P.hr, k = P.k, out = { head: '' };
        const main = it.style === 'hood' || it.style === 'cowl' ? S.cloth(it.color) : S.metal(it.color);
        if (it.style === 'greathelm' || it.style === 'horned') {
            let s = S.path(`M${avN(hx - r * 1.02)} ${avN(hy + r * 0.95)} L${avN(hx - r * 1.05)} ${avN(hy - r * 0.2)} Q${avN(hx - r * 1.02)} ${avN(hy - r * 1.28)} ${hx} ${avN(hy - r * 1.32)} Q${avN(hx + r * 1.05)} ${avN(hy - r * 1.28)} ${avN(hx + r * 1.1)} ${avN(hy - r * 0.2)} L${avN(hx + r * 1.05)} ${avN(hy + r * 0.95)} Q${hx} ${avN(hy + r * 1.3)} ${avN(hx - r * 1.02)} ${avN(hy + r * 0.95)} Z`, main);
            s += S.flat(`M${avN(hx + r * 0.2)} ${avN(hy - r * 1.2)} Q${avN(hx + r)} ${avN(hy - r)} ${avN(hx + r * 1.07)} ${avN(hy)} L${avN(hx + r * 1.02)} ${avN(hy + r * 0.92)} Q${avN(hx + r * 0.5)} ${avN(hy + r * 1.05)} ${avN(hx + r * 0.3)} ${avN(hy + r * 1.05)} Z`, '#000', 0.22);
            const eyeC = it.glow || '#ffb45a';
            s += S.glow(hx + r * 0.25, hy, r * 0.7, eyeC, 0.5);
            s += S.path(`M${avN(hx - r * 0.75)} ${avN(hy - r * 0.16)} L${avN(hx + r * 0.95)} ${avN(hy - r * 0.16)} L${avN(hx + r * 0.95)} ${avN(hy + r * 0.06)} L${avN(hx - r * 0.75)} ${avN(hy + r * 0.06)} Z`, S.radial(avLight(eyeC, 0.5), eyeC), P.ol * 0.7);
            s += S.path(`M${avN(hx + r * 0.05)} ${avN(hy + r * 0.06)} L${avN(hx + r * 0.2)} ${avN(hy + r * 0.06)} L${avN(hx + r * 0.2)} ${avN(hy + r * 0.7)} L${avN(hx + r * 0.05)} ${avN(hy + r * 0.7)} Z`, '#120d06', P.ol * 0.45);
            s += avTrimLine(S, `M${avN(hx - r * 0.2)} ${avN(hy - r * 1.3)} L${avN(hx - r * 0.2)} ${avN(hy + r * 1.1)}`, it, 1.5 * k);
            s += avTrimLine(S, `M${avN(hx - r * 1.02)} ${avN(hy + r * 0.9)} Q${hx} ${avN(hy + r * 1.24)} ${avN(hx + r * 1.05)} ${avN(hy + r * 0.9)}`, it, 1.6 * k);
            if (it.style === 'horned') {
                [-1, 1].forEach(sg => { s = S.path(`M${avN(hx + sg * r * 0.8)} ${avN(hy - r * 0.7)} Q${avN(hx + sg * r * 1.9)} ${avN(hy - r * 0.8)} ${avN(hx + sg * r * 1.85)} ${avN(hy - r * 2.1)} Q${avN(hx + sg * r * 1.35)} ${avN(hy - r * 1.1)} ${avN(hx + sg * r * 0.85)} ${avN(hy - r * 0.25)} Z`, S.lin('#f4ead2', '#6e5a3a', true)) + s; });
            } else if (it.tier >= 2) {
                s = S.path(`M${avN(hx - r * 0.1)} ${avN(hy - r * 1.28)} Q${avN(hx - r * 0.9)} ${avN(hy - r * 2.3)} ${avN(hx - r * 2.4)} ${avN(hy - r * 1.1)} Q${avN(hx - r * 1.5)} ${avN(hy - r * 1.2)} ${avN(hx - r * 1.2)} ${avN(hy - r * 0.6)} Q${avN(hx - r * 0.6)} ${avN(hy - r * 1.3)} ${avN(hx - r * 0.1)} ${avN(hy - r * 1.28)} Z`, S.cloth(it.plume || '#b3261e')) + s;
            }
            s += avGem(S, hx - r * 0.2, hy - r * 0.9, r * 0.14, it);
            out.head = s; out.hidesFace = true; out.hidesHair = true;
        } else if (it.style === 'nasal') {
            let s = S.path(`M${avN(hx - r * 1.02)} ${avN(hy + r * 0.05)} Q${avN(hx - r * 1.05)} ${avN(hy - r * 1.3)} ${hx} ${avN(hy - r * 1.32)} Q${avN(hx + r * 1.08)} ${avN(hy - r * 1.3)} ${avN(hx + r * 1.02)} ${avN(hy + r * 0.05)} L${avN(hx + r * 0.8)} ${avN(hy - r * 0.2)} Q${hx} ${avN(hy - r * 0.55)} ${avN(hx - r * 0.8)} ${avN(hy - r * 0.2)} Z`, main);
            s += S.path(`M${avN(hx + r * 0.1)} ${avN(hy - r * 0.45)} L${avN(hx + r * 0.3)} ${avN(hy - r * 0.45)} L${avN(hx + r * 0.26)} ${avN(hy + r * 0.45)} L${avN(hx + r * 0.14)} ${avN(hy + r * 0.45)} Z`, main, P.ol * 0.6);
            s += avTrimLine(S, `M${avN(hx - r * 0.9)} ${avN(hy - r * 0.3)} Q${hx} ${avN(hy - r * 0.62)} ${avN(hx + r * 0.9)} ${avN(hy - r * 0.3)}`, it, 1.5 * k);
            s += avGem(S, hx, hy - r * 0.95, r * 0.13, it);
            out.head = s; out.hidesHair = true;
        } else if (it.style === 'hood') {
            const tip = it.tier >= 2 ? 2.2 : 1.6;
            let back = S.path(`M${avN(hx - r * 1.3)} ${avN(hy + r * 1.35)} Q${avN(hx - r * 1.5)} ${avN(hy - r * 0.6)} ${avN(hx - r * 0.2)} ${avN(hy - r * 1.4)} Q${avN(hx + r * 0.4)} ${avN(hy - r * (tip - 0.3))} ${avN(hx + r * 0.7)} ${avN(hy - r * tip)} Q${avN(hx + r * 1.25)} ${avN(hy - r * 0.9)} ${avN(hx + r * 1.35)} ${avN(hy + r * 1.35)} Z`, main);
            let front = S.path(`M${avN(hx - r * 0.9)} ${avN(hy + r * 1.05)} Q${avN(hx - r * 1.0)} ${avN(hy - r * 0.6)} ${avN(hx + r * 0.05)} ${avN(hy - r * 0.85)} Q${avN(hx + r * 1.05)} ${avN(hy - r * 0.6)} ${avN(hx + r)} ${avN(hy + r * 1.05)} Z`, '#07080f', P.ol * 0.6);
            const ec = it.glow || '#5fd8ff';
            [-0.3, 0.42].forEach(o => { front += S.glow(hx + r * o, hy + r * 0.1, r * 0.34, ec, 0.8) + S.path(`M${avN(hx + r * (o - 0.18))} ${avN(hy + r * 0.12)} L${avN(hx + r * (o + 0.2))} ${avN(hy + r * 0.05)} L${avN(hx + r * (o + 0.16))} ${avN(hy + r * 0.2)} Z`, avLight(ec, 0.7), 0); });
            front += avTrimLine(S, `M${avN(hx - r * 0.92)} ${avN(hy + r * 1.05)} Q${avN(hx - r * 1.02)} ${avN(hy - r * 0.6)} ${avN(hx + r * 0.05)} ${avN(hy - r * 0.87)} Q${avN(hx + r * 1.07)} ${avN(hy - r * 0.6)} ${avN(hx + r * 1.02)} ${avN(hy + r * 1.05)}`, it, 1.6 * k);
            out.headBack = back; out.head = front; out.hidesFace = true; out.hidesHair = true; out.keepBeard = true;
        } else if (it.style === 'cowl') {
            let s = S.path(`M${avN(hx - r * 1.1)} ${avN(hy + r * 1.2)} Q${avN(hx - r * 1.2)} ${avN(hy - r * 1.35)} ${hx} ${avN(hy - r * 1.35)} Q${avN(hx + r * 1.2)} ${avN(hy - r * 1.35)} ${avN(hx + r * 1.1)} ${avN(hy + r * 1.2)} L${avN(hx + r * 0.85)} ${avN(hy - r * 0.05)} Q${hx} ${avN(hy - r * 0.7)} ${avN(hx - r * 0.85)} ${avN(hy - r * 0.05)} Z`, main);
            // cloth mask over the lower face
            s += S.path(`M${avN(hx - r * 0.9)} ${avN(hy + r * 0.35)} Q${hx} ${avN(hy + r * 0.25)} ${avN(hx + r * 0.95)} ${avN(hy + r * 0.35)} L${avN(hx + r * 0.6)} ${avN(hy + r * 1.1)} Q${hx} ${avN(hy + r * 1.3)} ${avN(hx - r * 0.6)} ${avN(hy + r * 1.1)} Z`, S.cloth(avDark(it.color, 0.2)), P.ol * 0.7);
            s += avTrimLine(S, `M${avN(hx - r * 0.85)} ${avN(hy - r * 0.05)} Q${hx} ${avN(hy - r * 0.7)} ${avN(hx + r * 0.85)} ${avN(hy - r * 0.05)}`, it, 1.4 * k);
            if (it.tier >= 3) [-0.3, 0.46].forEach(o => { s += S.glow(hx + r * o, hy + r * 0.08, r * 0.28, it.glow || '#3fe0c0', 0.7); });
            out.head = s; out.hidesHair = true; out.hideBeard = true;
        } else if (it.style === 'circlet') {
            let s = S.path(`M${avN(hx - r * 0.98)} ${avN(hy - r * 0.35)} Q${hx} ${avN(hy - r * 0.75)} ${avN(hx + r * 0.98)} ${avN(hy - r * 0.35)} L${avN(hx + r * 0.98)} ${avN(hy - r * 0.2)} Q${hx} ${avN(hy - r * 0.58)} ${avN(hx - r * 0.98)} ${avN(hy - r * 0.2)} Z`, S.metal(it.color || '#d4a84a'), P.ol * 0.6);
            s += it.tier >= 2 ? S.path(`M${avN(hx + r * 0.1)} ${avN(hy - r * 0.62)} L${avN(hx + r * 0.25)} ${avN(hy - r * 1.05)} L${avN(hx + r * 0.4)} ${avN(hy - r * 0.62)} Z`, S.metal(it.color || '#d4a84a'), P.ol * 0.5) : '';
            s += avGem(S, hx + r * 0.25, hy - r * 0.5, r * 0.12, Object.assign({}, it, { tier: 3 }));
            out.head = s;
        }
        return out;
    },

    // ---- torso (+ sleeves on the arms, cape on the back, robe skirt) ----
    chest(S, it) {
        const P = S.P, k = P.k, out = { torso: '', sleeveL: '', sleeveR: '', back: '' };
        const wy = P.wy, hy = P.hipy, ww = P.ww, sy = P.sy;
        if (it.style === 'plate' || it.style === 'mail') {
            const body = it.style === 'mail' ? S.lin(avLight(it.color, 0.3), avDark(it.color, 0.4)) : S.metal(it.color);
            let s = S.path(avTorsoPath(P, 1.2), body);
            s += S.flat(`M100 ${avN(sy - 10)} L${avN(100 + P.sw + 1)} ${avN(sy + 6)} Q${avN(100 + P.sw)} ${avN((sy + wy) / 2)} ${avN(100 + ww + 1)} ${wy} L100 ${wy} Z`, '#000', 0.22);
            if (it.style === 'mail') for (let y = sy + 6; y < wy; y += 5 * k) s += S.line(`M${avN(100 - P.sw * 0.8)} ${avN(y)} Q100 ${avN(y + 3)} ${avN(100 + P.sw * 0.8)} ${avN(y)}`, avDark(it.color, 0.5), 0.8, 0.5);
            else {
                s += S.line(`M100 ${avN(sy - 8)} L100 ${avN(wy - 2)}`, AV_INK, P.ol * 0.8, 0.7);
                s += S.line(`M${avN(100 - P.sw * 0.7)} ${avN(sy + 10)} Q100 ${avN(sy + 22 * k)} ${avN(100 + P.sw * 0.7)} ${avN(sy + 10)}`, AV_INK, P.ol * 0.6, 0.5);
            }
            s += avTrimLine(S, `M${avN(100 - P.sw + 5)} ${avN(sy - 5)} Q100 ${avN(sy - 12)} ${avN(100 + P.sw - 5)} ${avN(sy - 5)}`, it, 2 * k);
            s += avGem(S, 100, sy + 12 * k, 3 * k, it);
            // cloth tabard below the breastplate
            const tab = it.tabard || '#8e1b1b';
            s += S.path(`M${avN(100 - ww + 2)} ${wy + 4} L${avN(100 + ww - 2)} ${wy + 4} L${avN(100 + ww - 4)} ${avN(hy + 46 * k)} L100 ${avN(hy + 54 * k)} L${avN(100 - ww + 4)} ${avN(hy + 46 * k)} Z`, S.cloth(tab));
            s += avTrimLine(S, `M${avN(100 - ww + 4)} ${avN(hy + 44 * k)} L100 ${avN(hy + 52 * k)} L${avN(100 + ww - 4)} ${avN(hy + 44 * k)}`, it, 1.6 * k);
            out.torso = s;
            ['L', 'R'].forEach(sd => { const A = avArm(P, sd); out['sleeve' + sd] = S.path(avLimbPath(A, 7.8 * k, 6.8 * k, 5.8 * k, 0, 0.62), body) + S.ell(A.ex, A.ey, 5.8 * k, 4.8 * k, body); });
            if (it.cape) out.back = avCape(S, it.cape, it);
        } else if (it.style === 'leather') {
            const body = S.lin(avLight(it.color, 0.15), avDark(it.color, 0.5));
            let s = S.path(avTorsoPath(P, 0.8), body);
            s += S.flat(`M100 ${avN(sy - 10)} L${avN(100 + P.sw + 1)} ${avN(sy + 6)} Q${avN(100 + P.sw)} ${avN((sy + wy) / 2)} ${avN(100 + ww + 1)} ${wy} L100 ${wy} Z`, '#000', 0.25);
            // straps / laces
            s += S.path(`M${avN(100 - P.sw + 6)} ${avN(sy - 2)} L${avN(100 - P.sw + 12 * k)} ${avN(sy - 5)} L${avN(100 + ww + 1)} ${avN(wy - 4)} L${avN(100 + ww - 6)} ${avN(wy + 2)} Z`, S.lin('#5a3a22', '#221208'), P.ol * 0.7);
            for (let i = 0; i < 4; i++) s += S.line(`M${avN(96)} ${avN(sy + 6 + i * 8)} L${avN(104)} ${avN(sy + 10 + i * 8)}`, avLight(it.color, 0.4), 1.1, 0.8);
            s += avTrimLine(S, `M${avN(100 - P.sw + 5)} ${avN(sy - 5)} Q100 ${avN(sy - 12)} ${avN(100 + P.sw - 5)} ${avN(sy - 5)}`, it, 1.8 * k);
            s += avGem(S, 100 - P.sw * 0.45, sy + 6, 2.6 * k, it);
            // split coat tails
            s += S.path(`M${avN(100 - ww)} ${wy + 3} L${avN(100 - 2)} ${wy + 3} L${avN(100 - 4)} ${avN(hy + 34 * k)} L${avN(100 - ww - 3)} ${avN(hy + 30 * k)} Z`, body, P.ol * 0.8)
                + S.path(`M${avN(100 + 2)} ${wy + 3} L${avN(100 + ww)} ${wy + 3} L${avN(100 + ww + 3)} ${avN(hy + 30 * k)} L${avN(100 + 4)} ${avN(hy + 34 * k)} Z`, body, P.ol * 0.8);
            out.torso = s;
            ['L', 'R'].forEach(sd => { const A = avArm(P, sd); out['sleeve' + sd] = S.path(avLimbPath(A, 7.4 * k, 6.4 * k, 5.6 * k, 0, 0.72), body); });
            if (it.cape) out.back = avCape(S, it.cape, it);
        } else if (it.style === 'robe') {
            const body = S.cloth(it.color), fy = P.fy;
            let s = S.path(`M${avN(100 - P.sw + 5)} ${avN(sy - 7)} Q100 ${avN(sy - 15)} ${avN(100 + P.sw - 5)} ${avN(sy - 7)} L${avN(100 + P.sw)} ${avN(sy + 6)} ` +
                `Q${avN(100 + ww + 2)} ${wy} ${avN(100 + ww * 1.9)} ${fy - 16} Q100 ${fy - 10} ${avN(100 - ww * 1.9)} ${fy - 16} Q${avN(100 - ww - 2)} ${wy} ${avN(100 - P.sw)} ${avN(sy + 6)} Z`, body);
            s += S.flat(`M100 ${avN(sy - 10)} L${avN(100 + P.sw)} ${avN(sy + 6)} Q${avN(100 + ww + 2)} ${wy} ${avN(100 + ww * 1.9)} ${fy - 16} L100 ${fy - 12} Z`, '#000', 0.28);
            const tr = it.trim || '#d4a84a';
            if (it.tier >= 2) {
                s += S.line(`M100 ${avN(sy + 2)} L100 ${fy - 12}`, tr, 2.4 * k);
                s += S.line(`M${avN(100 - ww * 1.85)} ${fy - 17} Q100 ${fy - 11} ${avN(100 + ww * 1.85)} ${fy - 17}`, tr, 2.2 * k);
            }
            if (it.tier >= 3) for (let i = 0; i < 4; i++) { const y = wy + 12 + i * (fy - wy - 30) / 4; s += S.path(`M${avN(100 - 3 * k)} ${avN(y)} L100 ${avN(y - 4 * k)} L${avN(100 + 3 * k)} ${avN(y)} L100 ${avN(y + 4 * k)} Z`, avLight(tr, 0.4), 0.8); }
            s += S.glow(100, wy + 26, it.tier >= 3 ? 4 * k : 0, it.glow || '#5fd8ff', 0.8);
            out.torso = s;
            ['L', 'R'].forEach(sd => {
                const A = avArm(P, sd);
                out['sleeve' + sd] = S.path(avLimbPath(A, 7 * k, 7.5 * k, 8.5 * k, 0, 0.8), body)
                    + S.path(avLimbPath(A, 7 * k, 9 * k, 11 * k, 0.72, 1), body)
                    + (it.tier >= 2 ? S.line(avWristLine(A, 11 * k), tr, 1.6 * k) : '');
            });
            out.back = S.path(`M${avN(100 - P.sw + 3)} ${sy - 4} Q${avN(100 - P.sw * 1.6)} ${avN((sy + fy) / 2)} ${avN(100 - P.sw * 1.3)} ${fy - 2} L${avN(100 + P.sw * 1.1)} ${fy - 2} Q${avN(100 + P.sw * 1.3)} ${avN((sy + fy) / 2)} ${avN(100 + P.sw - 3)} ${sy - 4} Z`, S.cloth(avDark(it.color, 0.25)));
            out.coversLegs = true;
        }
        return out;
    },

    shoulders(S, it) {
        const P = S.P, k = P.k, out = { shoulderL: '', shoulderR: '' };
        ['L', 'R'].forEach(sd => {
            const A = avArm(P, sd), ax = A.ax, ay = A.ay;
            let s = '';
            if (it.style === 'plate' || it.style === 'spiked') {
                const m = S.metal(it.color);
                for (let i = 0; i < 3; i++) { const r = [12.5, 10.5, 8.5][i], yy = ay - 5 + i * 5 * k; s += S.path(`M${avN(ax - r * k)} ${avN(yy + 3 * k)} Q${avN(ax)} ${avN(yy - 8 * k)} ${avN(ax + r * k)} ${avN(yy + 3 * k)} Q${avN(ax)} ${avN(yy + 1)} ${avN(ax - r * k)} ${avN(yy + 3 * k)} Z`, m); }
                s += S.flat(`M${avN(ax - 9 * k)} ${avN(ay - 4)} Q${avN(ax - 2)} ${avN(ay - 11 * k)} ${avN(ax + 4 * k)} ${avN(ay - 8 * k)} Q${avN(ax - 2)} ${avN(ay - 5)} ${avN(ax - 9 * k)} ${avN(ay - 4)} Z`, '#fff', 0.45);
                s += avTrimLine(S, `M${avN(ax - 12 * k)} ${avN(ay - 2 + 3 * k)} Q${avN(ax)} ${avN(ay - 13 * k)} ${avN(ax + 12 * k)} ${avN(ay - 2 + 3 * k)}`, it, 1.4 * k);
                if (it.style === 'spiked') [-6, 0, 6].forEach(o => { s += S.path(`M${avN(ax + o * k - 2.5 * k)} ${avN(ay - 8 * k)} L${avN(ax + o * k)} ${avN(ay - 18 * k)} L${avN(ax + o * k + 2.5 * k)} ${avN(ay - 8 * k)} Z`, S.metal('#b8c0c8'), P.ol * 0.6); });
                s += avGem(S, ax, ay - 2, 2.4 * k, it);
            } else if (it.style === 'leather') {
                s += S.path(`M${avN(ax - 10 * k)} ${avN(ay + 6 * k)} Q${avN(ax)} ${avN(ay - 11 * k)} ${avN(ax + 10 * k)} ${avN(ay + 6 * k)} Q${avN(ax)} ${avN(ay + 2)} ${avN(ax - 10 * k)} ${avN(ay + 6 * k)} Z`, S.lin(avLight(it.color, 0.15), avDark(it.color, 0.5)));
                s += S.line(`M${avN(ax - 6 * k)} ${avN(ay)} L${avN(ax + 6 * k)} ${avN(ay)}`, avLight(it.color, 0.4), 1.2, 0.8);
                if (it.feathers) for (let i = 0; i < 4; i++) s += S.path(`M${avN(ax - 8 * k + i * 4 * k)} ${avN(ay - 3)} Q${avN(ax - 10 * k + i * 4 * k)} ${avN(ay - 14 * k)} ${avN(ax - 6 * k + i * 4 * k)} ${avN(ay - 20 * k)} Q${avN(ax - 5 * k + i * 4 * k)} ${avN(ay - 10 * k)} ${avN(ax - 5 * k + i * 4 * k)} ${avN(ay - 3)} Z`, S.lin('#2a2a3a', '#08080e'), P.ol * 0.5);
                s += avGem(S, ax, ay - 2, 2.2 * k, it);
            } else if (it.style === 'mantle') {
                s += S.path(`M${avN(ax - 11 * k)} ${avN(ay + 9 * k)} Q${avN(ax - 12 * k)} ${avN(ay - 9 * k)} ${avN(ax)} ${avN(ay - 9 * k)} Q${avN(ax + 12 * k)} ${avN(ay - 9 * k)} ${avN(ax + 11 * k)} ${avN(ay + 9 * k)} Q${avN(ax)} ${avN(ay + 4)} ${avN(ax - 11 * k)} ${avN(ay + 9 * k)} Z`, S.cloth(it.color));
                s += avTrimLine(S, `M${avN(ax - 11 * k)} ${avN(ay + 9 * k)} Q${avN(ax)} ${avN(ay + 4)} ${avN(ax + 11 * k)} ${avN(ay + 9 * k)}`, it, 1.5 * k);
                s += avGem(S, ax, ay - 1, 2.2 * k, it);
            }
            out['shoulder' + sd] = s;
        });
        return out;
    },

    gloves(S, it) {
        const P = S.P, k = P.k, out = {};
        ['L', 'R'].forEach(sd => {
            const A = avArm(P, sd), hx = A.hx, hy = A.hy;
            const m = it.style === 'gauntlet' ? S.metal(it.color) : S.lin(avLight(it.color, 0.15), avDark(it.color, 0.5));
            let s = S.path(avLimbPath(A, 7.4 * k, 7.2 * k, 6.6 * k, 0.72, 1), m);
            s += S.circle(hx, hy, 5.3 * k, m);
            const [cx0, cy0] = avLimbAt(A, 0.72);
            s += avTrimLine(S, `M${avN(cx0 - A.fdy * 7.4 * k)} ${avN(cy0 + A.fdx * 7.4 * k)} L${avN(cx0 + A.fdy * 7.4 * k)} ${avN(cy0 - A.fdx * 7.4 * k)}`, it, 1.4 * k);
            const [gx, gy] = avLimbAt(A, 0.86);
            s += avGem(S, gx, gy, 1.8 * k, it);
            out['glove' + sd] = s;
        });
        return out;
    },

    legs(S, it) {
        const P = S.P, k = P.k, out = {};
        ['L', 'R'].forEach(sd => {
            const g = avLeg(P, sd);
            let s;
            if (it.style === 'plate') {
                const m = S.metal(it.color);
                s = S.path(g.d, m);
                s += S.flat(`M${avN(g.hx0 + g.wk * 0.2)} ${P.hipy} L${avN(g.kx + g.wk)} ${avN(g.ky)} L${avN(g.cx + g.wa)} ${g.ank} L${avN(g.cx + g.wa * 0.2)} ${g.ank} Z`, '#000', 0.25);
                s += S.ell(g.kx + g.sgn * -1.5 * k, g.ky, g.wk * 1.08, g.wk * 0.86, m);
                s += avTrimLine(S, `M${avN(g.kx - g.wk)} ${avN(g.ky)} Q${avN(g.kx)} ${avN(g.ky - g.wk)} ${avN(g.kx + g.wk)} ${avN(g.ky)}`, it, 1.3 * k);
                s += avGem(S, g.kx, g.ky, 2 * k, it);
            } else {
                const m = it.style === 'leather' ? S.lin(avLight(it.color, 0.1), avDark(it.color, 0.55)) : S.cloth(it.color);
                s = S.path(g.d, m);
                s += S.flat(`M${avN(g.hx0 + g.wk * 0.2)} ${P.hipy} L${avN(g.kx + g.wk)} ${avN(g.ky)} L${avN(g.cx + g.wa)} ${g.ank} L${avN(g.cx + g.wa * 0.2)} ${g.ank} Z`, '#000', 0.25);
                if (it.style === 'leather') s += S.path(`M${avN(g.kx - g.wk - 0.5)} ${avN(g.ky - 5 * k)} L${avN(g.kx + g.wk + 0.5)} ${avN(g.ky - 5 * k)} L${avN(g.kx + g.wk)} ${avN(g.ky + 6 * k)} L${avN(g.kx - g.wk)} ${avN(g.ky + 6 * k)} Z`, S.lin(avLight(it.color, 0.3), avDark(it.color, 0.4)), P.ol * 0.7);
                s += avTrimLine(S, `M${avN(g.hx0 - g.wt)} ${avN(g.top + 8)} L${avN(g.cx - g.wa)} ${g.ank}`, it, 1.2 * k);
            }
            out['leg' + sd] = s;
        });
        return out;
    },

    boots(S, it) {
        const P = S.P, k = P.k, out = {};
        ['L', 'R'].forEach(sd => {
            const g = avLeg(P, sd), fy = P.fy, cx = g.cx, wa = g.wa, ank = g.ank;
            const m = it.style === 'plate' ? S.metal(it.color) : S.lin(avLight(it.color, 0.15), avDark(it.color, 0.55));
            const cuff = it.style === 'plate' ? 14 : it.style === 'leather' ? 18 : 8;
            let s = S.path(`M${avN(cx - wa - 2.5)} ${avN(ank - cuff)} L${avN(cx - wa - 3)} ${fy} L${avN(cx + wa + 11 * k)} ${fy} Q${avN(cx + wa + 11 * k)} ${fy - 9} ${avN(cx + wa + 2)} ${fy - 12} L${avN(cx + wa + 2.5)} ${avN(ank - cuff)} Z`, m);
            if (it.style !== 'cloth') s += S.path(`M${avN(cx - wa - 3.5)} ${avN(ank - cuff - 3)} L${avN(cx + wa + 3.5)} ${avN(ank - cuff - 3)} L${avN(cx + wa + 3)} ${avN(ank - cuff + 3)} L${avN(cx - wa - 3)} ${avN(ank - cuff + 3)} Z`, m, P.ol * 0.7);
            s += avTrimLine(S, `M${avN(cx - wa - 3)} ${avN(fy - 2)} L${avN(cx + wa + 10 * k)} ${avN(fy - 2)}`, it, 1.3 * k);
            s += avGem(S, cx, ank - cuff, 1.8 * k, it);
            out['boot' + sd] = s;
        });
        return out;
    },

    belt(S, it) {
        const P = S.P, k = P.k, wy = P.wy, ww = P.ww;
        let s = S.path(`M${avN(100 - ww - 2.5)} ${wy - 2} Q100 ${wy + 4} ${avN(100 + ww + 2.5)} ${wy - 2} L${avN(100 + ww + 2.5)} ${wy + 6} Q100 ${wy + 12} ${avN(100 - ww - 2.5)} ${wy + 6} Z`, it.style === 'sash' ? S.cloth(it.color) : S.lin(avLight(it.color, 0.15), avDark(it.color, 0.55)));
        s += S.path(`M96 ${wy} L104 ${wy} L104 ${wy + 8} L96 ${wy + 8} Z`, S.metal(it.trim || '#d4a84a'), P.ol * 0.5);
        if (it.style === 'sash') s += S.path(`M${avN(100 - ww)} ${wy + 5} L${avN(100 - ww - 3)} ${avN(wy + 24 * k)} L${avN(100 - ww + 3)} ${avN(wy + 22 * k)} Z`, S.cloth(it.color), P.ol * 0.6);
        if (it.pouch) s += S.path(`M${avN(100 + ww - 8)} ${wy + 5} L${avN(100 + ww)} ${wy + 5} L${avN(100 + ww - 1)} ${wy + 15} L${avN(100 + ww - 7)} ${wy + 15} Z`, S.lin('#6b4a30', '#2a1a10'), P.ol * 0.6);
        s += avGem(S, 100, wy + 4, 2 * k, it);
        return { belt: s };
    },

    amulet(S, it) {
        const P = S.P, k = P.k;
        const c = it.glow || '#e83a3a';
        return { amulet: S.line(`M${avN(100 - 7 * k)} ${avN(P.sy - 8)} Q100 ${avN(P.sy + 10 * k)} ${avN(100 + 7 * k)} ${avN(P.sy - 8)}`, '#c9a24a', 1.1 * k) + S.glow(100, P.sy + 9 * k, 5 * k, c, 0.5) + S.circle(100, P.sy + 9 * k, 2.6 * k, S.lin(avLight(c, 0.5), avDark(c, 0.3)), P.ol * 0.45) };
    },

    weapon(S, it) {
        const P = S.P, k = P.k, painter = AV_WEAPONS[it.style] || AV_WEAPONS.sword;
        // bows are held in the off hand (the rig draws the string with the other)
        if (it.style === 'bow') {
            const A = avArm(P, 'L'), R = avArm(P, 'R');
            // an arrow on the string, held by the drawing hand
            const tipX = A.hx + 26 * k, tipY = A.hy - 1;
            const arrow = S.line(`M${avN(R.hx - 4)} ${avN(R.hy)} L${avN(tipX)} ${avN(tipY)}`, '#8a5a2b', 1.6 * k)
                + S.path(`M${avN(tipX)} ${avN(tipY - 2.6 * k)} L${avN(tipX + 6 * k)} ${avN(tipY)} L${avN(tipX)} ${avN(tipY + 2.6 * k)} Z`, S.metal('#c9d2dc'), P.ol * 0.4)
                + S.path(`M${avN(R.hx - 4)} ${avN(R.hy)} l${avN(-6 * k)} ${avN(-3 * k)} l${avN(3 * k)} ${avN(3 * k)} l${avN(-3 * k)} ${avN(3 * k)} Z`, it.trim || '#c0392b', P.ol * 0.35);
            return { weaponL: S.rot(painter(S, it, A.hx, A.hy), 6, A.hx, A.hy), weaponR: arrow };
        }
        const A = avArm(P, 'R');
        const ANG = { sword: 18, axe: 0, mace: 16, hammer: 14, spear: 20, dagger: 100, staff: 4, scythe: -10, wand: 40 };
        return { weaponR: S.rot(painter(S, it, A.hx, A.hy), ANG[it.style] === undefined ? 30 : ANG[it.style], A.hx, A.hy) };
    },

    offhand(S, it) {
        const P = S.P, k = P.k, A = avArm(P, 'L'), x = A.hx, y = A.hy;
        const m = S.metal(it.color);
        if (it.style === 'kite' || it.style === 'tower') {
            const w = (it.style === 'tower' ? 18 : 16) * k, h = (it.style === 'tower' ? 36 : 30) * k;
            const d = it.style === 'tower'
                ? `M${avN(x - w)} ${avN(y - h * 0.6)} Q${avN(x)} ${avN(y - h * 0.7)} ${avN(x + w)} ${avN(y - h * 0.6)} L${avN(x + w)} ${avN(y + h * 0.5)} Q${avN(x)} ${avN(y + h * 0.75)} ${avN(x - w)} ${avN(y + h * 0.5)} Z`
                : `M${avN(x - w)} ${avN(y - h * 0.55)} Q${avN(x)} ${avN(y - h * 0.72)} ${avN(x + w)} ${avN(y - h * 0.55)} L${avN(x + w * 0.92)} ${avN(y + h * 0.1)} Q${avN(x + w * 0.6)} ${avN(y + h * 0.7)} ${avN(x)} ${avN(y + h)} Q${avN(x - w * 0.6)} ${avN(y + h * 0.7)} ${avN(x - w * 0.92)} ${avN(y + h * 0.1)} Z`;
            let s = S.path(d, S.lin(avLight(it.color, 0.15), avDark(it.color, 0.55), true));
            s += S.path(d, 'none', P.ol * 1.6, it.trim || '#c9a24a');
            const em = it.emblem || '#e8c35a';
            s += it.tier >= 2 ? S.line(`M${avN(x - w * 0.6)} ${avN(y + h * 0.05)} L${avN(x)} ${avN(y - h * 0.3)} L${avN(x + w * 0.6)} ${avN(y + h * 0.05)}`, em, 3 * k) : S.line(`M${avN(x)} ${avN(y - h * 0.4)} L${avN(x)} ${avN(y + h * 0.6)}`, em, 2.4 * k);
            s += S.circle(x, y + h * 0.3, 4.2 * k, S.metal(em), 1.2);
            s += avGem(S, x, y - h * 0.05, 3 * k, it);
            s += S.flat(`M${avN(x - w * 0.8)} ${avN(y - h * 0.5)} Q${avN(x - w * 0.3)} ${avN(y - h * 0.62)} ${avN(x)} ${avN(y - h * 0.62)} L${avN(x - w * 0.6)} ${avN(y + h * 0.3)} Z`, '#fff', 0.16);
            return { offhandL: s };
        }
        if (it.style === 'orb') {
            const c = it.glow || '#5fd8ff';
            return { offhandL: S.glow(x, y - 14 * k, 11 * k, c, 0.7) + S.circle(x, y - 14 * k, 6.5 * k, S.radial(avLight(c, 0.7), avDark(c, 0.3)), P.ol * 0.6) + S.circle(x - 2 * k, y - 16 * k, 1.8 * k, '#fff', 0) };
        }
        if (it.style === 'tome') {
            let s = S.path(`M${avN(x - 9 * k)} ${avN(y - 12 * k)} L${avN(x + 9 * k)} ${avN(y - 12 * k)} L${avN(x + 9 * k)} ${avN(y + 10 * k)} L${avN(x - 9 * k)} ${avN(y + 10 * k)} Z`, S.lin(avLight(it.color, 0.1), avDark(it.color, 0.5)));
            s += S.line(`M${avN(x - 6 * k)} ${avN(y - 12 * k)} L${avN(x - 6 * k)} ${avN(y + 10 * k)}`, '#d4a84a', 1.4 * k);
            s += S.glow(x + 2 * k, y - 1, 5 * k, it.glow || '#b05cff', 0.6) + S.circle(x + 2 * k, y - 1, 2.4 * k, '#e0c0ff', P.ol * 0.4);
            return { offhandL: s };
        }
        if (it.style === 'lantern') {
            let s = S.line(`M${avN(x)} ${avN(y + 2)} L${avN(x)} ${avN(y + 10 * k)}`, '#555', 1.4 * k);
            s += S.glow(x, y + 18 * k, 9 * k, it.glow || '#7dff7a', 0.6);
            s += S.path(`M${avN(x - 5 * k)} ${avN(y + 10 * k)} L${avN(x + 5 * k)} ${avN(y + 10 * k)} L${avN(x + 6 * k)} ${avN(y + 24 * k)} L${avN(x - 6 * k)} ${avN(y + 24 * k)} Z`, S.metal('#5a5f66'));
            s += S.circle(x, y + 17 * k, 3.4 * k, S.lin('#eae0c8', '#8a7a5a'), P.ol * 0.5); // a small skull inside
            return { offhandL: s };
        }
        if (it.style === 'dagger') return { offhandL: S.rot(AV_WEAPONS.dagger(S, it, x, y + 1), -70, x, y) };
        if (it.style === 'quiver') {
            const s = S.path(`M${avN(100 - 6 * k)} ${avN(P.sy - 14)} L${avN(100 + 4 * k)} ${avN(P.sy - 18)} L${avN(100 + 16 * k)} ${avN(P.wy + 10)} L${avN(100 + 6 * k)} ${avN(P.wy + 14)} Z`, S.lin(avLight(it.color, 0.15), avDark(it.color, 0.55)))
                + [0, 1, 2].map(i => S.line(`M${avN(100 - 3 * k + i * 3 * k)} ${avN(P.sy - 16)} L${avN(100 - 6 * k + i * 3 * k)} ${avN(P.sy - 28 * k)}`, '#d8d0c0', 1.2 * k) + S.path(`M${avN(100 - 8 * k + i * 3 * k)} ${avN(P.sy - 30 * k)} L${avN(100 - 6 * k + i * 3 * k)} ${avN(P.sy - 25 * k)} L${avN(100 - 4 * k + i * 3 * k)} ${avN(P.sy - 30 * k)} Z`, it.trim || '#c0392b', 0.8)).join('');
            return { back: s };
        }
        return {};
    },
};

function avCape(S, color, it) {
    const P = S.P, sy = P.sy, fy = P.fy, k = P.k;
    let s = S.path(`M${avN(100 - P.sw + 2)} ${sy - 4} Q${avN(100 - P.sw * 1.9)} ${avN((sy + fy) / 2)} ${avN(100 - P.sw * 1.35)} ${fy - 4} L${avN(100 + P.sw * 1.2)} ${fy - 8} Q${avN(100 + P.sw * 1.5)} ${avN((sy + fy) / 2)} ${avN(100 + P.sw - 2)} ${sy - 4} Z`, S.cloth(color));
    s += S.line(`M${avN(100 - P.sw * 0.8)} ${sy + 20} Q${avN(100 - P.sw * 1.3)} ${avN((sy + fy) / 2)} ${avN(100 - P.sw * 1.05)} ${fy - 8}`, '#000', 2 * k, 0.35);
    if (it && it.tier >= 2) s += S.line(`M${avN(100 - P.sw * 1.35)} ${fy - 4} L${avN(100 + P.sw * 1.2)} ${fy - 8}`, it.trim || '#c9a24a', 2 * k);
    return s;
}

// Weapons, drawn upright with the grip at (hx, hy).
const AV_WEAPONS = {
    sword(S, it, hx, hy) {
        const k = S.P.k, L = 72, w = 3.4 * k, m = S.metal(it.color || '#c9d2dc');
        let s = S.path(`M${avN(hx - w)} ${avN(hy - 6)} L${avN(hx - w)} ${avN(hy - 6 - L)} L${hx} ${avN(hy - 14 - L)} L${avN(hx + w)} ${avN(hy - 6 - L)} L${avN(hx + w)} ${avN(hy - 6)} Z`, m);
        s += S.line(`M${hx} ${avN(hy - 10)} L${hx} ${avN(hy - 10 - L)}`, '#fff', 1.1 * k, 0.7);
        if (it.glow) s = S.glow(hx, hy - 6 - L / 2, 12 * k, it.glow, 0.35) + s;
        s += S.path(`M${avN(hx - 12 * k)} ${avN(hy - 9)} Q${hx} ${avN(hy - 4)} ${avN(hx + 12 * k)} ${avN(hy - 9)} L${avN(hx + 12 * k)} ${avN(hy - 4)} Q${hx} ${avN(hy + 1)} ${avN(hx - 12 * k)} ${avN(hy - 4)} Z`, S.metal(it.trim || '#d4a84a'));
        s += S.path(`M${avN(hx - 2 * k)} ${avN(hy - 4)} L${avN(hx + 2 * k)} ${avN(hy - 4)} L${avN(hx + 2 * k)} ${avN(hy + 9 * k)} L${avN(hx - 2 * k)} ${avN(hy + 9 * k)} Z`, '#3a2616');
        s += S.circle(hx, hy + 11 * k, 3 * k, S.metal(it.trim || '#d4a84a'));
        return s + avGem(S, hx, hy - 7, 2 * k, it);
    },
    axe(S, it, hx, hy) {
        const k = S.P.k, top = hy - 70;
        let s = S.path(`M${avN(hx - 2.6 * k)} ${avN(hy + 14 * k)} L${avN(hx - 2.6 * k)} ${avN(top)} L${avN(hx + 2.6 * k)} ${avN(top)} L${avN(hx + 2.6 * k)} ${avN(hy + 14 * k)} Z`, S.lin('#7a5230', '#2e1a0c'));
        const sides = it.double ? [-1, 1] : [1];
        sides.forEach(sg => { s += S.path(`M${hx} ${avN(top + 6)} Q${avN(hx + sg * 14 * k)} ${avN(top - 4 * k)} ${avN(hx + sg * 22 * k)} ${avN(top - 12 * k)} Q${avN(hx + sg * 17 * k)} ${avN(top + 10 * k)} ${avN(hx + sg * 22 * k)} ${avN(top + 30 * k)} Q${avN(hx + sg * 12 * k)} ${avN(top + 19 * k)} ${hx} ${avN(top + 22 * k)} Z`, S.metal(it.color || '#c9d2dc')); });
        return s + avGem(S, hx, top + 12 * k, 2.4 * k, it);
    },
    mace(S, it, hx, hy) {
        const k = S.P.k, top = hy - 58;
        let s = S.path(`M${avN(hx - 2.4 * k)} ${avN(hy + 10 * k)} L${avN(hx - 2.4 * k)} ${avN(top + 8)} L${avN(hx + 2.4 * k)} ${avN(top + 8)} L${avN(hx + 2.4 * k)} ${avN(hy + 10 * k)} Z`, S.lin('#6a4a2a', '#2a1a0c'));
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; s += S.path(`M${hx} ${avN(top)} L${avN(hx + Math.cos(a) * 12 * k)} ${avN(top + Math.sin(a) * 12 * k)} L${avN(hx + Math.cos(a + 0.4) * 7 * k)} ${avN(top + Math.sin(a + 0.4) * 7 * k)} Z`, S.metal(it.color || '#a9b4c0'), S.P.ol * 0.5); }
        s += S.circle(hx, top, 7.5 * k, S.metal(it.color || '#a9b4c0'));
        return s + avGem(S, hx, top, 2.6 * k, it);
    },
    hammer(S, it, hx, hy) {
        const k = S.P.k, top = hy - 64;
        let s = S.path(`M${avN(hx - 2.4 * k)} ${avN(hy + 12 * k)} L${avN(hx - 2.4 * k)} ${avN(top)} L${avN(hx + 2.4 * k)} ${avN(top)} L${avN(hx + 2.4 * k)} ${avN(hy + 12 * k)} Z`, S.lin('#6a4a2a', '#2a1a0c'));
        s += S.path(`M${avN(hx - 13 * k)} ${avN(top - 8 * k)} L${avN(hx + 13 * k)} ${avN(top - 8 * k)} L${avN(hx + 13 * k)} ${avN(top + 8 * k)} L${avN(hx - 13 * k)} ${avN(top + 8 * k)} Z`, S.metal(it.color || '#d4a84a'));
        s += S.line(`M${avN(hx - 13 * k)} ${avN(top)} L${avN(hx + 13 * k)} ${avN(top)}`, it.trim || '#fff2a8', 1.4 * k, 0.8);
        if (it.glow) s = S.glow(hx, top, 16 * k, it.glow, 0.4) + s;
        return s + avGem(S, hx, top, 2.8 * k, it);
    },
    spear(S, it, hx, hy) {
        const k = S.P.k, top = hy - 100;
        let s = S.path(`M${avN(hx - 2 * k)} ${avN(hy + 26 * k)} L${avN(hx - 2 * k)} ${avN(top + 14)} L${avN(hx + 2 * k)} ${avN(top + 14)} L${avN(hx + 2 * k)} ${avN(hy + 26 * k)} Z`, S.lin('#7a5230', '#2e1a0c'));
        s += S.path(`M${hx} ${avN(top - 4)} L${avN(hx + 6 * k)} ${avN(top + 14)} L${hx} ${avN(top + 20)} L${avN(hx - 6 * k)} ${avN(top + 14)} Z`, S.metal(it.color || '#c9d2dc'));
        return s + avGem(S, hx, top + 16, 2 * k, it);
    },
    dagger(S, it, hx, hy) {
        const k = S.P.k, L = 30;
        let s = S.path(`M${avN(hx - 2.6 * k)} ${avN(hy - 5)} L${hx} ${avN(hy - 5 - L)} L${avN(hx + 2.6 * k)} ${avN(hy - 5)} Z`, S.metal(it.color || '#c9d2dc'));
        s += S.path(`M${avN(hx - 7 * k)} ${avN(hy - 6)} L${avN(hx + 7 * k)} ${avN(hy - 6)} L${avN(hx + 7 * k)} ${avN(hy - 3)} L${avN(hx - 7 * k)} ${avN(hy - 3)} Z`, S.metal(it.trim || '#8a8f96'), S.P.ol * 0.6);
        s += S.path(`M${avN(hx - 1.8 * k)} ${avN(hy - 3)} L${avN(hx + 1.8 * k)} ${avN(hy - 3)} L${avN(hx + 1.8 * k)} ${avN(hy + 7 * k)} L${avN(hx - 1.8 * k)} ${avN(hy + 7 * k)} Z`, '#2a1a3a');
        if (it.glow) s = S.glow(hx, hy - 20, 8 * k, it.glow, 0.45) + s;
        return s + avGem(S, hx, hy - 5, 1.6 * k, it);
    },
    bow(S, it, hx, hy) {
        const k = S.P.k, h = 52 * k, c = it.color || '#7a5230';
        let s = S.path(`M${avN(hx + 2)} ${avN(hy - h)} Q${avN(hx + 22 * k)} ${avN(hy)} ${avN(hx + 2)} ${avN(hy + h)} L${avN(hx - 2)} ${avN(hy + h - 3)} Q${avN(hx + 16 * k)} ${avN(hy)} ${avN(hx - 2)} ${avN(hy - h + 3)} Z`, S.lin(avLight(c, 0.2), avDark(c, 0.45)));
        s += S.line(`M${avN(hx + 1)} ${avN(hy - h + 1)} L${avN(hx + 1)} ${avN(hy + h - 1)}`, '#e8e0cc', 0.9);
        s += avTrimLine(S, `M${avN(hx + 8 * k)} ${avN(hy - h * 0.5)} Q${avN(hx + 13 * k)} ${avN(hy)} ${avN(hx + 8 * k)} ${avN(hy + h * 0.5)}`, it, 1.5 * k);
        if (it.glow) s = S.glow(hx + 10 * k, hy, 14 * k, it.glow, 0.35) + s;
        return s + avGem(S, hx + 12 * k, hy, 2.2 * k, it);
    },
    staff(S, it, hx, hy) {
        const k = S.P.k, top = hy - 92, c = it.glow || '#5fd8ff';
        let s = S.path(`M${avN(hx - 2.2 * k)} ${avN(hy + 34 * k)} L${avN(hx - 2.6 * k)} ${avN(top + 10)} L${avN(hx + 2.6 * k)} ${avN(top + 10)} L${avN(hx + 2.2 * k)} ${avN(hy + 34 * k)} Z`, S.lin(avLight(it.color || '#7a5230', 0.1), avDark(it.color || '#7a5230', 0.55)));
        s += S.path(`M${avN(hx - 8 * k)} ${avN(top + 12)} Q${avN(hx - 10 * k)} ${avN(top - 2)} ${avN(hx - 4 * k)} ${avN(top - 8 * k)} L${hx} ${avN(top + 6)} L${avN(hx + 4 * k)} ${avN(top - 8 * k)} Q${avN(hx + 10 * k)} ${avN(top - 2)} ${avN(hx + 8 * k)} ${avN(top + 12)} Z`, S.lin('#7a5230', '#2e1a0c'));
        s += S.glow(hx, top - 2, 14 * k, c, 0.7);
        s += S.path(`M${hx} ${avN(top - 16 * k)} L${avN(hx + 6 * k)} ${avN(top - 3)} L${hx} ${avN(top + 8)} L${avN(hx - 6 * k)} ${avN(top - 3)} Z`, S.lin(avLight(c, 0.8), avDark(c, 0.4), true), 1.4);
        return s;
    },
    scythe(S, it, hx, hy) {
        const k = S.P.k, top = hy - 96;
        let s = S.path(`M${avN(hx - 2.2 * k)} ${avN(hy + 30 * k)} L${avN(hx - 2.2 * k)} ${avN(top)} L${avN(hx + 2.2 * k)} ${avN(top)} L${avN(hx + 2.2 * k)} ${avN(hy + 30 * k)} Z`, S.lin('#3a2a3a', '#120a12'));
        s += S.path(`M${hx} ${avN(top + 2)} Q${avN(hx + 26 * k)} ${avN(top - 8 * k)} ${avN(hx + 40 * k)} ${avN(top + 16 * k)} Q${avN(hx + 22 * k)} ${avN(top + 4 * k)} ${hx} ${avN(top + 10 * k)} Z`, S.metal(it.color || '#b8c0c8'));
        if (it.glow) s = S.glow(hx + 24 * k, top + 4 * k, 14 * k, it.glow, 0.5) + s;
        return s + avGem(S, hx, top + 4, 2.2 * k, it);
    },
    wand(S, it, hx, hy) {
        const k = S.P.k, c = it.glow || '#b05cff';
        return S.path(`M${avN(hx - 1.8 * k)} ${avN(hy + 6)} L${avN(hx - 1.4 * k)} ${avN(hy - 38)} L${avN(hx + 1.4 * k)} ${avN(hy - 38)} L${avN(hx + 1.8 * k)} ${avN(hy + 6)} Z`, S.lin('#4a2a4a', '#1a0a1a'))
            + S.glow(hx, hy - 42, 8 * k, c, 0.8) + S.circle(hx, hy - 42, 3.2 * k, S.radial(avLight(c, 0.7), c), S.P.ol * 0.5);
    },
};

// --- composition --------------------------------------------------------------------
// spec: { cls, gender 'm'|'f', skin, hair, hairColor, beard, eyeColor, gear: { slot: item } }
function avBodyKey(spec) { return (AV_CLASS_BODY[spec.cls] || spec.body || 'heavy') + '_' + (spec.gender === 'f' ? 'f' : 'm'); }

function avPaint(spec) {
    const bodyKey = avBodyKey(spec), P = avGeom(bodyKey), S = avSession(P), k = P.k;
    const look = Object.assign({ skin: 0, hair: P.female ? 'long' : 'short', hairColor: 1, beard: 'none' }, spec);
    const skin = S.skin(AV_SKINS[look.skin || 0]);
    const gear = spec.gear || {};
    const W = gear.weapon && gear.weapon.style, O = gear.offhand && gear.offhand.style;
    P.armPose = {
        R: W === 'bow' ? 'nock' : (W === 'staff' || W === 'scythe') ? 'staff' : W ? 'ready' : 'hang',
        L: W === 'bow' ? 'bowhold' : (O === 'kite' || O === 'tower' || O === 'dagger') ? 'guard' : (O === 'orb' || O === 'tome') ? 'cast' : O === 'lantern' ? 'hold' : W ? 'hold' : 'hang',
    };
    const L = {};
    const add = o => { Object.keys(o || {}).forEach(key => { if (typeof o[key] === 'string') L[key] = (L[key] || '') + o[key]; else L[key] = o[key]; }); };
    Object.keys(gear).forEach(slot => { const it = gear[slot]; if (it && AV_PAINT[slot]) add(AV_PAINT[slot](S, it)); });

    // starter clothes wherever nothing is worn
    const linen = '#8a7a5e', trouser = '#4e4234', shoe = '#4a3020';
    const parts = {};
    // back
    parts.back = (L.back || '') + (gear.chest && gear.chest.cape ? '' : '');
    // legs
    ['L', 'R'].forEach(sd => {
        const g = avLeg(P, sd);
        let s = S.path(g.d, skin);
        s += L['leg' + sd] || (S.path(g.d, S.cloth(trouser)) + S.flat(`M${avN(g.hx0 + g.wk * 0.2)} ${P.hipy} L${avN(g.kx + g.wk)} ${avN(g.ky)} L${avN(g.cx + g.wa)} ${g.ank} L${avN(g.cx + g.wa * 0.2)} ${g.ank} Z`, '#000', 0.22));
        s += L['boot' + sd] || S.path(`M${avN(g.cx - g.wa - 2)} ${g.ank - 6} L${avN(g.cx - g.wa - 3)} ${P.fy} L${avN(g.cx + g.wa + 10 * k)} ${P.fy} Q${avN(g.cx + g.wa + 10 * k)} ${P.fy - 8} ${avN(g.cx + g.wa + 2)} ${P.fy - 10} L${avN(g.cx + g.wa + 2)} ${g.ank - 6} Z`, S.lin('#6b4a30', shoe));
        parts['leg' + sd] = s;
    });
    // torso: neck, body, shirt or armor, belt, amulet
    let t = S.path(`M${avN(100 - 6 * k)} ${P.neck - 4} L${avN(100 + 6 * k)} ${P.neck - 4} L${avN(100 + 7 * k)} ${P.sy - 4} L${avN(100 - 7 * k)} ${P.sy - 4} Z`, skin);
    t += S.path(avTorsoPath(P), skin);
    t += L.torso || (S.path(avTorsoPath(P, 0.5), S.cloth(linen)) + S.flat(`M100 ${avN(P.sy - 10)} L${avN(100 + P.sw)} ${avN(P.sy + 6)} Q${avN(100 + P.sw - 1)} ${avN((P.sy + P.wy) / 2)} ${avN(100 + P.ww)} ${P.wy} L100 ${P.wy} Z`, '#000', 0.2)
        + S.line(`M${avN(100 - 5 * k)} ${avN(P.sy - 8)} L100 ${avN(P.sy + 6)} L${avN(100 + 5 * k)} ${avN(P.sy - 8)}`, AV_INK, P.ol * 0.5, 0.6));
    t += L.belt || S.line(`M${avN(100 - P.ww - 1)} ${P.wy + 2} Q100 ${P.wy + 7} ${avN(100 + P.ww + 1)} ${P.wy + 2}`, '#6b5a3a', 3 * k);
    t += L.amulet || '';
    parts.torso = t;
    // head
    let h = L.headBack || '';
    if (!L.hidesHair) h += avHairBack(S, look);
    h += avFace(S, look);
    if (!L.hidesHair) h += avHairFront(S, look);
    if (!L.hidesFace && !L.hideBeard) h += avBeard(S, look);
    else if (L.keepBeard && look.beard !== 'none' && !P.female) h += '';
    h += L.head || '';
    parts.head = h;
    // arms: skin, sleeve (armor or shirt), glove or hand, shoulder, held items
    ['L', 'R'].forEach(sd => {
        const A = avArm(P, sd);
        let s = sd === 'R' ? (L.weaponR || '') : '';
        s += S.path(avLimbPath(A, 6.6 * k, 5.8 * k, 5 * k), skin);
        s += L['sleeve' + sd] || S.path(avLimbPath(A, 7.2 * k, 6.3 * k, 5.4 * k, 0, 0.45), S.cloth(linen));
        s += L['glove' + sd] || S.circle(A.hx, A.hy, 5 * k, skin);
        s += L['shoulder' + sd] || '';
        if (sd === 'L') s += (L.offhandL || '') + (L.weaponL || '');
        parts['arm' + sd] = s;
    });
    // quiver / cape order: the back layer is behind everything already
    const pivots = {
        legL: [avN(100 - P.hipw * 0.55), P.hipy - 2], legR: [avN(100 + P.hipw * 0.55), P.hipy - 2],
        torso: [100, P.hipy + 2], head: [100, P.neck],
        armL: [avN(100 - P.sw + 4), P.sy + 2], armR: [avN(100 + P.sw - 4), P.sy + 2],
    };
    const defs = S.defs();
    const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250" width="400" height="500"><defs>${defs}</defs>${body}</svg>`;
    const order = ['back', 'legL', 'legR', 'torso', 'head', 'armL', 'armR'];
    const svgs = {};
    order.forEach(p => { if (parts[p]) svgs[p] = wrap(parts[p]); });
    return {
        parts: svgs, order: order.filter(p => parts[p]), pivots,
        hand: (() => { const A = avArm(P, W === 'bow' ? 'L' : 'R'); return [avN(A.hx - A.ax), avN(A.hy - A.ay)]; })(),
        handSide: W === 'bow' ? 'L' : 'R',
        portrait: wrap('<ellipse cx="100" cy="240" rx="54" ry="8" fill="#000" fill-opacity=".4"/>' + order.map(p => parts[p] || '').join('')),
    };
}
