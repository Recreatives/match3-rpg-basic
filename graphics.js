// --- 2D COMBAT GRAPHICS (PixiJS character portraits + hit/ultimate effects) ---
// Purely a presentation layer bolted onto the existing DOM/CSS game - no combat
// rule, RNG, or network logic lives here. Every mode (solo/PvP/co-op) creates
// one "stage" per portrait slot it needs (see cgCreateStage) and calls into it
// at three moments: when a combatant is decided (cgStage.setPortrait), when a
// tile match resolves (cgStage.playHit), and when an ultimate fires
// (cgStage.playUlt). Nothing here assumes which mode is calling it.
//
// All stages share ONE WebGL renderer and ticker (see cgShared below) and
// only repaint while visible and actually changing - a portrait sitting in
// a closed PvP/co-op modal costs nothing.
//
// Character/monster portraits and board tiles: original vector art (tools/). Effect art credit:
// Kenney (kenney.nl). See assets/CREDITS.md.

// Faz 12 (graphics roadmap, 2nd wave) - a manual "low graphics mode",
// independent of the OS's prefers-reduced-motion (Faz 6, style.css).
// Reduced-motion means "this motion bothers me" (a vestibular/accessibility
// signal) - a completely different motivation from "my device is weak, I
// want the extra flourish effects off", which a player with zero motion
// sensitivity on a strong phone would never set, and a player on a weak
// phone with no motion sensitivity has no OS setting for at all. Gates the
// actual JS-side DOM churn (confetti pieces, tile bursts, board shakes,
// boss flashes), not just their CSS animation duration - Faz 6's reset
// alone still pays the cost of CREATING dozens of short-lived elements per
// event, which is the real performance line item on a weak GPU, not how
// long they visually animate for.
const CG_LOW_GRAPHICS_KEY = 'pixelDungeonLowGraphics';
// G4 (roadmap v2) - who decided the current mode: 'manual' once the player
// has pressed the 🎨/🐢 button (that choice is final - auto-detection never
// touches it again), 'auto' when the FPS check below lowered it, absent
// otherwise.
const CG_QUALITY_SOURCE_KEY = 'pixelDungeonQualitySource';
let cgLowGraphics = localStorage.getItem(CG_LOW_GRAPHICS_KEY) === 'true';
let cgQualitySource = localStorage.getItem(CG_QUALITY_SOURCE_KEY);

function cgEffectsEnabled() { return !cgLowGraphics; }

// 'high' | 'low-auto' | 'low-manual' - shown in the ?debug=1 overlay.
function cgQualityLevel() {
    if (!cgLowGraphics) return 'high';
    return cgQualitySource === 'auto' ? 'low-auto' : 'low-manual';
}

function cgApplyLowGraphicsState() {
    document.documentElement.classList.toggle('low-graphics-mode', cgLowGraphics);
    let btn = document.getElementById('low-graphics-btn');
    if (btn) btn.innerText = cgLowGraphics ? '🐢' : '🎨';
}

function cgToggleLowGraphics() {
    cgLowGraphics = !cgLowGraphics;
    cgQualitySource = 'manual';
    localStorage.setItem(CG_LOW_GRAPHICS_KEY, String(cgLowGraphics));
    localStorage.setItem(CG_QUALITY_SOURCE_KEY, 'manual');
    cgApplyLowGraphicsState();
}

// G4 - automatic quality. A weak phone shouldn't need the player to find
// the 🐢 button: a few seconds after boot, the real frame rate is sampled
// (requestAnimationFrame, i.e. what the player actually sees) and, if it's
// consistently low, the same low-graphics mode is switched on - and
// remembered as an AUTO decision. A manual choice always wins and is never
// overridden. A hidden tab (no frames at all) proves nothing and is skipped.
const CG_AUTO_LOW_FPS = 40;
const CG_AUTO_SAMPLE_MS = 3000;

function cgMeasureFps(ms) {
    return new Promise(resolve => {
        let frames = 0, running = true;
        const start = performance.now();
        const loop = () => { if (!running) return; frames++; requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        setTimeout(() => {
            running = false;
            const seconds = (performance.now() - start) / 1000;
            // Only trust a sample that really lasted about as long as asked
            // and saw a real number of frames - a throttled/background tab
            // or a test's fake clock gives nonsense otherwise.
            const trustworthy = frames >= 10 && seconds >= (ms / 1000) * 0.8;
            resolve(trustworthy ? frames / seconds : null);
        }, ms);
    });
}

function cgPageVisible() { return !document.visibilityState || document.visibilityState === 'visible'; }

async function cgRunAutoQuality() {
    if (cgQualitySource === 'manual' || cgLowGraphics) return cgQualityLevel();
    if (!cgPageVisible()) return cgQualityLevel();
    const fps = await cgMeasureFps(CG_AUTO_SAMPLE_MS);
    if (fps === null || cgQualitySource === 'manual') return cgQualityLevel();
    if (fps < CG_AUTO_LOW_FPS) {
        cgLowGraphics = true;
        cgQualitySource = 'auto';
        localStorage.setItem(CG_LOW_GRAPHICS_KEY, 'true');
        localStorage.setItem(CG_QUALITY_SOURCE_KEY, 'auto');
        cgApplyLowGraphicsState();
    }
    return cgQualityLevel();
}

// Original vector portraits (tools/make_characters.py): one SVG per hero
// class and monster type, loaded as a single high-resolution texture. All
// motion is done in code - idle breathing (cgFrame), class motions, attack
// lunge, hit knockback, death - so every character animates the same way
// at any size and pixel ratio.
const CHARACTER_SPRITES = {
    warrior: 'assets/characters/warrior.svg',
    berserker: 'assets/characters/berserker.svg',
    rogue: 'assets/characters/rogue.svg',
    archer: 'assets/characters/archer.svg',
    mage: 'assets/characters/mage.svg',
    necromancer: 'assets/characters/necromancer.svg',
    paladin: 'assets/characters/paladin.svg',
};

const MONSTER_SPRITES = {
    normal: 'assets/characters/monster_normal.svg',
    armored: 'assets/characters/monster_armored.svg',
    swift: 'assets/characters/monster_swift.svg',
    drain: 'assets/characters/monster_drain.svg',
    boss: 'assets/characters/monster_boss.svg',
};

// Presentation randomness (which move variant, spark angles...) uses its
// own generator so animations never consume the game's Math.random - the
// board/AI sequence (and tests' seeded worlds) stay independent of how many
// frames happened to render.
let cgRandState = (Date.now() ^ 0x9e3779b9) >>> 0;
function cgRand() {
    cgRandState ^= cgRandState << 13; cgRandState >>>= 0;
    cgRandState ^= cgRandState >>> 17;
    cgRandState ^= cgRandState << 5; cgRandState >>>= 0;
    return cgRandState / 4294967296;
}

// Idle breathing: a slow squash-and-stretch, repainted at ~15fps (plenty
// for motion this subtle, and far cheaper than 60 on a phone).
const CG_BREATH_STEP_MS = 66;

// --- CLASS CHOREOGRAPHY (per-class, per-action animation + vector CG_VFX) ------
// Every hero class has its OWN move for every action - sword, skull, heart,
// shield, energy and its ultimate - and every monster type its own attack
// and buff. A move = a pose curve for the portrait sprite (anticipation ->
// action -> recovery) plus vector effects drawn with PIXI.Graphics inside
// the portrait's own stage: sword arcs, a shield dome, a spinning rune
// circle, a pillar of light, an arrow, shadow afterimages, auras, particles.
// Heroes face right (+x toward the enemy), monsters face left.
//
// Pose helpers return {dx, dy, rot, sx, sy, alpha} for t in [0,1]; every
// value is an offset/multiplier from the resting pose.
const CG_EASE = {
    out: t => 1 - Math.pow(1 - t, 3),
    inOut: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    bump: t => Math.sin(Math.PI * Math.min(1, Math.max(0, t))),
    seg: (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a))),
};
const CG_POSE = {
    // wind back, strike forward, settle
    strike: (back, fwd, rot = 0.25) => t => {
        const w = CG_EASE.seg(t, 0, 0.3), s = CG_EASE.seg(t, 0.3, 0.55), r = CG_EASE.seg(t, 0.55, 1);
        const dx = -back * CG_EASE.out(w) + (back + fwd) * CG_EASE.out(s) - fwd * CG_EASE.inOut(r);
        const rt = -rot * 0.6 * CG_EASE.out(w) + rot * 1.6 * CG_EASE.out(s) - rot * CG_EASE.inOut(r);
        return { dx, dy: 0, rot: rt, sx: 1 + 0.06 * CG_EASE.bump(s), sy: 1 };
    },
    // rise, then slam down with a squash
    slam: (up, rot = 0) => t => {
        const u = CG_EASE.seg(t, 0, 0.4), d = CG_EASE.seg(t, 0.4, 0.55), r = CG_EASE.seg(t, 0.55, 1);
        return { dx: 4 * CG_EASE.bump(t), dy: -up * CG_EASE.out(u) + up * CG_EASE.out(d) + 3 * CG_EASE.bump(r), rot: rot * CG_EASE.bump(u),
                 sx: 1 + 0.12 * CG_EASE.bump(r), sy: 1 - 0.12 * CG_EASE.bump(r) };
    },
    // turns in place (a horizontal flip-through, like spinning on the spot)
    // rather than rotating around the feet, which would fling the character
    // out of its own portrait canvas
    spin: (turns = 1) => t => ({ dx: 6 * CG_EASE.bump(t), dy: -5 * CG_EASE.bump(t), rot: 0.08 * Math.sin(t * Math.PI * 4),
                                  sx: Math.cos(Math.PI * 2 * turns * CG_EASE.inOut(t)), sy: 1 + 0.05 * CG_EASE.bump(t) }),
    brace: (amt = 0.1) => t => ({ dx: -3 * CG_EASE.bump(t), dy: 3 * CG_EASE.bump(t), rot: -0.05 * CG_EASE.bump(t), sx: 1 + amt * CG_EASE.bump(t), sy: 1 - amt * 0.8 * CG_EASE.bump(t) }),
    float: (up) => t => ({ dx: 0, dy: -up * CG_EASE.bump(t), rot: 0.05 * Math.sin(t * Math.PI * 4), sx: 1, sy: 1 + 0.04 * CG_EASE.bump(t) }),
    kneel: (down) => t => ({ dx: 0, dy: down * CG_EASE.bump(t), rot: 0, sx: 1 + 0.05 * CG_EASE.bump(t), sy: 1 - 0.08 * CG_EASE.bump(t) }),
    roar: () => t => ({ dx: Math.sin(t * 60) * 2 * CG_EASE.bump(t), dy: 0, rot: 0, sx: 1 + 0.1 * CG_EASE.bump(t), sy: 1 + 0.1 * CG_EASE.bump(t) }),
    blink: (dist) => t => {
        const out = CG_EASE.seg(t, 0.1, 0.25), back = CG_EASE.seg(t, 0.65, 0.85);
        return { dx: dist * (t < 0.65 ? CG_EASE.out(CG_EASE.seg(t, 0.15, 0.3)) : 1 - CG_EASE.out(back)), dy: -4 * CG_EASE.bump(t), rot: 0.1 * CG_EASE.bump(t),
                 sx: 1, sy: 1, alpha: t < 0.25 ? 1 - out * 0.85 : t > 0.8 ? 1 : 0.15 + 0.85 * CG_EASE.seg(t, 0.3, 0.45) };
    },
    draw: () => t => {
        const d = CG_EASE.seg(t, 0, 0.45), f = CG_EASE.seg(t, 0.45, 0.6), r = CG_EASE.seg(t, 0.6, 1);
        return { dx: -7 * CG_EASE.out(d) + 12 * CG_EASE.out(f) - 5 * CG_EASE.inOut(r), dy: 0, rot: -0.08 * CG_EASE.out(d) + 0.08 * CG_EASE.out(f), sx: 1, sy: 1 };
    },
    dodge: (dist) => t => ({ dx: -dist * CG_EASE.bump(t), dy: -3 * CG_EASE.bump(t), rot: -0.2 * CG_EASE.bump(t), sx: 1, sy: 1 }),
    charge: (dist) => t => {
        const c = CG_EASE.seg(t, 0.15, 0.4), r = CG_EASE.seg(t, 0.55, 1);
        return { dx: -5 * CG_EASE.bump(CG_EASE.seg(t, 0, 0.15)) + dist * CG_EASE.out(c) - dist * CG_EASE.inOut(r), dy: 0, rot: 0.18 * CG_EASE.bump(c), sx: 1 + 0.08 * CG_EASE.bump(c), sy: 1 };
    },
};

