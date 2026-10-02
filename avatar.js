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
const AV_BOX = [-50, -60, 300, 310]; // x, y, width, height of every painted part (the body box is 0 0 200 250)
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

// Every class stands its own way (the silhouette alone should say who it
// is). front/back: where the feet land relative to the hips; crouch: how
// much lower the body sits (knees bend more); lean: how far the chest leads
// the hips; head: forward/down offset; R/L: arm (upper, forearm) angles;
// wAng / offAng: how the weapon / off-hand item is held.
const AV_STANCES = {
    // Arms are given as where the HAND rests, relative to its shoulder (the
    // elbow is solved): R = the near/rear arm (from the back shoulder, the
    // main weapon), L = the far/lead arm (from the front shoulder, reaching
    // toward the enemy: shield, bow, orb, lead hand). The two hands are kept
    // well apart so arms and weapons read clearly - like a boxer's guard.
    // balanced: shield out front, sword ready at the chest
    warrior: { front: 26, back: -36, crouch: 2, lean: 3, head: [0, 0], R: { to: [20, 30] }, L: { to: [44, 16] }, wAng: 24 },
    // upright and stately: hammer resting on the rear shoulder, shield planted low in front
    paladin: { front: 16, back: -20, crouch: 0, lean: 1, head: [0, -1], R: { to: [12, 34] }, L: { to: [34, 44] }, wAng: -58 },
    // very wide and low, lunging: axe raised overhead behind, lead hand clawing forward
    berserker: { front: 34, back: -44, crouch: 10, lean: 9, head: [3, 3], R: { to: [6, -50], bend: 'back' }, L: { to: [46, 34] }, wAng: -40 },
    // a deep crouch: rear dagger in reverse grip at the chest, lead dagger out front
    rogue: { front: 24, back: -32, crouch: 14, lean: 8, head: [2, 3], R: { to: [24, 24] }, L: { to: [46, 8] }, wAng: 150, offAng: 55 },
    // full draw: the bow arm straight out at shoulder height, the string hand at the cheek
    archer: { front: 20, back: -30, crouch: 4, lean: 3, head: [1, 0], R: { to: [34, -4] }, L: { to: [58, -2] }, wAng: 6 },
    // upright and calm, feet close: staff planted at the side, the lead hand raised with its magic
    mage: { front: 10, back: -12, crouch: 0, lean: 0, head: [0, -1], R: { to: [10, 58] }, L: { to: [36, -8] }, wAng: -17 },
    // hunched, head low: scythe held diagonally, lantern hanging out front
    necromancer: { front: 12, back: -16, crouch: 6, lean: 9, head: [4, 6], R: { to: [18, 36] }, L: { to: [34, 44] }, wAng: -30 },
};

// How each class breathes and fidgets while waiting (graphics.js cgFrame):
// bob = how far the body sinks into the knees (px) and how fast (Hz),
// sway = arm drift, torso/head = small rotations. A rogue bounces on the
// balls of its feet, a berserker heaves, a mage barely moves.
const AV_IDLE = {
    warrior: { bob: 1.6, hz: 0.45, sway: 0.04, torso: 0.015, head: 0.03 },
    paladin: { bob: 1.0, hz: 0.32, sway: 0.025, torso: 0.01, head: 0.02 },
    berserker: { bob: 3.2, hz: 0.62, sway: 0.07, torso: 0.04, head: 0.05 },
    rogue: { bob: 3.0, hz: 1.5, sway: 0.05, torso: 0.02, head: 0.03 },
    archer: { bob: 1.4, hz: 0.5, sway: 0.03, torso: 0.015, head: 0.02 },
    mage: { bob: 1.0, hz: 0.28, sway: 0.05, torso: 0.01, head: 0.035 },
    necromancer: { bob: 1.2, hz: 0.24, sway: 0.04, torso: 0.045, head: 0.05 },
};

function avGeom(bodyKey, cls) {
    const P = Object.assign({}, AV_BASE, AV_BODIES[bodyKey] || {});
    const st = AV_STANCES[cls] || AV_STANCES.warrior;
    P.stance = st;
    const k = P.k;
    // legs keep their length; a crouch lowers everything above them
    P.legLen = (P.fy - 14 - (P.hipy + 2)) * 0.53;
    ['hy', 'neck', 'sy', 'wy', 'hipy', 'hand'].forEach(key => { P[key] += st.crouch; });
    P.hy += st.head[1];
    // 3/4 view toward the enemy (+x): the chest leads the hips, the near
    // (right) shoulder is in front, the far (left) one tucked back.
    const lean = st.lean * k;
    P.lean = lean;
    P.front = 100 + P.sw * 0.25 + lean;                  // sternum / front line
    // turned toward +x, the camera-side (near) shoulder sits at the BACK of
    // the body and the far one at the front edge, half behind the chest
    P.shR = [100 - P.sw * 0.5 + lean, P.sy + 1];          // near (rear) shoulder joint
    P.shL = [100 + P.sw * 0.66 + lean, P.sy - 1];         // far (lead) shoulder joint
    P.hipR = [100 + P.hipw * 0.38, P.hipy + 2];
    P.hipL = [100 - P.hipw * 0.46, P.hipy + 1];
    P.headX = 100 + lean + 2 + st.head[0];
    P.neckX = 100 + lean;
    return P;
}

// --- skeleton ----------------------------------------------------------------------
// two-bone reach: from `a` to `c` with bones of length `l`, the middle joint
// bent toward `dir` (+1: toward +x, e.g. knees; for elbows see avArm)
function avIK(a, c, l, bendSign, bendAxis) {
    const dx = c[0] - a[0], dy = c[1] - a[1], d = Math.min(Math.hypot(dx, dy), 2 * l - 0.01);
    const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2, h = Math.sqrt(Math.max(0, l * l - (d / 2) * (d / 2)));
    let px = dy / (d || 1), py = -dx / (d || 1);
    // 'bd': the elbow goes back-and-down (a natural elbow for every held
    // arm; plain 'y' flipped a near-vertical arm forward - the mage's
    // staff arm bent backwards)
    const pick = bendAxis === 'bd' ? py - px : bendAxis === 'y' ? py : px;
    if (Math.sign(pick) !== bendSign) { px = -px; py = -py; }
    return [mx + px * h, my + py * h];
}

// legs: a fighting stance - knees bent, front foot forward, back foot behind
function avLeg(P, side) {
    const k = P.k, hip = side === 'R' ? P.hipR : P.hipL;
    // a wide fighting stance: the back leg reaches far behind almost
    // straight, the front leg steps forward with the knee bent
    const st = P.stance || AV_STANCES.warrior;
    const ank = side === 'R' ? [hip[0] + st.front * k, P.fy - 14] : [hip[0] + st.back * k, P.fy - 14];
    const d = Math.hypot(ank[0] - hip[0], ank[1] - hip[1]), l = Math.max(P.legLen || d * 0.53, d * 0.505);
    const knee = avIK(hip, ank, l, 1);
    const A = { ax: hip[0], ay: hip[1] - 4, ex: knee[0], ey: knee[1], wx: ank[0], wy: ank[1] };
    const f = side === 'L' ? 0.94 : 1; // the far leg reads a touch thinner
    return { A, hip, knee, ank, side, wt: P.hipw * 0.8 * f, wk: P.hipw * 0.6 * f, wa: P.hipw * 0.42 * f,
        d: avLimbPath(A, P.hipw * 0.8 * f, P.hipw * 0.6 / 0.85 * f, P.hipw * 0.42 * f) };
}
function avBootPath(P, g, cuff) {
    const k = P.k, [x, y] = g.ank, wa = g.wa, fy = P.fy;
    return `M${avN(x - wa - 2)} ${avN(y - cuff)} L${avN(x - wa - 3.5)} ${fy} L${avN(x + wa + 13 * k)} ${fy} Q${avN(x + wa + 13 * k)} ${fy - 9} ${avN(x + wa + 3)} ${fy - 12} L${avN(x + wa + 2.5)} ${avN(y - cuff)} Z`;
}

function avTorsoPath(P, grow) {
    const g = grow || 0, L = P.lean;
    const sw = P.sw + g, ww = P.ww + g, hw = P.hipw + g, sy = P.sy - g * 0.5, wy = P.wy, hy = P.hipy;
    const top = `M${avN(100 - sw * 0.56 + L)} ${avN(sy - 5)} Q${avN(100 + L)} ${avN(sy - 13)} ${avN(100 + sw * 0.8 + L)} ${avN(sy - 6)} ` +
        `Q${avN(100 + sw * 0.98 + L)} ${avN(sy + 4)} ${avN(100 + sw * 0.9 + L)} ${avN(sy + 16)} `;
    const front = P.female
        ? `Q${avN(100 + sw * 1.02 + L)} ${avN(sy + 25)} ${avN(100 + ww + 2 + L * 0.5)} ${avN(sy + 34)} Q${avN(100 + ww - 1)} ${avN(wy - 6)} ${avN(100 + ww * 0.9)} ${wy} ` +
          `Q${avN(100 + hw * 1.12)} ${avN((wy + hy) / 2)} ${avN(100 + hw * 1.02)} ${hy + 6} `
        : `Q${avN(100 + sw * 0.8 + L * 0.6)} ${avN((sy + wy) / 2)} ${avN(100 + ww * 0.92 + L * 0.3)} ${wy} L${avN(100 + hw * 0.95)} ${hy + 6} `;
    const back = P.female
        ? `Q${avN(100 + hw * 0.1)} ${hy + 13} ${avN(100 - hw * 1.05)} ${hy + 5} Q${avN(100 - hw * 1.15)} ${avN((wy + hy) / 2)} ${avN(100 - ww * 0.92)} ${wy} `
        : `Q${avN(100 + hw * 0.2)} ${hy + 13} ${avN(100 - hw * 0.96)} ${hy + 5} L${avN(100 - ww * 0.92)} ${wy} `;
    return top + front + back + `Q${avN(100 - sw * 0.72 + L * 0.6)} ${avN((sy + wy) / 2)} ${avN(100 - sw * 0.64 + L)} ${avN(sy + 10)} Q${avN(100 - sw * 0.7 + L)} ${avN(sy)} ${avN(100 - sw * 0.56 + L)} ${avN(sy - 5)} Z`;
}
// the far half of the torso in shadow (light comes from the front-left)
function avTorsoShade(S, P, grow) {
    const g = grow || 0, L = P.lean, sy = P.sy, wy = P.wy, hy = P.hipy;
    return S.flat(`M${avN(100 - (P.sw + g) * 0.56 + L)} ${avN(sy - 5)} L${avN(100 - 2 + L)} ${avN(sy - 11)} Q${avN(100 - 4)} ${avN((sy + wy) / 2)} ${avN(100 - (P.ww + g) * 0.2)} ${hy + 10} L${avN(100 - (P.hipw + g) * 0.96)} ${hy + 5} L${avN(100 - (P.ww + g) * 0.92)} ${wy} Q${avN(100 - (P.sw + g) * 0.72 + L * 0.6)} ${avN((sy + wy) / 2)} ${avN(100 - (P.sw + g) * 0.64 + L)} ${avN(sy + 10)} Z`, '#000', 0.24);
}

// Arm poses: (upper arm, forearm) angles from hanging straight down,
// positive = toward the enemy (+x). A fighter never stands with its arms
// dangling: the weapon is up and ready, a shield held across the body, a
// bow out at chest height with the other hand on the string.
const AV_ARM_POSES = {
    hang: [4, 8], ready: [10, 150], guard: [58, 116], bowhold: [66, 82], staff: [14, 132], hold: [34, 74], cast: [52, 122], fist: [58, 118],
};
function avArm(P, side) {
    const sh = side === 'L' ? P.shL : P.shR;
    const ax = sh[0], ay = sh[1];
    const pose = (P.armPose && P.armPose[side]) || 'hang';
    const len = (P.hand - P.sy) / 2;
    let ex, ey, hx, hy;
    if (pose && pose.to) {
        // hand placed where the stance says, elbow solved (down, or back
        // for a raised arm)
        const target = [ax + pose.to[0] * P.k, ay + pose.to[1] * P.k];
        const d = Math.hypot(target[0] - ax, target[1] - ay);
        if (d > 2 * len - 0.05) { const sc = (2 * len - 0.05) / d; target[0] = ax + (target[0] - ax) * sc; target[1] = ay + (target[1] - ay) * sc; }
        [ex, ey] = pose.bend === 'back' ? avIK([ax, ay], target, len, -1, 'x') : avIK([ax, ay], target, len, 1, 'bd');
        [hx, hy] = target;
    } else if (pose === 'nock') {
        // the drawing hand rests on the string at the bow's grip, elbow down
        const B = avArm(Object.assign({}, P, { armPose: { L: 'bowhold' } }), 'L');
        const target = [B.hx - 3, B.hy + 2];
        [ex, ey] = avIK([ax, ay], target, len, 1, 'y');
        [hx, hy] = target;
    } else {
        const [a1, a2] = Array.isArray(pose) ? pose : (AV_ARM_POSES[pose] || AV_ARM_POSES.hang);
        const r1 = a1 * Math.PI / 180, r2 = a2 * Math.PI / 180;
        ex = ax + Math.sin(r1) * len; ey = ay + Math.cos(r1) * len;
        hx = ex + Math.sin(r2) * len; hy = ey + Math.cos(r2) * len;
    }
    const dx = hx - ex, dy = hy - ey, dl = Math.hypot(dx, dy) || 1;
    return { side, pose, ax, ay, ex, ey, hx, hy, wx: hx - dx / dl * 4, wy: hy - dy / dl * 4, fdx: dx / dl, fdy: dy / dl, f: side === 'L' ? 0.92 : 1 };
}

