// --- MOVE LIBRARY -----------------------------------------------------------------
// What every fighter can do, as data. CombatStage._perform (graphics.js)
// runs a move; CombatStage._pickMove chooses one: several moves exist per
// class per action, the same move never plays twice in a row, and the
// match's power picks the tier:
//   tier 1  a 3-match              - light moves (2-3 per action)
//   tier 2  a 4-match / cross / combo - heavy moves
//   tier 3  5+ in a row / big combo - finishers
//
// A move:
//   kind      'melee' (travels to the target and strikes), 'ranged' (fires a
//             projectile from the hand), 'self' (buffs, stays put)
//   rig       jointed pose from CG_RIGS (warped so its blow/release lands on
//             the impact)
//   approach  melee only: 'dash' | 'leap' | 'blink' | 'charge' | 'slide'
//   shot      ranged only: a CG_SHOTS kind (arena.js); color; launchMs
//   pose      extra body curve (CG_POSE, graphics.js) - self moves, flourishes
//   fx        (stage, ctx) => vector effects on the fighter (CG_VFX)
//   onImpact  (stage, ctx) => extras exactly when the blow lands
//
// Timing: every blow lands CG_IMPACT_DELAY_MS after the move starts - the
// moment game.js/pvp.js/coop.js show the damage and the hit reaction.

function cgImpactMs() { return typeof CG_IMPACT_DELAY_MS !== 'undefined' ? CG_IMPACT_DELAY_MS : 480; }

// match multiplier (1 / 2 / 2.5 / 3+) and cascade depth -> move tier
function cgTierFor(power, combo) {
    const p = Number(power) || 1;
    let tier = p >= 3 ? 3 : p >= 2 ? 2 : 1;
    if ((combo || 0) >= 2) tier = Math.min(3, tier + 1);
    return tier;
}

function cgUltName(classKey) {
    if (typeof CLASSES === 'undefined') return '';
    const c = Object.values(CLASSES).find(k => k.name.toLowerCase() === classKey);
    return c ? c.ultName : '';
}

// Body motion over the move: {travel (px toward the foe), dx/dy (pose
// units, ~1/90 of the fighter's box), lift (px, negative = up), rot, sx,
// sy, alpha, run (leg cycle strength)}.
function cgBodyMotion(move, reach, i) {
    const pose = move.pose;
    if ((move.kind || 'self') !== 'melee' || !reach) return t => (pose ? pose(t) : {});
    const E = CG_EASE, seg = E.seg;
    const a = move.approach || 'dash';
    const arrive = Math.max(0.22, i - 0.1), leave = Math.min(0.8, i + 0.16), home = 0.95;
    return t => {
        const x = pose ? pose(t) : {};
        const out = { dx: 0, dy: 0, rot: x.rot || 0, sx: x.sx || 1, sy: x.sy || 1, alpha: x.alpha, travel: 0, lift: 0, run: 0 };
        const back = E.inOut(seg(t, leave, home));
        if (a === 'blink') {
            // vanish, reappear at the target, strike, vanish, back home
            const inGone = seg(t, 0.1, 0.2), inBack = seg(t, 0.24, 0.34), outGone = seg(t, leave, leave + 0.08), outBack = seg(t, leave + 0.12, home);
            out.travel = t < 0.22 ? 0 : t < leave + 0.1 ? reach : 0;
            out.alpha = t < 0.22 ? 1 - 0.95 * inGone : t < leave ? 0.05 + 0.95 * inBack : t < leave + 0.1 ? 1 - 0.95 * outGone : 0.05 + 0.95 * outBack;
            out.lift = -6 * E.bump(seg(t, 0.2, 0.4));
        } else if (a === 'leap') {
            const go = E.out(seg(t, 0.1, arrive));
            out.travel = reach * go * (1 - back) - 8 * E.bump(seg(t, 0, 0.14));
            out.lift = -Math.min(70, reach * 0.4) * E.bump(seg(t, 0.1, arrive)) - 6 * E.bump(seg(t, leave, home));
            const land = E.bump(seg(t, arrive, arrive + 0.1));
            out.sx *= 1 + 0.12 * land; out.sy *= 1 - 0.12 * land;
        } else if (a === 'charge') {
            const g = seg(t, 0.12, arrive), go = g * g;
            out.travel = (reach + 8 * E.bump(seg(t, arrive, arrive + 0.12))) * go * (1 - back) - 12 * E.bump(seg(t, 0, 0.16));
            out.run = 1.4 * E.bump(Math.min(1, g * 1.1)) + 0.8 * E.bump(seg(t, leave, home));
            out.rot += 0.2 * E.bump(g);
        } else { // dash / slide
            const go = E.inOut(seg(t, 0.08, arrive));
            out.travel = reach * go * (1 - back) - 10 * E.bump(seg(t, 0, 0.16));
            const running = E.bump(seg(t, 0.08, arrive)) + 0.8 * E.bump(seg(t, leave, home));
            if (a === 'slide') { out.sy *= 1 - 0.08 * running; out.rot += 0.12 * running; }
            else out.run = 1.1 * running;
            out.lift = -5 * E.bump(seg(t, leave, home));
        }
        if (x.dx) out.dx = x.dx * 0.3; // a flourish on top, kept small
        return out;
    };
}