// Vector effects. Coordinates are in the portrait's own pixel space
// (w x h, feet at the bottom center). `f` = facing (+1 hero, -1 monster).
const CG_VFX = {
    // a crescent sword arc in front of the character
    slash(st, color, { a0 = -2.1, a1 = 0.5, r = 0.42, width = 5, at = 0.3, ms = 520, cx = 0.62, cy = 0.5, spin = 0.9 } = {}) {
        const [w, h] = st.size, f = st.facing;
        const g = new PIXI.Graphics();
        g.arc(0, 0, h * r, a0, a1).stroke({ width: width * 2.6, color, alpha: 0.35, cap: 'round' });
        g.arc(0, 0, h * r, a0, a1).stroke({ width, color, alpha: 1, cap: 'round' });
        g.arc(0, 0, h * r * 0.9, a0 + 0.3, a1 - 0.1).stroke({ width: width * 0.45, color: 0xffffff, alpha: 1, cap: 'round' });
        g.x = w * (f > 0 ? cx : 1 - cx); g.y = h * cy; g.scale.x = f;
        st._vfx(g, ms, t => { g.alpha = t < at ? 0 : 1 - Math.pow(CG_EASE.seg(t, at, 1), 2); g.rotation = f * spin * CG_EASE.out(CG_EASE.seg(t, at, 1)); g.scale.set(f * (0.8 + 0.3 * CG_EASE.seg(t, at, 1)), 0.8 + 0.3 * CG_EASE.seg(t, at, 1)); });
    },
    ring(st, color, { x = 0.5, y = 0.92, r0 = 0.1, r1 = 0.55, width = 4, flat = 0.35, ms = 700, at = 0 } = {}) {
        const [w, h] = st.size;
        const g = new PIXI.Graphics();
        g.circle(0, 0, h * 0.5).stroke({ width: width / 0.5, color, alpha: 1 });
        g.x = w * x; g.y = h * y;
        st._vfx(g, ms, t => { const k = CG_EASE.seg(t, at, 1); const s = r0 + (r1 - r0) * CG_EASE.out(k); g.scale.set(s, s * flat); g.alpha = t < at ? 0 : 1 - k; });
    },
    dome(st, color, { ms = 950 } = {}) {
        const [w, h] = st.size;
        const g = new PIXI.Graphics();
        g.ellipse(0, 0, w * 0.46, h * 0.5).fill({ color, alpha: 0.2 }).stroke({ width: 3, color, alpha: 0.95 });
        g.ellipse(-w * 0.14, -h * 0.22, w * 0.12, h * 0.08).fill({ color: 0xffffff, alpha: 0.45 });
        g.x = w / 2; g.y = h * 0.52;
        st._vfx(g, ms, t => { const p = CG_EASE.seg(t, 0, 0.2); g.scale.set(0.6 + 0.45 * CG_EASE.out(p) - 0.05 * CG_EASE.seg(t, 0.2, 0.35)); g.alpha = t < 0.75 ? 1 : 1 - CG_EASE.seg(t, 0.75, 1); });
    },
    pillar(st, color, { ms = 1000 } = {}) {
        const [w, h] = st.size;
        const g = new PIXI.Graphics();
        for (let i = 0; i < 4; i++) g.rect(-w * (0.34 - i * 0.07), -h, w * (0.68 - i * 0.14), h * 1.02).fill({ color: i === 3 ? 0xffffff : color, alpha: 0.18 + i * 0.12 });
        g.x = w / 2; g.y = h;
        st._vfx(g, ms, t => { g.scale.x = 0.3 + 0.7 * CG_EASE.out(CG_EASE.seg(t, 0, 0.25)); g.alpha = t < 0.7 ? CG_EASE.seg(t, 0, 0.15) : 1 - CG_EASE.seg(t, 0.7, 1); }, true);
    },
    rune(st, color, { ms = 1000, size = 0.5, y = 0.96 } = {}) {
        const [w, h] = st.size;
        const c = new PIXI.Container();
        const g = new PIXI.Graphics();
        const R = w * size;
        g.circle(0, 0, R).stroke({ width: 3, color, alpha: 1 }).circle(0, 0, R * 0.78).stroke({ width: 1.5, color, alpha: 0.8 });
        const pts = [];
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 - Math.PI / 2; pts.push(Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78); }
        g.poly([pts[0], pts[1], pts[4], pts[5], pts[8], pts[9]]).stroke({ width: 1.8, color });
        g.poly([pts[2], pts[3], pts[6], pts[7], pts[10], pts[11]]).stroke({ width: 1.8, color });
        c.addChild(g); c.x = w / 2; c.y = h * y; c.scale.y = 0.32;
        st._vfx(c, ms, t => { g.rotation = t * 3; c.scale.x = CG_EASE.out(CG_EASE.seg(t, 0, 0.2)); c.alpha = t < 0.75 ? 1 : 1 - CG_EASE.seg(t, 0.75, 1); }, true);
    },
    aura(st, color, { ms = 900, pulses = 2 } = {}) {
        const [w, h] = st.size;
        const g = new PIXI.Graphics();
        for (let i = 3; i >= 1; i--) g.ellipse(0, 0, w * 0.2 * i, h * 0.18 * i).fill({ color, alpha: 0.12 });
        g.x = w / 2; g.y = h * 0.55;
        st._vfx(g, ms, t => { g.scale.set(0.85 + 0.2 * Math.abs(Math.sin(t * Math.PI * pulses))); g.alpha = CG_EASE.bump(t); }, true);
    },
    particles(st, color, { n = 10, x = 0.5, y = 0.8, spread = 0.4, rise = 0.5, vx = 0, ms = 900, size = 2.4, at = 0 } = {}) {
        const [w, h] = st.size, f = st.facing;
        for (let i = 0; i < n; i++) {
            const g = new PIXI.Graphics();
            g.circle(0, 0, size * (0.6 + Math.random() * 0.8)).fill({ color }).circle(0, 0, size * 2).fill({ color, alpha: 0.25 });
            const x0 = w * (x + (Math.random() - 0.5) * spread), y0 = h * (y + (Math.random() - 0.5) * spread * 0.4);
            const dx = f * vx * w * (0.6 + Math.random() * 0.8), dy = -rise * h * (0.6 + Math.random() * 0.8);
            const delay = at + Math.random() * 0.25;
            g.x = x0; g.y = y0; g.alpha = 0;
            st._vfx(g, ms, t => { const k = CG_EASE.seg(t, delay, 1); g.x = x0 + dx * CG_EASE.out(k); g.y = y0 + dy * CG_EASE.out(k); g.alpha = k <= 0 ? 0 : 1 - k; });
        }
    },
    orbit(st, color, { n = 5, ms = 1000, r = 0.34, inward = false } = {}) {
        const [w, h] = st.size;
        for (let i = 0; i < n; i++) {
            const g = new PIXI.Graphics();
            g.circle(0, 0, 3).fill({ color: 0xffffff }).circle(0, 0, 6).fill({ color, alpha: 0.6 }).circle(0, 0, 10).fill({ color, alpha: 0.2 });
            const a0 = i * Math.PI * 2 / n;
            st._vfx(g, ms, t => { const a = a0 + t * Math.PI * 3; const rr = (inward ? 1 - 0.8 * t : 0.3 + 0.7 * CG_EASE.out(t)) * r; g.x = w / 2 + Math.cos(a) * w * rr * 1.4; g.y = h * 0.55 + Math.sin(a) * h * rr * 0.6; g.alpha = CG_EASE.bump(t); });
        }
    },
    afterimages(st, color, { n = 3, gap = 0.08, ms = 700 } = {}) {
        if (!st.rigParts) return;
        const sprite = st.portraitSprite;
        for (let i = 1; i <= n; i++) {
            const ghost = st._buildRig(st.rigParts, st.rigPivots, st.facing < 0, st.rigBox);
            ghost.root.tint = color; ghost.root.alpha = 0;
            CG_JOINTS.forEach(j => { if (ghost.joints[j] && st.joints[j]) ghost.joints[j].rotation = st.joints[j].rotation; });
            if (ghost.joints.armLf && st.joints.armL) ghost.joints.armLf.rotation = st.joints.armL.rotation;
            st._vfx(ghost.root, ms, t => {
                // trails the real body with a lag, fading out
                const lagT = Math.max(0, t - i * gap);
                // the back layer already follows the body; trail behind it
                ghost.root.x = st.baseX - st.facing * i * 12 * Math.min(1, Math.abs(st.lastPose.dx) / 20);
                ghost.root.y = st.baseY + Math.min(0, st.lastPose.dy) * 0.2;
                ghost.root.rotation = sprite.rotation;
                ghost.root.scale.set(sprite.scale.x, sprite.scale.y);
                ghost.root.alpha = lagT > 0 ? 0.45 * (1 - t) / i : 0;
            }, true);
        }
    },
    arrow(st, color, { ms = 600, at = 0.45, big = false } = {}) {
        const [w, h] = st.size, f = st.facing;
        const g = new PIXI.Graphics();
        const L = w * (big ? 0.55 : 0.4), T = big ? 4 : 2.5;
        g.moveTo(-L, 0).lineTo(0, 0).stroke({ width: T, color: 0xe8d8b0 });
        g.poly([0, -T * 2.2, T * 4, 0, 0, T * 2.2]).fill({ color: 0xdfe6ee }).stroke({ width: 1, color: 0x222222 });
        g.moveTo(-L, 0).lineTo(-L - 8, -5).moveTo(-L, 0).lineTo(-L - 8, 5).stroke({ width: 2, color });
        g.moveTo(-L * 1.8, 0).lineTo(-L * 0.2, 0).stroke({ width: T * 3, color, alpha: 0.35 });
        g.scale.x = f; g.y = h * 0.52;
        st._vfx(g, ms, t => { const k = CG_EASE.seg(t, at, 1); g.x = w / 2 + f * (w * 0.1 + w * 0.9 * CG_EASE.out(k)); g.alpha = t < at ? 0 : 1 - CG_EASE.seg(k, 0.6, 1); });
    },
    beam(st, color, { ms = 800, at = 0.35 } = {}) {
        const [w, h] = st.size, f = st.facing;
        const g = new PIXI.Graphics();
        g.rect(0, -h * 0.07, w, h * 0.14).fill({ color, alpha: 0.5 }).rect(0, -h * 0.03, w, h * 0.06).fill({ color: 0xffffff, alpha: 0.9 });
        g.x = w / 2; g.y = h * 0.5; g.scale.x = f;
        st._vfx(g, ms, t => { const k = CG_EASE.seg(t, at, 1); g.scale.x = f * CG_EASE.out(CG_EASE.seg(k, 0, 0.25)); g.scale.y = 1 - 0.8 * CG_EASE.seg(k, 0.5, 1); g.alpha = t < at ? 0 : 1 - CG_EASE.seg(k, 0.6, 1); });
    },
    flash(st, color, { ms = 400 } = {}) {
        const [w, h] = st.size;
        const g = new PIXI.Graphics();
        g.rect(0, 0, w, h).fill({ color, alpha: 0.55 });
        st._vfx(g, ms, t => { g.alpha = 1 - t; });
    },
};


// --- CHARACTER RIG (jointed limbs) ----------------------------------------
// Characters are rigs (tools/make_characters.py -> assets/characters/<key>/
// <part>.svg + rigs.json): back, legL, legR, torso, head, armL (off-hand),
// armR (weapon). Each joint rotates around its pivot; the torso carries the
// head and both arms. Actions animate the joints with keyframes (angles in
// radians, +clockwise); heroes face right, monsters are mirrored.
// rigs.json sits next to the portraits it describes (one per art set)
let cgRigsPromises = {};

// SVG markup -> texture (painted avatars), cached by content so the same
// look on several stages (or re-equipping the same item) costs nothing.
const cgSvgTextures = new Map();
function cgTextureFromSVG(svg) {
    if (cgSvgTextures.has(svg)) return cgSvgTextures.get(svg);
    const p = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { const tex = PIXI.Texture.from(img); tex.source.scaleMode = 'linear'; resolve(tex); };
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    cgSvgTextures.set(svg, p);
    if (cgSvgTextures.size > 400) cgSvgTextures.delete(cgSvgTextures.keys().next().value);
    return p;
}
function cgLoadRigs(dir) {
    const d = dir || 'assets/characters/';
    if (!cgRigsPromises[d]) cgRigsPromises[d] = fetch(d + 'rigs.json').then(r => r.json()).catch(() => ({}));
    return cgRigsPromises[d];
}

