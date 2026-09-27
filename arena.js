// --- COMBAT ARENA ---------------------------------------------------------------
// One shared scene per mode (solo / PvP / co-op) that every fighter of that
// mode lives in, instead of each character sitting in its own small canvas.
// Fighters are still CombatStages (graphics.js) - same rig, same moves -
// but "embedded": their scene graph is a child of the arena's, positioned
// where their .arena-slot <div> sits, and the arena renders all of them
// into its one canvas. That is what lets a warrior actually run across to
// the enemy, an arrow actually fly from the bow to the target, and the
// camera shake/zoom the whole fight at once.
//
// Rendering goes through the same shared WebGL renderer as everything
// else (cgShared) and follows the same rules: only while visible, only
// while something changed (idle breathing ~15fps).
//
// Timing contract with the game code: game.js/pvp.js/coop.js schedule the
// defender's hit reaction, damage numbers and bar pulses CG_IMPACT_DELAY_MS
// after a move starts. Every attack here is choreographed so its blow
// lands (melee) or its projectile arrives (ranged) at exactly that moment,
// so the game logic never has to wait on an animation.

let cgArenas = {};

function cgGetArena(key) {
    if (cgArenas[key]) return cgArenas[key];
    const canvas = document.getElementById(key + '-arena-canvas');
    if (!canvas || typeof PIXI === 'undefined') return null;
    const arena = new CombatArena(key, canvas);
    cgArenas[key] = arena;
    return arena;
}

// Hit-stop: the whole fight freezes for a few frames on a big impact, the
// classic trick that makes a blow feel heavy. Tweens read cgNow(), which
// simply stops advancing while a stop is active.
let cgHitStopUntil = 0, cgHitStopTotal = 0, cgHitStopStart = 0;
function cgNow() {
    const now = performance.now();
    if (now < cgHitStopUntil) return cgHitStopStart - cgHitStopTotal;
    if (cgHitStopUntil && now >= cgHitStopUntil) {
        cgHitStopTotal += cgHitStopUntil - cgHitStopStart;
        cgHitStopUntil = 0;
    }
    return now - cgHitStopTotal;
}
function cgHitStop(ms) {
    if (!cgEffectsEnabled()) return;
    const now = performance.now();
    if (now < cgHitStopUntil) { cgHitStopUntil = Math.max(cgHitStopUntil, now + ms); return; }
    cgNow(); // fold any finished stop into the total first
    cgHitStopStart = now;
    cgHitStopUntil = now + ms;
}

