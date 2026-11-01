// --- PIXEL EFFECTS (pixelfx sprite sheets) ------------------------------------------
// Plays the pixelfx effects baked by tools/make_pixelfx.mjs (assets/fx/,
// pixelfx-data.js) inside the combat arena (arena.js). Effects roadmap,
// Faz 1 - docs/ROADMAP-effects.md.
//
// The sheets are 1x pixel art without dithering. Look "D" (picked in the
// Faz 0 study, tools/pixelfx-study.html) happens here, on the GPU: every
// layer is a quad with one small shader that upscales the frame 4x with
// Scale2x applied twice - staircase edges come out smooth, not blurred -
// and the light layer is drawn twice, sharp and as a soft glow, both
// added on top. Low-graphics mode plays none of it (the game's own vector
// effects are skipped there too).
//
// Never in the way of the game: a sheet that hasn't loaded yet simply
// isn't played (callers fall back to the old vector effect), so nothing
// ever waits on an image. Timing runs on the arena's tweens, so a hit-stop
// freezes these too.

const PFX = {
    textures: {},   // name -> { layer: PIXI.Texture }
    loading: {},    // name -> Promise
    geometry: {},   // name -> PIXI.MeshGeometry (one quad per effect)
    broken: false,  // the shader failed once: stay on the vector effects
    preloaded: {},  // class -> true once its sheets were requested
};

// Pixel size: a pixelfx character is ~48 px tall; ours fill the arena slot
// (~120 px on a phone, ~150 on a desktop) - match them.
function pfxScale(arena) {
    const f = arena && arena.fighters && arena.fighters[0];
    const h = (f && f.size && f.size[1]) || 120;
    return Math.max(1.5, Math.min(3.5, h / 48));
}

function pfxReady(name) {
    const t = PFX.textures[name];
    return !PFX.broken && !!t && typeof PFX_DATA !== 'undefined' && !!PFX_DATA[name];
}

function pfxLoad(name) {
    if (PFX.loading[name]) return PFX.loading[name];
    const d = typeof PFX_DATA !== 'undefined' && PFX_DATA[name];
    if (!d || typeof PIXI === 'undefined' || !PIXI.Assets) return Promise.resolve(false);
    PFX.loading[name] = Promise.all(Object.keys(d.layers).map(k => PIXI.Assets.load(d.layers[k]).then(tex => [k, tex])))
        .then(pairs => {
            const set = {};
            pairs.forEach(([k, tex]) => { tex.source.scaleMode = 'linear'; set[k] = tex; });
            PFX.textures[name] = set;
            return true;
        })
        .catch(e => { console.warn('pfx: could not load ' + name, e); return false; });
    return PFX.loading[name];
}
function pfxPreload(names) { (names || Object.keys(typeof PFX_DATA !== 'undefined' ? PFX_DATA : {})).forEach(pfxLoad); }