// keyframes [[t, value], ...] -> smooth (ease-in-out between keys) function
function cgKeys(frames) {
    return t => {
        if (t <= frames[0][0]) return frames[0][1];
        for (let i = 1; i < frames.length; i++) {
            const [t1, v1] = frames[i], [t0, v0] = frames[i - 1];
            if (t <= t1) { const k = (t - t0) / (t1 - t0 || 1); const e = k * k * (3 - 2 * k); return v0 + (v1 - v0) * e; }
        }
        return frames[frames.length - 1][1];
    };
}
const CG_JOINTS = ['legL', 'legR', 'torso', 'head', 'armL', 'armR'];
function cgRig(def) { const out = {}; CG_JOINTS.forEach(j => { if (def[j]) out[j] = cgKeys(def[j]); }); return out; }
const Z = [0, 0], ONE = [1, 0];
// arm angles: negative swings the arm forward/up toward the enemy (right),
// about -1.5 is straight forward, about -2.9 straight up over the head.
const CG_RIGS = {
    overhead: cgRig({ armR: [Z, [.3, -2.9], [.5, -0.5], [.72, -0.7], ONE], armL: [Z, [.3, 0.35], [.5, -0.45], ONE],
        torso: [Z, [.3, -0.12], [.5, 0.2], [.75, 0.12], ONE], head: [Z, [.3, -0.08], [.5, 0.1], ONE],
        legR: [Z, [.45, -0.35], [.75, -0.3], ONE], legL: [Z, [.45, 0.22], [.75, 0.18], ONE] }),
    heavy: cgRig({ armR: [Z, [.35, -3.0], [.52, -0.4], [.75, -0.6], ONE], armL: [Z, [.35, -2.7], [.54, -0.6], ONE],
        torso: [Z, [.35, -0.18], [.52, 0.3], [.75, 0.2], ONE], head: [Z, [.35, -0.12], [.52, 0.14], ONE],
        legR: [Z, [.5, -0.45], [.8, -0.4], ONE], legL: [Z, [.5, 0.3], [.8, 0.25], ONE] }),
    spin: cgRig({ armR: [Z, [.15, -1.6], [.85, -1.7], ONE], armL: [Z, [.15, 1.1], [.85, 1.1], ONE],
        legL: [Z, [.5, 0.25], ONE], legR: [Z, [.5, -0.25], ONE], head: [Z, [.5, 0.1], ONE] }),
    stab: cgRig({ armR: [Z, [.3, 0.6], [.45, -1.55], [.7, -1.45], ONE], armL: [Z, [.35, 0.5], [.55, -1.35], [.75, -1.25], ONE],
        torso: [Z, [.3, -0.1], [.45, 0.28], [.7, 0.22], ONE], legR: [Z, [.45, -0.5], [.7, -0.45], ONE], legL: [Z, [.45, 0.35], [.7, 0.3], ONE] }),
    xslash: cgRig({ armR: [Z, [.3, -2.5], [.5, -0.2], [.75, -0.3], ONE], armL: [Z, [.35, -2.3], [.55, 0.3], [.75, 0.25], ONE],
        torso: [Z, [.3, -0.1], [.5, 0.22], ONE], legR: [Z, [.45, -0.45], ONE], legL: [Z, [.45, 0.3], ONE] }),
    bow: cgRig({ armL: [Z, [.25, -0.75], [.8, -0.75], ONE], armR: [Z, [.25, -1.25], [.45, -0.55], [.52, -1.55], [.8, -1.3], ONE],
        torso: [Z, [.25, -0.06], [.5, 0.06], ONE], head: [Z, [.25, 0.08], [.8, 0.08], ONE],
        legL: [Z, [.25, 0.15], [.8, 0.15], ONE], legR: [Z, [.25, -0.15], [.8, -0.15], ONE] }),
    cast: cgRig({ armR: [Z, [.3, -2.7], [.55, -1.4], [.8, -1.5], ONE], armL: [Z, [.3, 2.3], [.55, -1.3], [.8, -1.2], ONE],
        head: [Z, [.3, -0.14], [.55, 0.08], ONE], torso: [Z, [.3, -0.08], [.55, 0.12], ONE] }),
    block: cgRig({ armL: [Z, [.22, -1.35], [.8, -1.35], ONE], armR: [Z, [.22, 0.4], [.8, 0.4], ONE],
        torso: [Z, [.22, -0.1], [.8, -0.1], ONE], head: [Z, [.22, 0.08], [.8, 0.08], ONE],
        legL: [Z, [.22, 0.2], [.8, 0.2], ONE], legR: [Z, [.22, -0.2], [.8, -0.2], ONE] }),
    heal: cgRig({ armL: [Z, [.3, 1.0], [.75, 1.0], ONE], armR: [Z, [.3, -1.0], [.75, -1.0], ONE],
        head: [Z, [.3, -0.18], [.75, -0.18], ONE], torso: [Z, [.3, -0.06], [.75, -0.06], ONE] }),
    kneel: cgRig({ legL: [Z, [.3, 0.5], [.75, 0.5], ONE], legR: [Z, [.3, -0.55], [.75, -0.55], ONE], torso: [Z, [.3, 0.12], [.75, 0.12], ONE],
        armL: [Z, [.3, -0.6], [.75, -0.6], ONE], armR: [Z, [.3, -0.9], [.75, -0.9], ONE], head: [Z, [.3, 0.18], [.75, 0.18], ONE] }),
    power: cgRig({ armL: [Z, [.2, 0.5], [.45, 2.5], [.8, 2.4], ONE], armR: [Z, [.2, -0.5], [.45, -2.5], [.8, -2.4], ONE],
        head: [Z, [.45, -0.2], [.8, -0.2], ONE], legL: [Z, [.2, 0.2], [.45, 0.05], ONE], legR: [Z, [.2, -0.2], [.45, -0.05], ONE] }),
    roar: cgRig({ armL: [Z, [.25, 1.3], [.75, 1.3], ONE], armR: [Z, [.25, -1.3], [.75, -1.3], ONE],
        head: [Z, [.25, -0.28], [.75, -0.25], ONE], torso: [Z, [.25, -0.12], [.75, -0.1], ONE] }),
    charge: cgRig({ armR: [Z, [.15, 0.8], [.4, -1.6], [.65, -1.4], ONE], armL: [Z, [.15, 0.6], [.4, -1.2], ONE],
        torso: [Z, [.15, -0.1], [.4, 0.3], [.65, 0.25], ONE],
        legR: [Z, [.2, -0.5], [.3, 0.3], [.4, -0.5], [.55, 0.2], ONE], legL: [Z, [.2, 0.4], [.3, -0.3], [.4, 0.4], [.55, -0.2], ONE] }),
    slam: cgRig({ armR: [Z, [.35, -3.0], [.5, -0.6], [.75, -0.7], ONE], armL: [Z, [.35, -2.8], [.5, -0.7], ONE],
        torso: [Z, [.35, -0.15], [.5, 0.25], ONE], legR: [Z, [.5, -0.3], ONE], legL: [Z, [.5, 0.2], ONE] }),
    dodge: cgRig({ torso: [Z, [.3, -0.28], ONE], head: [Z, [.3, -0.15], ONE], armL: [Z, [.3, 0.7], ONE], armR: [Z, [.3, -0.5], ONE],
        legL: [Z, [.3, 0.35], ONE], legR: [Z, [.3, -0.1], ONE] }),
    flinch: cgRig({ torso: [Z, [.15, -0.3], [.5, -0.1], ONE], head: [Z, [.15, -0.35], [.5, -0.1], ONE],
        armL: [Z, [.15, 0.8], [.6, 0.2], ONE], armR: [Z, [.15, -0.8], [.6, -0.2], ONE], legL: [Z, [.15, 0.12], ONE], legR: [Z, [.15, -0.12], ONE] }),
    death: cgRig({ torso: [Z, [1, -0.35]], head: [Z, [1, -0.4]], armL: [Z, [1, 0.9]], armR: [Z, [1, -0.9]], legL: [Z, [1, 0.2]], legR: [Z, [1, -0.3]] }),
    // --- arena move set ---
    thrust: cgRig({ armR: [Z, [.3, 0.5], [.45, -1.5], [.7, -1.4], ONE], armL: [Z, [.3, 0.4], [.45, 0.7], ONE],
        torso: [Z, [.3, -0.08], [.45, 0.25], [.7, 0.2], ONE], legR: [Z, [.45, -0.55], [.7, -0.5], ONE], legL: [Z, [.45, 0.35], ONE] }),
    uppercut: cgRig({ armR: [Z, [.3, 0.9], [.5, -2.6], [.72, -2.3], ONE], armL: [Z, [.3, -0.5], [.5, 0.5], ONE],
        torso: [Z, [.3, 0.18], [.5, -0.2], ONE], head: [Z, [.3, 0.1], [.5, -0.15], ONE], legR: [Z, [.3, -0.35], [.5, -0.1], ONE], legL: [Z, [.3, 0.25], ONE] }),
    backhand: cgRig({ armR: [Z, [.3, -2.0], [.5, 0.9], [.72, 0.7], ONE], armL: [Z, [.3, 0.4], [.5, -0.3], ONE],
        torso: [Z, [.3, -0.15], [.5, 0.18], ONE], legR: [Z, [.5, -0.35], ONE], legL: [Z, [.5, 0.25], ONE] }),
    kick: cgRig({ legR: [Z, [.3, 0.4], [.5, -1.3], [.68, -1.1], ONE], legL: [Z, [.5, 0.15], ONE],
        torso: [Z, [.3, 0.05], [.5, -0.25], ONE], armL: [Z, [.5, 0.6], ONE], armR: [Z, [.5, -0.8], ONE] }),
    bash: cgRig({ armL: [Z, [.3, 0.5], [.5, -1.45], [.7, -1.35], ONE], armR: [Z, [.3, 0.3], [.5, 0.5], ONE],
        torso: [Z, [.3, -0.1], [.5, 0.3], ONE], legR: [Z, [.5, -0.5], ONE], legL: [Z, [.5, 0.3], ONE] }),
    throw: cgRig({ armR: [Z, [.3, -3.0], [.47, -1.2], [.65, -0.9], ONE], armL: [Z, [.3, -1.2], [.47, 0.4], ONE],
        torso: [Z, [.3, -0.15], [.47, 0.2], ONE], legR: [Z, [.47, -0.35], ONE], legL: [Z, [.47, 0.2], ONE] }),
    push: cgRig({ armR: [Z, [.3, 0.6], [.5, -1.55], [.8, -1.5], ONE], armL: [Z, [.3, 0.6], [.5, -1.5], [.8, -1.45], ONE],
        torso: [Z, [.3, -0.12], [.5, 0.15], ONE], head: [Z, [.5, 0.08], ONE], legR: [Z, [.5, -0.25], ONE] }),
    summon: cgRig({ armR: [Z, [.35, -2.8], [.55, -0.3], ONE], armL: [Z, [.35, 2.6], [.55, 0.4], ONE],
        torso: [Z, [.35, -0.15], [.55, 0.2], ONE], legL: [Z, [.55, 0.25], ONE], legR: [Z, [.55, -0.25], ONE], head: [Z, [.35, -0.2], [.55, 0.2], ONE] }),
    pray: cgRig({ armR: [Z, [.3, -2.4], [.75, -2.4], ONE], armL: [Z, [.3, 2.4], [.75, 2.4], ONE], head: [Z, [.3, -0.22], [.75, -0.22], ONE] }),
    drink: cgRig({ armR: [Z, [.3, -2.3], [.7, -2.4], ONE], head: [Z, [.35, -0.3], [.7, -0.3], ONE], torso: [Z, [.35, -0.08], ONE] }),
    victory: cgRig({ armR: [Z, [.3, -2.9], [.8, -2.85], ONE], armL: [Z, [.3, 0.4], ONE], head: [Z, [.3, -0.15], ONE], torso: [Z, [.3, -0.05], ONE] }),
    guard: cgRig({ armL: [Z, [.2, -2.2], [.8, -2.2], ONE], armR: [Z, [.2, -0.4], [.8, -0.4], ONE], head: [Z, [.2, 0.12], ONE],
        legL: [Z, [.2, 0.3], [.8, 0.3], ONE], legR: [Z, [.2, -0.3], [.8, -0.3], ONE], torso: [Z, [.2, 0.08], ONE] }),
    stagger: cgRig({ torso: [Z, [.2, -0.4], [.6, -0.15], ONE], head: [Z, [.2, -0.45], [.6, -0.1], ONE], armL: [Z, [.2, 1.2], [.6, 0.3], ONE],
        armR: [Z, [.2, -1.2], [.6, -0.3], ONE], legL: [Z, [.2, 0.35], [.6, 0.1], ONE], legR: [Z, [.2, -0.45], [.6, -0.1], ONE] }),
    recoil: cgRig({ torso: [Z, [.15, 0.35], [.55, 0.1], ONE], head: [Z, [.15, 0.3], [.55, 0.05], ONE], armL: [Z, [.15, -0.5], ONE],
        armR: [Z, [.15, 0.5], ONE], legL: [Z, [.15, 0.2], ONE], legR: [Z, [.15, -0.2], ONE] }),
    knockdown: cgRig({ torso: [Z, [.25, -0.6], [.6, -0.6], ONE], head: [Z, [.25, -0.4], [.6, -0.3], ONE], armL: [Z, [.25, 1.5], [.6, 1.2], ONE],
        armR: [Z, [.25, -1.5], [.6, -1.2], ONE], legL: [Z, [.25, -0.4], [.6, -0.3], ONE], legR: [Z, [.25, -0.9], [.6, -0.8], ONE] }),
};
// when each rig's decisive beat happens (the blow / the release), so a
// move can time-warp its rig to land that beat exactly on the impact
// Variants for painted avatars (avatar.js), whose rest pose is already
// "ready": the bow is held out at chest height, so aiming only lifts it a
// little and the drawing hand pulls back (+) and snaps forward on release.
CG_RIGS.bowA = cgRig({ armL: [Z, [.25, -0.3], [.8, -0.3], ONE], armR: [Z, [.25, 0.25], [.45, 0.55], [.52, -0.25], [.8, 0.1], ONE],
    torso: [Z, [.25, -0.06], [.5, 0.06], ONE], head: [Z, [.25, 0.08], [.8, 0.08], ONE], legL: [Z, [.25, 0.12], [.8, 0.12], ONE], legR: [Z, [.25, -0.12], [.8, -0.12], ONE] });
const CG_RIG_KEYS = { bowA: 0.47, overhead: 0.5, heavy: 0.52, spin: 0.5, stab: 0.45, xslash: 0.5, bow: 0.47, cast: 0.55, slam: 0.5, charge: 0.4,
    thrust: 0.45, uppercut: 0.5, backhand: 0.5, kick: 0.5, bash: 0.5, throw: 0.47, push: 0.5, summon: 0.55 };
function cgRigWarp(rig, target) {
    const a = CG_RIG_KEYS[rig];
    if (target === null || target === undefined || a === undefined || target <= 0 || target >= 1) return t => t;
    return t => t <= target ? a * t / target : a + (1 - a) * (t - target) / (1 - target);
}
// which rig animation each class uses for each action (VFX + body motion
// live in CG_CLASS_ACTIONS below)
const CG_CLASS_RIGS = {
    warrior: { sword: 'overhead', skull: 'heavy', shield: 'block', heart: 'kneel', energy: 'roar', ult: 'charge' },
    berserker: { sword: 'spin', skull: 'heavy', shield: 'roar', heart: 'roar', energy: 'power', ult: 'spin' },
    rogue: { sword: 'stab', skull: 'xslash', shield: 'dodge', heart: 'kneel', energy: 'spin', ult: 'xslash' },
    archer: { sword: 'bow', skull: 'bow', shield: 'kneel', heart: 'heal', energy: 'power', ult: 'bow' },
    mage: { sword: 'cast', skull: 'cast', shield: 'block', heart: 'heal', energy: 'power', ult: 'cast' },
    necromancer: { sword: 'cast', skull: 'cast', shield: 'block', heart: 'heal', energy: 'power', ult: 'cast' },
    paladin: { sword: 'slam', skull: 'slam', shield: 'block', heart: 'heal', energy: 'power', ult: 'slam' },
};
const CG_MONSTER_RIGS = {
    monster_normal: { attack: 'overhead', buff: 'roar' }, monster_armored: { attack: 'slam', buff: 'block' },
    monster_swift: { attack: 'stab', buff: 'power' }, monster_drain: { attack: 'cast', buff: 'heal' },
    monster_boss: { attack: 'charge', buff: 'roar' },
};

const CG_COL = { white: 0xffffff, steel: 0xdfe8f2, blue: 0x4f9dff, cyan: 0x62e6ff, gold: 0xffd24a, red: 0xff3b30, orange: 0xff8a2a,
              purple: 0xb05cff, green: 0x3dff8a, leaf: 0x7ed957, holy: 0xfff2a8, bone: 0xeae0c8, shadow: 0x6a3aa8 };