// --- small builders -----------------------------------------------------------
// an arc of steel/magic right when the blow lands
function cgSlashAt(color, o) {
    return (s, c) => CG_VFX.slash(s, color, Object.assign({ ms: c.ms, at: Math.max(0, c.impactMs / c.ms - 0.05), cx: 0.66 }, o || {}));
}
function cgAll(...fns) { return (s, c) => fns.forEach(f => f && f(s, c)); }
function cgRingAt(color, o) { return (s, c) => CG_VFX.ring(s, color, Object.assign({ ms: c.ms, at: c.impactMs / c.ms }, o || {})); }
function cgGroundHit(color, n) {
    return (s, c) => { if (!c.foe || !c.arena) return; const p = c.arena.bodyPoint(c.foe, 0); c.arena.dust(p.x, p.y, n || 8); c.arena.impact(p.x, p.y - 6, color, 1); };
}
const CGC = CG_COL;
function cgMelee(id, rig, approach, color, fx, extra) { return Object.assign({ id, kind: 'melee', ms: 1000, rig, approach, color, fx }, extra || {}); }
// a ranged move always gathers a little glow at the caster before the shot
function cgRanged(id, rig, shot, color, fx, extra) {
    const glint = s => CG_VFX.particles(s, color, { n: 5, y: 0.5, rise: 0.12, spread: 0.4, ms: 500 });
    return Object.assign({ id, kind: 'ranged', ms: 1000, rig, shot, color, fx: fx ? cgAll(glint, fx) : glint, launchMs: 230 }, extra || {});
}
function cgSelf(id, rig, pose, fx, extra) { return Object.assign({ id, kind: 'self', ms: 1000, rig, pose, fx }, extra || {}); }

// a potion lifted to the mouth
function cgPotionFx(color) {
    return s => {
        const [w, h] = s.size, f = s.facing;
        const g = new PIXI.Graphics();
        g.roundRect(-4, -9, 8, 12, 3).fill({ color }).rect(-2, -13, 4, 5).fill({ color: 0xd9c6a0 });
        g.circle(-1.5, -5, 1.5).fill({ color: 0xffffff, alpha: 0.7 });
        g.x = w / 2 + f * w * 0.12; g.y = h * 0.62;
        s._vfx(g, 1000, t => { const up = CG_EASE.out(CG_EASE.seg(t, 0.05, 0.35)); g.y = h * (0.62 - 0.3 * up); g.rotation = f * -1.6 * CG_EASE.seg(t, 0.35, 0.6); g.alpha = t > 0.75 ? 1 - CG_EASE.seg(t, 0.75, 1) : 1; });
        CG_VFX.particles(s, CGC.green, { n: 8, at: 0.5 });
    };
}
// several arrows/shots in one move (all arrive together)
function cgExtraShots(n, spread) {
    return (s, c) => {
        if (!c.foe || !c.arena) return;
        for (let i = 1; i <= n; i++) {
            const launch = 230 + i * 45;
            s._after(launch, () => {
                const to = c.arena.bodyPoint(c.foe, 0.5);
                to.y += (i % 2 ? -1 : 1) * spread * i;
                const m = s.lastAction || {};
                c.arena.shoot(m.shot || 'arrow', c.arena.handPoint(s), to, Math.max(60, c.impactMs - launch), m.color || CGC.leaf);
            });
        }
    };
}
function cgOldFx(cls, act) { const A = CG_CLASS_ACTIONS; return (A[cls] && A[cls][act] && A[cls][act].fx) || null; }