const PFX_VERTEX = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
}`;

// uMode 0: look D (Scale2x twice), 1: soft glow of the light, 2: plain
// smooth (fallback). uFrame = the frame's cell in the sheet, in texels.
const PFX_FRAGMENT = `
precision highp float;
in vec2 vUV;
uniform sampler2D uTexture;
uniform vec4 uFrame;
uniform vec2 uTexSize;
uniform float uAlpha;
uniform float uMode;
vec4 T(vec2 p) {
    p = clamp(p, vec2(0.0), uFrame.zw - 1.0);
    return texture(uTexture, (uFrame.xy + p + 0.5) / uTexSize);
}
vec4 S(vec2 c) {
    c = clamp(c, vec2(0.5), uFrame.zw - 0.5);
    return texture(uTexture, (uFrame.xy + c) / uTexSize);
}
bool same(vec4 a, vec4 b) { vec4 d = abs(a - b); return max(max(d.r, d.g), max(d.b, d.a)) < 0.003; }
// Scale2x: which of P / its neighbors the sub-pixel s (0/1, 0/1) takes
vec4 pick(vec4 P, vec4 A, vec4 B, vec4 C, vec4 D, vec2 s) {
    if (s.y < 0.5) {
        if (s.x < 0.5) { if (same(C, A) && !same(C, D) && !same(A, B)) return A; }
        else { if (same(A, B) && !same(A, C) && !same(B, D)) return B; }
    } else {
        if (s.x < 0.5) { if (same(D, C) && !same(D, B) && !same(C, A)) return C; }
        else { if (same(B, D) && !same(B, A) && !same(D, C)) return D; }
    }
    return P;
}
vec4 S2(vec2 q) {
    vec2 p = floor(q * 0.5);
    return pick(T(p), T(p + vec2(0.0, -1.0)), T(p + vec2(1.0, 0.0)), T(p + vec2(-1.0, 0.0)), T(p + vec2(0.0, 1.0)), q - p * 2.0);
}
void main() {
    vec2 px = vUV * uFrame.zw;
    vec4 o;
    if (uMode > 1.5) {
        o = S(px);
    } else if (uMode > 0.5) {
        o = S(px) * 2.0;
        for (int i = 0; i < 12; i++) {
            float a = float(i) * 0.5235988;
            o += S(px + vec2(cos(a), sin(a)) * 1.6);
        }
        o /= 14.0;
    } else {
        vec2 p1 = floor(px);
        if (T(p1).a + T(p1 + vec2(1.0, 0.0)).a + T(p1 - vec2(1.0, 0.0)).a + T(p1 + vec2(0.0, 1.0)).a + T(p1 - vec2(0.0, 1.0)).a < 0.002) discard;
        vec2 c4 = floor(px * 4.0), q = floor(c4 * 0.5);
        o = pick(S2(q), S2(q + vec2(0.0, -1.0)), S2(q + vec2(1.0, 0.0)), S2(q + vec2(-1.0, 0.0)), S2(q + vec2(0.0, 1.0)), c4 - q * 2.0);
    }
    gl_FragColor = o * uAlpha;
}`;

let pfxProgram = null;
function pfxGlProgram() {
    if (!pfxProgram) pfxProgram = PIXI.GlProgram.from({ vertex: PFX_VERTEX, fragment: PFX_FRAGMENT, name: 'pixelfx-d' });
    return pfxProgram;
}

function pfxQuad(name) {
    if (PFX.geometry[name]) return PFX.geometry[name];
    const d = PFX_DATA[name], [w, h] = d.cell, [ox, oy] = d.origin;
    const g = new PIXI.MeshGeometry({
        positions: new Float32Array([-ox, -oy, w - ox, -oy, w - ox, h - oy, -ox, h - oy]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    PFX.geometry[name] = g;
    return g;
}

function pfxMesh(name, tex, mode, blend, alpha) {
    const d = PFX_DATA[name];
    const uniforms = new PIXI.UniformGroup({
        uFrame: { value: new Float32Array([0, 0, d.cell[0], d.cell[1]]), type: 'vec4<f32>' },
        uTexSize: { value: new Float32Array([tex.source.width, tex.source.height]), type: 'vec2<f32>' },
        uAlpha: { value: alpha, type: 'f32' },
        uMode: { value: mode, type: 'f32' },
    });
    const shader = new PIXI.Shader({ glProgram: pfxGlProgram(), resources: { uTexture: tex.source, pfx: uniforms } });
    const mesh = new PIXI.Mesh({ geometry: pfxQuad(name), shader });
    if (blend) mesh.blendMode = blend;
    mesh.pfx = { uniforms, alpha };
    return mesh;
}

// The arena's layer behind the fighters (smoke columns, ground fire).
function pfxBackLayer(arena) {
    if (!arena.pfxBack) {
        arena.pfxBack = new PIXI.Container();
        arena.root.addChildAt(arena.pfxBack, arena.root.getChildIndex(arena.fighterLayer));
    }
    return arena.pfxBack;
}

// Plays effect `name` at (x, y) in arena space. o: { ms (default: its own
// length), flip, scale (x pfxScale), onT(t, inst) each frame, onDone }.
// Returns the instance ({ front, back } containers), or null if it can't
// play right now (not loaded, low graphics) - the caller then does its
// old effect instead.
function pfxPlay(arena, name, x, y, o) {
    o = o || {};
    if (!arena || !pfxReady(name) || !cgEffectsEnabled()) return null;
    const d = PFX_DATA[name], set = PFX.textures[name];
    const smooth = o.plain ? 2 : 0;
    const inst = { name, front: new PIXI.Container(), back: new PIXI.Container(), meshes: [] };
    try {
        for (const side of ['b', 'f']) {
            const box = side === 'b' ? inst.back : inst.front;
            if (set[side + 'c']) box.addChild(pfxMesh(name, set[side + 'c'], smooth, null, 1));
            if (set[side + 'l']) {
                box.addChild(pfxMesh(name, set[side + 'l'], 1, 'add', 0.9)); // glow
                box.addChild(pfxMesh(name, set[side + 'l'], smooth, 'add', 1));
            }
            inst.meshes.push(...box.children);
        }
    } catch (e) {
        console.warn('pfx: shader unavailable, using the vector effects', e);
        PFX.broken = true;
        return null;
    }
    const k = pfxScale(arena) * (o.scale || 1);
    for (const c of [inst.front, inst.back]) { c.position.set(x, y); c.scale.set(o.flip ? -k : k, k); }
    arena.pfxLive = (arena.pfxLive || 0) + 1; // effects playing right now (tests, debugging)
    if (inst.back.children.length) pfxBackLayer(arena).addChild(inst.back);
    arena.fxLayer.addChild(inst.front);
    // skipMs: start this far into the effect (its contact frame comes later
    // than the game's impact - play it from where it lines up)
    const skip = Math.max(0, o.skipMs || 0), full = (d.frames / d.fps) * 1000;
    const ms = o.ms || Math.max(1, full - skip);
    let last = -1;
    inst.frameAt = t => {
        const age = (t * ms + skip) / 1000;
        let i = Math.floor(age * d.fps);
        i = d.loop ? i % d.frames : Math.min(d.frames - 1, i);
        // a loop played for a set time fades out over its last 15%
        const fade = d.loop && o.ms ? Math.min(1, (1 - t) / 0.15) : 1;
        if (i !== last || fade < 1) {
            last = i;
            const fx = (i % d.cols) * d.cell[0], fy = Math.floor(i / d.cols) * d.cell[1];
            inst.meshes.forEach(m => {
                const u = m.pfx.uniforms.uniforms;
                u.uFrame[0] = fx; u.uFrame[1] = fy; u.uAlpha = m.pfx.alpha * fade;
                m.pfx.uniforms.update();
            });
        }
    };
    inst.frameAt(0);
    arena._tween(ms, t => { inst.frameAt(t); if (o.onT) o.onT(t, inst); arena.dirty = true; }, () => {
        for (const c of [inst.front, inst.back]) { if (c.parent) c.parent.removeChild(c); c.destroy({ children: true }); }
        arena.pfxLive--;
        if (o.onDone) o.onDone();
    });
    return inst;
}

// Where the ground is under a point: the feet of the fighter nearest to it.
function pfxGroundUnder(arena, pt) {
    let best = null, bd = Infinity;
    (arena.fighters || []).forEach(f => {
        if (!f.portraitSprite) return;
        const p = arena.bodyPoint(f, 0), dd = Math.abs(p.x - pt.x);
        if (dd < bd) { bd = dd; best = p; }
    });
    return best ? { x: pt.x, y: best.y } : pt;
}

// --- moves -------------------------------------------------------------------------
// Which move plays which effects is data: moves.js CG_PFX_MOVES maps a move
// id to a list of specs { fx: sheet name, on: 'foe' | 'self' | 'foeBody' |
// 'selfBody' | 'mid', at: 'impact' (default: the effect's own contact frame
// lands on the game's impact) | 'start' | ms, ms (how long a loop plays),
// scale }. CombatStage._perform (graphics.js) plays them INSTEAD of the
// move's vector fx when every sheet they need is loaded, and keeps the
// vector fx otherwise (while loading, low graphics, a shader problem).

function pfxSpecsFor(move) {
    return (move && typeof CG_PFX_MOVES !== 'undefined' && CG_PFX_MOVES[move.id]) || null;
}
function pfxNamesOf(specs) { return (specs || []).filter(s => s.fx).map(s => s.fx); }
// the move's pixelfx effect is its projectile (meteor, hands from the ground)
function pfxNoShot(move) { return (pfxSpecsFor(move) || []).some(s => s.noShot); }

// All sheets of a move ready? If not, start fetching them so the next
// time it is.
function pfxMoveReady(move) {
    const specs = pfxSpecsFor(move);
    if (!specs || PFX.broken) return false;
    const names = pfxNamesOf(specs);
    if (names.every(pfxReady)) return true;
    names.forEach(pfxLoad);
    return false;
}

function pfxPointFor(stage, ctx, on) {
    const arena = ctx.arena, foe = ctx.foe || stage;
    switch (on) {
        case 'self': return arena.bodyPoint(stage, 0);
        case 'selfBody': return arena.bodyPoint(stage, 0.5);
        case 'foeBody': return arena.bodyPoint(foe, 0.5);
        case 'mid': { const a = arena.bodyPoint(stage, 0), b = arena.bodyPoint(foe, 0); return { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) }; }
        default: return arena.bodyPoint(foe, 0);
    }
}

// Plays a move's specs (see above). Returns false if it couldn't.
function pfxRunMove(move, stage, ctx) {
    const arena = ctx.arena;
    if (!arena || !cgEffectsEnabled() || !pfxMoveReady(move)) return false;
    const f = stage.facing || 1, k = pfxScale(arena);
    pfxSpecsFor(move).forEach(spec => {
        if (!spec.fx) return;
        const d = PFX_DATA[spec.fx];
        const hitMs = d.hits && d.hits.length ? d.hits[0] * 1000 : 0;
        const at = spec.at === 'start' ? 0 : typeof spec.at === 'number' ? spec.at : Math.max(0, ctx.impactMs - hitMs);
        const skipMs = spec.at === undefined || spec.at === 'impact' ? Math.max(0, hitMs - ctx.impactMs) : 0;
        arena.pfxLive = (arena.pfxLive || 0) + 1; // scheduled counts as playing
        arena.after(Math.max(1, at), () => {
            arena.pfxLive--;
            if (stage.dead && spec.on !== 'foe' && spec.on !== 'foeBody') return;
            const p = pfxPointFor(stage, ctx, spec.on || 'foe');
            let x = p.x;
            // a caster->target effect (a slash): put its target on the foe
            if (d.tx && (spec.on || 'foe').startsWith('foe')) x -= d.tx * k * (spec.scale || 1) * f;
            pfxPlay(arena, spec.fx, x, p.y, { flip: f < 0, scale: spec.scale, ms: spec.ms, skipMs });
        });
    });
    return true;
}

// Every sheet a class's moves (and ult) can use - fetched when that class
// steps into an arena, so a player only ever downloads their own class.
function pfxPreloadClass(cls) {
    if (typeof CG_MOVES === 'undefined' || !CG_MOVES[cls] || PFX.preloaded[cls]) return;
    PFX.preloaded[cls] = true;
    const moves = [].concat(...Object.values(CG_MOVES[cls]), (typeof CG_ULTS !== 'undefined' && CG_ULTS[cls]) || []);
    const names = new Set();
    moves.forEach(m => { pfxNamesOf(pfxSpecsFor(m)).forEach(n => names.add(n)); (PFX_SHOT_SHEETS[m.shot] || []).forEach(n => names.add(n)); });
    names.forEach(pfxLoad);
}

// --- projectiles --------------------------------------------------------------------
// A fireball that is a real pixelfx fireball, ending in a pixelfx ground
// blast. Same contract as every CG_SHOTS kind (arena.js): arrive in `ms`,
// then onHit. Falls back to the vector fireball until the sheets are in.
// Sheets each pixelfx projectile needs (for preloading).
const PFX_SHOT_SHEETS = {};

// A projectile: `ball` (a pixelfx loop facing right) flies from -> to on an
// arc, turned along its path, and `blast` plays where it lands ('ground':
// at the target's feet, 'hit': on the point itself). Falls back to the
// vector shot `fallback` (arena.js) until both sheets are in.
function pfxShot(kind, o) {
    PFX_SHOT_SHEETS[kind] = [o.ball, o.blast];
    CG_SHOTS[kind] = function (arena, from, to, ms, color, onHit) {
        if (!pfxReady(o.ball) || !pfxReady(o.blast) || !cgEffectsEnabled()) {
            pfxLoad(o.ball); pfxLoad(o.blast);
            return CG_SHOTS[o.fallback](arena, from, to, ms, color, onHit);
        }
        const flip = to.x < from.x;
        // ballDy: the sprite's own lift, in pixelfx px (an orb drawn hovering
        // above its origin) - pulled back onto the flight path
        const dy = (o.ballDy || 0) * pfxScale(arena) * (o.ballScale || 1);
        let prev = from;
        const ball = pfxPlay(arena, o.ball, from.x, from.y + dy, {
            ms, flip, scale: o.ballScale || 1,
            onT: (t, inst) => {
                const p = cgArc(from, to, t, o.arc === undefined ? 20 : o.arc);
                const a = Math.atan2(p.y - prev.y, p.x - prev.x);
                if (t > 0 && o.turn !== false) inst.front.rotation = inst.back.rotation = flip ? a - Math.PI : a;
                inst.front.position.set(p.x, p.y + dy); inst.back.position.set(p.x, p.y + dy);
                prev = p;
            },
        });
        if (!ball) return CG_SHOTS[o.fallback](arena, from, to, ms, color, onHit);
        arena.after(ms, () => {
            const g = o.blastAt === 'hit' ? to : pfxGroundUnder(arena, to);
            if (!pfxPlay(arena, o.blast, g.x, g.y, { flip, scale: o.blastScale || 1 })) arena.impact(to.x, to.y, color, 1);
            if (o.shake) arena.shake(o.shake, 250);
            if (onHit) onHit();
        });
    };
}

if (typeof CG_SHOTS !== 'undefined') {
    pfxShot('pfxfireball', { ball: 'fire-fireball', blast: 'explosions-small-explosion', fallback: 'fireball', ballScale: 0.75, blastScale: 0.65, shake: 5 });
    pfxShot('pfxarrow', { ball: 'projectiles-arrow', blast: 'impacts-hit-spark', fallback: 'arrow', arc: 14, blastAt: 'hit', ballScale: 0.9, blastScale: 0.8 });
    pfxShot('pfxshard', { ball: 'ice-ice-lance', blast: 'ice-ice-shatter', fallback: 'shard', arc: 0, blastAt: 'hit', ballScale: 0.7, blastScale: 0.6 });
    pfxShot('pfxshadow', { ball: 'shadow-void-orb', blast: 'shadow-dark-explosion', fallback: 'orb', arc: 16, turn: false, ballDy: 78, ballScale: 0.4, blastScale: 0.5, shake: 3 });
}