// ms: total length. pose: sprite curve. fx(stage): effects to spawn.
const CG_CLASS_ACTIONS = {
    warrior: {
        sword: { ms: 720, pose: CG_POSE.strike(6, 18), fx: s => CG_VFX.slash(s, CG_COL.steel, { width: 6 }) },
        skull: { ms: 900, pose: CG_POSE.slam(14, -0.3), fx: s => { CG_VFX.slash(s, CG_COL.red, { a0: -2.6, a1: 0.2, width: 7, at: 0.4 }); CG_VFX.ring(s, CG_COL.orange, { at: 0.45 }); } },
        shield: { ms: 1000, pose: CG_POSE.brace(0.1), fx: s => CG_VFX.dome(s, CG_COL.blue) },
        heart: { ms: 1000, pose: CG_POSE.kneel(5), fx: s => { CG_VFX.aura(s, CG_COL.green); CG_VFX.particles(s, CG_COL.green, { n: 9 }); } },
        energy: { ms: 900, pose: CG_POSE.roar(), fx: s => { CG_VFX.ring(s, CG_COL.orange, { y: 0.45, flat: 1, r1: 0.7 }); CG_VFX.ring(s, CG_COL.gold, { y: 0.45, flat: 1, r1: 0.9, at: 0.25 }); } },
        ult: { ms: 1300, pose: CG_POSE.charge(26), fx: s => { CG_VFX.afterimages(s, CG_COL.steel); CG_VFX.slash(s, CG_COL.white, { r: 0.55, width: 9, at: 0.35 }); CG_VFX.ring(s, CG_COL.blue, { at: 0.4, r1: 0.9 }); CG_VFX.dome(s, CG_COL.blue, { ms: 800 }); } },
    },
    berserker: {
        sword: { ms: 800, pose: CG_POSE.spin(1), fx: s => { CG_VFX.slash(s, CG_COL.red, { a0: -Math.PI, a1: Math.PI, r: 0.4, cx: 0.5, at: 0.2, spin: 2 }); } },
        skull: { ms: 1000, pose: CG_POSE.strike(8, 20, 0.45), fx: s => { CG_VFX.aura(s, CG_COL.red, { pulses: 4 }); CG_VFX.slash(s, CG_COL.red, { at: 0.3 }); CG_VFX.slash(s, CG_COL.orange, { a0: -1.2, a1: 1.6, at: 0.5 }); } },
        shield: { ms: 900, pose: CG_POSE.roar(), fx: s => { CG_VFX.ring(s, CG_COL.orange, { y: 0.5, flat: 1, r1: 0.6 }); CG_VFX.particles(s, CG_COL.orange, { n: 8, y: 0.95, rise: 0.2, spread: 0.8 }); } },
        heart: { ms: 900, pose: CG_POSE.roar(), fx: s => { CG_VFX.aura(s, CG_COL.orange, { pulses: 3 }); CG_VFX.particles(s, CG_COL.red, { n: 8 }); } },
        energy: { ms: 900, pose: CG_POSE.slam(8), fx: s => { CG_VFX.ring(s, CG_COL.gold, { at: 0.45 }); CG_VFX.particles(s, 0x9a7a55, { n: 10, y: 0.97, rise: 0.15, spread: 1, at: 0.45 }); } },
        ult: { ms: 1400, pose: CG_POSE.spin(2), fx: s => { CG_VFX.aura(s, CG_COL.red, { ms: 1400, pulses: 5 }); CG_VFX.particles(s, CG_COL.orange, { n: 16, ms: 1400, rise: 0.8 }); CG_VFX.slash(s, CG_COL.red, { a0: -Math.PI, a1: Math.PI, r: 0.45, cx: 0.5, at: 0.2, spin: 3, ms: 1300 }); } },
    },
    rogue: {
        sword: { ms: 800, pose: CG_POSE.blink(22), fx: s => { CG_VFX.afterimages(s, CG_COL.shadow); CG_VFX.slash(s, CG_COL.purple, { width: 3, at: 0.45, a0: -1.8, a1: 0.2 }); } },
        skull: { ms: 900, pose: CG_POSE.blink(26), fx: s => { CG_VFX.afterimages(s, CG_COL.shadow); CG_VFX.slash(s, CG_COL.purple, { a0: -2.3, a1: -0.3, at: 0.4 }); CG_VFX.slash(s, CG_COL.purple, { a0: 0.3, a1: 2.3, at: 0.5, spin: -0.9 }); } },
        shield: { ms: 800, pose: CG_POSE.dodge(18), fx: s => { CG_VFX.afterimages(s, CG_COL.shadow); CG_VFX.particles(s, 0x8a8a9a, { n: 10, y: 0.85, rise: 0.25, spread: 0.7 }); } },
        heart: { ms: 900, pose: CG_POSE.kneel(4), fx: s => { CG_VFX.particles(s, 0x8a8a9a, { n: 8, rise: 0.3 }); CG_VFX.particles(s, CG_COL.green, { n: 6 }); } },
        energy: { ms: 700, pose: CG_POSE.spin(1), fx: s => { CG_VFX.orbit(s, CG_COL.purple, { n: 4 }); } },
        ult: { ms: 1300, pose: CG_POSE.blink(28), fx: s => { CG_VFX.afterimages(s, CG_COL.shadow, { n: 4 }); [0.35, 0.5, 0.65].forEach((at, i) => CG_VFX.slash(s, i % 2 ? CG_COL.white : CG_COL.purple, { at, a0: i % 2 ? 0.3 : -2.3, a1: i % 2 ? 2.3 : -0.3, spin: i % 2 ? -1 : 1, ms: 1300 })); } },
    },
    archer: {
        sword: { ms: 800, pose: CG_POSE.draw(), fx: s => CG_VFX.arrow(s, CG_COL.leaf) },
        skull: { ms: 1000, pose: CG_POSE.draw(), fx: s => { CG_VFX.rune(s, CG_COL.leaf, { ms: 1000 }); CG_VFX.arrow(s, CG_COL.red, { big: true, at: 0.5 }); } },
        shield: { ms: 900, pose: CG_POSE.kneel(7), fx: s => { CG_VFX.orbit(s, CG_COL.leaf, { n: 6 }); } },
        heart: { ms: 1000, pose: CG_POSE.float(4), fx: s => { CG_VFX.aura(s, CG_COL.leaf); CG_VFX.particles(s, CG_COL.leaf, { n: 10 }); } },
        energy: { ms: 900, pose: CG_POSE.draw(), fx: s => { CG_VFX.ring(s, CG_COL.leaf, { y: 0.5, flat: 1, r0: 0.9, r1: 0.1 }); } },
        ult: { ms: 1300, pose: CG_POSE.draw(), fx: s => { CG_VFX.rune(s, CG_COL.gold, { ms: 1300 }); CG_VFX.arrow(s, CG_COL.gold, { big: true, at: 0.5, ms: 1300 }); CG_VFX.beam(s, CG_COL.leaf, { at: 0.55, ms: 1300 }); } },
    },
    mage: {
        sword: { ms: 900, pose: CG_POSE.float(8), fx: s => { CG_VFX.rune(s, CG_COL.blue); CG_VFX.particles(s, CG_COL.cyan, { n: 6, y: 0.4, vx: 0.8, rise: 0.05, at: 0.35 }); } },
        skull: { ms: 1000, pose: CG_POSE.float(10), fx: s => { CG_VFX.rune(s, CG_COL.purple); CG_VFX.beam(s, CG_COL.cyan); } },
        shield: { ms: 1000, pose: CG_POSE.float(5), fx: s => { CG_VFX.dome(s, CG_COL.cyan); CG_VFX.rune(s, CG_COL.cyan, { ms: 900 }); } },
        heart: { ms: 1000, pose: CG_POSE.float(6), fx: s => { CG_VFX.particles(s, CG_COL.cyan, { n: 10 }); CG_VFX.aura(s, CG_COL.blue); } },
        energy: { ms: 900, pose: CG_POSE.float(6), fx: s => { CG_VFX.rune(s, CG_COL.gold); CG_VFX.orbit(s, CG_COL.cyan, { n: 5 }); } },
        ult: { ms: 1400, pose: CG_POSE.float(12), fx: s => { CG_VFX.rune(s, CG_COL.cyan, { ms: 1400, size: 0.7 }); CG_VFX.orbit(s, CG_COL.blue, { n: 6, ms: 1400, inward: true }); CG_VFX.beam(s, CG_COL.cyan, { at: 0.5, ms: 1400 }); CG_VFX.flash(s, CG_COL.cyan, { ms: 500 }); } },
    },
    necromancer: {
        sword: { ms: 900, pose: CG_POSE.float(4), fx: s => { CG_VFX.orbit(s, CG_COL.purple, { n: 4 }); CG_VFX.particles(s, CG_COL.purple, { n: 6, y: 0.5, vx: 0.8, rise: 0.05, at: 0.4 }); } },
        skull: { ms: 1000, pose: CG_POSE.kneel(4), fx: s => { CG_VFX.aura(s, CG_COL.shadow, { pulses: 3 }); CG_VFX.ring(s, CG_COL.purple, { at: 0.3 }); CG_VFX.particles(s, CG_COL.bone, { n: 6, y: 0.9, rise: 0.4, at: 0.3 }); } },
        shield: { ms: 1000, pose: CG_POSE.brace(0.06), fx: s => { CG_VFX.dome(s, CG_COL.shadow); CG_VFX.orbit(s, CG_COL.bone, { n: 5 }); } },
        heart: { ms: 1000, pose: CG_POSE.float(5), fx: s => { CG_VFX.orbit(s, CG_COL.green, { n: 5, inward: true }); } },
        energy: { ms: 900, pose: CG_POSE.float(5), fx: s => { CG_VFX.aura(s, CG_COL.purple, { pulses: 3 }); } },
        ult: { ms: 1400, pose: CG_POSE.float(10), fx: s => { CG_VFX.aura(s, CG_COL.shadow, { ms: 1400, pulses: 5 }); CG_VFX.orbit(s, CG_COL.purple, { n: 7, ms: 1400, inward: true }); CG_VFX.rune(s, CG_COL.purple, { ms: 1400, size: 0.65 }); } },
    },
    paladin: {
        sword: { ms: 900, pose: CG_POSE.slam(12), fx: s => { CG_VFX.ring(s, CG_COL.gold, { at: 0.45 }); CG_VFX.particles(s, CG_COL.holy, { n: 8, y: 0.95, rise: 0.3, at: 0.45 }); } },
        skull: { ms: 1100, pose: CG_POSE.slam(16), fx: s => { CG_VFX.pillar(s, CG_COL.gold); CG_VFX.ring(s, CG_COL.holy, { at: 0.45, r1: 0.8 }); } },
        shield: { ms: 1000, pose: CG_POSE.brace(0.08), fx: s => CG_VFX.dome(s, CG_COL.gold) },
        heart: { ms: 1100, pose: CG_POSE.float(5), fx: s => { CG_VFX.pillar(s, CG_COL.holy); CG_VFX.particles(s, CG_COL.holy, { n: 10 }); } },
        energy: { ms: 900, pose: CG_POSE.float(4), fx: s => { CG_VFX.ring(s, CG_COL.gold, { y: 0.12, flat: 0.3, r0: 0.2, r1: 0.6 }); CG_VFX.aura(s, CG_COL.gold); } },
        ult: { ms: 1500, pose: CG_POSE.slam(16), fx: s => { CG_VFX.pillar(s, CG_COL.gold, { ms: 1500 }); CG_VFX.ring(s, CG_COL.holy, { at: 0.45, r1: 1 }); CG_VFX.ring(s, CG_COL.gold, { at: 0.55, r1: 1.2 }); CG_VFX.flash(s, CG_COL.holy, { ms: 600 }); } },
    },
};

// Monsters (facing left). `attack` when their own sword/skull lands,
// `buff` when they match heart/shield/energy.
const CG_MONSTER_ACTIONS = {
    monster_normal: {
        attack: { ms: 800, pose: CG_POSE.strike(7, 18, 0.35), fx: s => CG_VFX.slash(s, 0xc9955a, { width: 6 }) },
        buff: { ms: 800, pose: CG_POSE.roar(), fx: s => CG_VFX.aura(s, CG_COL.leaf) },
    },
    monster_armored: {
        attack: { ms: 1000, pose: CG_POSE.slam(10), fx: s => { CG_VFX.ring(s, 0xaab4c0, { at: 0.45, r1: 0.9, width: 6 }); CG_VFX.particles(s, 0x8a8f96, { n: 12, y: 0.97, rise: 0.2, spread: 1.1, at: 0.45 }); } },
        buff: { ms: 900, pose: CG_POSE.brace(0.06), fx: s => CG_VFX.dome(s, CG_COL.cyan) },
    },
    monster_swift: {
        attack: { ms: 800, pose: CG_POSE.blink(22), fx: s => { CG_VFX.afterimages(s, CG_COL.red); CG_VFX.slash(s, CG_COL.orange, { width: 3, at: 0.45 }); } },
        buff: { ms: 700, pose: CG_POSE.spin(1), fx: s => CG_VFX.particles(s, CG_COL.orange, { n: 8 }) },
    },
    monster_drain: {
        attack: { ms: 1000, pose: CG_POSE.blink(18), fx: s => { CG_VFX.orbit(s, CG_COL.purple, { n: 5 }); CG_VFX.particles(s, CG_COL.purple, { n: 8, y: 0.5, vx: 0.9, rise: 0.05, at: 0.4 }); } },
        buff: { ms: 900, pose: CG_POSE.float(6), fx: s => CG_VFX.aura(s, CG_COL.purple, { pulses: 3 }) },
    },
    monster_boss: {
        attack: { ms: 1000, pose: CG_POSE.charge(24), fx: s => { CG_VFX.afterimages(s, CG_COL.red); CG_VFX.slash(s, CG_COL.red, { r: 0.55, width: 8, at: 0.35 }); CG_VFX.ring(s, CG_COL.orange, { at: 0.4, r1: 0.9 }); } },
        buff: { ms: 1000, pose: CG_POSE.roar(), fx: s => { CG_VFX.aura(s, CG_COL.red, { pulses: 4 }); CG_VFX.particles(s, CG_COL.orange, { n: 10 }); } },
    },
};

// Kenney's particle pack ships neutral grayscale/white masks meant to be
// recolored per use (confirmed by inspecting them against a dark ground -
// e.g. "flame" and "fire" render as plain white smoke puffs with no tint at
// all) - every effect below pairs a sprite with the tint that actually makes
// it read as its intended element. One small burst per tile type fires on
// every match, not just ultimates, so "vuruş efektleri" (hit effects) are
// felt on ordinary turns too.
const HIT_EFFECT_SPRITES = {
    sword: { sprite: 'assets/effects/scorch_01.webp', tint: 0xffffff },
    skull: { sprite: 'assets/effects/scorch_01.webp', tint: 0xe74c3c },
    shield: { sprite: 'assets/effects/circle_03.webp', tint: 0x3b82f6 },
    heart: { sprite: 'assets/effects/light_02.webp', tint: 0xff6b9d },
    energy: { sprite: 'assets/effects/star_04.webp', tint: 0xf1c40f },
};

// Three-layer bursts (a base shape + an accent + a Faz 4 (graphics roadmap)
// "impact ring" 3rd layer) for the one big moment each class's ultimate is -
// chosen to echo that class's own flavor (see the class_asset_plan.png
// shared with the user during asset selection). The 3rd layer deliberately
// reuses a sprite ALREADY used by a different class/slot above rather than
// pulling in new art (this project's whole effect pool is the 14 files in
// assets/effects/ - see assets/CREDITS.md) - _burst below already
// randomizes each instance's own rotation, so the same base file still
// reads as a fresh shape each time it's reused.
const ULT_EFFECT_SPRITES = {
    warrior: [{ sprite: 'assets/effects/scorch_01.webp', tint: 0xdfe6e9 }, { sprite: 'assets/effects/spark_06.webp', tint: 0xffffff }, { sprite: 'assets/effects/circle_03.webp', tint: 0xecf0f1 }],
    berserker: [{ sprite: 'assets/effects/flame_04.webp', tint: 0xff4500 }, { sprite: 'assets/effects/fire_01.webp', tint: 0xff8c00 }, { sprite: 'assets/effects/smoke_04.webp', tint: 0x8b0000 }],
    rogue: [{ sprite: 'assets/effects/slash_04.webp', tint: 0x9b59b6 }, { sprite: 'assets/effects/spark_06.webp', tint: 0xe0c3fc }, { sprite: 'assets/effects/star_04.webp', tint: 0xd6a4ff }],
    archer: [{ sprite: 'assets/effects/muzzle_02.webp', tint: 0x2ecc71 }, { sprite: 'assets/effects/spark_06.webp', tint: 0xffffff }, { sprite: 'assets/effects/circle_04.webp', tint: 0x27ae60 }],
    mage: [{ sprite: 'assets/effects/magic_03.webp', tint: 0x3498db }, { sprite: 'assets/effects/star_04.webp', tint: 0x00d4ff }, { sprite: 'assets/effects/spark_06.webp', tint: 0x00eaff }],
    necromancer: [{ sprite: 'assets/effects/symbol_01.webp', tint: 0x8e44ad }, { sprite: 'assets/effects/smoke_04.webp', tint: 0x2c3e50 }, { sprite: 'assets/effects/circle_03.webp', tint: 0x4a148c }],
    paladin: [{ sprite: 'assets/effects/light_01.webp', tint: 0xf1c40f }, { sprite: 'assets/effects/circle_04.webp', tint: 0xffd700 }, { sprite: 'assets/effects/star_04.webp', tint: 0xfff9c4 }],
};

// Every texture is tiny (character portraits are a few KB, effects ~20KB of
// 256px WebP) and reused across every stage/mode, so one shared, load-once
// cache beats each stage fetching its own copies.
let cgTextureCache = {};
async function cgLoadTexture(url) {
    if (!cgTextureCache[url]) cgTextureCache[url] = PIXI.Assets.load(url);
    return cgTextureCache[url];
}