class CombatArena {
    constructor(key, canvasEl) {
        this.key = key;
        this.canvasEl = canvasEl;
        this.el = canvasEl.parentElement;
        this.ctx = canvasEl.getContext('2d');
        this.fighters = [];
        this.size = [0, 0];
        this.dirty = true;
        this.activeTweens = 0;
        this.renderCount = 0;
        this.shakeMag = 0;
        this.zoom = { k: 1, x: 0, y: 0 };
        this.root = new PIXI.Container();       // camera (shake / zoom) moves this
        this.bgLayer = new PIXI.Container();    // ground, shadows, ground rings
        this.fighterLayer = new PIXI.Container();
        this.fxLayer = new PIXI.Container();    // projectiles, impacts - in front of everyone
        this.overlayLayer = new PIXI.Container(); // cinematic dim + banner, above the camera
        this.root.addChild(this.bgLayer, this.fighterLayer, this.fxLayer);
        this.scene = new PIXI.Container();
        this.scene.addChild(this.root, this.overlayLayer);
        this.ground = new PIXI.Graphics();
        this.bgLayer.addChild(this.ground);
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.layout());
            this.observer.observe(this.el);
        }
        this.layout();
    }

    addFighter(stage) {
        this.fighters.push(stage);
        // draw order: back-row (co-op teammate) first
        this.fighters.sort((a, b) => (a.canvasEl.classList.contains('slot-ally') ? -1 : 0) - (b.canvasEl.classList.contains('slot-ally') ? -1 : 0));
        this.fighterLayer.removeChildren();
        this.fighters.forEach(f => { if (f.root) this.fighterLayer.addChild(f.root); });
        stage.shadow = new PIXI.Graphics();
        this.bgLayer.addChild(stage.shadow);
        this.layoutFighter(stage);
    }

    visible() { return cgIsVisible(this.canvasEl); }

    // Canvas + every fighter follow the arena element's current box.
    layout() {
        const w = this.el.clientWidth, h = this.el.clientHeight;
        if (!w || !h) return; // hidden (closed modal) - done again once shown
        const res = cgShared.resolution || 1;
        if (w !== this.size[0] || h !== this.size[1]) {
            this.size = [w, h];
            this.canvasEl.width = Math.round(w * res);
            this.canvasEl.height = Math.round(h * res);
            this.ctx.imageSmoothingEnabled = true;
            this.ctx.imageSmoothingQuality = 'high';
        }
        this._drawGround();
        this.fighters.forEach(f => this.layoutFighter(f));
        this.dirty = true;
    }

    layoutFighter(stage) {
        const el = stage.canvasEl;
        const w = el.offsetWidth, h = el.offsetHeight;
        if (w && h) stage.size = [w, h];
        else if (!stage.size || !stage.size[0]) stage.size = cgShared.size;
        if (stage.root) stage.root.position.set(el.offsetLeft || 0, el.offsetTop || 0);
        if (stage.portraitSprite) stage._fitPortrait();
        if (stage.shadow) this._drawShadow(stage);
        stage.needsRender = true;
        this.dirty = true;
    }

    _drawGround() {
        const [w, h] = this.size, g = this.ground;
        g.clear();
        // a floor band the fighters stand on, lit from the middle
        g.rect(0, h * 0.86, w, h * 0.14).fill({ color: 0x000000, alpha: 0.28 });
        g.ellipse(w / 2, h * 0.93, w * 0.46, h * 0.07).fill({ color: 0xffd9a0, alpha: 0.06 });
        g.rect(0, h * 0.86, w, 1).fill({ color: 0xffe2b0, alpha: 0.12 });
    }

    _drawShadow(stage) {
        const g = stage.shadow;
        g.clear();
        const [w] = stage.size;
        const r = Math.min(w * 0.3, 60);
        if (stage.groundGlow !== undefined && stage.groundGlow !== null) {
            g.ellipse(0, 0, r * 1.15, r * 0.24).fill({ color: stage.groundGlow, alpha: 0.28 });
        }
        g.ellipse(0, 0, r, r * 0.18).fill({ color: 0x000000, alpha: 0.38 });
        this._placeShadow(stage);
    }

    // shadow follows the fighter's feet (x only - a jump shrinks it)
    _placeShadow(stage) {
        if (!stage.shadow || !stage.root || !stage.portraitSprite) return;
        const sp = stage.portraitSprite;
        stage.shadow.x = stage.root.x + sp.x;
        stage.shadow.y = stage.root.y + stage.baseY - 2;
        const lift = Math.max(0, stage.baseY - sp.y);
        const k = Math.max(0.4, 1 - lift / 80);
        stage.shadow.scale.set(k, k);
        stage.shadow.alpha = sp.alpha;
    }

    // The fighter across the arena from `stage` (co-op heroes: the enemy;
    // the enemy: `preferId`'s fighter if given, else the front hero).
    opponentOf(stage, preferId) {
        const foes = this.fighters.filter(f => f.side !== stage.side && !f.dead);
        if (preferId) { const p = foes.find(f => f.canvasEl.id === preferId); if (p) return p; }
        if (!foes.length) return null;
        // nearest one
        const x = this.fighterX(stage);
        return foes.slice().sort((a, b) => Math.abs(this.fighterX(a) - x) - Math.abs(this.fighterX(b) - x))[0];
    }

    // arena-space x of a fighter's resting feet / a point on its body
    fighterX(stage) { return (stage.root ? stage.root.x : 0) + (stage.baseX || 0); }
    bodyPoint(stage, fy) {
        const sp = stage.portraitSprite;
        const bodyH = (stage.stripH || 250) * (stage.portraitBaseScale || 1);
        return { x: stage.root.x + sp.x, y: stage.root.y + sp.y - bodyH * (fy === undefined ? 0.5 : fy) };
    }
    // where the weapon hand is right now (projectile launch point)
    handPoint(stage) {
        const arm = stage.joints && (stage.joints.armR || stage.joints.armL);
        if (arm && arm.parent) {
            try {
                // bottom of the arm part ~ the hand; rig space -> arena space
                const hand = stage.rigHand || [6, 58];
                const p = arm.toGlobal(new PIXI.Point(arm.pivot.x + hand[0], arm.pivot.y + hand[1]));
                const origin = this.root.toGlobal(new PIXI.Point(0, 0));
                const k = this.root.scale.x || 1;
                return { x: (p.x - origin.x) / k, y: (p.y - origin.y) / k };
            } catch (e) { /* fall through */ }
        }
        return this.bodyPoint(stage, 0.55);
    }

    // Melee reach: how far `stage` has to travel to stand next to `foe`.
    reachTo(stage, foe) {
        if (!foe) return 0;
        const d = Math.abs(this.fighterX(foe) - this.fighterX(stage));
        const bodyW = s => 200 * (s.portraitBaseScale || 1) * 0.5;
        return Math.max(0, d - bodyW(stage) - bodyW(foe) * 0.95);
    }

    _tween(ms, onFrame, onDone) {
        const start = cgNow();
        const ticker = cgShared.ticker;
        this.activeTweens++;
        const step = () => {
            const t = Math.min(1, (cgNow() - start) / ms);
            onFrame(t);
            if (t >= 1) {
                ticker.remove(step);
                this.activeTweens--;
                this.dirty = true;
                if (onDone) onDone();
            }
        };
        ticker.add(step);
    }

    // runs fn after `ms` of arena time (ticker-driven, pauses in hit-stop)
    after(ms, fn) { this._tween(Math.max(1, ms), () => {}, fn); }

    _fx(obj, ms, onT, layer) {
        (layer || this.fxLayer).addChild(obj);
        onT(0);
        this._tween(ms, onT, () => { if (obj.parent) obj.parent.removeChild(obj); obj.destroy({ children: true }); });
    }

    shake(mag, ms) {
        if (!cgEffectsEnabled()) return;
        this.shakeMag = Math.max(this.shakeMag, mag);
        this._tween(ms || 300, t => {
            const m = this.shakeMag * (1 - t);
            this.root.x = this.zoomOffset().x + (cgRand() * 2 - 1) * m;
            this.root.y = this.zoomOffset().y + (cgRand() * 2 - 1) * m * 0.6;
        }, () => { this.shakeMag = 0; const o = this.zoomOffset(); this.root.x = o.x; this.root.y = o.y; });
    }

    zoomOffset() { const z = this.zoom; return { x: z.x * (1 - z.k), y: z.y * (1 - z.k) }; }

    // Camera push-in on (x, y) and back out - used by cinematic ultimates.
    zoomTo(x, y, k, ms, holdMs) {
        if (!cgEffectsEnabled()) return;
        const inMs = ms * 0.3, total = ms + (holdMs || 0);
        this._tween(total, t => {
            const e = t * total < inMs ? CG_EASE.out((t * total) / inMs) : t * total > total - ms * 0.4 ? 1 - CG_EASE.inOut((t * total - (total - ms * 0.4)) / (ms * 0.4)) : 1;
            this.zoom = { k: 1 + (k - 1) * e, x, y };
            this.root.scale.set(this.zoom.k);
            const o = this.zoomOffset();
            if (!this.shakeMag) { this.root.x = o.x; this.root.y = o.y; }
        }, () => { this.zoom = { k: 1, x: 0, y: 0 }; this.root.scale.set(1); this.root.position.set(0, 0); });
    }

    // Darkens everything but lets effects glow through (cinematics).
    dim(alpha, ms) {
        if (!cgEffectsEnabled()) return;
        const [w, h] = this.size;
        const g = new PIXI.Graphics();
        g.rect(0, 0, w, h).fill({ color: 0x05030a, alpha: 1 });
        this._fx(g, ms, t => { g.alpha = alpha * (t < 0.2 ? t / 0.2 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1); }, this.overlayLayer);
    }

    // Big title text sweeping across (the ult's name).
    banner(text, color, ms) {
        if (!cgEffectsEnabled() || !text) return;
        const [w, h] = this.size;
        const style = { fontFamily: 'Cinzel, Georgia, serif', fontSize: Math.max(14, Math.min(30, w / 14)), fontWeight: '900', fill: 0xffffff,
                        stroke: { color: 0x000000, width: 4 }, letterSpacing: 2, dropShadow: { color, blur: 8, distance: 0, alpha: 1 } };
        let label;
        try { label = new PIXI.Text({ text, style }); } catch (e) { return; }
        label.anchor.set(0.5);
        label.y = h * 0.58;
        const stripe = new PIXI.Graphics();
        stripe.rect(-w, -label.height * 0.75, w * 2, label.height * 1.5).fill({ color, alpha: 0.35 });
        const c = new PIXI.Container();
        c.addChild(stripe, label);
        c.y = 0;
        this._fx(c, ms, t => {
            const inT = CG_EASE.out(Math.min(1, t / 0.22)), outT = t > 0.75 ? CG_EASE.inOut((t - 0.75) / 0.25) : 0;
            c.x = w * (-0.3 + 0.8 * inT) + w * 0.8 * outT;
            label.y = h * 0.58; stripe.y = h * 0.58;
            c.alpha = t > 0.75 ? 1 - outT : 1;
            label.scale.set(1 + 0.04 * Math.sin(t * 20) * (1 - inT));
        }, this.overlayLayer);
    }

    // Projectile from `from` to `to` (arena coordinates) over `ms`, drawn by
    // CG_SHOTS[kind]; calls onHit at arrival (impact burst etc.).
    shoot(kind, from, to, ms, color, onHit) {
        const def = (typeof CG_SHOTS !== 'undefined' && CG_SHOTS[kind]) || null;
        if (!def || !cgEffectsEnabled()) { if (onHit) this.after(ms, onHit); return; }
        def(this, from, to, ms, color, onHit);
    }

    // Impact burst at a point: flash disc + ring + sparks.
    impact(x, y, color, size) {
        if (!cgEffectsEnabled()) return;
        const s = size || 1;
        const g = new PIXI.Graphics();
        g.circle(0, 0, 16).fill({ color: 0xffffff, alpha: 0.9 });
        g.circle(0, 0, 26).fill({ color, alpha: 0.45 });
        g.x = x; g.y = y;
        this._fx(g, 320, t => { g.scale.set(s * (0.4 + 1.1 * CG_EASE.out(t))); g.alpha = 1 - t; });
        const ring = new PIXI.Graphics();
        ring.circle(0, 0, 20).stroke({ width: 3, color, alpha: 1 });
        ring.x = x; ring.y = y;
        this._fx(ring, 450, t => { ring.scale.set(s * (0.5 + 2 * CG_EASE.out(t))); ring.alpha = 1 - t; });
        this.sparks(x, y, color, Math.round(8 * s));
    }

    sparks(x, y, color, n, spread) {
        if (!cgEffectsEnabled()) return;
        const count = Math.min(n || 8, this.fxLayer.children.length > 80 ? 3 : 16);
        for (let i = 0; i < count; i++) {
            const g = new PIXI.Graphics();
            g.rect(-4, -1, 8, 2).fill({ color: i % 3 ? color : 0xffffff });
            const a = cgRand() * Math.PI * 2, v = (30 + cgRand() * 50) * (spread || 1);
            g.rotation = a; g.x = x; g.y = y;
            this._fx(g, 380 + cgRand() * 200, t => {
                const e = CG_EASE.out(t);
                g.x = x + Math.cos(a) * v * e; g.y = y + Math.sin(a) * v * e + 30 * t * t;
                g.alpha = 1 - t;
            });
        }
    }

    // kicked-up floor dust at a point (footsteps, landings)
    dust(x, y, n, dir) {
        if (!cgEffectsEnabled()) return;
        for (let i = 0; i < (n || 5); i++) {
            const g = new PIXI.Graphics();
            const r = 3 + cgRand() * 4;
            g.circle(0, 0, r).fill({ color: 0xcbb89a, alpha: 0.5 });
            g.x = x; g.y = y;
            const vx = ((dir || 0) * 0.6 + (cgRand() * 2 - 1)) * 22, vy = -6 - cgRand() * 10;
            this._fx(g, 520, t => { g.x = x + vx * t; g.y = y + vy * CG_EASE.out(t); g.scale.set(1 + t * 1.4); g.alpha = 0.6 * (1 - t); }, this.bgLayer);
        }
    }

    render() {
        const renderer = cgShared.renderer;
        const [w, h] = this.size;
        if (!w || !h || !renderer || cgShared.lost) return;
        this.fighters.forEach(f => this._placeShadow(f));
        if (renderer.width !== w || renderer.height !== h) renderer.resize(w, h);
        renderer.render({ container: this.scene, clear: true });
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
        ctx.drawImage(renderer.canvas, 0, 0, renderer.canvas.width, renderer.canvas.height, 0, 0, this.canvasEl.width, this.canvasEl.height);
        this.dirty = false;
        this.renderCount++;
        this.fighters.forEach(f => { f.renderCount++; });
        cgShared.stats.renders++;
    }
}