// --- HERO CLASSES -----------------------------------------------------------------
const CG_MOVES = {
    warrior: {
        sword: [
            cgMelee('w.overhead', 'overhead', 'dash', CGC.steel, cgSlashAt(CGC.steel, { width: 6 })),
            cgMelee('w.backhand', 'backhand', 'dash', CGC.steel, cgSlashAt(CGC.steel, { a0: 0.4, a1: 2.6, spin: -0.9, width: 6 })),
            cgMelee('w.thrust', 'thrust', 'dash', CGC.white, cgSlashAt(CGC.white, { a0: -0.35, a1: 0.35, r: 0.5, width: 4 })),
            cgMelee('w.bashcut', 'bash', 'charge', CGC.blue, cgAll(cgRingAt(CGC.blue, { y: 0.5, flat: 1, r1: 0.5 }), cgSlashAt(CGC.steel, { width: 6 })), { tier: 2 }),
            cgMelee('w.leapstrike', 'heavy', 'leap', CGC.white, cgAll(cgSlashAt(CGC.white, { r: 0.55, width: 9 }), cgRingAt(CGC.orange, { r1: 0.9 })), { tier: 3, onImpact: cgGroundHit(CGC.orange, 10) }),
        ],
        skull: [
            cgMelee('w.heavy', 'heavy', 'dash', CGC.red, cgAll(cgSlashAt(CGC.red, { a0: -2.6, a1: 0.2, width: 7 }), cgRingAt(CGC.orange))),
            cgMelee('w.uppercut', 'uppercut', 'dash', CGC.red, cgSlashAt(CGC.red, { a0: 1.2, a1: -1.6, spin: -1.2, width: 7 })),
            cgMelee('w.shieldcharge', 'bash', 'charge', CGC.blue, cgAll(s => CG_VFX.dome(s, CGC.blue, { ms: 700 }), cgRingAt(CGC.blue, { r1: 0.8 })), { tier: 2 }),
            cgMelee('w.groundbreaker', 'slam', 'leap', CGC.orange, cgAll(cgSlashAt(CGC.red, { a0: -2.6, a1: 0.4, r: 0.6, width: 10 }), cgRingAt(CGC.orange, { r1: 1.2, width: 6 })), { tier: 3, onImpact: cgGroundHit(CGC.orange, 14) }),
        ],
        shield: [
            cgSelf('w.block', 'block', CG_POSE.brace(0.1), cgOldFx('warrior', 'shield')),
            cgSelf('w.guard', 'guard', CG_POSE.brace(0.06), cgAll(s => CG_VFX.rune(s, CGC.blue, { ms: 1000 }), s => CG_VFX.dome(s, CGC.steel, { ms: 900 }))),
        ],
        heart: [
            cgSelf('w.kneel', 'kneel', CG_POSE.kneel(5), cgOldFx('warrior', 'heart')),
            cgSelf('w.drink', 'drink', CG_POSE.float(3), cgPotionFx(0xe74c3c)),
        ],
        energy: [
            cgSelf('w.roar', 'roar', CG_POSE.roar(), cgOldFx('warrior', 'energy')),
            cgSelf('w.power', 'power', CG_POSE.float(5), cgAll(s => CG_VFX.aura(s, CGC.gold, { pulses: 3 }), s => CG_VFX.particles(s, CGC.gold, { n: 10 }))),
        ],
    },
    berserker: {
        sword: [
            cgMelee('b.whirl', 'spin', 'dash', CGC.red, cgSlashAt(CGC.red, { a0: -Math.PI, a1: Math.PI, r: 0.4, cx: 0.5, spin: 2 }), { pose: CG_POSE.spin(1) }),
            cgMelee('b.chop', 'overhead', 'dash', CGC.red, cgSlashAt(CGC.red, { width: 8 })),
            cgMelee('b.kick', 'kick', 'dash', CGC.orange, cgRingAt(CGC.orange, { y: 0.6, flat: 1, r1: 0.4 })),
            cgMelee('b.frenzy', 'xslash', 'charge', CGC.red, cgAll(cgSlashAt(CGC.red, { a0: -2.3, a1: -0.3 }), cgSlashAt(CGC.orange, { a0: 0.3, a1: 2.3, spin: -0.9 })), { tier: 2 }),
            cgMelee('b.cleave', 'heavy', 'leap', CGC.red, cgAll(cgSlashAt(CGC.red, { r: 0.6, width: 11 }), cgRingAt(CGC.red, { r1: 1.1, width: 6 })), { tier: 3, onImpact: cgGroundHit(CGC.red, 12) }),
        ],
        skull: [
            cgMelee('b.heavy', 'heavy', 'dash', CGC.red, cgAll(s => CG_VFX.aura(s, CGC.red, { pulses: 3 }), cgSlashAt(CGC.red, { width: 8 }))),
            cgMelee('b.uppercut', 'uppercut', 'dash', CGC.orange, cgSlashAt(CGC.orange, { a0: 1.2, a1: -1.6, spin: -1.2, width: 8 })),
            cgRanged('b.axethrow', 'throw', 'dagger', CGC.red, s => CG_VFX.aura(s, CGC.red, { pulses: 2 }), { tier: 2 }),
            cgMelee('b.bloodspin', 'spin', 'charge', CGC.red, cgAll(s => CG_VFX.aura(s, CGC.red, { pulses: 4 }), cgSlashAt(CGC.red, { a0: -Math.PI, a1: Math.PI, r: 0.45, cx: 0.5, spin: 3 })), { tier: 3, pose: CG_POSE.spin(2) }),
        ],
        shield: [
            cgSelf('b.brace', 'roar', CG_POSE.roar(), cgOldFx('berserker', 'shield')),
            cgSelf('b.stance', 'guard', CG_POSE.brace(0.12), cgAll(s => CG_VFX.dome(s, CGC.orange, { ms: 900 }), s => CG_VFX.particles(s, CGC.orange, { n: 6 }))),
        ],
        heart: [
            cgSelf('b.bloodlust', 'roar', CG_POSE.roar(), cgOldFx('berserker', 'heart')),
            cgSelf('b.drink', 'drink', CG_POSE.float(3), cgPotionFx(0xc0392b)),
        ],
        energy: [
            cgSelf('b.power', 'power', CG_POSE.float(5), cgAll(s => CG_VFX.aura(s, CGC.red, { pulses: 3 }), s => CG_VFX.particles(s, CGC.orange, { n: 10 }))),
            cgSelf('b.stomp', 'slam', CG_POSE.slam(8), cgOldFx('berserker', 'energy')),
        ],
    },
    rogue: {
        sword: [
            cgMelee('r.stab', 'stab', 'blink', CGC.purple, cgAll(s => CG_VFX.afterimages(s, CGC.shadow), cgSlashAt(CGC.purple, { width: 3, a0: -1.8, a1: 0.2 }))),
            cgMelee('r.xslash', 'xslash', 'blink', CGC.purple, cgAll(cgSlashAt(CGC.purple, { a0: -2.3, a1: -0.3 }), cgSlashAt(CGC.white, { a0: 0.3, a1: 2.3, spin: -0.9 }))),
            cgRanged('r.daggers', 'throw', 'dagger', CGC.purple, cgExtraShots(1, 8)),
            cgMelee('r.backstab', 'thrust', 'blink', CGC.white, cgAll(s => CG_VFX.afterimages(s, CGC.shadow, { n: 4 }), cgSlashAt(CGC.white, { a0: -0.4, a1: 0.4, r: 0.5 })), { tier: 2 }),
            cgMelee('r.flurry', 'xslash', 'blink', CGC.purple, cgAll(s => CG_VFX.afterimages(s, CGC.shadow, { n: 4 }), ...[0, 1, 2].map(i => cgSlashAt(i % 2 ? CGC.white : CGC.purple, { a0: i % 2 ? 0.3 : -2.3, a1: i % 2 ? 2.3 : -0.3, spin: i % 2 ? -1 : 1 }))), { tier: 3 }),
        ],
        skull: [
            cgMelee('r.gut', 'backhand', 'dash', CGC.purple, cgSlashAt(CGC.purple, { a0: 0.4, a1: 2.6, spin: -0.9 })),
            cgRanged('r.poison', 'throw', 'dagger', CGC.green, s => CG_VFX.particles(s, CGC.green, { n: 5 })),
            cgMelee('r.shadowstep', 'stab', 'blink', CGC.shadow, cgAll(s => CG_VFX.afterimages(s, CGC.shadow, { n: 4 }), cgSlashAt(CGC.purple, { r: 0.5, width: 5 })), { tier: 2 }),
            cgMelee('r.execution', 'uppercut', 'blink', CGC.purple, cgAll(s => CG_VFX.afterimages(s, CGC.shadow, { n: 4 }), cgSlashAt(CGC.white, { a0: 1.2, a1: -1.6, spin: -1.3, r: 0.6, width: 7 }), cgRingAt(CGC.purple, { r1: 1 })), { tier: 3 }),
        ],
        shield: [
            cgSelf('r.dodge', 'dodge', CG_POSE.dodge(18), cgOldFx('rogue', 'shield')),
            cgSelf('r.smoke', 'guard', CG_POSE.float(3), s => CG_VFX.particles(s, 0x8a8a9a, { n: 14, rise: 0.4, spread: 1 })),
        ],
        heart: [
            cgSelf('r.bandage', 'kneel', CG_POSE.kneel(4), cgOldFx('rogue', 'heart')),
            cgSelf('r.drink', 'drink', CG_POSE.float(3), cgPotionFx(0x2ecc71)),
        ],
        energy: [
            cgSelf('r.twirl', 'spin', CG_POSE.spin(1), cgOldFx('rogue', 'energy')),
            cgSelf('r.focus', 'pray', CG_POSE.float(4), s => CG_VFX.orbit(s, CGC.purple, { n: 5, inward: true })),
        ],
    },
    archer: {
        sword: [
            cgRanged('a.shot', 'bow', 'arrow', CGC.leaf, null, { pose: CG_POSE.draw() }),
            cgRanged('a.double', 'bow', 'arrow', CGC.leaf, cgExtraShots(1, 10), { pose: CG_POSE.draw() }),
            cgMelee('a.bowbash', 'backhand', 'dash', CGC.leaf, cgSlashAt(CGC.leaf, { a0: 0.4, a1: 2.6, spin: -0.9, width: 4 })),
            cgRanged('a.power', 'bow', 'arrow', CGC.gold, cgAll(s => CG_VFX.rune(s, CGC.leaf, { ms: 1000 }), cgExtraShots(2, 9)), { tier: 2, pose: CG_POSE.draw() }),
            cgRanged('a.volley', 'bow', 'rain', CGC.leaf, s => CG_VFX.rune(s, CGC.gold, { ms: 1000 }), { tier: 3, launchMs: 160, pose: CG_POSE.draw() }),
        ],
        skull: [
            cgRanged('a.redshot', 'bow', 'arrow', CGC.red, s => CG_VFX.rune(s, CGC.leaf, { ms: 900 }), { pose: CG_POSE.draw() }),
            cgRanged('a.venom', 'bow', 'orb', CGC.green, null, { pose: CG_POSE.draw() }),
            cgRanged('a.pierce', 'bow', 'beam', CGC.leaf, s => CG_VFX.rune(s, CGC.gold, { ms: 1000 }), { tier: 2, pose: CG_POSE.draw() }),
            cgRanged('a.storm', 'bow', 'rain', CGC.red, s => CG_VFX.rune(s, CGC.red, { ms: 1000 }), { tier: 3, launchMs: 160, pose: CG_POSE.draw() }),
        ],
        shield: [
            cgSelf('a.crouch', 'kneel', CG_POSE.kneel(7), cgOldFx('archer', 'shield')),
            cgSelf('a.roll', 'dodge', CG_POSE.dodge(16), s => CG_VFX.particles(s, 0x9a8a6a, { n: 8, y: 0.95, rise: 0.15, spread: 0.8 })),
        ],
        heart: [
            cgSelf('a.herb', 'heal', CG_POSE.float(4), cgOldFx('archer', 'heart')),
            cgSelf('a.drink', 'drink', CG_POSE.float(3), cgPotionFx(0x27ae60)),
        ],
        energy: [
            cgSelf('a.focus', 'power', CG_POSE.float(4), cgOldFx('archer', 'energy')),
            cgSelf('a.wind', 'pray', CG_POSE.float(5), s => CG_VFX.orbit(s, CGC.leaf, { n: 6 })),
        ],
    },
    mage: {
        sword: [
            cgRanged('m.missile', 'cast', 'orb', CGC.cyan, s => CG_VFX.rune(s, CGC.blue, { ms: 900 }), { pose: CG_POSE.float(5) }),
            cgRanged('m.shard', 'push', 'shard', CGC.cyan, null, { pose: CG_POSE.float(4) }),
            cgRanged('m.spark', 'cast', 'bolt', CGC.cyan, s => CG_VFX.orbit(s, CGC.cyan, { n: 3 }), { pose: CG_POSE.float(6) }),
            cgRanged('m.fireball', 'push', 'fireball', CGC.orange, s => CG_VFX.rune(s, CGC.orange, { ms: 900 }), { tier: 2, pose: CG_POSE.float(6) }),
            cgRanged('m.meteor', 'summon', 'meteor', CGC.orange, s => CG_VFX.rune(s, CGC.orange, { ms: 1000, size: 0.65 }), { tier: 3, launchMs: 150, pose: CG_POSE.float(10) }),
        ],
        skull: [
            cgRanged('m.beam', 'cast', 'beam', CGC.cyan, s => CG_VFX.rune(s, CGC.purple, { ms: 900 }), { pose: CG_POSE.float(8) }),
            cgRanged('m.fire', 'push', 'fireball', CGC.orange, null, { pose: CG_POSE.float(6) }),
            cgRanged('m.chain', 'cast', 'bolt', CGC.white, cgAll(s => CG_VFX.orbit(s, CGC.cyan, { n: 5 }), s => CG_VFX.flash(s, CGC.cyan, { ms: 400 })), { tier: 2, pose: CG_POSE.float(8) }),
            cgRanged('m.frost', 'push', 'shard', CGC.cyan, cgAll(s => CG_VFX.rune(s, CGC.cyan, { ms: 1000, size: 0.6 }), cgExtraShots(2, 10)), { tier: 3, pose: CG_POSE.float(8) }),
        ],
        shield: [
            cgSelf('m.barrier', 'cast', CG_POSE.float(5), cgOldFx('mage', 'shield')),
            cgSelf('m.ward', 'guard', CG_POSE.float(4), cgAll(s => CG_VFX.rune(s, CGC.cyan, { ms: 1000, size: 0.6, y: 0.5 }), s => CG_VFX.dome(s, CGC.blue, { ms: 900 }))),
        ],
        heart: [
            cgSelf('m.mend', 'heal', CG_POSE.float(6), cgOldFx('mage', 'heart')),
            cgSelf('m.pray', 'pray', CG_POSE.float(5), s => CG_VFX.pillar(s, CGC.cyan, { ms: 1000 })),
        ],
        energy: [
            cgSelf('m.channel', 'power', CG_POSE.float(6), cgOldFx('mage', 'energy')),
            cgSelf('m.gather', 'summon', CG_POSE.float(6), s => CG_VFX.orbit(s, CGC.gold, { n: 6, inward: true })),
        ],
    },
    necromancer: {
        sword: [
            cgRanged('n.shadowbolt', 'cast', 'orb', CGC.purple, s => CG_VFX.orbit(s, CGC.purple, { n: 3 }), { pose: CG_POSE.float(4) }),
            cgRanged('n.bone', 'throw', 'dagger', CGC.bone, null),
            cgRanged('n.siphon', 'push', 'drain', CGC.purple, s => CG_VFX.aura(s, CGC.shadow, { pulses: 2 }), { tier: 2, pose: CG_POSE.float(5) }),
            cgRanged('n.grasp', 'summon', 'graspers', CGC.purple, s => CG_VFX.rune(s, CGC.purple, { ms: 1000, size: 0.6 }), { tier: 3, launchMs: 170, pose: CG_POSE.kneel(4) }),
        ],
        skull: [
            cgRanged('n.drain', 'push', 'drain', CGC.shadow, s => CG_VFX.aura(s, CGC.shadow, { pulses: 3 }), { pose: CG_POSE.float(4) }),
            cgRanged('n.hex', 'cast', 'beam', CGC.purple, s => CG_VFX.rune(s, CGC.purple, { ms: 900 }), { pose: CG_POSE.float(5) }),
            cgRanged('n.graspers', 'summon', 'graspers', CGC.bone, s => CG_VFX.particles(s, CGC.bone, { n: 6, y: 0.9, rise: 0.4 }), { tier: 2, launchMs: 170, pose: CG_POSE.kneel(4) }),
            cgRanged('n.doom', 'summon', 'graspers', CGC.purple, cgAll(s => CG_VFX.aura(s, CGC.shadow, { pulses: 4 }), s => CG_VFX.rune(s, CGC.purple, { ms: 1000, size: 0.7 })), { tier: 3, launchMs: 150, pose: CG_POSE.float(8), onImpact: cgGroundHit(CGC.purple, 10) }),
        ],
        shield: [
            cgSelf('n.bonewall', 'block', CG_POSE.brace(0.06), cgOldFx('necromancer', 'shield')),
            cgSelf('n.veil', 'guard', CG_POSE.float(4), s => CG_VFX.aura(s, CGC.shadow, { pulses: 2 })),
        ],
        heart: [
            cgSelf('n.leech', 'heal', CG_POSE.float(5), cgOldFx('necromancer', 'heart')),
            cgSelf('n.ritual', 'pray', CG_POSE.float(5), s => CG_VFX.rune(s, CGC.green, { ms: 1000 })),
        ],
        energy: [
            cgSelf('n.dark', 'power', CG_POSE.float(5), cgOldFx('necromancer', 'energy')),
            cgSelf('n.souls', 'summon', CG_POSE.float(6), s => CG_VFX.orbit(s, CGC.bone, { n: 6, inward: true })),
        ],
    },
    paladin: {
        sword: [
            cgMelee('p.hammer', 'slam', 'dash', CGC.gold, cgAll(cgRingAt(CGC.gold), cgSlashAt(CGC.holy, { width: 6 }))),
            cgMelee('p.swing', 'overhead', 'dash', CGC.holy, cgSlashAt(CGC.holy, { width: 7 })),
            cgMelee('p.bash', 'bash', 'charge', CGC.gold, s => CG_VFX.dome(s, CGC.gold, { ms: 700 })),
            cgRanged('p.wave', 'slam', 'wave', CGC.gold, s => CG_VFX.pillar(s, CGC.holy, { ms: 700 }), { tier: 2, launchMs: 200 }),
            cgMelee('p.judgement', 'heavy', 'leap', CGC.gold, cgAll(cgSlashAt(CGC.holy, { r: 0.6, width: 10 }), cgRingAt(CGC.gold, { r1: 1.2, width: 6 })), { tier: 3, onImpact: cgGroundHit(CGC.gold, 12) }),
        ],
        skull: [
            cgMelee('p.crush', 'slam', 'dash', CGC.gold, cgAll(s => CG_VFX.pillar(s, CGC.gold, { ms: 900 }), cgRingAt(CGC.holy, { r1: 0.8 }))),
            cgRanged('p.smite', 'cast', 'smite', CGC.holy, null, { pose: CG_POSE.float(4) }),
            cgRanged('p.holywave', 'slam', 'wave', CGC.holy, cgRingAt(CGC.gold, { r1: 1 }), { tier: 2, launchMs: 200 }),
            cgRanged('p.wrath', 'summon', 'smite', CGC.gold, cgAll(s => CG_VFX.pillar(s, CGC.gold, { ms: 1000 }), s => CG_VFX.flash(s, CGC.holy, { ms: 500 })), { tier: 3, launchMs: 160, pose: CG_POSE.float(8) }),
        ],
        shield: [
            cgSelf('p.aegis', 'block', CG_POSE.brace(0.08), cgOldFx('paladin', 'shield')),
            cgSelf('p.guard', 'guard', CG_POSE.brace(0.06), cgAll(s => CG_VFX.rune(s, CGC.gold, { ms: 1000 }), s => CG_VFX.dome(s, CGC.holy, { ms: 900 }))),
        ],
        heart: [
            cgSelf('p.light', 'heal', CG_POSE.float(5), cgOldFx('paladin', 'heart')),
            cgSelf('p.prayer', 'pray', CG_POSE.kneel(3), cgAll(s => CG_VFX.pillar(s, CGC.holy, { ms: 1000 }), s => CG_VFX.particles(s, CGC.holy, { n: 10 }))),
        ],
        energy: [
            cgSelf('p.vow', 'power', CG_POSE.float(4), cgOldFx('paladin', 'energy')),
            cgSelf('p.halo', 'pray', CG_POSE.float(5), s => CG_VFX.ring(s, CGC.gold, { y: 0.12, flat: 0.3, r0: 0.2, r1: 0.7 })),
        ],
    },
};