// Preloads every sprite this module could ever need. Not required (cgLoadTexture
// lazily loads on first use either way) but called once at boot so the very
// first hit/ult in a fresh session doesn't stall on a network fetch.
function cgPreloadAll() {
    if (typeof PIXI === 'undefined') return;
    Object.values(CHARACTER_SPRITES).forEach(cgLoadTexture);
    Object.values(MONSTER_SPRITES).forEach(cgLoadTexture);
    Object.values(HIT_EFFECT_SPRITES).forEach(e => cgLoadTexture(e.sprite));
    Object.values(ULT_EFFECT_SPRITES).forEach(list => list.forEach(e => cgLoadTexture(e.sprite)));
}

// Resolves --portrait-w/--portrait-h (style.css, tied to --tile-size) to
// actual pixel numbers, via a hidden probe element rather than
// canvasEl.getBoundingClientRect() directly - PvP/co-op stages are first
// created while their modal is still display:none (see CLAUDE.md's note on
// pvp-modal/coop-modal sitting hidden earlier in index.html), and a hidden
// ancestor makes getBoundingClientRect report 0x0. The probe is appended
// straight to <body> (never inside a modal) and hidden with
// visibility:hidden rather than display:none, so it always participates in
// layout and its computed size is real - unlike reading the custom property
// text itself (getComputedStyle on an untyped custom property returns the
// clamp()/calc() source string, NOT the resolved number).
let cgSizeProbe = null;
function cgPortraitSize() {
    if (!cgSizeProbe) {
        cgSizeProbe = document.createElement('div');
        cgSizeProbe.style.cssText = 'position:absolute; top:0; left:0; visibility:hidden; pointer-events:none; width:var(--portrait-w); height:var(--portrait-h);';
        document.body.appendChild(cgSizeProbe);
    }
    const rect = cgSizeProbe.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return [Math.round(rect.width), Math.round(rect.height)];
    return [56, 70];
}

// --- ONE SHARED RENDERER (G0, graphics roadmap v2) ---------------------------
// This used to be one PIXI.Application per portrait slot: up to 7 WebGL
// contexts (solo 2 + PvP 2 + co-op 3), each with its own always-running
// 60fps ticker - even for PvP/co-op portraits sitting in a closed modal
// (pause()/resume() existed but were never actually called anywhere).
// Mobile browsers cap live WebGL contexts (iOS Safari especially) and drop
// the oldest when over the limit, and each one costs its own GPU memory.
//
// Now there is exactly ONE WebGL renderer, drawing into an offscreen canvas.
// Every portrait <canvas> is a plain 2D canvas; each frame, a stage that is
// (a) actually visible and (b) actually changed renders its own container
// into the shared renderer and copies the result over with drawImage. An
// idle portrait only changes when its 4-frame idle strip flips frames (a few
// times a second), so a calm screen does a handful of tiny renders per
// second instead of 7 full-rate ones.
const cgShared = {
    renderer: null,
    ticker: null,
    ready: null,
    size: [56, 70],
    resolution: 1,
    lost: false,
    stages: [],
    stats: { renders: 0, frames: 0 }
};

function cgInitShared() {
    if (cgShared.ready) return cgShared.ready;
    cgShared.ready = (async () => {
        cgShared.size = cgPortraitSize();
        cgShared.resolution = Math.min(window.devicePixelRatio || 1, 2);
        const renderer = await PIXI.autoDetectRenderer({
            preference: 'webgl',
            width: cgShared.size[0],
            height: cgShared.size[1],
            backgroundAlpha: 0,
            antialias: false, // crisp pixel art, not smoothed
            resolution: cgShared.resolution,
            autoDensity: false,
        });
        cgShared.renderer = renderer;
        // Context loss (GPU reset, too many contexts elsewhere, a mobile
        // browser reclaiming memory in the background): PixiJS re-uploads
        // its textures on restore by itself; all this layer has to do is
        // stop drawing garbage in between and repaint everything after.
        renderer.canvas.addEventListener('webglcontextlost', () => { cgShared.lost = true; });
        renderer.canvas.addEventListener('webglcontextrestored', () => {
            cgShared.lost = false;
            cgShared.stages.forEach(s => { s.needsRender = true; });
        });

        const ticker = new PIXI.Ticker();
        ticker.add(cgFrame);
        ticker.start();
        cgShared.ticker = ticker;

        // Rotating a phone or resizing the window changes --portrait-w/h
        // (they're tied to the viewport via --tile-size). Every stage
        // re-lays itself out at the new size instead of staying stuck at
        // whatever size the page first loaded with.
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(cgHandleResize, 150);
        });
        return renderer;
    })();
    return cgShared.ready;
}

function cgHandleResize() {
    if (!cgShared.renderer) return;
    if (typeof cgRelayoutArenas === 'function') cgRelayoutArenas();
    const size = cgPortraitSize();
    if (size[0] === cgShared.size[0] && size[1] === cgShared.size[1]) return;
    cgShared.size = size;
    cgShared.stages.forEach(s => s._layout());
}

// A canvas inside a display:none modal (or a closed screen) has no
// offsetParent - skip it entirely, it can't be seen.
function cgIsVisible(el) {
    return !!el && el.isConnected && el.offsetParent !== null;
}

function cgFrame(ticker) {
    cgShared.stats.frames++;
    const renderer = cgShared.renderer;
    for (const stage of cgShared.stages) {
        if (stage.paused || !stage.portraitSprite) continue;
        if (!cgIsVisible(stage.arena ? stage.arena.canvasEl : stage.canvasEl)) continue;
        // Idle breathing, only while nothing else is animating the sprite.
        if (stage.stripH && !stage.dead && stage.activeTweens === 0) {
            const now = performance.now();
            const step = Math.floor(now / CG_BREATH_STEP_MS);
            if (step !== stage.lastFrame) {
                stage.lastFrame = step;
                const sec = now / 1000, b = Math.sin(sec * 2.4 + stage.breathPhase);
                stage.portraitSprite.scale.set(stage.portraitBaseScale * (1 - 0.012 * b), stage.portraitBaseScale * (1 + 0.022 * b));
                // idle life: arms sway out of phase, head bobs, weight shifts
                const j = stage.joints;
                if (j.armL) j.armL.rotation = 0.07 * Math.sin(sec * 2.4 + stage.breathPhase + 0.6);
                if (j.armR) j.armR.rotation = -0.07 * Math.sin(sec * 2.4 + stage.breathPhase + 1.2);
                if (j.head) j.head.rotation = 0.04 * Math.sin(sec * 1.2 + stage.breathPhase);
                if (j.torso) j.torso.rotation = 0.015 * Math.sin(sec * 1.2 + stage.breathPhase + 2);
                stage.needsRender = true;
            }
        }
        if (stage._updateAuras(performance.now())) stage.needsRender = true;
        // arena fighters: the arena paints them all at once (cgRenderArenas)
        if (stage.arena) {
            if (stage.needsRender || stage.activeTweens > 0) { stage.arena.dirty = true; stage.needsRender = false; }
            continue;
        }
        if (!stage.needsRender && stage.activeTweens === 0) continue;
        if (cgShared.lost) continue;
        const [w, h] = stage.size;
        stage._syncLinked();
        if (renderer.width !== w || renderer.height !== h) renderer.resize(w, h);
        renderer.render({ container: stage.root, clear: true });
        const ctx = stage.ctx;
        ctx.clearRect(0, 0, stage.canvasEl.width, stage.canvasEl.height);
        ctx.drawImage(renderer.canvas, 0, 0, renderer.canvas.width, renderer.canvas.height, 0, 0, stage.canvasEl.width, stage.canvasEl.height);
        stage.needsRender = false;
        stage.renderCount++;
        cgShared.stats.renders++;
    }
    if (typeof cgRenderArenas === 'function') cgRenderArenas();
}

// One CombatStage per portrait slot (solo's player/enemy, PvP's me/opponent,
// co-op's me/ally/enemy - up to 7 across the whole app). Owns a scene graph
// (root -> portrait sprite + effect layer) and a 2D canvas to show it in;
// the WebGL work all happens in the one shared renderer above.
class CombatStage {
    constructor(canvasEl) {
        this.canvasEl = canvasEl;
        this.ctx = null;
        this.root = null;
        this.portraitSprite = null;
        this.effectLayer = null;
        this.url = null;
        this.size = cgShared.size;
        this.paused = false;
        this.needsRender = true;
        this.activeTweens = 0;
        this.lastFrame = -1;
        this.renderCount = 0;
        this.lastMoves = {};
        this.performToken = 0;
        this.auras = { ult: null, legendary: null, enraged: false };
        this.groundGlow = null;
        this.incomingTier = 0;
        // An .arena-slot <div> (not a <canvas>) = this fighter lives in its
        // mode's shared arena scene (arena.js) instead of its own canvas.
        this.side = canvasEl.dataset && canvasEl.dataset.side === 'right' ? 'right' : 'left';
        this.embedded = canvasEl.tagName !== 'CANVAS';
        this.ready = this._init();
    }

    async _init() {
        await cgInitShared();
        if (!this.embedded) this.ctx = this.canvasEl.getContext('2d');
        this.root = new PIXI.Container();
        // back layer (auras, pillars, runes, afterimages) sits behind the
        // character; effectLayer (slashes, bursts, particles) in front.
        this.backLayer = new PIXI.Container();
        this.root.addChild(this.backLayer);
        // arena fighters face their side's opponent; a lone portrait faces
        // right (heroes) or left (monsters, set in setPortrait)
        this.facing = this.embedded && this.side === 'right' ? -1 : 1;
        this.lastPose = { dx: 0, dy: 0 };
        // `portraitSprite` is the rig's ROOT container (kept under this name:
        // every body-level effect - lunge, knockback, flash, death - moves or
        // tints it as a whole); the jointed parts live inside (see _buildRig).
        this.portraitSprite = new PIXI.Container();
        this.joints = {};
        this.breathPhase = Math.random() * Math.PI * 2; // two portraits never breathe in lockstep
        this.portraitBaseScale = 1;
        this.root.addChild(this.portraitSprite);
        this.effectLayer = new PIXI.Container();
        this.root.addChild(this.effectLayer);
        // persistent auras (ULT ready, legendary item, enrage) - their own
        // layer, deepest of all, so effect layers only ever hold effects
        this.auraG = new PIXI.Graphics();
        this.root.addChildAt(this.auraG, 0);
        cgShared.stages.push(this);
        if (this.embedded && typeof cgGetArena === 'function') {
            this.arena = cgGetArena(this.canvasEl.dataset.arena);
            if (this.arena) this.arena.addFighter(this);
        }
        this._layout();
        return this;
    }