function avLimbAt(A, t) {
    return t <= 0.5 ? [A.ax + (A.ex - A.ax) * t / 0.5, A.ay + (A.ey - A.ay) * t / 0.5]
        : [A.ex + (A.wx - A.ex) * (t - 0.5) / 0.5, A.ey + (A.wy - A.ey) * (t - 0.5) / 0.5];
}
function avLimbWidth(wu, we, ww, t) {
    const W = [[0, wu], [0.25, wu * 1.08], [0.5, we * 0.85], [0.7, we * 1.02], [1, ww]];
    for (let i = 1; i < W.length; i++) if (t <= W[i][0]) { const u = (t - W[i - 1][0]) / (W[i][0] - W[i - 1][0]); return W[i - 1][1] + (W[i][1] - W[i - 1][1]) * u; }
    return ww;
}
// a limb (arm or leg) along its bones, its width laid out perpendicular to
// the bone so a bent limb stays solid. `from`/`to` draw a section only.
function avLimbPath(A, wu, we, ww, from, to) {
    const f = A.f || 1, a = from || 0, b = to === undefined ? 1 : to, n = 12;
    const Lp = [], Rp = [];
    for (let i = 0; i <= n; i++) {
        const t = a + (b - a) * i / n, [x, y] = avLimbAt(A, t);
        const [x2, y2] = avLimbAt(A, Math.min(1, t + 0.02)), [x1, y1] = avLimbAt(A, Math.max(0, t - 0.02));
        let tx = x2 - x1, ty = y2 - y1; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const w = avLimbWidth(wu, we, ww, t) * f;
        Lp.push([x + ty * w, y - tx * w]); Rp.push([x - ty * w, y + tx * w]);
    }
    let d = `M${avN(Lp[0][0])} ${avN(Lp[0][1])}`;
    for (let i = 1; i <= n; i++) d += ` L${avN(Lp[i][0])} ${avN(Lp[i][1])}`;
    for (let i = n; i >= 0; i--) d += ` L${avN(Rp[i][0])} ${avN(Rp[i][1])}`;
    return d + ' Z';
}
function avWristLine(A, w) {
    const nx = -A.fdy, ny = A.fdx;
    return `M${avN(A.wx + nx * w)} ${avN(A.wy + ny * w)} L${avN(A.wx - nx * w)} ${avN(A.wy - ny * w)}`;
}
function avAcross(A, t, w) { // a line across the limb at t
    const [x, y] = avLimbAt(A, t), [x2, y2] = avLimbAt(A, Math.min(1, t + 0.02)), [x1, y1] = avLimbAt(A, Math.max(0, t - 0.02));
    let tx = x2 - x1, ty = y2 - y1; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    return `M${avN(x + ty * w)} ${avN(y - tx * w)} L${avN(x - ty * w)} ${avN(y + tx * w)}`;
}

// --- head: a 3/4 face turned toward the enemy -------------------------------------
function avHeadPath(P, grow) {
    const g = grow || 0, hx = P.headX, hy = P.hy, r = P.hr + g, f = P.female;
    return `M${avN(hx - r * 0.95)} ${avN(hy - r * 0.1)} Q${avN(hx - r * 1.0)} ${avN(hy - r * 1.05)} ${avN(hx + r * 0.05)} ${avN(hy - r * 1.1)} ` +
        `Q${avN(hx + r * 0.95)} ${avN(hy - r * 1.02)} ${avN(hx + r * 0.95)} ${avN(hy - r * 0.2)} ` +              // forehead
        `L${avN(hx + r * (f ? 1.02 : 1.08))} ${avN(hy + r * 0.34)} L${avN(hx + r * 0.9)} ${avN(hy + r * 0.44)} ` +   // nose
        `Q${avN(hx + r * 0.95)} ${avN(hy + r * 0.62)} ${avN(hx + r * 0.84)} ${avN(hy + r * 0.72)} ` +              // lips
        `Q${avN(hx + r * (f ? 0.82 : 0.9))} ${avN(hy + r * 0.98)} ${avN(hx + r * (f ? 0.58 : 0.66))} ${avN(hy + r * (f ? 1.0 : 1.04))} ` + // chin
        `Q${avN(hx + r * 0.05)} ${avN(hy + r * (f ? 0.95 : 1.02))} ${avN(hx - r * 0.38)} ${avN(hy + r * 0.62)} ` +  // jaw
        `Q${avN(hx - r * 0.7)} ${avN(hy + r * 0.55)} ${avN(hx - r * 0.95)} ${avN(hy - r * 0.1)} Z`;
}
function avFace(S, look) {
    const P = S.P, hx = P.headX, hy = P.hy, r = P.hr, f = P.female;
    const skin = look.skinTone || AV_SKINS[look.skin || 0];
    let s = S.path(avHeadPath(P), S.skin(skin));
    s += S.flat(`M${avN(hx - r * 0.95)} ${avN(hy - r * 0.1)} Q${avN(hx - r * 1.0)} ${avN(hy - r * 1.05)} ${avN(hx - r * 0.1)} ${avN(hy - r * 1.08)} Q${avN(hx - r * 0.35)} ${avN(hy)} ${avN(hx - r * 0.2)} ${avN(hy + r * 0.75)} Q${avN(hx - r * 0.7)} ${avN(hy + r * 0.55)} ${avN(hx - r * 0.95)} ${avN(hy - r * 0.1)} Z`, '#000', 0.16);
    // ear on the back half of the head
    s += S.path(`M${avN(hx - r * 0.34)} ${avN(hy - r * 0.02)} Q${avN(hx - r * 0.62)} ${avN(hy - r * 0.12)} ${avN(hx - r * 0.6)} ${avN(hy + r * 0.24)} Q${avN(hx - r * 0.55)} ${avN(hy + r * 0.48)} ${avN(hx - r * 0.3)} ${avN(hy + r * 0.44)}`, S.skin(skin), P.ol * 0.6);
    // eyes: the near one full, the far one narrow by the nose; stern brows
    const ey = hy + r * 0.08, iris = look.eyeColor || '#3a2a1c';
    const brow = AV_HAIR_COLORS[look.hairColor || 0] === '#e6e2da' ? '#8a8578' : AV_INK;
    [[0.34, 0.2, 1], [0.8, 0.11, 0.7]].forEach(([o, w0, sc]) => {
        const x = hx + r * o, w = r * w0;
        s += S.path(`M${avN(x - w)} ${avN(ey)} Q${avN(x)} ${avN(ey - r * 0.12 * sc)} ${avN(x + w)} ${avN(ey + r * 0.01)} Q${avN(x)} ${avN(ey + r * 0.09 * sc)} ${avN(x - w)} ${avN(ey)} Z`, '#f4efe6', P.ol * 0.42);
        s += S.circle(x + w * 0.35, ey, r * 0.07 * (sc > 0.8 ? 1 : 0.85), iris, 0);
        if (f) s += S.line(`M${avN(x + w)} ${avN(ey)} l${avN(r * 0.07)} ${avN(-r * 0.07)}`, AV_INK, P.ol * 0.45);
        s += S.line(f ? `M${avN(x - w)} ${avN(ey - r * 0.18)} Q${avN(x)} ${avN(ey - r * 0.27)} ${avN(x + w * 1.1)} ${avN(ey - r * 0.2)}`
                      : `M${avN(x - w * 1.2)} ${avN(ey - r * 0.27)} L${avN(x + w * 1.1)} ${avN(ey - r * 0.18)}`, brow, f ? P.ol * 0.5 : P.ol * 0.9);
    });
    s += avRaceFace(S, look, skin);
    // cheekbone, mouth
    s += S.line(`M${avN(hx + r * 0.2)} ${avN(hy + r * 0.42)} Q${avN(hx + r * 0.4)} ${avN(hy + r * 0.5)} ${avN(hx + r * 0.55)} ${avN(hy + r * 0.42)}`, avDark(skin[1], 0.2), P.ol * 0.35, 0.6);
    s += f ? S.path(`M${avN(hx + r * 0.58)} ${avN(hy + r * 0.66)} Q${avN(hx + r * 0.72)} ${avN(hy + r * 0.61)} ${avN(hx + r * 0.85)} ${avN(hy + r * 0.66)} Q${avN(hx + r * 0.72)} ${avN(hy + r * 0.76)} ${avN(hx + r * 0.58)} ${avN(hy + r * 0.66)} Z`, '#a85a52', P.ol * 0.3)
        : S.line(`M${avN(hx + r * 0.55)} ${avN(hy + r * 0.68)} Q${avN(hx + r * 0.7)} ${avN(hy + r * 0.66)} ${avN(hx + r * 0.84)} ${avN(hy + r * 0.7)}`, avDark(skin[1], 0.45), P.ol * 0.55);
    return s;
}

// Monster races (avMonsterSpec): what sets their faces apart - a long
// pointed ear, glowing eyes, an orc's tusks, a demon's horns, a lich's
// sunken cheeks.
function avRaceFace(S, look, skin) {
    const race = look.race;
    if (!race) return '';
    const P = S.P, hx = P.headX, hy = P.hy, r = P.hr;
    let s = '';
    if (race === 'orc' || race === 'ghoul' || race === 'lich' || race === 'demon') {
        s += S.path(`M${avN(hx - r * 0.32)} ${avN(hy - r * 0.05)} L${avN(hx - r * 1.25)} ${avN(hy - r * 0.55)} L${avN(hx - r * 0.5)} ${avN(hy + r * 0.45)} Z`, S.skin(skin), P.ol * 0.6);
    }
    if (race === 'orc') {
        // heavy brow and two tusks jutting up from the jaw
        s += S.flat(`M${avN(hx + r * 0.05)} ${avN(hy - r * 0.2)} L${avN(hx + r * 1.0)} ${avN(hy - r * 0.12)} L${avN(hx + r * 0.95)} ${avN(hy + r * 0.02)} L${avN(hx + r * 0.1)} ${avN(hy - r * 0.02)} Z`, '#000', 0.25);
        [[0.62, 1], [0.86, 0.8]].forEach(([o, k]) => { s += S.path(`M${avN(hx + r * o - r * 0.07 * k)} ${avN(hy + r * 0.78)} L${avN(hx + r * o)} ${avN(hy + r * (0.78 - 0.34 * k))} L${avN(hx + r * o + r * 0.07 * k)} ${avN(hy + r * 0.78)} Z`, '#efe6cf', P.ol * 0.4); });
    }
    if (race === 'lich' || race === 'ghoul') {
        s += S.flat(`M${avN(hx + r * 0.15)} ${avN(hy + r * 0.25)} Q${avN(hx + r * 0.4)} ${avN(hy + r * 0.6)} ${avN(hx + r * 0.7)} ${avN(hy + r * 0.3)} Z`, '#000', 0.3);
    }
    if (race === 'demon') {
        s += S.path(`M${avN(hx - r * 0.2)} ${avN(hy - r * 0.85)} Q${avN(hx - r * 0.8)} ${avN(hy - r * 1.9)} ${avN(hx - r * 1.6)} ${avN(hy - r * 1.7)} Q${avN(hx - r * 0.9)} ${avN(hy - r * 1.35)} ${avN(hx - r * 0.55)} ${avN(hy - r * 0.6)} Z`, S.lin('#e8dcc0', '#4a3a2a', true), P.ol * 0.8);
        s += S.path(`M${avN(hx + r * 0.3)} ${avN(hy - r * 0.95)} Q${avN(hx + r * 0.5)} ${avN(hy - r * 1.9)} ${avN(hx + r * 1.2)} ${avN(hy - r * 2.0)} Q${avN(hx + r * 0.75)} ${avN(hy - r * 1.4)} ${avN(hx + r * 0.75)} ${avN(hy - r * 0.8)} Z`, S.lin('#e8dcc0', '#4a3a2a', true), P.ol * 0.8);
    }
    if (look.eyeGlow) {
        const ey = hy + r * 0.08;
        [[0.4, 1], [0.82, 0.7]].forEach(([o, k]) => { s += S.glow(hx + r * o, ey, r * 0.3 * k, look.eyeGlow, 0.7) + S.circle(hx + r * o, ey, r * 0.1 * k, look.eyeGlow, 0); });
    }
    return s;
}