// The ultimate: one signature move per class, always a finisher.
const CG_ULTS = {
    warrior: cgMelee('w.ult', 'heavy', 'leap', CGC.white, cgAll(s => CG_VFX.afterimages(s, CGC.steel), cgSlashAt(CGC.white, { r: 0.6, width: 11 }), cgRingAt(CGC.blue, { r1: 1.3, width: 7 })), { tier: 3, ms: 1300, onImpact: cgGroundHit(CGC.blue, 16) }),
    berserker: cgMelee('b.ult', 'spin', 'charge', CGC.red, cgAll(s => CG_VFX.aura(s, CGC.red, { ms: 1300, pulses: 5 }), cgSlashAt(CGC.red, { a0: -Math.PI, a1: Math.PI, r: 0.5, cx: 0.5, spin: 3 }), cgSlashAt(CGC.orange, { a0: -Math.PI, a1: Math.PI, r: 0.4, cx: 0.5, spin: -3 })), { tier: 3, ms: 1300, pose: CG_POSE.spin(3), onImpact: cgGroundHit(CGC.red, 14) }),
    rogue: cgMelee('r.ult', 'xslash', 'blink', CGC.purple, cgAll(s => CG_VFX.afterimages(s, CGC.shadow, { n: 5 }), ...[0, 1, 2, 3].map(i => (s, c) => CG_VFX.slash(s, i % 2 ? CGC.white : CGC.purple, { ms: c.ms, at: c.impactMs / c.ms - 0.12 + i * 0.05, a0: i % 2 ? 0.3 : -2.3, a1: i % 2 ? 2.3 : -0.3, spin: i % 2 ? -1 : 1, cx: 0.66 }))), { tier: 3, ms: 1300 }),
    archer: cgRanged('a.ult', 'bow', 'rain', CGC.gold, cgAll(s => CG_VFX.rune(s, CGC.gold, { ms: 1300, size: 0.7 }), s => CG_VFX.beam(s, CGC.leaf, { ms: 900 })), { tier: 3, ms: 1300, launchMs: 140, pose: CG_POSE.draw() }),
    mage: cgRanged('m.ult', 'summon', 'meteor', CGC.orange, cgAll(s => CG_VFX.rune(s, CGC.cyan, { ms: 1300, size: 0.75 }), s => CG_VFX.orbit(s, CGC.blue, { n: 6, ms: 1300, inward: true })), { tier: 3, ms: 1300, launchMs: 120, pose: CG_POSE.float(12) }),
    necromancer: cgRanged('n.ult', 'summon', 'graspers', CGC.purple, cgAll(s => CG_VFX.aura(s, CGC.shadow, { ms: 1300, pulses: 5 }), s => CG_VFX.rune(s, CGC.purple, { ms: 1300, size: 0.7 })), { tier: 3, ms: 1300, launchMs: 120, pose: CG_POSE.float(10), onImpact: (s, c) => { if (c.foe && c.arena) c.arena.shoot('drain', c.arena.handPoint(s), c.arena.bodyPoint(c.foe, 0.5), 300, CGC.green); } }),
    paladin: cgRanged('p.ult', 'summon', 'smite', CGC.holy, cgAll(s => CG_VFX.pillar(s, CGC.gold, { ms: 1300 }), s => CG_VFX.flash(s, CGC.holy, { ms: 600 })), { tier: 3, ms: 1400, launchMs: 120, pose: CG_POSE.float(10), onImpact: cgGroundHit(CGC.gold, 14) }),
};