// Called by cgFrame after the per-stage pass: paints every arena that is
// on screen and changed this frame.
function cgRenderArenas() {
    for (const key in cgArenas) {
        const arena = cgArenas[key];
        if (!arena.visible()) continue;
        if (!arena.size[0]) arena.layout();
        if (arena.dirty || arena.activeTweens > 0) arena.render();
    }
}

function cgRelayoutArenas() { for (const key in cgArenas) cgArenas[key].layout(); }

// --- PROJECTILES ------------------------------------------------------------
// Each draws its own flight from -> to over `ms` and calls onHit on arrival.
function cgArc(from, to, t, lift) {
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - lift * 4 * t * (1 - t) };
}
function cgTrail(arena, x, y, color, r, ms) {
    if (arena.fxLayer.children.length > 90) return; // particle budget (weak phones)
    const g = new PIXI.Graphics();
    g.circle(0, 0, r).fill({ color, alpha: 0.55 });
    g.x = x; g.y = y;
    arena._fx(g, ms || 220, t => { g.scale.set(1 - t * 0.7); g.alpha = 0.55 * (1 - t); });
}

const CG_SHOTS = {
    // a real arrow on a slight arc, pointing along its flight
    arrow(arena, from, to, ms, color, onHit) {
        const g = new PIXI.Graphics();
        g.rect(-16, -1, 26, 2).fill({ color: 0x8a5a2b });
        g.poly([10, -4, 17, 0, 10, 4]).fill({ color: 0xdfe8f2 });
        g.poly([-16, -1, -21, -5, -12, -1]).fill({ color }).poly([-16, 1, -21, 5, -12, 1]).fill({ color });
        let prev = from;
        arena._fx(g, ms, t => {
            const p = cgArc(from, to, t, 14);
            g.x = p.x; g.y = p.y; g.rotation = Math.atan2(p.y - prev.y, p.x - prev.x) || g.rotation;
            prev = p;
            if (t > 0.05 && t < 0.95 && cgRand() < 0.6) cgTrail(arena, p.x, p.y, color, 2, 160);
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, color, 0.7); if (onHit) onHit(); });
    },
    // glowing orb with a sparkling tail
    orb(arena, from, to, ms, color, onHit) {
        const g = new PIXI.Graphics();
        g.circle(0, 0, 11).fill({ color, alpha: 0.35 }).circle(0, 0, 7).fill({ color }).circle(-2, -2, 3).fill({ color: 0xffffff });
        arena._fx(g, ms, t => {
            const p = cgArc(from, to, CG_EASE.inOut(t), 8);
            g.x = p.x; g.y = p.y; g.scale.set(0.7 + 0.5 * Math.sin(t * 30) * 0.2 + t * 0.4);
            if (cgRand() < 0.8) cgTrail(arena, p.x + (cgRand() * 6 - 3), p.y + (cgRand() * 6 - 3), color, 4, 260);
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, color, 1.1); if (onHit) onHit(); });
    },
    // fireball: big, flickering, smoky trail, explosion
    fireball(arena, from, to, ms, color, onHit) {
        const g = new PIXI.Graphics();
        g.circle(0, 0, 15).fill({ color: 0xff5a1a, alpha: 0.4 }).circle(0, 0, 10).fill({ color: 0xff8a2a }).circle(2, -1, 6).fill({ color: 0xffe07a });
        arena._fx(g, ms, t => {
            const p = cgArc(from, to, t, 20);
            g.x = p.x; g.y = p.y; g.rotation += 0.3; g.scale.set(0.8 + 0.15 * cgRand() + t * 0.3);
            cgTrail(arena, p.x, p.y, cgRand() < 0.5 ? 0xff5a1a : 0x55443a, 6, 320);
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, 0xff8a2a, 1.5); arena.shake(5, 250); if (onHit) onHit(); });
    },
    // ice shard: a fast straight spike
    shard(arena, from, to, ms, color, onHit) {
        const g = new PIXI.Graphics();
        g.poly([-14, -4, 14, 0, -14, 4, -9, 0]).fill({ color: 0xbff4ff }).stroke({ width: 1, color: 0x62e6ff });
        const a = Math.atan2(to.y - from.y, to.x - from.x);
        arena._fx(g, ms, t => {
            const e = CG_EASE.inOut(t);
            g.x = from.x + (to.x - from.x) * e; g.y = from.y + (to.y - from.y) * e; g.rotation = a;
            if (cgRand() < 0.6) cgTrail(arena, g.x, g.y, 0x9fefff, 2.5, 200);
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, 0x9fefff, 0.9); if (onHit) onHit(); });
    },
    // lightning: an instant jagged bolt that flickers, arriving at the end
    bolt(arena, from, to, ms, color, onHit) {
        const g = new PIXI.Graphics();
        arena._fx(g, ms + 180, t => {
            g.clear();
            const T = t * (ms + 180) / ms;
            if (T < 0.55) return; // charge-up
            const segs = 8, pts = [from.x, from.y];
            for (let i = 1; i < segs; i++) {
                const k = i / segs;
                pts.push(from.x + (to.x - from.x) * k + (cgRand() * 2 - 1) * 4, from.y + (to.y - from.y) * k + (cgRand() * 2 - 1) * 14);
            }
            pts.push(to.x, to.y);
            g.poly(pts, false).stroke({ width: 7, color, alpha: 0.35, join: 'round' });
            g.poly(pts, false).stroke({ width: 2.5, color: 0xffffff, alpha: 1, join: 'round' });
            g.alpha = T > 1 ? 1 - (T - 1) / 0.18 * 0.9 : 1;
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, color, 1); arena.shake(3, 180); if (onHit) onHit(); });
    },
    // a spinning thrown dagger
    dagger(arena, from, to, ms, color, onHit) {
        const g = new PIXI.Graphics();
        g.poly([-3, 0, 0, -11, 3, 0, 0, 4]).fill({ color: 0xdfe8f2 }).rect(-4, 3, 8, 2).fill({ color: 0x5a3a8a });
        arena._fx(g, ms, t => {
            const p = cgArc(from, to, t, 10);
            g.x = p.x; g.y = p.y; g.rotation = t * 18;
            if (cgRand() < 0.5) cgTrail(arena, p.x, p.y, color, 2, 160);
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, color, 0.6); if (onHit) onHit(); });
    },
    // a beam that grows from the caster to the target and holds
    beam(arena, from, to, ms, color, onHit) {
        const g = new PIXI.Graphics();
        const len = Math.hypot(to.x - from.x, to.y - from.y), a = Math.atan2(to.y - from.y, to.x - from.x);
        g.x = from.x; g.y = from.y; g.rotation = a;
        arena._fx(g, ms + 260, t => {
            const T = t * (ms + 260) / ms, grow = CG_EASE.out(Math.min(1, T / 0.7)), fade = T > 1 ? 1 - (T - 1) / 0.26 : 1;
            g.clear();
            g.rect(0, -7, len * grow, 14).fill({ color, alpha: 0.35 * fade });
            g.rect(0, -2.5, len * grow, 5).fill({ color: 0xffffff, alpha: 0.95 * fade });
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, color, 1.1); if (onHit) onHit(); });
    },
    // life stream: particles flowing from the target BACK to the caster
    drain(arena, from, to, ms, color, onHit) {
        for (let i = 0; i < 10; i++) {
            const g = new PIXI.Graphics();
            g.circle(0, 0, 3 + cgRand() * 2).fill({ color });
            const d0 = i * 0.06;
            arena._fx(g, ms + 500, t => {
                const T = Math.max(0, Math.min(1, (t * (ms + 500) / (ms + 500 - 60 * i / 10) - d0)));
                const p = cgArc(to, from, T, 25 * Math.sin(i));
                g.x = p.x; g.y = p.y; g.alpha = T <= 0 || T >= 1 ? 0 : 0.9;
            });
        }
        CG_SHOTS.orb(arena, from, to, ms, color, onHit);
    },
    // a shockwave running along the floor
    wave(arena, from, to, ms, color, onHit) {
        const floorY = to.y + 34;
        arena._fx(new PIXI.Graphics(), ms, t => {
            const x = from.x + (to.x - from.x) * CG_EASE.inOut(t);
            if (cgRand() < 0.9) arena.dust(x, floorY, 1, Math.sign(to.x - from.x));
            const g = new PIXI.Graphics();
            g.poly([-6, 0, 0, -14 - cgRand() * 10, 6, 0]).fill({ color, alpha: 0.8 });
            g.x = x; g.y = floorY;
            arena._fx(g, 240, k => { g.alpha = 0.8 * (1 - k); g.scale.y = 1 - k * 0.5; });
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, color, 1.2); arena.shake(4, 220); if (onHit) onHit(); });
    },
    // a hail of arrows from the sky onto the target (archer ult)
    rain(arena, from, to, ms, color, onHit) {
        for (let i = 0; i < 9; i++) {
            const dx = (cgRand() * 2 - 1) * 28, delay = i * (ms * 0.5 / 9);
            arena.after(delay, () => {
                const top = { x: to.x + dx - 40, y: -10 }, hit = { x: to.x + dx, y: to.y + 10 + cgRand() * 20 };
                CG_SHOTS.arrow(arena, top, hit, ms * 0.5, color, null);
            });
        }
        arena.after(ms, () => { if (onHit) onHit(); });
    },
    // falling meteor (mage ult)
    meteor(arena, from, to, ms, color, onHit) {
        const top = { x: to.x - 60, y: -30 };
        const g = new PIXI.Graphics();
        g.circle(0, 0, 20).fill({ color: 0xff5a1a, alpha: 0.35 }).circle(0, 0, 13).fill({ color: 0x7a3a1a }).circle(-3, -3, 7).fill({ color: 0xffb04a });
        arena._fx(g, ms, t => {
            const e = t * t;
            g.x = top.x + (to.x - top.x) * e; g.y = top.y + (to.y - top.y) * e; g.rotation += 0.2;
            cgTrail(arena, g.x, g.y, cgRand() < 0.5 ? 0xff8a2a : 0x3a2a22, 9, 380);
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, 0xff8a2a, 2.4); arena.shake(9, 450); arena.dust(to.x, to.y + 30, 12); if (onHit) onHit(); });
    },
    // hands of bone bursting from the ground under the target (necro ult)
    graspers(arena, from, to, ms, color, onHit) {
        const floorY = to.y + 36;
        for (let i = 0; i < 4; i++) {
            const g = new PIXI.Graphics();
            g.rect(-2.5, -26, 5, 26).fill({ color: 0xeae0c8 });
            [-6, -2, 2, 6].forEach(f => g.rect(f - 1, -34, 2, 9).fill({ color: 0xeae0c8 }));
            g.x = to.x + (i - 1.5) * 16; g.y = floorY;
            const d = i * 0.08;
            arena._fx(g, ms + 300, t => {
                const T = Math.max(0, Math.min(1, (t - d) / 0.45));
                g.scale.y = CG_EASE.out(T) * (t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1);
                g.rotation = (i - 1.5) * 0.15;
            });
        }
        arena.dust(to.x, floorY, 8);
        arena.after(ms, () => { arena.impact(to.x, to.y, color, 1.4); if (onHit) onHit(); });
    },
    // a column of holy light slamming down on the target (paladin ult)
    smite(arena, from, to, ms, color, onHit) {
        const g = new PIXI.Graphics();
        const h = arena.size[1];
        arena._fx(g, ms + 400, t => {
            const T = t * (ms + 400) / ms;
            g.clear();
            const wdt = T < 1 ? 6 + 30 * T : 36 * (1 - (T - 1) / 0.4);
            g.rect(to.x - wdt / 2, 0, wdt, to.y + 40).fill({ color, alpha: 0.35 });
            g.rect(to.x - wdt / 6, 0, wdt / 3, to.y + 40).fill({ color: 0xffffff, alpha: 0.8 });
        });
        arena.after(ms, () => { arena.impact(to.x, to.y, color, 2); arena.shake(6, 300); if (onHit) onHit(); });
    },
};