// --- MONSTERS ----------------------------------------------------------------------
// Every monster is painted like a hero (same bodies, same gear painters):
// a race for the face and skin, a gear set per monster type, and a
// variant by floor - the floor's color theme (crypt / moss / ember / abyss,
// every 5 floors, like the backdrop) and heavier, more ornate gear every
// 10 floors.
const AV_MONSTER_THEMES = {
    crypt: { cloth: '#4a4650', metal: '#8a8f96', trim: '#b8a070', glow: '#ff5a3a' },
    moss: { cloth: '#3a4a2a', metal: '#6a7a5a', trim: '#9aa04a', glow: '#9aff4a' },
    ember: { cloth: '#5a2a1a', metal: '#7a4a3a', trim: '#ff8a2a', glow: '#ffb02a' },
    abyss: { cloth: '#2a1a3a', metal: '#4a3a6a', trim: '#b05cff', glow: '#c07aff' },
};
function avMonsterSpec(type, level) {
    const L = Math.max(1, level | 0);
    const themes = ['crypt', 'moss', 'ember', 'abyss'];
    const T = AV_MONSTER_THEMES[themes[Math.floor((L - 1) / 5) % themes.length]];
    const tier = L <= 10 ? 1 : L <= 25 ? 2 : 3;
    const pick = list => list[Math.min(list.length - 1, Math.floor((L - 1) / 10))];
    const g = (slot, style, color, extra) => Object.assign({ slot, style, tier, color, trim: T.trim, glow: tier >= 2 ? T.glow : undefined }, extra || {});
    if (type === 'armored') {
        // a dead knight: sealed plate, a tower shield, the eye slit burning
        return { cls: 'warrior', race: 'undead', gender: 'm', skinTone: ['#d8d2c0', '#8a8270'], hair: 'shaved', beard: 'none', charKey: 'monster_armored',
            gear: { helmet: g('helmet', 'greathelm', T.metal, { glow: T.glow }), chest: g('chest', 'plate', T.metal, { tabard: T.cloth }), shoulders: g('shoulders', pick(['plate', 'spiked']), T.metal),
                gloves: g('gloves', 'gauntlet', T.metal), legs: g('legs', 'plate', T.metal), boots: g('boots', 'plate', T.metal),
                weapon: g('weapon', pick(['sword', 'mace', 'sword']), '#b8c0c8'), offhand: g('offhand', 'tower', T.metal) } };
    }
    if (type === 'swift') {
        // a ghoul stalker: hooded, lean, twin blades
        return { cls: 'rogue', race: 'ghoul', gender: 'm', skinTone: ['#9a96a8', '#4a4658'], eyeGlow: '#ffe04a', hair: 'shaved', beard: 'none', charKey: 'monster_swift',
            gear: { helmet: g('helmet', 'hood', T.cloth), chest: g('chest', 'leather', T.cloth), legs: g('legs', 'leather', '#2a2430'), boots: g('boots', 'leather', '#2a2020'),
                gloves: g('gloves', 'leather', '#3a2a2a'), belt: g('belt', 'sash', T.trim), weapon: g('weapon', 'dagger', '#c9d2dc'), offhand: g('offhand', 'dagger', '#c9d2dc') } };
    }
    if (type === 'drain') {
        // a lich: robed, cowled, a staff and a soul lantern
        return { cls: 'necromancer', race: 'lich', gender: 'm', skinTone: ['#a8b4b8', '#4a5860'], eyeGlow: T.glow, hair: 'shaved', beard: 'none', charKey: 'monster_drain',
            gear: { helmet: g('helmet', 'cowl', T.cloth), chest: g('chest', 'robe', T.cloth), boots: g('boots', 'cloth', '#1a1a1a'), belt: g('belt', 'sash', T.trim),
                weapon: g('weapon', 'staff', '#3a2a3a', { glow: T.glow }), offhand: g('offhand', 'lantern', T.metal, { glow: T.glow }), amulet: g('amulet', 'pendant', T.glow, { glow: T.glow }) } };
    }
    if (type === 'boss') {
        // a demon warlord: horns, spiked plate, a cape and a great double axe
        return { cls: 'berserker', race: 'demon', gender: 'm', skinTone: ['#b8503a', '#5a1a0a'], eyeGlow: '#ffd24a', hair: 'shaved', beard: 'none', charKey: 'monster_boss', sizeBoost: 1.14,
            gear: { chest: g('chest', pick(['leather', 'mail', 'plate']), T.metal, { cape: T.cloth, tier: Math.max(2, tier) }), shoulders: g('shoulders', 'spiked', T.metal, { tier: Math.max(2, tier) }),
                gloves: g('gloves', 'gauntlet', T.metal), legs: g('legs', 'plate', T.metal), boots: g('boots', 'plate', T.metal), belt: g('belt', 'leather', '#3a2010'),
                weapon: g('weapon', 'axe', '#8a8f96', { double: true, tier: Math.max(2, tier), glow: T.glow }), amulet: g('amulet', 'pendant', T.glow, { glow: T.glow }) } };
    }
    // an orc brute: tusks, crude leather, a club that gets meaner by floor
    return { cls: 'warrior', race: 'orc', gender: 'm', skinTone: ['#7e9a5a', '#3a5222'], hair: 'topknot', hairColor: 0, beard: 'none', charKey: 'monster_normal',
        gear: { chest: g('chest', pick(['leather', 'leather', 'mail']), '#5a3a22'), legs: g('legs', 'leather', '#3a2a1a'), boots: g('boots', 'leather', '#3a2616'),
            belt: g('belt', 'leather', '#4a3020', { pouch: true }), shoulders: L > 10 ? g('shoulders', 'spiked', T.metal) : undefined,
            weapon: g('weapon', pick(['mace', 'axe', 'hammer']), '#8a8f96') } };
}

function avHairBack(S, look) {
    const P = S.P, hx = P.headX, hy = P.hy, r = P.hr, c = AV_HAIR_COLORS[look.hairColor || 0], fill = S.lin(avLight(c, 0.15), avDark(c, 0.35));
    const st = look.hair;
    if (st === 'long' && !P.female) return S.path(`M${avN(hx - r * 0.95)} ${avN(hy - r * 0.6)} Q${avN(hx - r * 1.3)} ${avN(hy + r * 0.6)} ${avN(hx - r * 1.1)} ${avN(hy + r * 1.65)} L${avN(hx - r * 0.2)} ${avN(hy + r * 1.35)} Q${avN(hx - r * 0.4)} ${avN(hy + r * 0.3)} ${avN(hx)} ${avN(hy - r * 0.6)} Z`, fill);
    if (st === 'long') return S.path(`M${avN(hx - r * 0.95)} ${avN(hy - r * 0.6)} Q${avN(hx - r * 1.45)} ${avN(hy + r)} ${avN(hx - r * 1.2)} ${avN(hy + r * 2.5)} Q${avN(hx - r * 0.5)} ${avN(hy + r * 2.7)} ${avN(hx + r * 0.1)} ${avN(hy + r * 2.2)} Q${avN(hx - r * 0.2)} ${avN(hy + r * 0.8)} ${avN(hx + r * 0.2)} ${avN(hy - r * 0.6)} Z`, fill);
    if (st === 'bob') return S.path(`M${avN(hx - r * 0.95)} ${avN(hy - r * 0.6)} Q${avN(hx - r * 1.3)} ${avN(hy + r * 0.5)} ${avN(hx - r * 0.95)} ${avN(hy + r * 1.0)} L${avN(hx - r * 0.1)} ${avN(hy + r * 0.85)} Q${avN(hx - r * 0.3)} ${avN(hy + r * 0.2)} ${avN(hx + r * 0.2)} ${avN(hy - r * 0.6)} Z`, fill);
    if (st === 'braid') {
        let s = '';
        for (let i = 0; i < 6; i++) s += S.ell(hx - r * (0.95 + i * 0.05), hy + r * (0.55 + i * 0.36), r * (0.26 - i * 0.02), r * 0.22, fill, P.ol * 0.6);
        return s + S.circle(hx - r * 1.25, hy + r * 2.7, r * 0.12, '#b08a3a', P.ol * 0.5);
    }
    if (st === 'bun') return S.circle(hx - r * 0.85, hy - r * 0.75, r * 0.42, fill);
    if (st === 'topknot') return S.circle(hx - r * 0.35, hy - r * 1.2, r * 0.3, fill) + S.path(`M${avN(hx - r * 0.5)} ${avN(hy - r * 1.02)} L${avN(hx - r * 0.2)} ${avN(hy - r * 1.02)}`, 'none', P.ol * 1.4, '#8a2a1a');
    return '';
}
function avHairFront(S, look) {
    const P = S.P, hx = P.headX, hy = P.hy, r = P.hr, c = AV_HAIR_COLORS[look.hairColor || 0], fill = S.lin(avLight(c, 0.2), avDark(c, 0.3));
    if (look.hair === 'shaved') return S.flat(`M${avN(hx - r * 0.95)} ${avN(hy - r * 0.2)} Q${avN(hx - r * 1.0)} ${avN(hy - r * 1.05)} ${avN(hx + r * 0.05)} ${avN(hy - r * 1.1)} Q${avN(hx + r * 0.95)} ${avN(hy - r * 1.02)} ${avN(hx + r * 0.9)} ${avN(hy - r * 0.4)} Q${avN(hx)} ${avN(hy - r * 0.75)} ${avN(hx - r * 0.95)} ${avN(hy - r * 0.2)} Z`, c, 0.25);
    const fringe = P.female
        ? `Q${avN(hx + r * 0.75)} ${avN(hy - r * 0.6)} ${avN(hx + r * 0.2)} ${avN(hy - r * 0.55)} Q${avN(hx - r * 0.35)} ${avN(hy - r * 0.35)} ${avN(hx - r * 0.45)} ${avN(hy + r * 0.3)}`
        : `Q${avN(hx + r * 0.6)} ${avN(hy - r * 0.75)} ${avN(hx + r * 0.15)} ${avN(hy - r * 0.68)} Q${avN(hx - r * 0.3)} ${avN(hy - r * 0.6)} ${avN(hx - r * 0.4)} ${avN(hy - r * 0.05)}`;
    return S.path(`M${avN(hx - r * 1.0)} ${avN(hy + r * 0.1)} Q${avN(hx - r * 1.12)} ${avN(hy - r * 1.2)} ${avN(hx + r * 0.05)} ${avN(hy - r * 1.24)} Q${avN(hx + r * 1.02)} ${avN(hy - r * 1.14)} ${avN(hx + r * 0.95)} ${avN(hy - r * 0.35)} ${fringe} Q${avN(hx - r * 0.6)} ${avN(hy + r * 0.3)} ${avN(hx - r * 1.0)} ${avN(hy + r * 0.1)} Z`, fill);
}
function avBeard(S, look) {
    if (S.P.female || !look.beard || look.beard === 'none') return '';
    const P = S.P, hx = P.headX, hy = P.hy, r = P.hr, c = AV_HAIR_COLORS[look.hairColor || 0];
    const jaw = `M${avN(hx - r * 0.36)} ${avN(hy + r * 0.25)} Q${avN(hx - r * 0.35)} ${avN(hy + r * 0.85)} ${avN(hx + r * 0.1)} ${avN(hy + r * 1.05)} ` +
        `Q${avN(hx + r * 0.62)} ${avN(hy + r * 1.1)} ${avN(hx + r * 0.9)} ${avN(hy + r * 0.72)} Q${avN(hx + r * 0.55)} ${avN(hy + r * 0.78)} ${avN(hx + r * 0.3)} ${avN(hy + r * 0.55)} Q${avN(hx)} ${avN(hy + r * 0.5)} ${avN(hx - r * 0.36)} ${avN(hy + r * 0.25)} Z`;
    if (look.beard === 'stubble') return S.flat(jaw, c, 0.45);
    const fill = S.lin(avLight(c, 0.15), avDark(c, 0.3));
    let s = S.path(`M${avN(hx - r * 0.38)} ${avN(hy + r * 0.2)} Q${avN(hx - r * 0.4)} ${avN(hy + r * 1.1)} ${avN(hx + r * 0.25)} ${avN(hy + r * 1.5)} ` +
        `Q${avN(hx + r * 0.85)} ${avN(hy + r * 1.3)} ${avN(hx + r * 0.95)} ${avN(hy + r * 0.66)} Q${avN(hx + r * 0.72)} ${avN(hy + r * 0.62)} ${avN(hx + r * 0.55)} ${avN(hy + r * 0.66)} Q${avN(hx + r * 0.2)} ${avN(hy + r * 0.5)} ${avN(hx - r * 0.38)} ${avN(hy + r * 0.2)} Z`, fill, P.ol * 0.8);
    s += S.line(`M${avN(hx + r * 0.52)} ${avN(hy + r * 0.72)} Q${avN(hx + r * 0.7)} ${avN(hy + r * 0.69)} ${avN(hx + r * 0.88)} ${avN(hy + r * 0.72)}`, AV_INK, P.ol * 0.5);
    if (look.beard === 'braided') {
        for (let i = 0; i < 3; i++) s += S.ell(hx + r * 0.3, hy + r * (1.55 + i * 0.32), r * 0.16, r * 0.18, fill, P.ol * 0.55);
        s += S.circle(hx + r * 0.3, hy + r * 2.45, r * 0.1, '#b08a3a', P.ol * 0.5);
    }
    return s;
}