    // (Re)sizes the 2D canvas to the current shared portrait size and
    // re-fits the portrait - on creation and on every viewport resize.
    _layout() {
        if (this.arena) { this.arena.layoutFighter(this); return; }
        if (this.embedded) return;
        this.size = cgShared.size;
        const [w, h] = this.size;
        const res = cgShared.resolution;
        this.canvasEl.width = Math.round(w * res);
        this.canvasEl.height = Math.round(h * res);
        this.canvasEl.style.width = w + 'px';
        this.canvasEl.style.height = h + 'px';
        if (this.ctx) { this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high'; }
        this._fitPortrait();
        this.needsRender = true;
    }

    _fitPortrait() {
        const [w, h] = this.size;
        const sprite = this.portraitSprite;
        this.baseX = w / 2;
        this.baseY = h;
        sprite.x = this.baseX;
        sprite.y = this.baseY;
        sprite.rotation = 0;
        sprite.pivot.set(100, 250); // rig space: feet at the bottom center of the 200x250 box
        if (this.stripW) {
            // Fit within the canvas while preserving aspect ratio, leaving
            // side room for the class actions to lunge/dash into.
            const scale = Math.min((h * 0.9) / this.stripH, (w * 0.8) / this.stripW, 4);
            this.portraitBaseScale = scale;
        }
        sprite.scale.set(this.portraitBaseScale);
    }

    // Swaps which character/monster art this stage shows. Safe to call before
    // init finishes (awaits internally) or repeatedly (e.g. a fresh monster
    // every level) - always resets any hit-shake/motion/death left over from
    // the last one.
    async setPortrait(url) {
        await this.ready;
        this.url = url;
        this.isAvatar = false;
        this.rigHandSide = 'R';
        this.charKey = url.split('/').pop().replace(/\.[a-z]+$/, '');
        this.facing = this.embedded ? (this.side === 'right' ? -1 : 1) : (this.charKey.indexOf('monster_') === 0 ? -1 : 1);
        const rigs = await cgLoadRigs(url.replace(/[^/]*$/, ''));
        const rig = rigs[this.charKey];
        if (!rig) return;
        const base = url.replace(/\.[a-z]+$/, '') + '/';
        const textures = await Promise.all(rig.parts.map(p => cgLoadTexture(base + p + '.svg')));
        if (this.url !== url) return; // a newer setPortrait won the race
        const parts = {};
        rig.parts.forEach((p, i) => { textures[i].source.scaleMode = 'linear'; parts[p] = textures[i]; });
        this.rigParts = parts;
        this.rigPivots = rig.pivots;
        this.rigHand = rig.hand || [6, 58]; // weapon hand, relative to the arm pivot
        this.portraitSprite.removeChildren().forEach(c => c.destroy({ children: true }));
        this.rigBox = null;
        const built = this._buildRig(parts, rig.pivots, this.facing < 0);
        this.portraitSprite.addChild(built.inner);
        this.joints = built.joints;
        this.stripW = 200;
        this.stripH = 250;
        this.portraitSprite.tint = 0xffffff;
        this.portraitSprite.alpha = 1;
        this.dead = false;
        this._fitPortrait();
        this.needsRender = true;
        // a fresh monster in the arena walks in from its side
        if (this.arena && this.side === 'right' && this.charKey.indexOf('monster_') === 0) this.playEntrance();
    }

    // A layered avatar (avatar.js): painted from data (body, looks, gear)
    // instead of loaded from files. Same rig, same animations.
    async setAvatar(spec) {
        await this.ready;
        if (typeof avPaint !== 'function') return;
        const painted = avPaint(spec);
        const token = this.url = 'avatar:' + JSON.stringify(spec);
        this.charKey = 'avatar_' + (spec.cls || 'hero');
        this.facing = this.embedded ? (this.side === 'right' ? -1 : 1) : 1;
        const textures = await Promise.all(painted.order.map(p => cgTextureFromSVG(painted.parts[p])));
        if (this.url !== token) return; // a newer look won the race
        const parts = {};
        painted.order.forEach((p, i) => { parts[p] = textures[i]; });
        this.isAvatar = true;
        this.rigHandSide = painted.handSide || 'R';
        this._installRig(parts, painted.pivots, painted.hand, painted.box);
    }

    _installRig(parts, pivots, hand, box) {
        this.rigBox = box || null;
        this.rigParts = parts;
        this.rigPivots = pivots;
        this.rigHand = hand || [6, 58];
        this.portraitSprite.removeChildren().forEach(c => c.destroy({ children: true }));
        const built = this._buildRig(parts, pivots, this.facing < 0, this.rigBox);
        this.portraitSprite.addChild(built.inner);
        this.joints = built.joints;
        this.stripW = 200;
        this.stripH = 250;
        this.portraitSprite.tint = 0xffffff;
        this.portraitSprite.alpha = 1;
        this.dead = false;
        this._fitPortrait();
        this.needsRender = true;
    }

    // Builds the joint hierarchy for a set of part textures: back and legs on
    // the body, the torso joint carrying head and both arms. Returns the
    // (optionally mirrored) inner container, its joints, and a standalone
    // root for clones (afterimages).
    // `box` [x, y, w, h]: where each part image sits in the 200x250 body
    // space (painted avatars draw on a bigger canvas than the body box).
    _buildRig(parts, pivots, mirror, box) {
        const joints = {};
        const inner = new PIXI.Container();
        if (mirror) { inner.position.set(200, 0); inner.scale.x = -1; }
        const B = box || [0, 0, 200, 250];
        const sprite = (tex) => { const sp = new PIXI.Sprite(tex); sp.position.set(B[0], B[1]); sp.width = B[2]; sp.height = B[3]; return sp; };
        const joint = (name) => {
            const c = new PIXI.Container();
            const [px, py] = pivots[name] || [100, 125];
            c.pivot.set(px, py); c.position.set(px, py);
            if (parts[name]) c.addChild(sprite(parts[name]));
            joints[name] = c;
            return c;
        };
        if (parts.back) inner.addChild(sprite(parts.back));
        inner.addChild(joint('legL'));
        inner.addChild(joint('legR'));
        const torso = joint('torso');
        if (parts.armLf) {
            // 3/4 view (avatar.js): the far arm is behind the body, but what
            // it holds (a shield, an orb, a bow) is in front - a second
            // joint on the same pivot, turned with the arm (_syncLinked)
            torso.addChildAt(joint('armL'), 0);
            torso.addChild(joint('head'));
            torso.addChild(joint('armLf'));
        } else {
            torso.addChild(joint('head'));
            torso.addChild(joint('armL'));
        }
        torso.addChild(joint('armR'));
        inner.addChild(torso);
        const root = new PIXI.Container();
        root.pivot.set(100, 250);
        root.addChild(inner);
        return { inner, joints, root };
    }

    // Joints that mirror another one (the far hand's held item).
    _syncLinked() {
        const j = this.joints;
        if (j && j.armLf && j.armL) j.armLf.rotation = j.armL.rotation;
    }

    // Sets joint angles from a rig animation at t (or idle when none).
    _applyRig(rigAnim, t) {
        CG_JOINTS.forEach(j => {
            const c = this.joints[j];
            if (!c) return;
            c.rotation = rigAnim && rigAnim[j] ? rigAnim[j](t) : 0;
        });
    }

    // One-off joint animation (hit flinch, death) layered on the body.
    _rigTween(name, ms, hold) {
        const anim = CG_RIGS[name];
        if (!anim) return;
        this._tween(ms, t => this._applyRig(anim, t), () => { if (!hold) this._applyRig(null, 0); });
    }

    // A quick shake + white hit-flash on the portrait itself, plus a small
    // type-specific burst sprite - used for a SELF-buff tile (shield/heart/
    // energy), where nobody is actually being hit, just a gentle "something
    // happened to me" cue. For sword/skull, which actually damage someone,
    // see playHitReaction instead - a shake reads as far too mild for "I
    // just got hit," which is exactly the gap the user called out.
    async playHit(tileType, delayMs) {
        await this.ready;
        if (delayMs) await cgWait(delayMs);
        // Self-buffs: a gentle bob plus a flash in the buff's own color
        // (green heal, blue armor, gold energy) so it reads as "I got
        // something", held long enough to actually see.
        this._shake(this.portraitSprite, 5, 420);
        this._flash(this.portraitSprite, 700, CG_FLASH_COLORS[tileType] || 0x9fd8ff);
        const effect = HIT_EFFECT_SPRITES[tileType];
        if (effect) this._burst([effect], 1.3, 800);
    }

    // Played on the DEFENDER when a blow lands. How hard it reads depends on
    // what hit it: the attacker's move marks its target with its tier when
    // it starts (incomingTier) - a light hit flinches, a heavy one staggers
    // the fighter back a few steps, a finisher knocks them off their feet.
    // Two flinch variants alternate so a run of small hits doesn't repeat.
    async playHitReaction(tileType, delayMs, tierArg) {
        await this.ready;
        if (delayMs) await cgWait(delayMs);
        if (this.dead) return;
        const tier = tierArg || this.incomingTier || (tileType === 'skull' ? 2 : 1);
        this.incomingTier = 0;
        this._flash(this.portraitSprite, 650, 0xff3b30); // hurt = red
        const effect = HIT_EFFECT_SPRITES[tileType];
        if (effect) this._burst([effect], 1.1 + 0.3 * tier, 850);
        if (this.activeMove) return; // mid-move: the flash + burst say it, don't yank the body
        const back = -this.facing; // pushed away from whoever it faces
        const sprite = this.portraitSprite, k = this.size[0] / 90;
        let rig, ms, push;
        if (tier >= 3) { rig = 'knockdown'; ms = 1300; push = 26; }
        else if (tier === 2) { rig = cgRand() < 0.5 ? 'stagger' : 'recoil'; ms = 760; push = 20; }
        else { rig = cgRand() < 0.5 ? 'flinch' : 'recoil'; ms = 520; push = 12; }
        const anim = CG_RIGS[rig];
        const token = ++this.performToken;
        this.activeMove = { reaction: true };
        this._tween(ms, t => {
            if (token !== this.performToken) return;
            let dx, rot = 0, dy = 0;
            if (tier >= 3) {
                // thrown back, down on the ground, then back up
                const fly = CG_EASE.out(CG_EASE.seg(t, 0, 0.25)), up = CG_EASE.inOut(CG_EASE.seg(t, 0.6, 0.95));
                dx = push * k * fly * (1 - up * 0.6);
                rot = back * 1.25 * fly * (1 - up);
                dy = -18 * k * CG_EASE.bump(CG_EASE.seg(t, 0, 0.25)) / 3;
            } else {
                dx = push * k * Math.sin(Math.min(1, t * 1.4) * Math.PI) * (1 - t * 0.3);
                rot = back * 0.16 * Math.sin(t * Math.PI);
            }
            sprite.x = this.baseX + back * dx;
            sprite.y = this.baseY + dy;
            sprite.rotation = rot;
            this._applyRig(anim, t);
        }, () => {
            if (token !== this.performToken) return;
            this.activeMove = null;
            sprite.x = this.baseX; sprite.y = this.baseY; sprite.rotation = 0;
            this._applyRig(null, 0);
        });
        if (this.arena && tier >= 3) this._after(ms * 0.25, () => { const p = this.arena.bodyPoint(this, 0); this.arena.dust(p.x, p.y, 8, back); this.arena.shake(4, 220); });
    }

    // The one big moment per class: the arena dims, the camera pushes in on
    // the caster, the ult's name sweeps across, then the class's own ult
    // move lands (at the usual impact time) with a hit-stop and a heavy
    // reaction on the target.
    async playUlt(classKey) {
        await this.ready;
        const move = typeof cgUltMove === 'function' ? cgUltMove(classKey) : null;
        const arena = this.arena;
        const color = (move && move.color) || 0xfff2a0;
        if (arena && cgEffectsEnabled()) {
            arena.dim(0.55, 1600);
            const bp = arena.bodyPoint(this, 0.55);
            arena.zoomTo(bp.x, bp.y, 1.14, 900, 250);
            arena.banner(cgUltName(classKey), color, 1500);
        }
        this._flash(this.portraitSprite, 900, 0xfff2a0);
        const effects = ULT_EFFECT_SPRITES[classKey] || [HIT_EFFECT_SPRITES.energy];
        this._burst(effects, 2.1, 1200);
        if (move) this._perform(move);
        const foe = arena ? arena.opponentOf(this) : null;
        if (foe) this._after(cgImpactMs(), () => { cgHitStop(120); foe.playHitReaction('skull', 0, 3); });
    }

    // The fighter's own move for a tile match. Every class has several
    // moves per action (moves.js); a bigger match (4/5, L/T) or a combo
    // escalates to heavier moves and finishers, and the same move never
    // plays twice in a row.
    async playClassMotion(classKey, tileType, power, combo) {
        await this.ready;
        const act = tileType === 'teamheal' ? 'heart' : tileType;
        const list = typeof cgMovesFor === 'function' ? cgMovesFor(classKey, act) : null;
        this._perform(this._pickMove(classKey + '.' + act, list, cgTierFor(power, combo)));
    }

    _pickMove(key, list, tier) {
        if (!list || !list.length) return null;
        let pool = list.filter(m => (m.tier || 1) === tier);
        for (let t = tier - 1; !pool.length && t >= 1; t--) pool = list.filter(m => (m.tier || 1) === t);
        if (!pool.length) pool = list;
        const last = this.lastMoves[key];
        if (pool.length > 1) pool = pool.filter(m => m.id !== last);
        const move = pool[Math.floor(cgRand() * pool.length)];
        this.lastMoves[key] = move.id;
        return move;
    }

    // Runs fn after `ms` of animation time.
    _after(ms, fn) { this._tween(Math.max(1, ms), () => {}, fn); }

    // Runs one move: body motion (a dash/leap/blink across the arena for
    // melee, a pose for the rest), the jointed rig, its vector effects, a
    // projectile timed to arrive on the impact, and the impact's own
    // hit-stop/shake/burst. Effects spawned in the fighter's own layers
    // travel with the body.
    _perform(move, opts) {
        if (!move || this.dead) return;
        opts = opts || {};
        const ms = move.ms || 1000, impactMs = cgImpactMs();
        const kind = move.kind || 'self', f = this.facing;
        const arena = this.arena;
        const foe = arena && kind !== 'self' ? arena.opponentOf(this, opts.targetId) : null;
        const reach = kind === 'melee' && foe ? arena.reachTo(this, foe) : 0;
        const tier = move.tier || 1;
        if (foe) foe.incomingTier = Math.max(foe.incomingTier || 0, tier);
        this.lastAction = move;
        const ctx = { stage: this, foe, arena, reach, impactMs, ms, f, tier };
        if (move.fx && cgEffectsEnabled()) move.fx(this, ctx);
        if (kind === 'ranged' && move.shot && foe) {
            const launch = move.launchMs || 230;
            this._after(launch, () => {
                if (foe.dead && !foe.portraitSprite) return;
                arena.shoot(move.shot, arena.handPoint(this), arena.bodyPoint(foe, move.aimY || 0.5), Math.max(60, impactMs - launch), move.color || 0xffffff);
            });
        }
        this._after(impactMs, () => {
            if (move.onImpact && cgEffectsEnabled()) move.onImpact(this, ctx);
            if (!foe) return;
            if (tier >= 2) cgHitStop(tier >= 3 ? 110 : 60);
            arena.shake(tier >= 3 ? 7 : tier === 2 ? 4 : 2, 260);
            if (kind === 'melee') {
                const p = arena.bodyPoint(foe, 0.55);
                arena.impact(p.x - f * 8, p.y, move.color || 0xffffff, 0.5 + 0.3 * tier);
            }
        });
        const sprite = this.portraitSprite;
        const rigAnim = (this.isAvatar && CG_RIGS[move.rig + 'A']) || CG_RIGS[move.rig];
        const keyT = kind === 'ranged' ? (move.launchMs || 230) / ms : kind === 'melee' ? impactMs / ms : null;
        const warp = cgRigWarp(move.rig, keyT);
        const body = typeof cgBodyMotion === 'function' ? cgBodyMotion(move, reach, impactMs / ms) : (t => ({}));
        const k = this.size[0] / 90;
        const room = arena ? Infinity : Math.max(4, (this.size[0] - (this.stripW || 200) * this.portraitBaseScale) / 2 + this.size[0] * 0.08);
        // start from wherever the body is now (an interrupted move) instead of snapping
        const from = { x: sprite.x - this.baseX, y: sprite.y - this.baseY, r: sprite.rotation };
        const token = ++this.performToken;
        this.activeMove = move;
        let stepSide = 0;
        this._tween(ms, t => {
            if (token !== this.performToken) return;
            const p = body(t);
            const blend = 1 - Math.min(1, t / 0.12);
            const local = Math.max(-room, Math.min(room, (p.dx || 0) * k));
            const dx = f * (local + (p.travel || 0));
            const dy = (p.dy || 0) * k + (p.lift || 0);
            this.lastPose = { dx, dy };
            sprite.x = this.baseX + dx * (1 - blend) + from.x * blend;
            sprite.y = this.baseY + dy * (1 - blend) + from.y * blend;
            sprite.rotation = f * (p.rot || 0) * (1 - blend) + from.r * blend;
            sprite.scale.set(this.portraitBaseScale * (p.sx || 1), this.portraitBaseScale * (p.sy || 1));
            sprite.alpha = p.alpha === undefined ? 1 : p.alpha;
            this._applyRig(rigAnim, warp(t));
            if (p.run) {
                // running legs/arms layered over the move's own pose
                const ph = t * ms / 1000 * 15, j = this.joints;
                if (j.legL) j.legL.rotation += 0.75 * p.run * Math.sin(ph);
                if (j.legR) j.legR.rotation -= 0.75 * p.run * Math.sin(ph);
                if (j.torso) j.torso.rotation += 0.12 * p.run;
                const side = Math.sin(ph) > 0 ? 1 : -1;
                if (arena && side !== stepSide && Math.abs(p.run) > 0.3) { stepSide = side; const q = arena.bodyPoint(this, 0); arena.dust(q.x, q.y, 2, -f); }
            }
            this.effectLayer.x = this.backLayer.x = sprite.x - this.baseX;
            this.effectLayer.y = this.backLayer.y = Math.min(0, sprite.y - this.baseY);
        }, () => {
            if (token !== this.performToken) return;
            this.activeMove = null;
            this._applyRig(null, 0);
            this.lastPose = { dx: 0, dy: 0 };
            sprite.x = this.baseX; sprite.y = this.baseY; sprite.rotation = 0; sprite.alpha = 1;
            sprite.scale.set(this.portraitBaseScale);
            this.effectLayer.x = this.backLayer.x = 0;
            this.effectLayer.y = this.backLayer.y = 0;
        });
    }

    // A monster walks (or, for a boss, stomps) in from its side of the arena.
    playEntrance() {
        if (!this.arena || this.dead) return;
        const sprite = this.portraitSprite, from = this.arena.size[0] - (this.root.x + this.baseX) + 60;
        const boss = this.charKey === 'monster_boss';
        const token = ++this.performToken;
        this.activeMove = { entrance: true };
        this._tween(boss ? 1100 : 900, t => {
            if (token !== this.performToken) return;
            const e = CG_EASE.out(t);
            sprite.x = this.baseX + (1 - e) * from;
            sprite.y = this.baseY - (boss ? 40 * CG_EASE.bump(CG_EASE.seg(t, 0, 0.8)) : 0);
            const ph = t * 14, j = this.joints;
            if (!boss) { if (j.legL) j.legL.rotation = 0.6 * Math.sin(ph) * (1 - t); if (j.legR) j.legR.rotation = -0.6 * Math.sin(ph) * (1 - t); }
            if (j.armL) j.armL.rotation = -0.3 * Math.sin(ph) * (1 - t);
            if (j.armR) j.armR.rotation = 0.3 * Math.sin(ph) * (1 - t);
        }, () => {
            if (token !== this.performToken) return;
            this.activeMove = null;
            sprite.x = this.baseX; sprite.y = this.baseY;
            this._applyRig(null, 0);
            if (boss && this.arena) { const p = this.arena.bodyPoint(this, 0); this.arena.dust(p.x, p.y, 12); this.arena.shake(8, 400); }
        });
    }

    // Arms up after the opponent falls.
    playVictory() {
        if (this.dead) return;
        this._perform({ id: 'victory', kind: 'self', ms: 1200, rig: 'victory', pose: CG_POSE.float(6) });
    }

    // Persistent looks, drawn behind the fighter every frame they're on:
    // ULT ready (gold), an equipped unique item (its rarity color), an
    // enraged boss (red).
    setUltReady(on) { this.auras.ult = on ? 0xffd24a : null; this.needsRender = true; }
    setLegendary(color) { this.auras.legendary = color || null; this.needsRender = true; }
    setEnraged(on) { this.auras.enraged = !!on; this.needsRender = true; }
    setGroundGlow(color) { this.groundGlow = color; if (this.arena && this.shadow) this.arena._drawShadow(this); this.needsRender = true; }

    _updateAuras(now) {
        const a = this.auras, g = this.auraG;
        if (!g) return false;
        const any = a.ult !== null || a.legendary !== null || a.enraged;
        if (!any) { if (g.visible) { g.clear(); g.visible = false; return true; } return false; }
        const step = Math.floor(now / CG_BREATH_STEP_MS);
        if (step === this.auraStep && !this.activeTweens) return false;
        this.auraStep = step;
        g.visible = !this.dead;
        g.clear();
        const sp = this.portraitSprite, bodyH = (this.stripH || 250) * this.portraitBaseScale;
        const cx = sp.x, cy = sp.y - bodyH * 0.45;
        const pulse = 0.5 + 0.5 * Math.sin(now / 1000 * 3.2);
        const ring = (color, r, alpha) => { for (let i = 3; i >= 1; i--) g.ellipse(cx, cy, r * 0.42 * i / 3 + 4, r * 0.55 * i / 3 + 4).fill({ color, alpha: alpha / i }); };
        if (a.enraged) ring(0xff2a1a, bodyH * 1.05, 0.22 + 0.18 * pulse);
        if (a.legendary !== null) ring(a.legendary, bodyH * 0.95, 0.14 + 0.1 * pulse);
        if (a.ult !== null) {
            ring(a.ult, bodyH * 0.9, 0.16 + 0.16 * pulse);
            // rising motes
            for (let i = 0; i < 5; i++) {
                const ph = (now / 1400 + i / 5) % 1;
                g.circle(cx + Math.sin(i * 2.4 + now / 700) * bodyH * 0.22, cy + bodyH * 0.45 - ph * bodyH, 1.6 + pulse).fill({ color: a.ult, alpha: 0.9 * (1 - ph) });
            }
        }
        return true;
    }

    // Adds a vector effect that lives for `ms`, updated by onT(t), then is
    // removed and destroyed.
    _vfx(obj, ms, onT, back) {
        (back ? this.backLayer : this.effectLayer).addChild(obj);
        onT(0);
        this._tween(ms, onT, () => { if (obj.parent) obj.parent.removeChild(obj); obj.destroy({ children: true }); });
    }

    // `effects` is a list of {sprite, tint} - see HIT_EFFECT_SPRITES/
    // ULT_EFFECT_SPRITES' header comment for why every burst carries a tint
    // (the source art is a neutral grayscale mask, not colored art).
    // Skipped entirely in low-graphics mode (the portrait's own shake/flash
    // still plays, so the hit still reads).
    async _burst(effects, scaleTo, durationMs) {
        if (!cgEffectsEnabled()) return;
        const textures = await Promise.all(effects.map(e => cgLoadTexture(e.sprite)));
        const [w, h] = this.size;
        textures.forEach((texture, i) => {
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);
            sprite.x = w / 2;
            sprite.y = h * 0.55;
            sprite.alpha = 0.95;
            // 'normal' rather than 'add' - additive blending only reads
            // correctly for near-white tints (its brightness contribution
            // scales with the tint's own RGB value), which silently made
            // every mid-tone tint here (necromancer's purple, berserker's
            // orange) nearly invisible during testing. 'normal' respects the
            // tint's actual color/brightness regardless of what's behind it.
            sprite.blendMode = 'normal';
            sprite.tint = effects[i].tint;
            sprite.rotation = Math.random() * Math.PI * 2;
            const baseScale = (h / texture.height) * 0.5;
            sprite.scale.set(baseScale * 0.4);
            this.effectLayer.addChild(sprite);
            this._tween(durationMs + i * 80, t => {
                sprite.scale.set(baseScale * (0.4 + scaleTo * t));
                sprite.alpha = 0.95 * (1 - t);
            }, () => { this.effectLayer.removeChild(sprite); sprite.destroy(); });
        });
    }