// --- MONSTERS -----------------------------------------------------------------------
const CG_MONSTER_MOVES = {
    monster_normal: {
        attack: [
            cgMelee('mn.club', 'overhead', 'dash', 0xc9955a, cgSlashAt(0xc9955a, { width: 6 })),
            cgMelee('mn.swipe', 'backhand', 'dash', 0xc9955a, cgSlashAt(0xc9955a, { a0: 0.4, a1: 2.6, spin: -0.9, width: 5 })),
            cgMelee('mn.kick', 'kick', 'dash', CGC.orange, cgRingAt(CGC.orange, { y: 0.6, flat: 1, r1: 0.4 })),
            cgMelee('mn.smash', 'heavy', 'leap', CGC.orange, cgSlashAt(CGC.orange, { r: 0.55, width: 8 }), { tier: 2, onImpact: cgGroundHit(CGC.orange, 8) }),
        ],
        buff: [cgSelf('mn.roar', 'roar', CG_POSE.roar(), s => CG_VFX.aura(s, CGC.leaf)), cgSelf('mn.flex', 'power', CG_POSE.float(4), s => CG_VFX.particles(s, CGC.leaf, { n: 8 }))],
    },
    monster_armored: {
        attack: [
            cgMelee('ma.slam', 'slam', 'dash', 0xaab4c0, cgRingAt(0xaab4c0, { r1: 0.9, width: 6 }), { onImpact: cgGroundHit(0x8a8f96, 8) }),
            cgMelee('ma.bash', 'bash', 'charge', CGC.cyan, s => CG_VFX.dome(s, CGC.cyan, { ms: 700 })),
            cgMelee('ma.quake', 'heavy', 'leap', 0xaab4c0, cgRingAt(0xaab4c0, { r1: 1.2, width: 7 }), { tier: 2, onImpact: cgGroundHit(0x8a8f96, 14) }),
        ],
        buff: [cgSelf('ma.shell', 'block', CG_POSE.brace(0.06), s => CG_VFX.dome(s, CGC.cyan)), cgSelf('ma.guard', 'guard', CG_POSE.brace(0.05), s => CG_VFX.rune(s, CGC.cyan, { ms: 900 }))],
    },
    monster_swift: {
        attack: [
            cgMelee('ms.stab', 'stab', 'blink', CGC.orange, cgAll(s => CG_VFX.afterimages(s, CGC.red), cgSlashAt(CGC.orange, { width: 3 }))),
            cgMelee('ms.slice', 'xslash', 'slide', CGC.orange, cgAll(cgSlashAt(CGC.orange, { a0: -2.3, a1: -0.3 }), cgSlashAt(CGC.red, { a0: 0.3, a1: 2.3, spin: -0.9 }))),
            cgRanged('ms.knife', 'throw', 'dagger', CGC.orange, null),
            cgMelee('ms.flurry', 'xslash', 'blink', CGC.red, cgAll(s => CG_VFX.afterimages(s, CGC.red, { n: 4 }), cgSlashAt(CGC.red, { r: 0.5 }), cgSlashAt(CGC.orange, { a0: 0.3, a1: 2.3, spin: -1 })), { tier: 2 }),
        ],
        buff: [cgSelf('ms.spin', 'spin', CG_POSE.spin(1), s => CG_VFX.particles(s, CGC.orange, { n: 8 })), cgSelf('ms.hop', 'dodge', CG_POSE.dodge(14), s => CG_VFX.afterimages(s, CGC.red))],
    },
    monster_drain: {
        attack: [
            cgRanged('md.orb', 'cast', 'orb', CGC.purple, s => CG_VFX.orbit(s, CGC.purple, { n: 4 })),
            cgRanged('md.drain', 'push', 'drain', CGC.purple, s => CG_VFX.aura(s, CGC.purple, { pulses: 2 })),
            cgRanged('md.hex', 'cast', 'bolt', CGC.purple, null),
            cgRanged('md.void', 'summon', 'beam', CGC.shadow, s => CG_VFX.rune(s, CGC.purple, { ms: 1000, size: 0.6 }), { tier: 2 }),
        ],
        buff: [cgSelf('md.feed', 'heal', CG_POSE.float(6), s => CG_VFX.aura(s, CGC.purple, { pulses: 3 })), cgSelf('md.gather', 'summon', CG_POSE.float(6), s => CG_VFX.orbit(s, CGC.purple, { n: 6, inward: true }))],
    },
    monster_boss: {
        attack: [
            cgMelee('mb.charge', 'charge', 'charge', CGC.red, cgAll(s => CG_VFX.afterimages(s, CGC.red), cgSlashAt(CGC.red, { r: 0.55, width: 8 }))),
            cgMelee('mb.axe', 'heavy', 'dash', CGC.red, cgAll(cgSlashAt(CGC.red, { r: 0.6, width: 10 }), cgRingAt(CGC.orange, { r1: 0.9 }))),
            cgRanged('mb.fire', 'push', 'fireball', CGC.orange, null),
            cgRanged('mb.quake', 'slam', 'wave', CGC.orange, cgRingAt(CGC.orange, { r1: 1.1, width: 6 }), { tier: 2, launchMs: 200 }),
            cgMelee('mb.crush', 'slam', 'leap', CGC.red, cgAll(cgSlashAt(CGC.red, { r: 0.7, width: 12 }), cgRingAt(CGC.red, { r1: 1.4, width: 8 })), { tier: 3, onImpact: cgGroundHit(CGC.red, 16) }),
        ],
        // an enraged boss (under half HP) also throws meteors
        enraged: [cgRanged('mb.meteor', 'summon', 'meteor', CGC.orange, s => CG_VFX.aura(s, CGC.red, { pulses: 4 }), { tier: 2, launchMs: 150 })],
        buff: [cgSelf('mb.roar', 'roar', CG_POSE.roar(), s => { CG_VFX.aura(s, CGC.red, { pulses: 4 }); CG_VFX.particles(s, CGC.orange, { n: 10 }); }), cgSelf('mb.power', 'power', CG_POSE.float(5), s => CG_VFX.ring(s, CGC.red, { y: 0.45, flat: 1, r1: 0.9 }))],
    },
};