// --- ITEM PAINTERS ------------------------------------------------------------------
// An item: { slot, style, tier (1 plain, 2 trimmed, 3 ornate), color, trim,
// glow }. Each painter returns layers keyed by where they go.
function avTrimLine(S, d, item, w) { return item.tier >= 2 ? S.line(d, item.trim || '#c9a24a', w) : ''; }
function avGem(S, x, y, r, item) {
    if (item.tier < 3) return '';
    const c = item.glow || '#e83a3a';
    return S.glow(x, y, r * 2.2, c, 0.6) + S.path(`M${avN(x)} ${avN(y - r)} L${avN(x + r)} ${avN(y)} L${avN(x)} ${avN(y + r)} L${avN(x - r)} ${avN(y)} Z`, S.lin(avLight(c, 0.5), avDark(c, 0.3)), S.P.ol * 0.45);
}
const avLeather = (S, c) => S.lin(avLight(c, 0.15), avDark(c, 0.55));

const AV_PAINT = {
    helmet(S, it) {
        const P = S.P, hx = P.headX, hy = P.hy, r = P.hr, k = P.k, out = {};
        const main = it.style === 'hood' || it.style === 'cowl' ? S.cloth(it.color) : S.metal(it.color);
        if (it.style === 'greathelm' || it.style === 'horned') {
            let s = S.path(`M${avN(hx - r * 1.05)} ${avN(hy + r * 0.9)} L${avN(hx - r * 1.08)} ${avN(hy - r * 0.2)} Q${avN(hx - r * 1.02)} ${avN(hy - r * 1.3)} ${avN(hx + r * 0.1)} ${avN(hy - r * 1.33)} ` +
                `Q${avN(hx + r * 1.08)} ${avN(hy - r * 1.22)} ${avN(hx + r * 1.14)} ${avN(hy - r * 0.1)} L${avN(hx + r * 1.12)} ${avN(hy + r * 0.88)} Q${avN(hx + r * 0.2)} ${avN(hy + r * 1.28)} ${avN(hx - r * 1.05)} ${avN(hy + r * 0.9)} Z`, main);
            s += S.flat(`M${avN(hx - r * 1.05)} ${avN(hy + r * 0.9)} L${avN(hx - r * 1.08)} ${avN(hy - r * 0.2)} Q${avN(hx - r * 1.02)} ${avN(hy - r * 1.3)} ${avN(hx - r * 0.1)} ${avN(hy - r * 1.32)} Q${avN(hx - r * 0.35)} ${avN(hy)} ${avN(hx - r * 0.2)} ${avN(hy + r * 1.08)} Z`, '#000', 0.24);
            // the face plate: a ridge, a glowing eye slit, breathing holes
            s += S.line(`M${avN(hx + r * 0.42)} ${avN(hy - r * 1.28)} Q${avN(hx + r * 0.5)} ${avN(hy)} ${avN(hx + r * 0.42)} ${avN(hy + r * 1.1)}`, AV_INK, P.ol * 0.6, 0.6);
            const eyeC = it.glow || '#ffb45a';
            s += S.glow(hx + r * 0.7, hy - r * 0.05, r * 0.6, eyeC, 0.55);
            s += S.path(`M${avN(hx + r * 0.1)} ${avN(hy - r * 0.18)} L${avN(hx + r * 1.13)} ${avN(hy - r * 0.2)} L${avN(hx + r * 1.13)} ${avN(hy + r * 0.02)} L${avN(hx + r * 0.1)} ${avN(hy + r * 0.04)} Z`, S.radial(avLight(eyeC, 0.5), eyeC), P.ol * 0.7);
            for (let i = 0; i < 3; i++) s += S.circle(hx + r * 0.85, hy + r * (0.32 + i * 0.17), r * 0.05, AV_INK, 0);
            s += avTrimLine(S, `M${avN(hx - r * 1.05)} ${avN(hy + r * 0.85)} Q${avN(hx + r * 0.2)} ${avN(hy + r * 1.22)} ${avN(hx + r * 1.12)} ${avN(hy + r * 0.83)}`, it, 1.6 * k);
            if (it.style === 'horned') {
                s = S.path(`M${avN(hx - r * 0.7)} ${avN(hy - r * 0.8)} Q${avN(hx - r * 1.7)} ${avN(hy - r * 1.0)} ${avN(hx - r * 1.55)} ${avN(hy - r * 2.0)} Q${avN(hx - r * 1.2)} ${avN(hy - r * 1.2)} ${avN(hx - r * 0.55)} ${avN(hy - r * 0.35)} Z`, S.lin('#c9bfa6', '#5a4a2e', true)) + s;
                s += S.path(`M${avN(hx + r * 0.55)} ${avN(hy - r * 0.95)} Q${avN(hx + r * 1.6)} ${avN(hy - r * 1.1)} ${avN(hx + r * 1.75)} ${avN(hy - r * 2.25)} Q${avN(hx + r * 1.25)} ${avN(hy - r * 1.35)} ${avN(hx + r * 0.62)} ${avN(hy - r * 0.45)} Z`, S.lin('#f4ead2', '#6e5a3a', true));
            } else if (it.tier >= 2) {
                s = S.path(`M${avN(hx - r * 0.05)} ${avN(hy - r * 1.3)} Q${avN(hx - r * 0.9)} ${avN(hy - r * 2.3)} ${avN(hx - r * 2.3)} ${avN(hy - r * 1.0)} Q${avN(hx - r * 1.5)} ${avN(hy - r * 1.15)} ${avN(hx - r * 1.2)} ${avN(hy - r * 0.55)} Q${avN(hx - r * 0.6)} ${avN(hy - r * 1.3)} ${avN(hx - r * 0.05)} ${avN(hy - r * 1.3)} Z`, S.cloth(it.plume || '#b3261e')) + s;
            }
            s += avGem(S, hx + r * 0.42, hy - r * 0.9, r * 0.13, it);
            out.head = s; out.hidesFace = true; out.hidesHair = true;
        } else if (it.style === 'nasal') {
            let s = S.path(`M${avN(hx - r * 1.05)} ${avN(hy + r * 0.3)} Q${avN(hx - r * 1.08)} ${avN(hy - r * 1.32)} ${avN(hx + r * 0.08)} ${avN(hy - r * 1.33)} Q${avN(hx + r * 1.08)} ${avN(hy - r * 1.25)} ${avN(hx + r * 1.02)} ${avN(hy - r * 0.2)} Q${avN(hx + r * 0.4)} ${avN(hy - r * 0.48)} ${avN(hx - r * 0.3)} ${avN(hy - r * 0.2)} L${avN(hx - r * 0.35)} ${avN(hy + r * 0.55)} Z`, main);
            s += S.flat(`M${avN(hx - r * 1.05)} ${avN(hy + r * 0.3)} Q${avN(hx - r * 1.08)} ${avN(hy - r * 1.32)} ${avN(hx - r * 0.1)} ${avN(hy - r * 1.32)} Q${avN(hx - r * 0.3)} ${avN(hy - r * 0.6)} ${avN(hx - r * 0.35)} ${avN(hy + r * 0.55)} Z`, '#000', 0.22);
            s += S.path(`M${avN(hx + r * 0.84)} ${avN(hy - r * 0.35)} L${avN(hx + r * 1.02)} ${avN(hy - r * 0.35)} L${avN(hx + r * 1.08)} ${avN(hy + r * 0.38)} L${avN(hx + r * 0.94)} ${avN(hy + r * 0.38)} Z`, main, P.ol * 0.55);
            s += avTrimLine(S, `M${avN(hx - r * 0.3)} ${avN(hy - r * 0.25)} Q${avN(hx + r * 0.4)} ${avN(hy - r * 0.55)} ${avN(hx + r * 1.02)} ${avN(hy - r * 0.25)}`, it, 1.5 * k);
            s += avGem(S, hx + r * 0.2, hy - r * 0.95, r * 0.12, it);
            out.head = s; out.hidesHair = true;
        } else if (it.style === 'hood') {
            const tip = it.tier >= 2 ? 2.3 : 1.7;
            out.headBack = S.path(`M${avN(hx - r * 1.25)} ${avN(hy + r * 1.4)} Q${avN(hx - r * 1.55)} ${avN(hy - r * 0.5)} ${avN(hx - r * 0.55)} ${avN(hy - r * 1.35)} Q${avN(hx - r * 0.2)} ${avN(hy - r * (tip - 0.3))} ${avN(hx - r * 0.05)} ${avN(hy - r * tip)} ` +
                `Q${avN(hx + r * 1.15)} ${avN(hy - r * 1.2)} ${avN(hx + r * 1.28)} ${avN(hy + r * 0.2)} L${avN(hx + r * 1.05)} ${avN(hy + r * 1.4)} Z`, main);
            let front = S.path(`M${avN(hx - r * 0.1)} ${avN(hy + r * 1.1)} Q${avN(hx - r * 0.4)} ${avN(hy - r * 0.3)} ${avN(hx + r * 0.45)} ${avN(hy - r * 0.85)} Q${avN(hx + r * 1.22)} ${avN(hy - r * 0.4)} ${avN(hx + r * 1.12)} ${avN(hy + r * 1.05)} Z`, '#07080f', P.ol * 0.6);
            const ec = it.glow || '#5fd8ff';
            [[0.4, 1], [0.85, 0.7]].forEach(([o, sc]) => { front += S.glow(hx + r * o, hy + r * 0.12, r * 0.3 * sc, ec, 0.85) + S.path(`M${avN(hx + r * (o - 0.16 * sc))} ${avN(hy + r * 0.14)} L${avN(hx + r * (o + 0.18 * sc))} ${avN(hy + r * 0.06)} L${avN(hx + r * (o + 0.14 * sc))} ${avN(hy + r * 0.2)} Z`, avLight(ec, 0.7), 0); });
            front += avTrimLine(S, `M${avN(hx - r * 0.12)} ${avN(hy + r * 1.1)} Q${avN(hx - r * 0.42)} ${avN(hy - r * 0.32)} ${avN(hx + r * 0.45)} ${avN(hy - r * 0.88)} Q${avN(hx + r * 1.25)} ${avN(hy - r * 0.42)} ${avN(hx + r * 1.15)} ${avN(hy + r * 1.05)}`, it, 1.6 * k);
            out.head = front; out.hidesFace = true; out.hidesHair = true;
        } else if (it.style === 'cowl') {
            let s = S.path(`M${avN(hx - r * 1.1)} ${avN(hy + r * 1.2)} Q${avN(hx - r * 1.25)} ${avN(hy - r * 1.3)} ${avN(hx + r * 0.1)} ${avN(hy - r * 1.35)} Q${avN(hx + r * 1.2)} ${avN(hy - r * 1.3)} ${avN(hx + r * 1.12)} ${avN(hy - r * 0.15)} Q${avN(hx + r * 0.5)} ${avN(hy - r * 0.62)} ${avN(hx - r * 0.1)} ${avN(hy - r * 0.2)} L${avN(hx - r * 0.3)} ${avN(hy + r * 1.1)} Z`, main);
            s += S.path(`M${avN(hx - r * 0.3)} ${avN(hy + r * 0.3)} Q${avN(hx + r * 0.5)} ${avN(hy + r * 0.22)} ${avN(hx + r * 1.12)} ${avN(hy + r * 0.32)} L${avN(hx + r * 0.85)} ${avN(hy + r * 1.08)} Q${avN(hx + r * 0.3)} ${avN(hy + r * 1.3)} ${avN(hx - r * 0.3)} ${avN(hy + r * 1.05)} Z`, S.cloth(avDark(it.color, 0.2)), P.ol * 0.7);
            s += avTrimLine(S, `M${avN(hx - r * 0.1)} ${avN(hy - r * 0.2)} Q${avN(hx + r * 0.5)} ${avN(hy - r * 0.62)} ${avN(hx + r * 1.12)} ${avN(hy - r * 0.15)}`, it, 1.4 * k);
            if (it.tier >= 3) [[0.34, 1], [0.8, 0.7]].forEach(([o, sc]) => { s += S.glow(hx + r * o, hy + r * 0.08, r * 0.26 * sc, it.glow || '#3fe0c0', 0.75); });
            out.head = s; out.hidesHair = true; out.hideBeard = true;
        } else if (it.style === 'circlet') {
            let s = S.path(`M${avN(hx - r * 0.98)} ${avN(hy - r * 0.35)} Q${avN(hx + r * 0.1)} ${avN(hy - r * 0.8)} ${avN(hx + r * 0.98)} ${avN(hy - r * 0.45)} L${avN(hx + r * 0.98)} ${avN(hy - r * 0.3)} Q${avN(hx + r * 0.1)} ${avN(hy - r * 0.63)} ${avN(hx - r * 0.98)} ${avN(hy - r * 0.2)} Z`, S.metal(it.color || '#d4a84a'), P.ol * 0.6);
            s += avGem(S, hx + r * 0.55, hy - r * 0.58, r * 0.12, Object.assign({}, it, { tier: 3 }));
            out.head = s;
        }
        return out;
    },

    chest(S, it) {
        const P = S.P, k = P.k, out = {};
        const wy = P.wy, hy = P.hipy, ww = P.ww, sy = P.sy, fx = P.front;
        if (it.style === 'plate' || it.style === 'mail') {
            const body = it.style === 'mail' ? S.lin(avLight(it.color, 0.3), avDark(it.color, 0.4)) : S.metal(it.color);
            // cloth tabard hanging from the belt, behind the plate skirt
            const tab = it.tabard || '#8e1b1b', tx = fx - 3;
            let s = S.path(`M${avN(tx - ww * 0.75)} ${wy + 4} L${avN(tx + ww * 0.75)} ${wy + 4} L${avN(tx + ww * 0.62 + 4 * k)} ${avN(hy + 48 * k)} L${avN(tx + 3 * k)} ${avN(hy + 55 * k)} L${avN(tx - ww * 0.62)} ${avN(hy + 46 * k)} Z`, S.cloth(tab));
            s += avTrimLine(S, `M${avN(tx - ww * 0.62)} ${avN(hy + 44 * k)} L${avN(tx + 3 * k)} ${avN(hy + 52 * k)} L${avN(tx + ww * 0.62 + 4 * k)} ${avN(hy + 46 * k)}`, it, 1.6 * k);
            s += S.path(avTorsoPath(P, 1.2), body) + avTorsoShade(S, P, 1.2);
            if (it.style === 'mail') for (let y = sy + 6; y < wy; y += 5 * k) s += S.line(`M${avN(100 - P.sw * 0.55 + P.lean)} ${avN(y)} Q${avN(fx)} ${avN(y + 3)} ${avN(100 + P.sw * 0.85)} ${avN(y - 1)}`, avDark(it.color, 0.5), 0.8, 0.5);
            else {
                s += S.line(`M${avN(fx)} ${avN(sy - 9)} Q${avN(fx + 3 * k)} ${avN((sy + wy) / 2)} ${avN(fx - 2)} ${avN(wy - 2)}`, AV_INK, P.ol * 0.8, 0.65);
                s += S.line(`M${avN(100 - P.sw * 0.4 + P.lean)} ${avN(sy + 12)} Q${avN(fx)} ${avN(sy + 22 * k)} ${avN(100 + P.sw * 0.82)} ${avN(sy + 10)}`, AV_INK, P.ol * 0.55, 0.45);
                s += S.flat(`M${avN(fx + 2)} ${avN(sy - 6)} Q${avN(100 + P.sw * 0.8)} ${avN(sy)} ${avN(100 + P.sw * 0.82)} ${avN(sy + 14)} L${avN(fx + 4)} ${avN(sy + 18)} Z`, '#fff', 0.2);
            }
            s += avTrimLine(S, `M${avN(100 - P.sw * 0.5 + P.lean)} ${avN(sy - 4)} Q${avN(100 + P.lean)} ${avN(sy - 12)} ${avN(100 + P.sw * 0.78 + P.lean)} ${avN(sy - 5)}`, it, 2 * k);
            s += avGem(S, fx + 1, sy + 12 * k, 3 * k, it);
            out.torso = s;
            out.sleeveL = S.path(avLimbPath(avArm(P, 'L'), 7.8 * k, 6.8 * k, 5.8 * k, 0, 0.62), body);
            out.sleeveR = S.path(avLimbPath(avArm(P, 'R'), 7.8 * k, 6.8 * k, 5.8 * k, 0, 0.62), body);
            ['L', 'R'].forEach(sd => { const A = avArm(P, sd); out['sleeve' + sd] += S.ell(A.ex, A.ey, 5.8 * k * A.f, 4.8 * k * A.f, body); });
            if (it.cape) out.back = avCape(S, it.cape, it);
        } else if (it.style === 'leather') {
            const body = avLeather(S, it.color);
            // split coat tails first (under the vest)
            let s = S.path(`M${avN(100 - ww * 0.9)} ${wy + 3} L${avN(fx - 1)} ${wy + 3} L${avN(fx - 3)} ${avN(hy + 34 * k)} L${avN(100 - ww - 5)} ${avN(hy + 30 * k)} Z`, body, P.ol * 0.8)
                + S.path(`M${avN(fx + 1)} ${wy + 3} L${avN(100 + ww * 0.95)} ${wy + 3} L${avN(100 + ww + 4)} ${avN(hy + 28 * k)} L${avN(fx + 3)} ${avN(hy + 33 * k)} Z`, body, P.ol * 0.8);
            s += S.path(avTorsoPath(P, 0.8), body) + avTorsoShade(S, P, 0.8);
            s += S.path(`M${avN(100 - P.sw * 0.5 + P.lean)} ${avN(sy - 2)} L${avN(100 - P.sw * 0.3 + P.lean)} ${avN(sy - 6)} L${avN(100 + ww)} ${avN(wy - 3)} L${avN(100 + ww - 7)} ${avN(wy + 2)} Z`, S.lin('#5a3a22', '#221208'), P.ol * 0.7);
            for (let i = 0; i < 4; i++) s += S.line(`M${avN(fx - 3)} ${avN(sy + 6 + i * 8)} L${avN(fx + 4)} ${avN(sy + 10 + i * 8)}`, avLight(it.color, 0.4), 1.1, 0.8);
            s += avTrimLine(S, `M${avN(100 - P.sw * 0.5 + P.lean)} ${avN(sy - 4)} Q${avN(100 + P.lean)} ${avN(sy - 12)} ${avN(100 + P.sw * 0.78 + P.lean)} ${avN(sy - 5)}`, it, 1.8 * k);
            s += avGem(S, 100 + P.sw * 0.55, sy + 8, 2.6 * k, it);
            out.torso = s;
            out.sleeveL = S.path(avLimbPath(avArm(P, 'L'), 7.4 * k, 6.4 * k, 5.6 * k, 0, 0.72), body);
            out.sleeveR = S.path(avLimbPath(avArm(P, 'R'), 7.4 * k, 6.4 * k, 5.6 * k, 0, 0.72), body);
            if (it.cape) out.back = avCape(S, it.cape, it);
        } else if (it.style === 'robe') {
            const body = S.cloth(it.color), fy = P.fy, tr = it.trim || '#d4a84a';
            let s = S.path(`M${avN(100 - P.sw * 0.56 + P.lean)} ${avN(sy - 5)} Q${avN(100 + P.lean)} ${avN(sy - 13)} ${avN(100 + P.sw * 0.8 + P.lean)} ${avN(sy - 6)} Q${avN(100 + P.sw * 0.98 + P.lean)} ${avN(sy + 4)} ${avN(100 + P.sw * 0.9 + P.lean)} ${avN(sy + 16)} ` +
                `Q${avN(100 + ww * 1.7)} ${avN(wy + 22)} ${avN(100 + ww * 2.7)} ${fy - 14} Q${avN(100 + ww * 0.3)} ${fy - 7} ${avN(100 - ww * 2.9)} ${fy - 14} Q${avN(100 - ww * 1.2)} ${wy} ${avN(100 - P.sw * 0.64 + P.lean)} ${avN(sy + 10)} Z`, body);
            s += S.flat(`M${avN(100 - P.sw * 0.56 + P.lean)} ${avN(sy - 5)} L${avN(100 + P.lean - 2)} ${avN(sy - 11)} Q${avN(100 - 6)} ${wy} ${avN(100 - ww * 0.4)} ${fy - 10} L${avN(100 - ww * 2.9)} ${fy - 14} Q${avN(100 - ww * 1.2)} ${wy} ${avN(100 - P.sw * 0.64 + P.lean)} ${avN(sy + 10)} Z`, '#000', 0.28);
            // the front opening of the robe
            s += S.line(`M${avN(fx)} ${avN(sy + 2)} Q${avN(fx + 2)} ${wy} ${avN(fx + ww * 0.5)} ${fy - 13}`, it.tier >= 2 ? tr : avDark(it.color, 0.5), (it.tier >= 2 ? 2.4 : 1.4) * k);
            if (it.tier >= 2) s += S.line(`M${avN(100 - ww * 2.85)} ${fy - 15} Q${avN(100 + ww * 0.3)} ${fy - 8} ${avN(100 + ww * 2.62)} ${fy - 15}`, tr, 2.2 * k);
            if (it.tier >= 3) for (let i = 0; i < 4; i++) { const y = wy + 12 + i * (fy - wy - 30) / 4, x = fx + 1 + i * ww * 0.12; s += S.path(`M${avN(x - 3 * k)} ${avN(y)} L${avN(x)} ${avN(y - 4 * k)} L${avN(x + 3 * k)} ${avN(y)} L${avN(x)} ${avN(y + 4 * k)} Z`, avLight(tr, 0.4), 0.8); }
            out.torso = s;
            ['L', 'R'].forEach(sd => {
                const A = avArm(P, sd);
                out['sleeve' + sd] = S.path(avLimbPath(A, 7 * k, 7.5 * k, 8.5 * k, 0, 0.8), body)
                    + S.path(avLimbPath(A, 7 * k, 9 * k, 11 * k, 0.72, 1), body)
                    + (it.tier >= 2 ? S.line(avWristLine(A, 11 * k * A.f), tr, 1.6 * k) : '');
            });
            out.back = S.path(`M${avN(P.shL[0] - 2)} ${sy - 6} Q${avN(100 - P.sw * 1.5)} ${avN((sy + fy) / 2)} ${avN(100 - P.sw * 1.5)} ${fy - 3} L${avN(100 + P.sw * 0.6)} ${fy - 5} Q${avN(100 + P.sw * 0.5)} ${avN((sy + fy) / 2)} ${avN(P.shR[0] - 6)} ${sy - 6} Z`, S.cloth(avDark(it.color, 0.25)));
            out.coversLegs = true;
            out.legCloth = avDark(it.color, 0.35);
        }
        return out;
    },

    shoulders(S, it) {
        const P = S.P, k = P.k, out = {};
        ['L', 'R'].forEach(sd => {
            const A = avArm(P, sd), ax = A.ax, ay = A.ay, f = A.f;
            let s = '';
            if (it.style === 'plate' || it.style === 'spiked') {
                const m = S.metal(it.color);
                for (let i = 0; i < 3; i++) { const r = [12.5, 10.5, 8.5][i] * f, yy = ay - 5 + i * 5 * k; s += S.path(`M${avN(ax - r * k)} ${avN(yy + 3 * k)} Q${avN(ax)} ${avN(yy - 8 * k)} ${avN(ax + r * k)} ${avN(yy + 3 * k)} Q${avN(ax)} ${avN(yy + 1)} ${avN(ax - r * k)} ${avN(yy + 3 * k)} Z`, m); }
                s += S.flat(`M${avN(ax - 9 * k)} ${avN(ay - 4)} Q${avN(ax - 2)} ${avN(ay - 11 * k)} ${avN(ax + 4 * k)} ${avN(ay - 8 * k)} Q${avN(ax - 2)} ${avN(ay - 5)} ${avN(ax - 9 * k)} ${avN(ay - 4)} Z`, '#fff', 0.45);
                s += avTrimLine(S, `M${avN(ax - 12 * k * f)} ${avN(ay - 2 + 3 * k)} Q${avN(ax)} ${avN(ay - 13 * k)} ${avN(ax + 12 * k * f)} ${avN(ay - 2 + 3 * k)}`, it, 1.4 * k);
                if (it.style === 'spiked') [-6, 0, 6].forEach(o => { s += S.path(`M${avN(ax + o * k - 2.5 * k)} ${avN(ay - 8 * k)} L${avN(ax + o * k)} ${avN(ay - 18 * k)} L${avN(ax + o * k + 2.5 * k)} ${avN(ay - 8 * k)} Z`, S.metal('#b8c0c8'), P.ol * 0.6); });
                s += avGem(S, ax, ay - 2, 2.4 * k, it);
            } else if (it.style === 'leather') {
                s += S.path(`M${avN(ax - 10 * k * f)} ${avN(ay + 6 * k)} Q${avN(ax)} ${avN(ay - 11 * k)} ${avN(ax + 10 * k * f)} ${avN(ay + 6 * k)} Q${avN(ax)} ${avN(ay + 2)} ${avN(ax - 10 * k * f)} ${avN(ay + 6 * k)} Z`, avLeather(S, it.color));
                s += S.line(`M${avN(ax - 6 * k)} ${avN(ay)} L${avN(ax + 6 * k)} ${avN(ay)}`, avLight(it.color, 0.4), 1.2, 0.8);
                if (it.feathers) for (let i = 0; i < 4; i++) s += S.path(`M${avN(ax - 8 * k + i * 4 * k)} ${avN(ay - 3)} Q${avN(ax - 12 * k + i * 4 * k)} ${avN(ay - 14 * k)} ${avN(ax - 9 * k + i * 4 * k)} ${avN(ay - 20 * k)} Q${avN(ax - 5 * k + i * 4 * k)} ${avN(ay - 10 * k)} ${avN(ax - 5 * k + i * 4 * k)} ${avN(ay - 3)} Z`, S.lin('#2a2a3a', '#08080e'), P.ol * 0.5);
                s += avGem(S, ax, ay - 2, 2.2 * k, it);
            } else if (it.style === 'mantle') {
                s += S.path(`M${avN(ax - 11 * k * f)} ${avN(ay + 9 * k)} Q${avN(ax - 12 * k * f)} ${avN(ay - 9 * k)} ${avN(ax)} ${avN(ay - 9 * k)} Q${avN(ax + 12 * k * f)} ${avN(ay - 9 * k)} ${avN(ax + 11 * k * f)} ${avN(ay + 9 * k)} Q${avN(ax)} ${avN(ay + 4)} ${avN(ax - 11 * k * f)} ${avN(ay + 9 * k)} Z`, S.cloth(it.color));
                s += avTrimLine(S, `M${avN(ax - 11 * k * f)} ${avN(ay + 9 * k)} Q${avN(ax)} ${avN(ay + 4)} ${avN(ax + 11 * k * f)} ${avN(ay + 9 * k)}`, it, 1.5 * k);
                s += avGem(S, ax, ay - 1, 2.2 * k, it);
            }
            out['shoulder' + sd] = s;
        });
        return out;
    },

    gloves(S, it) {
        const P = S.P, k = P.k, out = {};
        ['L', 'R'].forEach(sd => {
            const A = avArm(P, sd);
            const m = it.style === 'gauntlet' ? S.metal(it.color) : avLeather(S, it.color);
            let s = S.path(avLimbPath(A, 7.4 * k, 7.2 * k, 6.6 * k, 0.72, 1), m);
            s += S.circle(A.hx, A.hy, 5.3 * k * A.f, m);
            s += avTrimLine(S, avAcross(A, 0.72, 7.6 * k * A.f), it, 1.4 * k);
            const [gx, gy] = avLimbAt(A, 0.86);
            s += avGem(S, gx, gy, 1.8 * k, it);
            out['glove' + sd] = s;
        });
        return out;
    },

    legs(S, it) {
        const P = S.P, k = P.k, out = {};
        ['L', 'R'].forEach(sd => {
            const g = avLeg(P, sd), A = g.A;
            let s;
            if (it.style === 'plate') {
                const m = S.metal(it.color);
                s = S.path(g.d, m);
                s += S.flat(avLimbPath(A, g.wt * 0.45, g.wk * 0.5 / 0.85, g.wa * 0.5, 0.05, 0.95), '#000', 0.18);
                s += S.path(`M${avN(g.knee[0] - g.wk * 0.8)} ${avN(g.knee[1] - g.wk * 0.5)} Q${avN(g.knee[0] + 2 * k)} ${avN(g.knee[1] - g.wk * 1.1)} ${avN(g.knee[0] + g.wk * 1.05)} ${avN(g.knee[1] - g.wk * 0.2)} Q${avN(g.knee[0] + g.wk * 0.9)} ${avN(g.knee[1] + g.wk * 0.75)} ${avN(g.knee[0])} ${avN(g.knee[1] + g.wk * 0.7)} Q${avN(g.knee[0] - g.wk * 0.9)} ${avN(g.knee[1] + g.wk * 0.2)} ${avN(g.knee[0] - g.wk * 0.8)} ${avN(g.knee[1] - g.wk * 0.5)} Z`, m);
                s += avTrimLine(S, avAcross(A, 0.35, g.wt), it, 1.3 * k);
                s += avGem(S, g.knee[0] + 2 * k, g.knee[1], 2 * k, it);
            } else {
                const m = it.style === 'leather' ? S.lin(avLight(it.color, 0.1), avDark(it.color, 0.55)) : S.cloth(it.color);
                s = S.path(g.d, m);
                s += S.flat(avLimbPath(A, g.wt * 0.45, g.wk * 0.5 / 0.85, g.wa * 0.5, 0.05, 0.95), '#000', 0.2);
                if (it.style === 'leather') s += S.path(avLimbPath(A, g.wt * 1.05, g.wk * 1.15 / 0.85, g.wa, 0.45, 0.58), S.lin(avLight(it.color, 0.3), avDark(it.color, 0.4)), P.ol * 0.7);
                s += avTrimLine(S, avAcross(A, 0.08, g.wt), it, 1.2 * k);
            }
            out['leg' + sd] = s;
        });
        return out;
    },

    boots(S, it) {
        const P = S.P, k = P.k, out = {};
        ['L', 'R'].forEach(sd => {
            const g = avLeg(P, sd), [x, y] = g.ank, wa = g.wa;
            const m = it.style === 'plate' ? S.metal(it.color) : avLeather(S, it.color);
            const cuff = it.style === 'plate' ? 14 : it.style === 'leather' ? 18 : 8;
            let s = S.path(avBootPath(P, g, cuff), m);
            if (it.style !== 'cloth') s += S.path(`M${avN(x - wa - 3.5)} ${avN(y - cuff - 3)} L${avN(x + wa + 3.5)} ${avN(y - cuff - 3)} L${avN(x + wa + 3)} ${avN(y - cuff + 3)} L${avN(x - wa - 3)} ${avN(y - cuff + 3)} Z`, m, P.ol * 0.7);
            s += avTrimLine(S, `M${avN(x - wa - 3)} ${avN(P.fy - 2)} L${avN(x + wa + 12 * k)} ${avN(P.fy - 2)}`, it, 1.3 * k);
            s += avGem(S, x, y - cuff, 1.8 * k, it);
            out['boot' + sd] = s;
        });
        return out;
    },

    belt(S, it) {
        const P = S.P, k = P.k, wy = P.wy, ww = P.ww, bx = 100 + ww * 0.45;
        let s = S.path(`M${avN(100 - ww * 0.95 - 1.5)} ${wy - 3} Q${avN(100)} ${wy + 3} ${avN(100 + ww * 0.95 + 1.5)} ${wy - 2} L${avN(100 + ww * 0.95 + 1.5)} ${wy + 6} Q${avN(100)} ${wy + 11} ${avN(100 - ww * 0.95 - 1.5)} ${wy + 5} Z`, it.style === 'sash' ? S.cloth(it.color) : avLeather(S, it.color));
        s += S.path(`M${avN(bx - 4)} ${wy - 0.5} L${avN(bx + 4)} ${wy - 0.5} L${avN(bx + 4)} ${wy + 7.5} L${avN(bx - 4)} ${wy + 7.5} Z`, S.metal(it.trim || '#d4a84a'), P.ol * 0.5);
        if (it.style === 'sash') s += S.path(`M${avN(100 - ww * 0.7)} ${wy + 5} L${avN(100 - ww * 0.9)} ${avN(wy + 24 * k)} L${avN(100 - ww * 0.4)} ${avN(wy + 22 * k)} Z`, S.cloth(it.color), P.ol * 0.6);
        if (it.pouch) s += S.path(`M${avN(100 - ww * 0.55)} ${wy + 5} L${avN(100 - ww * 0.05)} ${wy + 5} L${avN(100 - ww * 0.1)} ${wy + 15} L${avN(100 - ww * 0.5)} ${wy + 15} Z`, S.lin('#6b4a30', '#2a1a10'), P.ol * 0.6);
        s += avGem(S, bx, wy + 3.5, 2 * k, it);
        return { belt: s };
    },

    amulet(S, it) {
        const P = S.P, k = P.k, x = P.front + 1, c = it.glow || '#e83a3a';
        return { amulet: S.line(`M${avN(x - 7 * k)} ${avN(P.sy - 8)} Q${avN(x)} ${avN(P.sy + 10 * k)} ${avN(x + 6 * k)} ${avN(P.sy - 9)}`, '#c9a24a', 1.1 * k) + S.glow(x, P.sy + 9 * k, 5 * k, c, 0.5) + S.circle(x, P.sy + 9 * k, 2.6 * k, S.lin(avLight(c, 0.5), avDark(c, 0.3)), P.ol * 0.45) };
    },

    weapon(S, it) {
        const P = S.P, k = P.k, painter = AV_WEAPONS[it.style] || AV_WEAPONS.sword;
        if (it.style === 'bow') {
            const A = avArm(P, 'L'), R = avArm(P, 'R');
            const tipX = A.hx + 26 * k, tipY = A.hy - 1;
            // an arrow on the string, the drawing hand holding its nock
            const arrow = S.line(`M${avN(R.hx - 4)} ${avN(R.hy)} L${avN(tipX)} ${avN(tipY)}`, '#8a5a2b', 1.6 * k)
                + S.path(`M${avN(tipX)} ${avN(tipY - 2.6 * k)} L${avN(tipX + 6 * k)} ${avN(tipY)} L${avN(tipX)} ${avN(tipY + 2.6 * k)} Z`, S.metal('#c9d2dc'), P.ol * 0.4)
                + S.path(`M${avN(R.hx - 4)} ${avN(R.hy)} l${avN(-6 * k)} ${avN(-3 * k)} l${avN(3 * k)} ${avN(3 * k)} l${avN(-3 * k)} ${avN(3 * k)} Z`, it.trim || '#c0392b', P.ol * 0.35);
            // the string pulled back to the drawing hand (in the bow's frame, rotated 6deg)
            const h = 52 * k, rad = 6 * Math.PI / 180, rotP = (x, y) => [A.hx + (x - A.hx) * Math.cos(rad) - (y - A.hy) * Math.sin(rad), A.hy + (x - A.hx) * Math.sin(rad) + (y - A.hy) * Math.cos(rad)];
            const top = rotP(A.hx + 1, A.hy - h + 1), bot = rotP(A.hx + 1, A.hy + h - 1);
            const string = S.line(`M${avN(top[0])} ${avN(top[1])} L${avN(R.hx - 3)} ${avN(R.hy)} L${avN(bot[0])} ${avN(bot[1])}`, '#e8e0cc', 0.9);
            return { held: S.rot(painter(S, Object.assign({}, it, { drawnTo: true }), A.hx, A.hy), 6, A.hx, A.hy), weaponR: string + arrow };
        }
        const A = avArm(P, 'R');
        const ANG = { sword: 18, axe: 6, mace: 12, hammer: 8, spear: 30, dagger: 55, staff: 2, scythe: -6, wand: 40 };
        const ang = P.stance && P.stance.wAng !== undefined ? P.stance.wAng + (it.style === 'wand' ? 30 : 0) : (ANG[it.style] === undefined ? 20 : ANG[it.style]);
        return { weaponR: S.rot(painter(S, it, A.hx, A.hy), ang, A.hx, A.hy) };
    },

    offhand(S, it) {
        const P = S.P, k = P.k, A = avArm(P, 'L'), x = A.hx, y = A.hy;
        if (it.style === 'kite' || it.style === 'tower') {
            // a shield held across the body, seen a little from the side
            const w = (it.style === 'tower' ? 15 : 13.5) * k, h = (it.style === 'tower' ? 36 : 30) * k;
            const d = it.style === 'tower'
                ? `M${avN(x - w)} ${avN(y - h * 0.6)} Q${avN(x)} ${avN(y - h * 0.7)} ${avN(x + w)} ${avN(y - h * 0.62)} L${avN(x + w * 0.95)} ${avN(y + h * 0.5)} Q${avN(x)} ${avN(y + h * 0.75)} ${avN(x - w)} ${avN(y + h * 0.52)} Z`
                : `M${avN(x - w)} ${avN(y - h * 0.55)} Q${avN(x)} ${avN(y - h * 0.72)} ${avN(x + w)} ${avN(y - h * 0.58)} L${avN(x + w * 0.9)} ${avN(y + h * 0.08)} Q${avN(x + w * 0.6)} ${avN(y + h * 0.7)} ${avN(x + w * 0.05)} ${avN(y + h)} Q${avN(x - w * 0.6)} ${avN(y + h * 0.7)} ${avN(x - w * 0.92)} ${avN(y + h * 0.1)} Z`;
            // rim thickness on the near edge
            let s = S.path(d, avDark(it.trim || '#c9a24a', 0.35), P.ol * 0.8);
            s = `<g transform="translate(${avN(3 * k)} 0)">${s}</g>`;
            s += S.path(d, S.lin(avLight(it.color, 0.15), avDark(it.color, 0.55), true));
            s += S.path(d, 'none', P.ol * 1.6, it.trim || '#c9a24a');
            const em = it.emblem || '#e8c35a';
            s += it.tier >= 2 ? S.line(`M${avN(x - w * 0.6)} ${avN(y + h * 0.05)} L${avN(x)} ${avN(y - h * 0.3)} L${avN(x + w * 0.6)} ${avN(y + h * 0.05)}`, em, 3 * k) : S.line(`M${avN(x)} ${avN(y - h * 0.4)} L${avN(x + w * 0.05)} ${avN(y + h * 0.6)}`, em, 2.4 * k);
            s += S.circle(x, y + h * 0.3, 4 * k, S.metal(em), 1.2);
            s += avGem(S, x, y - h * 0.05, 3 * k, it);
            s += S.flat(`M${avN(x - w * 0.8)} ${avN(y - h * 0.5)} Q${avN(x - w * 0.3)} ${avN(y - h * 0.62)} ${avN(x)} ${avN(y - h * 0.62)} L${avN(x - w * 0.6)} ${avN(y + h * 0.3)} Z`, '#fff', 0.16);
            return { held: s };
        }
        if (it.style === 'orb') {
            const c = it.glow || '#5fd8ff';
            return { held: S.glow(x + 2, y - 12 * k, 11 * k, c, 0.7) + S.circle(x + 2, y - 12 * k, 6.5 * k, S.radial(avLight(c, 0.7), avDark(c, 0.3)), P.ol * 0.6) + S.circle(x, y - 14 * k, 1.8 * k, '#fff', 0) };
        }
        if (it.style === 'tome') {
            let s = S.path(`M${avN(x - 8 * k)} ${avN(y - 14 * k)} L${avN(x + 10 * k)} ${avN(y - 12 * k)} L${avN(x + 10 * k)} ${avN(y + 8 * k)} L${avN(x - 8 * k)} ${avN(y + 6 * k)} Z`, S.lin(avLight(it.color, 0.1), avDark(it.color, 0.5)));
            s += S.line(`M${avN(x - 5 * k)} ${avN(y - 13.5 * k)} L${avN(x - 5 * k)} ${avN(y + 6.5 * k)}`, '#d4a84a', 1.4 * k);
            s += S.glow(x + 3 * k, y - 3, 5 * k, it.glow || '#b05cff', 0.6) + S.circle(x + 3 * k, y - 3, 2.4 * k, '#e0c0ff', P.ol * 0.4);
            return { held: s };
        }
        if (it.style === 'lantern') {
            let s = S.line(`M${avN(x)} ${avN(y + 2)} L${avN(x)} ${avN(y + 10 * k)}`, '#555', 1.4 * k);
            s += S.glow(x, y + 18 * k, 9 * k, it.glow || '#7dff7a', 0.6);
            s += S.path(`M${avN(x - 5 * k)} ${avN(y + 10 * k)} L${avN(x + 5 * k)} ${avN(y + 10 * k)} L${avN(x + 6 * k)} ${avN(y + 24 * k)} L${avN(x - 6 * k)} ${avN(y + 24 * k)} Z`, S.metal('#5a5f66'));
            s += S.circle(x, y + 17 * k, 3.4 * k, S.lin('#eae0c8', '#8a7a5a'), P.ol * 0.5);
            return { held: s };
        }
        if (it.style === 'dagger') return { held: S.rot(AV_WEAPONS.dagger(S, it, x, y), P.stance && P.stance.offAng !== undefined ? P.stance.offAng : 70, x, y) };
        if (it.style === 'quiver') {
            const qx = P.shL[0] - 4, qy = P.sy - 8;
            const s = S.path(`M${avN(qx - 5 * k)} ${avN(qy - 4)} L${avN(qx + 4 * k)} ${avN(qy - 8)} L${avN(qx + 12 * k)} ${avN(P.wy + 8)} L${avN(qx + 3 * k)} ${avN(P.wy + 12)} Z`, avLeather(S, it.color))
                + [0, 1, 2].map(i => S.line(`M${avN(qx - 2 * k + i * 3 * k)} ${avN(qy - 6)} L${avN(qx - 6 * k + i * 3 * k)} ${avN(qy - 18 * k)}`, '#d8d0c0', 1.2 * k) + S.path(`M${avN(qx - 8 * k + i * 3 * k)} ${avN(qy - 20 * k)} L${avN(qx - 6 * k + i * 3 * k)} ${avN(qy - 15 * k)} L${avN(qx - 4 * k + i * 3 * k)} ${avN(qy - 20 * k)} Z`, it.trim || '#c0392b', 0.8)).join('');
            return { back: s };
        }
        return {};
    },
};

