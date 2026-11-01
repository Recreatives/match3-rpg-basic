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
    if (inst.back.children.length) pfxBackLayer(arena).addChild(inst.back);
    arena.fxLayer.addChild(inst.front);
    const ms = o.ms || (d.frames / d.fps) * 1000;
    let last = -1;
    inst.frameAt = t => {
        const age = (t * ms) / 1000;
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

// --- projectiles --------------------------------------------------------------------
// A fireball that is a real pixelfx fireball, ending in a pixelfx ground
// blast. Same contract as every CG_SHOTS kind (arena.js): arrive in `ms`,
// then onHit. Falls back to the vector fireball until the sheets are in.
if (typeof CG_SHOTS !== 'undefined') {
    CG_SHOTS.pfxfireball = function (arena, from, to, ms, color, onHit) {
        if (!pfxReady('fire-fireball') || !pfxReady('explosions-small-explosion') || !cgEffectsEnabled()) {
            return CG_SHOTS.fireball(arena, from, to, ms, color, onHit);
        }
        const flip = to.x < from.x;
        let prev = from;
        const ball = pfxPlay(arena, 'fire-fireball', from.x, from.y, {
            ms, flip, scale: 0.75,
            onT: (t, inst) => {
                const p = cgArc(from, to, t, 20);
                const a = Math.atan2(p.y - prev.y, p.x - prev.x);
                if (t > 0) inst.front.rotation = inst.back.rotation = flip ? a - Math.PI : a;
                inst.front.position.set(p.x, p.y); inst.back.position.set(p.x, p.y);
                prev = p;
            },
        });
        if (!ball) return CG_SHOTS.fireball(arena, from, to, ms, color, onHit);
        arena.after(ms, () => {
            const g = pfxGroundUnder(arena, to);
            if (!pfxPlay(arena, 'explosions-small-explosion', g.x, g.y, { flip, scale: 0.65 })) arena.impact(to.x, to.y, 0xff8a2a, 1.5);
            arena.shake(5, 250);
            if (onHit) onHit();
        });
    };
}

// The sheets are small (Faz 1: a handful); fetch them once the page is idle.
if (typeof window !== 'undefined') {
    const go = () => pfxPreload();
    if (document.readyState === 'complete') setTimeout(go, 0);
    else window.addEventListener('load', () => setTimeout(go, 0));
}