// --- WEAPON-TYPE MOVES ------------------------------------------------------------
// Extra attacks for what's actually in the hand (hero avatars only - see
// playClassMotion): an axe cleaves wide, a mace or hammer smashes the
// ground, a spear lunges from far, daggers flurry, a scythe reaps. They
// join the class's own list, so a warrior with a spear still fights like a
// warrior - just with some spear work mixed in.
const CG_WEAPON_MOVES = {
    axe: {
        sword: [cgMelee('wx.cleave', 'spin', 'charge', CGC.steel, cgSlashAt(CGC.steel, { a0: -2.6, a1: 2.6, spin: 1.4, r: 0.55, width: 8 })),
            cgMelee('wx.chop', 'overhead', 'leap', CGC.orange, cgAll(cgSlashAt(CGC.white, { a0: -1.9, a1: 0.2, width: 9 }), cgRingAt(CGC.orange, { r1: 0.7 })), { tier: 2, onImpact: cgGroundHit(CGC.orange, 8) })],
    },
    mace: {
        sword: [cgMelee('wm.smash', 'heavy', 'dash', CGC.steel, cgRingAt(CGC.white, { r1: 0.6 }), { onImpact: cgGroundHit(0xaab4c0, 8) }),
            cgMelee('wm.crush', 'slam', 'leap', CGC.gold, cgAll(cgRingAt(CGC.gold, { y: 0.5, flat: 1, r1: 0.9 }), cgSlashAt(CGC.gold, { a0: -1.6, a1: 0.4, width: 7 })), { tier: 2, onImpact: cgGroundHit(CGC.gold, 12) })],
    },
    spear: {
        sword: [cgMelee('ws.lunge', 'thrust', 'slide', CGC.white, cgSlashAt(CGC.white, { a0: -0.2, a1: 0.2, r: 0.7, width: 3 })),
            cgMelee('ws.vault', 'thrust', 'leap', CGC.blue, cgAll(cgSlashAt(CGC.white, { a0: -0.5, a1: 0.5, r: 0.6, width: 4 }), cgRingAt(CGC.blue, { r1: 0.5 })), { tier: 2 })],
    },
    dagger: {
        sword: [cgMelee('wd.flurry', 'stab', 'blink', CGC.purple, cgAll(cgSlashAt(CGC.white, { a0: -0.8, a1: 0.6, r: 0.4, width: 3 }), cgSlashAt(CGC.purple, { a0: 0.6, a1: -0.8, r: 0.42, width: 3, at: 0.55 })))],
    },
    scythe: {
        sword: [cgMelee('wy.reap', 'spin', 'slide', CGC.purple, cgSlashAt(CGC.purple, { a0: -2.8, a1: 1.2, spin: 1.1, r: 0.6, width: 7 }))],
        skull: [cgMelee('wy.harvest', 'backhand', 'blink', CGC.bone, cgAll(cgSlashAt(CGC.bone, { a0: 1.2, a1: -2.2, r: 0.6, width: 8 }), cgRingAt(CGC.purple, { r1: 0.6 })), { tier: 2 })],
    },
};
CG_WEAPON_MOVES.hammer = CG_WEAPON_MOVES.mace;
function cgWeaponMoves(style, action) {
    const set = CG_WEAPON_MOVES[style];
    return (set && set[action]) || [];
}

// Every move gets a readable default length: melee/ranged ~1s (impact at
// the midpoint), self moves 1s.
function cgMovesFor(classKey, action) {
    const set = CG_MOVES[classKey];
    return set ? set[action] || null : null;
}
function cgUltMove(classKey) { return CG_ULTS[classKey] || null; }
function cgMonsterMoves(charKey, kind, enraged) {
    const set = CG_MONSTER_MOVES[charKey] || CG_MONSTER_MOVES.monster_normal;
    const list = set[kind] || [];
    return enraged && set.enraged ? list.concat(set.enraged) : list;
}