function avCape(S, color, it) {
    const P = S.P, sy = P.sy, fy = P.fy, k = P.k;
    let s = S.path(`M${avN(P.shL[0] - 3)} ${sy - 5} Q${avN(100 - P.sw * 1.7)} ${avN((sy + fy) / 2)} ${avN(100 - P.sw * 1.65)} ${fy - 3} L${avN(100 + P.sw * 0.55)} ${fy - 8} Q${avN(100 + P.sw * 0.45)} ${avN((sy + fy) / 2)} ${avN(P.shR[0] - 6)} ${sy - 6} Z`, S.cloth(color));
    s += S.line(`M${avN(100 - P.sw * 0.7)} ${sy + 20} Q${avN(100 - P.sw * 1.3)} ${avN((sy + fy) / 2)} ${avN(100 - P.sw * 1.3)} ${fy - 8}`, '#000', 2 * k, 0.35);
    s += S.line(`M${avN(100 - P.sw * 0.1)} ${sy + 26} Q${avN(100 - P.sw * 0.5)} ${avN((sy + fy) / 2 + 10)} ${avN(100 - P.sw * 0.4)} ${fy - 10}`, '#000', 2 * k, 0.3);
    if (it && it.tier >= 2) s += S.line(`M${avN(100 - P.sw * 1.65)} ${fy - 4} L${avN(100 + P.sw * 0.55)} ${fy - 9}`, it.trim || '#c9a24a', 2 * k);
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
        if (!it.drawnTo) s += S.line(`M${avN(hx + 1)} ${avN(hy - h + 1)} L${avN(hx + 1)} ${avN(hy + h - 1)}`, '#e8e0cc', 0.9);
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

// --- item icons ----------------------------------------------------------------------
// The inventory draws every item with the same painter that puts it on
// the hero: weapons lie diagonally like a loot icon, armor is painted on an
// invisible mannequin (only the item's own layers), rings and amulets get
// their own little drawings. The crop is measured (getBBox) once per look
// and cached, so any new catalog piece gets a tight icon for free.
const AV_ICON_CACHE = new Map();
const AV_ICON_ORDER = ['back', 'legL', 'bootL', 'legR', 'bootR', 'sleeveL', 'shoulderL', 'gloveL', 'torso', 'belt', 'amulet', 'headBack', 'head', 'sleeveR', 'shoulderR', 'gloveR', 'held', 'weaponR'];
// which body an item is shown on (robes need the robed body, etc.)
function avIconBody(vis, classes) {
    const cls = (classes && classes[0]) || 'warrior';
    return { key: (AV_CLASS_BODY[cls] || 'heavy') + '_m', cls };
}
function avMeasure(inner) {
    if (typeof document === 'undefined' || !document.body) return null;
    let host = document.getElementById('av-measure');
    if (!host) {
        host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        host.id = 'av-measure';
        host.setAttribute('width', '0'); host.setAttribute('height', '0');
        host.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none';
        document.body.appendChild(host);
    }
    host.innerHTML = '<g>' + inner + '</g>';
    try { const b = host.firstChild.getBBox(); return b.width > 0 && b.height > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; } catch (e) { return null; } finally { host.innerHTML = ''; }
}
function avIconRing(S, it) {
    const c = it.glow || '#8fd0ff', g = S.metal(it.trim && it.trim !== '#888888' ? it.trim : '#d4a84a');
    return S.glow(50, 38, 14, c, 0.45)
        + `<ellipse cx="50" cy="58" rx="22" ry="20" fill="none" stroke="${AV_INK}" stroke-width="10"/><ellipse cx="50" cy="58" rx="22" ry="20" fill="none" stroke="${g}" stroke-width="6.5"/>`
        + S.path('M38 40 L50 26 L62 40 L50 50 Z', S.lin(avLight(c, 0.6), avDark(c, 0.35), true), 2) + S.circle(46, 36, 2.2, '#fff', 0);
}
function avIconAmulet(S, it) {
    const c = it.glow || '#e83a3a';
    return S.line('M22 14 Q50 70 78 14', AV_INK, 5) + S.line('M22 14 Q50 70 78 14', '#c9a24a', 2.6)
        + S.glow(50, 66, 16, c, 0.5) + S.path('M50 50 L63 64 L50 84 L37 64 Z', S.metal('#c9a24a'), 2)
        + S.circle(50, 66, 7, S.lin(avLight(c, 0.55), avDark(c, 0.3)), 1.6) + S.circle(47.5, 63.5, 2, '#fff', 0);
}
// SVG markup for an item's icon, or null if there's nothing to draw.
// A two-cell item (itemSize 2) gets a tall 1:2 icon, weapons upright.
// opts.square forces a square icon (the paper doll's slots).
function avItemIcon(item, opts) {
    if (!item) return null;
    const vis = typeof heroItemVisual === 'function' ? heroItemVisual(item) : null;
    const slot = typeof itemSlotOf === 'function' ? itemSlotOf(item) : item.slot;
    const tall = !(opts && opts.square) && typeof itemSize === 'function' && itemSize(item) === 2;
    const key = slot + '|' + JSON.stringify(vis) + '|' + item.rarity + (tall ? '|t' : '');
    if (AV_ICON_CACHE.has(key)) return AV_ICON_CACHE.get(key);
    const classes = typeof itemClasses === 'function' ? itemClasses(item) : null;
    const body = avIconBody(vis, classes);
    const P = avGeom(body.key, body.cls), S = avSession(P);
    P.armPose = { R: P.stance.R, L: P.stance.L };
    let inner = '', box = null;
    const it = vis || { color: '#9aa4b0', trim: '#c9a24a', tier: 1 };
    if (slot === 'ring' || (!vis && slot === 'ring')) { inner = avIconRing(S, it); box = { x: 0, y: 0, w: 100, h: 100 }; }
    else if (slot === 'amulet') { inner = avIconAmulet(S, it); box = { x: 0, y: 0, w: 100, h: 100 }; }
    else if (!vis) { AV_ICON_CACHE.set(key, null); return null; }
    else if (vis.slot === 'weapon' && AV_WEAPONS[vis.style]) {
        // upright at the grip, then laid diagonally
        const drawn = AV_WEAPONS[vis.style](S, Object.assign({}, it, { drawnTo: false }), 100, 150);
        inner = tall ? drawn : S.rot(drawn, vis.style === 'bow' ? 38 : 42, 100, 110);
    } else if (AV_PAINT[vis.slot]) {
        const layers = AV_PAINT[vis.slot](S, it) || {};
        // a chest piece's cape would swamp the icon
        if (vis.slot === 'chest' && layers.torso) delete layers.back;
        // a pair (gloves, boots, pauldrons) reads better as one big piece
        if (['gloves', 'boots', 'shoulders'].indexOf(vis.slot) !== -1) Object.keys(layers).forEach(k => { if (/L$/.test(k) && layers[k.slice(0, -1) + 'R']) delete layers[k]; });
        const keys = AV_ICON_ORDER.filter(k => typeof layers[k] === 'string').concat(Object.keys(layers).filter(k => typeof layers[k] === 'string' && AV_ICON_ORDER.indexOf(k) === -1));
        inner = keys.map(k => layers[k]).join('');
    }
    if (!inner) { AV_ICON_CACHE.set(key, null); return null; }
    if (!box) {
        box = avMeasure(inner) || { x: 40, y: 20, w: 120, h: 160 };
        // square (or 1:2 for a tall item), centered, with room for strokes and glows
        const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
        const h = Math.max(box.h, tall ? box.w * 2 : box.w) * 1.12 + 6, w = tall ? h / 2 : h;
        box = { x: cx - w / 2, y: cy - h / 2, w, h };
    }
    const glow = it.tier >= 3 && it.glow ? `<circle cx="${avN(box.x + box.w / 2)}" cy="${avN(box.y + box.h / 2)}" r="${avN(Math.min(box.w, box.h) * 0.42)}" fill="${it.glow}" fill-opacity=".22" filter="url(#avblur)"/>` : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${avN(box.x)} ${avN(box.y)} ${avN(box.w)} ${avN(box.h)}" width="${tall ? 48 : 96}" height="96"><defs>${S.defs()}</defs>${glow}${inner}</svg>`;
    AV_ICON_CACHE.set(key, svg);
    return svg;
}

// --- composition --------------------------------------------------------------------
// spec: { cls, gender 'm'|'f', skin, hair, hairColor, beard, eyeColor, gear: { slot: item } }
function avBodyKey(spec) { return (AV_CLASS_BODY[spec.cls] || spec.body || 'heavy') + '_' + (spec.gender === 'f' ? 'f' : 'm'); }

function avPaint(spec) {
    const bodyKey = avBodyKey(spec), P = avGeom(bodyKey, spec.cls), S = avSession(P), k = P.k;
    const look = Object.assign({ skin: 0, hair: P.female ? 'long' : 'short', hairColor: 1, beard: 'none' }, spec);
    const skin = S.skin(look.skinTone || AV_SKINS[look.skin || 0]);
    const gear = spec.gear || {};
    const W = gear.weapon && gear.weapon.style, O = gear.offhand && gear.offhand.style;
    // arm poses follow what the hands hold
    // arms follow the class stance (a bow always takes the archer's grip)
    const ST = P.stance;
    P.armPose = W === 'bow' ? { R: AV_STANCES.archer.R, L: AV_STANCES.archer.L } : { R: ST.R, L: ST.L };
    const L = {};
    const add = o => { Object.keys(o || {}).forEach(key => { if (typeof o[key] === 'string') L[key] = (L[key] || '') + o[key]; else L[key] = o[key]; }); };
    Object.keys(gear).forEach(slot => { const it = gear[slot]; if (it && AV_PAINT[slot]) add(AV_PAINT[slot](S, it)); });

    const linen = '#8a7a5e', trouser = '#4e4234';
    const parts = {};
    const clips = [];
    // Split a limb at its middle joint (elbow / knee): two clip regions, the
    // half-plane on each side of the joint; the lower one also takes a disk
    // around the joint so a bent limb never shows a seam.
    const splitAt = (id, a, e, c, r) => {
        let u1x = a[0] - e[0], u1y = a[1] - e[1], u2x = c[0] - e[0], u2y = c[1] - e[1];
        const l1 = Math.hypot(u1x, u1y) || 1, l2 = Math.hypot(u2x, u2y) || 1;
        u1x /= l1; u1y /= l1; u2x /= l2; u2y /= l2;
        let nx = u1x - u2x, ny = u1y - u2y; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const px = -ny, py = nx, F = 600;
        // the lower piece reaches 0.8px past the seam so antialiased edges
        // never leave a hairline gap between the two pieces
        const poly = (sg, o) => { const cx = e[0] - sg * nx * (o || 0), cy = e[1] - sg * ny * (o || 0);
            return [[cx + px * F, cy + py * F], [cx + px * F + sg * nx * F, cy + py * F + sg * ny * F], [cx - px * F + sg * nx * F, cy - py * F + sg * ny * F], [cx - px * F, cy - py * F]]
                .map(q => avN(q[0]) + ',' + avN(q[1])).join(' '); };
        // the upper piece is its half-plane minus the joint disk, so the two
        // pieces never overlap (translucent shading would darken twice)
        const B = AV_BOX;
        clips.push(`<mask id="u${id}" maskUnits="userSpaceOnUse" x="${B[0]}" y="${B[1]}" width="${B[2]}" height="${B[3]}"><polygon points="${poly(1)}" fill="#fff"/><circle cx="${avN(e[0])}" cy="${avN(e[1])}" r="${avN(r)}" fill="#000"/></mask>`);
        clips.push(`<clipPath id="l${id}"><polygon points="${poly(-1, 0.8)}"/><circle cx="${avN(e[0])}" cy="${avN(e[1])}" r="${avN(r + 0.8)}"/></clipPath>`);
        return { upper: body => `<g mask="url(#u${id})">${body}</g>`, lower: body => `<g clip-path="url(#l${id})">${body}</g>` };
    };
    parts.back = L.back || '';
    // legs: thigh + shin (the far leg first, the near one over it)
    const legs = {};
    ['L', 'R'].forEach(sd => {
        const g = avLeg(P, sd);
        let s = S.path(g.d, skin);
        s += L['leg' + sd] || (S.path(g.d, S.cloth(L.legCloth || trouser)) + S.flat(avLimbPath(g.A, g.wt * 0.45, g.wk * 0.5 / 0.85, g.wa * 0.5, 0.05, 0.95), '#000', 0.2));
        if (sd === 'L') s += S.flat(g.d, '#000', 0.12); // the far leg sits in a little shadow
        const cut = splitAt('K' + sd, g.hip, g.knee, g.ank, g.wk * 1.05);
        parts['leg' + sd] = cut.upper(s);
        parts['shin' + sd] = cut.lower(s) + (L['boot' + sd] || S.path(avBootPath(P, g, 6), S.lin('#6b4a30', '#3a2414')));
        legs[sd] = { hip: [avN(g.hip[0]), avN(g.hip[1] - 2)], knee: [avN(g.knee[0]), avN(g.knee[1])], ank: [avN(g.ank[0]), avN(g.ank[1])] };
    });
    // torso
    let t = S.path(`M${avN(P.neckX - 6 * k)} ${P.neck - 4} L${avN(P.neckX + 6 * k)} ${P.neck - 4} L${avN(P.neckX + 7 * k)} ${P.sy - 4} L${avN(P.neckX - 7 * k)} ${P.sy - 4} Z`, skin);
    t += S.path(avTorsoPath(P), skin);
    t += L.torso || (S.path(avTorsoPath(P, 0.5), S.cloth(linen)) + avTorsoShade(S, P, 0.5)
        + S.line(`M${avN(P.front - 5 * k)} ${avN(P.sy - 8)} L${avN(P.front)} ${avN(P.sy + 6)} L${avN(P.front + 5 * k)} ${avN(P.sy - 9)}`, AV_INK, P.ol * 0.5, 0.6));
    t += L.belt || S.line(`M${avN(100 - P.ww * 0.95)} ${P.wy + 1} Q100 ${P.wy + 6} ${avN(100 + P.ww * 0.95)} ${P.wy + 2}`, '#6b5a3a', 3 * k);
    t += L.amulet || '';
    parts.torso = t;
    // head
    let h = L.headBack || '';
    if (!L.hidesHair) h += avHairBack(S, look);
    if (!L.hidesFace) h += avFace(S, look); // a hood / closed helm is the whole head
    if (!L.hidesHair) h += avHairFront(S, look);
    if (!L.hidesFace && !L.hideBeard) h += avBeard(S, look);
    h += L.head || '';
    // eyes that burn out of the dark under a hood / cowl (monsters)
    if (L.hidesFace && look.eyeGlow) {
        const r = P.hr, ey = P.hy + r * 0.1;
        [[0.42, 1], [0.8, 0.7]].forEach(([o, sc]) => { h += S.glow(P.headX + r * o, ey, r * 0.28 * sc, look.eyeGlow, 0.8) + S.ell(P.headX + r * o, ey, r * 0.11 * sc, r * 0.06 * sc, look.eyeGlow, 0); });
    }
    parts.head = h;
    // arms: upper arm + forearm. The far arm sits behind the body; whatever
    // it holds is drawn in front (armLf > foreLf) and turns with it.
    const arms = {};
    ['L', 'R'].forEach(sd => {
        const A = avArm(P, sd);
        let s = S.path(avLimbPath(A, 6.6 * k, 5.8 * k, 5 * k), skin);
        s += L['sleeve' + sd] || S.path(avLimbPath(A, 7.2 * k, 6.3 * k, 5.4 * k, 0, 0.45), S.cloth(linen));
        const hand = L['glove' + sd] || S.circle(A.hx, A.hy, 5 * k * A.f, skin);
        if (sd === 'L') s += S.flat(avLimbPath(A, 7.5 * k, 6.5 * k, 5.5 * k), '#000', 0.14);
        const cut = splitAt('E' + sd, [A.ax, A.ay], [A.ex, A.ey], [A.hx, A.hy], 6.2 * k * A.f);
        parts['arm' + sd] = cut.upper(s) + (L['shoulder' + sd] || '');
        parts['fore' + sd] = cut.lower(s) + hand + (sd === 'R' ? (L.weaponR || '') : '');
        arms[sd] = A;
    });
    if (L.held) parts.foreLf = L.held;
    const pivots = {
        legL: legs.L.hip, legR: legs.R.hip, shinL: legs.L.knee, shinR: legs.R.knee,
        torso: [100, P.hipy + 2], head: [avN(P.neckX), P.neck],
        armL: [avN(arms.L.ax), avN(arms.L.ay)], armR: [avN(arms.R.ax), avN(arms.R.ay)],
        foreL: [avN(arms.L.ex), avN(arms.L.ey)], foreR: [avN(arms.R.ex), avN(arms.R.ey)],
        cape: [avN(P.neckX - 4), P.sy - 6],
    };
    pivots.armLf = pivots.armL;
    pivots.foreLf = pivots.foreL;
    // Each part is drawn on a canvas bigger than the 200x250 body box
    // (AV_BOX), so a weapon held up, a cape or a wide stance can reach past
    // the body box without being cut off; the engine places it with `box`.
    const B = AV_BOX;
    const defs = S.defs() + clips.join('');
    const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${B[0]} ${B[1]} ${B[2]} ${B[3]}" width="${B[2] * 2}" height="${B[3] * 2}"><defs>${defs}</defs>${body}</svg>`;
    // `back` is the cape (a joint of its own: it swings)
    const order = ['back', 'legL', 'shinL', 'legR', 'shinR', 'armL', 'foreL', 'torso', 'head', 'foreLf', 'armR', 'foreR'];
    const svgs = {};
    order.forEach(p => { if (parts[p]) svgs[p] = wrap(parts[p]); });
    const handA = arms[W === 'bow' ? 'L' : 'R'];
    return {
        parts: svgs, order: order.filter(p => parts[p]), pivots,
        // the weapon hand, relative to its elbow (projectile launch point)
        hand: [avN(handA.hx - handA.ex), avN(handA.hy - handA.ey)],
        // the off hand, relative to its elbow (off-hand item effects)
        handL: [avN(arms.L.hx - arms.L.ex), avN(arms.L.hy - arms.L.ey)],
        handSide: W === 'bow' ? 'L' : 'R',
        handJoint: W === 'bow' ? 'foreL' : 'foreR',
        legs, box: AV_BOX, idle: AV_IDLE[spec.cls] || AV_IDLE.warrior,
        portrait: wrap('<ellipse cx="100" cy="240" rx="58" ry="8" fill="#000" fill-opacity=".4"/>' + order.map(p => parts[p] || '').join('')),
    };
}