    _shake(target, magnitude, durationMs) {
        this._tween(durationMs, t => {
            const decay = 1 - t;
            target.x = this.baseX + (Math.random() * 2 - 1) * magnitude * decay;
        }, () => { target.x = this.baseX; });
    }

    // A sharp push away from rest plus a stagger tilt, unlike _shake's small
    // random jitter - meant to read as "that landed," not just "something
    // happened." Snaps out fast then eases back, with a brief rotational
    // stagger layered on top.
    _knockback(target, magnitude, durationMs) {
        this._tween(durationMs, t => {
            const push = magnitude * Math.sin(t * Math.PI) * (1 - t * 0.3);
            target.x = this.baseX - this.facing * push;
            target.rotation = Math.sin(t * Math.PI) * 0.18;
        }, () => { target.x = this.baseX; target.rotation = 0; });
    }

    // Tints the portrait toward `color` and back: a quick rise, a hold,
    // then an ease back to normal, so the hit/heal color is actually seen.
    _flash(target, durationMs, color) {
        const c = color === undefined ? 0xff3b30 : color;
        const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
        this._tween(durationMs, t => {
            const k = t < 0.15 ? t / 0.15 : t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55;
            const mix = (v) => Math.round(255 + (v - 255) * k * 0.85);
            target.tint = t >= 0.99 ? 0xffffff : (mix(r) << 16 | mix(g) << 8 | mix(b));
        }, () => { target.tint = 0xffffff; });
    }

    // A tiny hand-rolled tween instead of pulling in a whole animation
    // library - every effect here is "interpolate one value over N ms then
    // clean up", which a single ticker callback covers completely. Counted
    // in activeTweens so cgFrame knows this stage needs repainting while it
    // runs (and can go back to near-idle the moment it's done).
    _tween(durationMs, onFrame, onDone) {
        const clock = typeof cgNow === 'function' ? cgNow : () => performance.now();
        const start = clock();
        const ticker = cgShared.ticker;
        this.activeTweens++;
        const step = () => {
            const t = Math.min(1, (clock() - start) / durationMs);
            onFrame(t);
            if (t >= 1) {
                ticker.remove(step);
                this.activeTweens--;
                this.needsRender = true; // paint the final resting pose
                if (onDone) onDone();
            }
        };
        ticker.add(step);
    }

    // A monster's own hit / self-buff (moves.js has several per monster).
    // `power` = the match multiplier; `targetId` picks which hero it goes
    // for when there are two (co-op).
    async playAttack(power, targetId) {
        await this.ready;
        const list = typeof cgMonsterMoves === 'function' ? cgMonsterMoves(this.charKey, 'attack', this.auras.enraged) : null;
        this._perform(this._pickMove(this.charKey + '.attack', list, cgTierFor(power > 0 ? power : 1, 0)), { targetId });
    }

    async playBuff() {
        await this.ready;
        const list = typeof cgMonsterMoves === 'function' ? cgMonsterMoves(this.charKey, 'buff') : null;
        this._perform(this._pickMove(this.charKey + '.buff', list, 1));
    }

    // G3 - topples and fades out; stays down until setPortrait()/revive().
    async playDeath() {
        await this.ready;
        const sprite = this.portraitSprite;
        this.performToken++; // stop whatever move was running
        this.activeMove = null;
        this.dead = true;
        this._rigTween('death', 650, true);
        const foe = this.arena ? this.arena.opponentOf(this) : null;
        if (foe && !foe.dead) this._after(450, () => foe.playVictory());
        this._tween(650, t => {
            sprite.rotation = 0.5 * t;
            sprite.y = this.baseY + this.size[1] * 0.12 * t;
            sprite.alpha = 1 - t;
            const c = Math.round(255 - 90 * t);
            sprite.tint = (255 << 16) | (c << 8) | c;
        }, () => { sprite.alpha = 0; });
    }

    async revive() {
        await this.ready;
        this.dead = false;
        this.performToken++;
        this.activeMove = null;
        this.portraitSprite.alpha = 1;
        this.portraitSprite.tint = 0xffffff;
        this._applyRig(null, 0);
        this._fitPortrait();
        this.needsRender = true;
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; this.needsRender = true; }
}

// Registry so a mode can fetch its own stage by canvas id without holding a
// reference across function calls (game.js/pvp.js/coop.js call cgGetStage
// fresh each time rather than threading a variable through every function).
let cgStages = {};

// Lazily creates (or returns the existing) CombatStage for a <canvas id="...">.
// Returns null if the canvas doesn't exist or PixiJS failed to load - every
// call site checks for null so a graphics failure never breaks combat itself.
function cgGetStage(canvasId) {
    if (typeof PIXI === 'undefined') return null;
    if (cgStages[canvasId]) return cgStages[canvasId];
    const el = document.getElementById(canvasId);
    if (!el) return null;
    const stage = new CombatStage(el);
    cgStages[canvasId] = stage;
    return stage;
}

// ?debug=1 - a small live overlay: page FPS (real requestAnimationFrame
// rate, not just the Pixi ticker's), portrait renders per second, DOM node
// count and the number of live WebGL contexts this module owns. Meant for
// checking a weak phone (e.g. the Galaxy A50 this project's perf notes
// mention) without devtools attached.
function cgStartDebugOverlay() {
    const el = document.createElement('div');
    el.id = 'cg-debug-overlay';
    el.style.cssText = 'position:fixed; right:4px; bottom:4px; z-index:9999; background:rgba(0,0,0,0.75); color:#2ecc71; font:11px monospace; padding:4px 6px; border-radius:4px; pointer-events:none; white-space:pre;';
    document.body.appendChild(el);
    let frames = 0, last = performance.now(), lastRenders = 0;
    const loop = (now) => {
        frames++;
        if (now - last >= 1000) {
            const renders = cgShared.stats.renders - lastRenders;
            lastRenders = cgShared.stats.renders;
            el.textContent = `FPS ${Math.round(frames * 1000 / (now - last))}\nrenders/s ${renders}\nstages ${cgShared.stages.length} · webgl ${cgShared.renderer ? 1 : 0}\nDOM ${document.getElementsByTagName('*').length}\nquality ${typeof cgQualityLevel === 'function' ? cgQualityLevel() : '-'}`;
            frames = 0; last = now;
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
if (/[?&]debug=1\b/.test(location.search)) document.addEventListener('DOMContentLoaded', cgStartDebugOverlay);

// Faz 2 (graphics roadmap) - a tiny colored burst AT THE MATCHED TILE'S OWN
// POSITION, tinted per tile type (same palette as HIT_EFFECT_SPRITES above,
// so the board and the portrait hit effects read as the same visual
// language). Deliberately plain DOM/CSS, not another PixiJS stage - a match
// can clear up to 7-8 tiles at once on a 64-tile board, and one PIXI.Application
// per tile would be a real cost for something this small; a radial-gradient
// div animated with transform+opacity only is compositor-cheap and matches
// this project's existing mobile-GPU-perf discipline (see .tile's own
// comment in style.css on why filter/box-shadow are avoided at board scale).
const TILE_BURST_COLORS = {
    // same hues as the board tiles (tools/make_tiles.py DISC)
    sword: '#e6edf5', skull: '#ff4a3a', shield: '#4f9dff', heart: '#ff5c8a', energy: '#ffe24a', teamheal: '#4fe88a'
};
function cgTileBurst(tileEl, tileType) {
    if (!tileEl || !cgEffectsEnabled()) return;
    const color = TILE_BURST_COLORS[tileType];
    if (!color) return;
    const rect = tileEl.getBoundingClientRect();
    const burst = document.createElement('div');
    burst.className = 'cg-tile-burst';
    burst.style.left = (rect.left + rect.width / 2 + window.scrollX) + 'px';
    burst.style.top = (rect.top + rect.height / 2 + window.scrollY) + 'px';
    burst.style.width = rect.width + 'px';
    burst.style.height = rect.height + 'px';
    burst.style.setProperty('--burst-color', color);
    document.body.appendChild(burst);
    // animationend is the normal path; the timeout is only a safety net in
    // case the element gets display:none'd (e.g. a fast overlay swap) before
    // the animation ever fires that event.
    burst.addEventListener('animationend', () => burst.remove());
    setTimeout(() => burst.remove(), 600);
}

// Faz 7 (graphics roadmap, 2nd wave) - sets a bar AND its ghost-trail
// sibling (see .bar-ghost, style.css) to the same target width. Safe to
// call on any bar id, ghost or not - a bar with no `${barId}-ghost`
// element in the DOM (armor bars, ult bars, the tiered opponent/ally
// status bars) just silently skips that half, so this can be dropped in
// anywhere a bar's width was previously set directly.
function cgSetBarWithGhost(barId, pct) {
    const bar = document.getElementById(barId);
    if (bar) bar.style.width = pct + '%';
    const ghost = document.getElementById(barId + '-ghost');
    if (ghost) ghost.style.width = pct + '%';
}

// Faz 7 - toggles the low-HP pulse (style.css's .low-hp) on a bar's own
// .bar-container. `containerEl` (not an id) since the three modes don't
// all reach their HP bar's container the same way - callers already have
// the element in hand more often than not.
function cgSetLowHpWarning(containerEl, isLow) {
    if (!containerEl) return;
    containerEl.classList.toggle('low-hp', !!isLow);
}

// Faz 7 - toggles the ULT-ready glow (style.css's .ult-ready).
function cgSetUltReady(containerEl, isReady) {
    if (!containerEl) return;
    containerEl.classList.toggle('ult-ready', !!isReady);
}

// Faz 8 (graphics roadmap, 2nd wave) - a boss level's entrance (a red
// full-screen flash + the boss's own portrait bouncing into view) instead
// of just a log line and a bigger stat block. `portraitId` is the mode's
// own enemy canvas ('enemy-sprite' solo, 'coop-enemy-sprite' co-op - PvP
// has no boss concept, it's 1v1 duels). The entrance class is removed
// after its own animation finishes rather than left on the element - solo's
// enemy-sprite ALSO carries .enemy-display's permanent float bob, and since
// two animation-shorthand classes on one element don't combine (the later
// one wins outright, same lesson as matched/matched-big - see that fix's
// commit), leaving cg-boss-entrance on permanently would silently kill the
// float animation for good, not just for its own 0.6s.
function cgBossIntro(portraitId) {
    if (!cgEffectsEnabled()) return;
    const flash = document.createElement('div');
    flash.className = 'cg-boss-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);

    const portrait = document.getElementById(portraitId);
    if (portrait && portrait.tagName !== 'CANVAS') {
        // arena: the boss stomps in (its entrance) and roars once it lands
        const st = cgStages[portraitId];
        if (st) st.ready.then(() => st._after(1200, () => st.playBuff()));
        return;
    }
    if (portrait) {
        portrait.classList.remove('cg-boss-entrance');
        void portrait.offsetWidth;
        portrait.classList.add('cg-boss-entrance');
        setTimeout(() => portrait.classList.remove('cg-boss-entrance'), 650);
    }
}

// Faz 8 - a ONE-TIME dramatic beat for the moment a boss enrages, on top of
// checkBossEnrage's (game.js) existing ONGOING .enraged pulse - that pulse
// communicates "this is now more dangerous" for the rest of the fight, but
// never actually announced the TRANSITION itself. Reuses cgBoardImpact's
// own shake for the "impact" half rather than inventing a third shake
// variant.
function cgBossEnrageTransition(gridEl) {
    if (typeof cgBoardImpact === 'function') cgBoardImpact(gridEl, 3);
    if (!cgEffectsEnabled()) return;
    const flash = document.createElement('div');
    flash.className = 'cg-boss-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
}

// Faz 10 (graphics roadmap, 2nd wave) - a per-class glow ring around the
// player's OWN portrait, not the shared board (Faz 5 already gave
// #pvp-grid/#coop-grid their own MODE-identity border tint - stacking a
// second, class-based tint on the same shared board would fight that
// signal instead of adding to it; the player's own portrait belongs to
// them alone in every mode, so it's the right place for CLASS identity).
const CLASS_GLOW_KEYS = ['warrior', 'berserker', 'rogue', 'archer', 'mage', 'necromancer', 'paladin'];
const CLASS_GLOW_COLORS = { warrior: 0x95a5a6, berserker: 0xe74c3c, rogue: 0x9b59b6, archer: 0x27ae60, mage: 0x3498db, necromancer: 0x8e44ad, paladin: 0xf1c40f };
function cgSetClassGlow(canvasId, classKey) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    // an arena fighter gets a colored ring on the floor instead of a CSS glow
    if (el.tagName !== 'CANVAS') { cgStageDo(canvasId, 'setGroundGlow', CLASS_GLOW_COLORS[classKey] === undefined ? null : CLASS_GLOW_COLORS[classKey]); return; }
    CLASS_GLOW_KEYS.forEach(k => el.classList.remove('class-glow-' + k));
    if (classKey && CLASS_GLOW_KEYS.includes(classKey)) el.classList.add('class-glow-' + classKey);
}

// Faz 10 - a persistent aura on the player's own portrait while an
// orange/red/teal unique item (items.js's RARITY_DEFS - the isUnique tier,
// this project's actual "legendary" vocabulary; the reward-pool's own
// common/uncommon/rare/epic/legendary strings from Faz 9 are a DIFFERENT,
// unrelated system for temporary per-run stat picks) is equipped in any
// slot. `rarityKey` is null to clear it. Uses the item's own RARITY_DEFS
// color (single source of truth) rather than a second hardcoded palette.
function cgSetLegendaryAura(canvasId, rarityKey) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    if (el.tagName !== 'CANVAS') {
        const def = rarityKey && typeof RARITY_DEFS !== 'undefined' ? RARITY_DEFS[rarityKey] : null;
        cgStageDo(canvasId, 'setLegendary', def ? parseInt(String(def.color).replace('#', ''), 16) : null);
        return;
    }
    if (rarityKey && typeof RARITY_DEFS !== 'undefined' && RARITY_DEFS[rarityKey]) {
        el.style.setProperty('--legendary-aura-color', RARITY_DEFS[rarityKey].color);
        el.classList.add('cg-legendary-aura');
    } else {
        el.classList.remove('cg-legendary-aura');
        el.style.removeProperty('--legendary-aura-color');
    }
}

// Faz 11 (graphics roadmap, 2nd wave) - every modal in this project opened/
// closed with a hard display:none<->flex snap (no transition possible on
// `display` itself). This fades+scales it instead, using the same
// "add .visible a frame after display is set, remove it before the
// eventual display:none" pattern .cg-defeat-vignette and .achievement-toast
// already use elsewhere in this file/achievements.js - not a new
// technique, just applied to modals too. `opening=false`'s setTimeout only
// commits display:none if nothing re-opened the SAME modal in the
// meantime (checks .visible is still absent), so a fast close-then-reopen
// (e.g. a player double-tapping) can't get stuck hidden.
function cgAnimateModal(modalEl, opening) {
    if (!modalEl) return;
    if (opening) {
        modalEl.style.display = 'flex';
        void modalEl.offsetWidth;
        modalEl.classList.add('visible');
    } else {
        modalEl.classList.remove('visible');
        setTimeout(() => {
            if (!modalEl.classList.contains('visible')) modalEl.style.display = 'none';
        }, 220);
    }
}

// Faz 11 (graphics roadmap, 2nd wave) - a depleting progress underline on
// the speed-bonus badge (⚡x2.0 etc.), so how much of the window is left
// reads at a glance instead of only from the multiplier number itself.
// Simpler than a true circular countdown ring - the badge is a pill, not
// a circle, and a conic-gradient ring wrapped around non-circular text
// adds real visual complexity for the same "time's running out" read a
// linear depletion bar already gives cleanly. `ratio` is 1 (full window
// left) down to 0 (about to expire).
function cgSetSpeedBonusProgress(elId, ratio) {
    const el = document.getElementById(elId);
    if (el) el.style.setProperty('--speed-progress', (Math.max(0, Math.min(1, ratio)) * 100) + '%');
}

// Faz 11 - see cgAnimateModal below for the full rationale; this one is a
// brief full-screen dark curtain for the reward-screen -> next-level
// transition (the "SONRAKİ SEVİYE" button's onclick, game.js), which
// previously swapped straight to the new board with no transition at all.
function cgLevelTransition() {
    const curtain = document.createElement('div');
    curtain.className = 'cg-level-curtain';
    document.body.appendChild(curtain);
    setTimeout(() => curtain.remove(), 500);
}

// Faz 3 (graphics roadmap) - a whole-screen moment for the two events that
// previously got only a sound cue and a log line: winning (an enemy/boss/
// PvP opponent goes down) and losing (game over, party wipe, PvP loss).
// `kind` is 'victory' or 'defeat'; `big` (boss kills, not ordinary minion
// kills) makes the victory confetti burst noticeably larger. Every element
// this creates is position:fixed + transform/opacity-only and self-removes
// on a timeout, the same disposable-DOM-node pattern cgTileBurst above
// uses, so a mode never has to remember to clean this up itself.
function cgCelebrate(kind, big) {
    if (kind === 'victory') cgConfettiBurst(big);
    else if (kind === 'defeat') cgDefeatVignette();
}

const CG_CONFETTI_COLORS = ['#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#e67e22'];
function cgConfettiBurst(big) {
    if (!cgEffectsEnabled()) return;
    const count = big ? 40 : 22;
    const layer = document.createElement('div');
    layer.className = 'cg-confetti-layer';
    for (let i = 0; i < count; i++) {
        const piece = document.createElement('div');
        piece.className = 'cg-confetti-piece';
        piece.style.left = (Math.random() * 100) + 'vw';
        piece.style.setProperty('--drift', (Math.random() * 140 - 70) + 'px');
        piece.style.setProperty('--spin', (Math.random() * 720 - 360) + 'deg');
        piece.style.backgroundColor = CG_CONFETTI_COLORS[i % CG_CONFETTI_COLORS.length];
        piece.style.animationDelay = (Math.random() * 0.3) + 's';
        piece.style.animationDuration = (1.4 + Math.random() * 0.8) + 's';
        layer.appendChild(piece);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2600);
}

function cgDefeatVignette() {
    const el = document.createElement('div');
    el.className = 'cg-defeat-vignette';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => el.remove(), 1600);
}

// Faz 1 (graphics roadmap) - board-wide "that landed" feedback for a big
// match, on top of the per-portrait hit effects above. Takes the grid
// element itself (caller's job to getElementById the right one - see
// CLAUDE.md's hard rule on why this file never guesses a selector) and the
// STRONGEST getMatchShapeInfo multiplier among the groups resolved this
// step, so a step with several simultaneous matches shakes at its biggest
// match's intensity, not its smallest. multiplier thresholds mirror
// getMatchShapeInfo's own tiers (1=3-match, 2=4, 2.5=cross, 3=5, 3.5=6,
// 4=7!!) - below 2 (a plain 3-match) gets no shake at all, matching how the
// board has always felt for the common case.
function cgBoardImpact(gridEl, maxMultiplier) {
    if (!gridEl || !maxMultiplier || maxMultiplier < 2 || !cgEffectsEnabled()) return;
    const cls = maxMultiplier >= 3 ? 'shake-big' : 'shake';
    gridEl.classList.remove('shake', 'shake-big');
    void gridEl.offsetWidth; // force reflow so re-adding the class restarts the animation
    gridEl.classList.add(cls);
}

// Buff flash colors (portrait tint) and the delay between a shot leaving
// the board and it landing on the target portrait: the target's reaction
// and the combat number are timed to that landing, so cause and effect
// read as one motion.
const CG_FLASH_COLORS = { heart: 0x3dff8a, shield: 0x5aa8ff, energy: 0xffd84a, teamheal: 0x3dff8a };
const CG_IMPACT_DELAY_MS = 480;
function cgWait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Big combat numbers over a portrait: "-25" red for damage, "+12" green
// heal, "+8" blue armor, "+15%" gold ult charge. Pops in larger than life,
// holds, then floats up and fades (~1.4s) - long enough to read what just
// happened. Shown in low-graphics mode too (it's information, not flair).
function cgCombatText(targetEl, text, kind, delayMs) {
    if (!targetEl) return;
    const show = () => {
        const r = targetEl.getBoundingClientRect();
        if (!r.width) return;
        const el = document.createElement('div');
        el.className = 'cg-combat-text cg-ct-' + (kind || 'dmg');
        el.textContent = text;
        el.style.left = (r.left + r.width / 2 + (Math.random() * 16 - 8)) + 'px';
        el.style.top = (r.top + r.height * 0.35) + 'px';
        document.body.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
        setTimeout(() => el.remove(), 1800);
    };
    if (delayMs) setTimeout(show, delayMs); else show();
}

// Rising green sparkles around a portrait for heals.
function cgHealSparkles(targetEl, delayMs) {
    if (!targetEl || !cgEffectsEnabled()) return;
    setTimeout(() => {
        const r = targetEl.getBoundingClientRect();
        if (!r.width) return;
        const layer = document.createElement('div');
        layer.className = 'cg-sparkle-layer';
        for (let i = 0; i < 9; i++) {
            const p = document.createElement('div');
            p.className = 'cg-sparkle';
            p.style.left = (r.left + r.width * (0.15 + Math.random() * 0.7)) + 'px';
            p.style.top = (r.top + r.height * (0.45 + Math.random() * 0.4)) + 'px';
            p.style.animationDelay = (i * 0.07) + 's';
            layer.appendChild(p);
        }
        document.body.appendChild(layer);
        setTimeout(() => layer.remove(), 1700);
    }, delayMs || 0);
}

// A bar (HP/armor/ult) container pulses red (hit) or green (heal).
function cgBarPulse(containerEl, kind, delayMs) {
    if (!containerEl) return;
    setTimeout(() => {
        containerEl.classList.remove('cg-bar-hit', 'cg-bar-heal');
        void containerEl.offsetWidth;
        containerEl.classList.add(kind === 'heal' ? 'cg-bar-heal' : 'cg-bar-hit');
        setTimeout(() => containerEl.classList.remove('cg-bar-hit', 'cg-bar-heal'), 800);
    }, delayMs || 0);
}

// G3 (roadmap v2) - a small glowing shot flying from the matched tiles to
// whoever the match affects (the enemy for sword/skull, your own portrait
// for heart/shield/energy, your teammate for co-op's teamheal), so cause and
// effect read as one motion instead of "tiles vanish, a number changes
// somewhere else". position:fixed + transform/opacity only, self-removing.
function cgProjectile(fromEl, toEl, tileType) {
    if (!fromEl || !toEl || !cgEffectsEnabled()) return;
    const color = TILE_BURST_COLORS[tileType] || '#ffffff';
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    if (!a.width || !b.width) return; // hidden screen - nothing to fly between
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
    const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
    const el = document.createElement('div');
    el.className = 'cg-projectile';
    el.style.left = x0 + 'px';
    el.style.top = y0 + 'px';
    el.style.setProperty('--dx', (x1 - x0) + 'px');
    el.style.setProperty('--dy', (y1 - y0) + 'px');
    el.style.setProperty('--shot-color', color);
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 900);
}

// G3 - the combat area's backdrop changes every 5 floors (after each boss):
// crypt -> moss -> ember -> abyss, then around again. Pure CSS (style.css,
// [data-floor]); this only sets the attribute.
const CG_FLOOR_THEMES = ['crypt', 'moss', 'ember', 'abyss'];
function cgSetSceneTier(el, level) {
    if (!el) return;
    el.dataset.floor = CG_FLOOR_THEMES[Math.floor(Math.max(0, level - 1) / 5) % CG_FLOOR_THEMES.length];
}

// Plays a portrait method if that stage exists - keeps the mode files' call
// sites to one line.
function cgStageDo(canvasId, method, arg, arg2) {
    if (typeof PIXI === 'undefined') return;
    const stage = cgGetStage(canvasId);
    if (stage && stage[method]) stage[method](arg, arg2);
}

// Browsers decode a background image lazily, per element, the first time
// it's painted - a freshly built 64-tile board could show blank cells for a
// frame or two (seen in live testing, even with the art inlined). Decoding
// each tile image once up front puts them in the decoded-image cache, so
// the first board paints complete.
const cgWarmImages = [];
function cgWarmTileImages() {
    const probe = document.createElement('div');
    probe.className = 'tile';
    probe.style.cssText = 'position:absolute; left:-9999px; top:0;';
    document.body.appendChild(probe);
    ['sword', 'heart', 'shield', 'energy', 'skull', 'teamheal'].forEach(type => {
        probe.dataset.type = type;
        const m = getComputedStyle(probe).backgroundImage.match(/url\("?(.*?)"?\)$/);
        if (!m) return;
        const img = new Image();
        img.src = m[1];
        if (img.decode) img.decode().catch(() => {});
        cgWarmImages.push(img);
    });
    probe.remove();
}

document.addEventListener('DOMContentLoaded', cgWarmTileImages);
document.addEventListener('DOMContentLoaded', cgPreloadAll);
document.addEventListener('DOMContentLoaded', cgApplyLowGraphicsState);
document.addEventListener('DOMContentLoaded', () => setTimeout(() => { cgRunAutoQuality(); }, 1500));
