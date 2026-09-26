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

// Idle breathing: a slow squash-and-stretch, repainted at ~15fps (plenty
// for motion this subtle, and far cheaper than 60 on a phone).
const CG_BREATH_STEP_MS = 66;

// No attack spritesheet exists in the free art this project uses (see
// assets/CREDITS.md) - the character/monster packs only ship idle/walk/run.
// Rather than leave every class's every tile type looking identical, each
// class gets its own motion PER TILE TYPE (35 combinations total), built
// from a small set of reusable primitives below rather than 35 fully
// bespoke curves. Every primitive is a function of t in [0,1] returning
// {dx, dy, rot, scale} offsets from the portrait's resting pose.
const MOTION = {
    // forward-and-back lunge (attack)
    lunge: (amp, rotAmp = 0) => t => ({ dx: Math.sin(t * Math.PI) * amp, dy: 0, rot: Math.sin(t * Math.PI) * rotAmp, scale: 1 + Math.sin(t * Math.PI) * 0.08 }),
    // two rapid back-to-back lunges (frenzied attack)
    doubleLunge: (amp, rotAmp = 0) => t => ({ dx: Math.sin(t * Math.PI * 2) * amp, dy: 0, rot: Math.sin(t * Math.PI * 2) * rotAmp, scale: 1 }),
    // diagonal dart forward-up and back (rogue-style quick strike)
    dash: (dx, dy) => t => ({ dx: Math.sin(t * Math.PI) * dx, dy: -Math.sin(t * Math.PI) * dy, rot: -Math.sin(t * Math.PI) * 0.2, scale: 1 - Math.sin(t * Math.PI) * 0.08 }),
    // pull back (anticipation) then snap forward past origin (bow release)
    pullRelease: (back, forward) => t => ({ dx: t < 0.35 ? -back * (t / 0.35) : forward * Math.sin(((t - 0.35) / 0.65) * Math.PI), dy: 0, rot: 0, scale: 1 }),
    // rise up with a light rotational wobble and scale pulse (arcane cast)
    riseAndPulse: (amp, rotAmp = 0.06) => t => ({ dx: 0, dy: -Math.sin(t * Math.PI) * amp, rot: Math.sin(t * Math.PI * 2) * rotAmp, scale: 1 + Math.sin(t * Math.PI) * 0.06 }),
    // dip down then rise back (channeling/drawing essence inward)
    dipAndRise: (amp, scaleAmp = 0.07) => t => ({ dx: 0, dy: Math.sin(t * Math.PI) * amp, rot: 0, scale: 1 - Math.sin(t * Math.PI) * scaleAmp }),
    // wind up (rise) then slam down hard with a squash on landing
    windUpSlam: (up, down, squash = 0.12) => t => ({ dx: 0, dy: t < 0.45 ? -up * (t / 0.45) : down * ((t - 0.45) / 0.55), rot: 0, scale: t > 0.45 ? 1 + ((t - 0.45) / 0.55) * squash : 1 }),
    // raise up and hold, bracing (shield block)
    raiseGuard: amp => t => ({ dx: 0, dy: -amp * Math.sin(t * Math.PI * 0.9), rot: 0, scale: 1 + Math.sin(t * Math.PI) * 0.05 }),
    // duck/crouch low (taking cover instead of blocking)
    duckLow: amp => t => ({ dx: 0, dy: amp * Math.sin(t * Math.PI), rot: 0, scale: 1 - Math.sin(t * Math.PI) * 0.06 }),
    // quick lateral dodge and return (evasive block)
    sidestep: amp => t => ({ dx: Math.sin(t * Math.PI) * amp, dy: 0, rot: Math.sin(t * Math.PI) * 0.1, scale: 1 }),
    // brief resisting flinch then settle (shrugging off / bracing)
    shrinkFlinch: amp => t => ({ dx: 0, dy: 0, rot: 0, scale: 1 - Math.sin(t * Math.PI) * amp }),
    // gentle radiant float (healing glow)
    glowFloat: amp => t => ({ dx: 0, dy: -amp * Math.sin(t * Math.PI), rot: 0, scale: 1 + Math.sin(t * Math.PI) * 0.08 }),
    // small steady hold, minimal motion (calm/composed)
    steady: amp => t => ({ dx: 0, dy: -amp * Math.sin(t * Math.PI), rot: 0, scale: 1 + Math.sin(t * Math.PI) * 0.03 }),
};

// Chosen to echo each class's own combat identity, AND to make the same
// tile type read differently class to class (the user specifically asked
// for Archer's and Warrior's own shield/armor reaction to look different
// from each other, not just attacks) - e.g. shield: Warrior/Paladin raise
// an actual guard, Rogue dodges instead of blocking (matches its own dodge-
// chance passive), Archer ducks for cover, Mage/Necromancer conjure a ward.
const CLASS_MOTIONS = {
    warrior: {
        sword: MOTION.lunge(12), skull: MOTION.lunge(17, 0.05),
        shield: MOTION.raiseGuard(9), heart: MOTION.dipAndRise(5, 0.05), energy: MOTION.riseAndPulse(3, 0.03),
    },
    berserker: {
        sword: MOTION.doubleLunge(10), skull: MOTION.doubleLunge(15, 0.12),
        shield: MOTION.shrinkFlinch(0.1), heart: MOTION.doubleLunge(5), energy: MOTION.doubleLunge(6, 0.08),
    },
    rogue: {
        sword: MOTION.dash(16, 7), skull: MOTION.dash(20, 9),
        shield: MOTION.sidestep(14), heart: MOTION.dipAndRise(4, 0.04), energy: MOTION.sidestep(6),
    },
    archer: {
        sword: MOTION.pullRelease(7, 11), skull: MOTION.pullRelease(9, 15),
        shield: MOTION.duckLow(8), heart: MOTION.steady(4), energy: MOTION.pullRelease(3, 4),
    },
    mage: {
        sword: MOTION.riseAndPulse(9), skull: MOTION.riseAndPulse(12, 0.1),
        shield: MOTION.glowFloat(6), heart: MOTION.glowFloat(9), energy: MOTION.riseAndPulse(5, 0.12),
    },
    necromancer: {
        sword: MOTION.dipAndRise(7), skull: MOTION.dipAndRise(10, 0.1),
        shield: MOTION.shrinkFlinch(0.06), heart: MOTION.dipAndRise(8, 0.05), energy: MOTION.dipAndRise(4, 0.06),
    },
    paladin: {
        sword: MOTION.windUpSlam(9, 13), skull: MOTION.windUpSlam(11, 17, 0.16),
        shield: MOTION.raiseGuard(13), heart: MOTION.riseAndPulse(10, 0.04), energy: MOTION.raiseGuard(5),
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
        if (!cgIsVisible(stage.canvasEl)) continue;
        // Idle breathing, only while nothing else is animating the sprite.
        if (stage.stripH && !stage.dead && stage.activeTweens === 0) {
            const now = performance.now();
            const step = Math.floor(now / CG_BREATH_STEP_MS);
            if (step !== stage.lastFrame) {
                stage.lastFrame = step;
                const b = Math.sin(now / 1000 * 2.4 + stage.breathPhase);
                stage.portraitSprite.scale.set(stage.portraitBaseScale * (1 - 0.012 * b), stage.portraitBaseScale * (1 + 0.022 * b));
                stage.needsRender = true;
            }
        }
        if (!stage.needsRender && stage.activeTweens === 0) continue;
        if (cgShared.lost) continue;
        const [w, h] = stage.size;
        if (renderer.width !== w || renderer.height !== h) renderer.resize(w, h);
        renderer.render({ container: stage.root, clear: true });
        const ctx = stage.ctx;
        ctx.clearRect(0, 0, stage.canvasEl.width, stage.canvasEl.height);
        ctx.drawImage(renderer.canvas, 0, 0, renderer.canvas.width, renderer.canvas.height, 0, 0, stage.canvasEl.width, stage.canvasEl.height);
        stage.needsRender = false;
        stage.renderCount++;
        cgShared.stats.renders++;
    }
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
        this.ready = this._init();
    }

    async _init() {
        await cgInitShared();
        this.ctx = this.canvasEl.getContext('2d');
        this.root = new PIXI.Container();
        this.portraitSprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        this.portraitSprite.anchor.set(0.5, 1);
        this.breathPhase = Math.random() * Math.PI * 2; // two portraits never breathe in lockstep
        this.portraitBaseScale = 1;
        this.root.addChild(this.portraitSprite);
        this.effectLayer = new PIXI.Container();
        this.root.addChild(this.effectLayer);
        cgShared.stages.push(this);
        this._layout();
        return this;
    }

    // (Re)sizes the 2D canvas to the current shared portrait size and
    // re-fits the portrait - on creation and on every viewport resize.
    _layout() {
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
        if (this.stripW) {
            // Fit within the canvas while preserving aspect ratio.
            const scale = Math.min((h * 0.98) / this.stripH, (w * 0.98) / this.stripW, 4);
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
        const texture = await cgLoadTexture(url);
        if (this.url !== url) return; // a newer setPortrait won the race
        texture.source.scaleMode = 'linear';
        this.portraitSprite.texture = texture;
        this.stripW = texture.width;
        this.stripH = texture.height;
        this.portraitSprite.tint = 0xffffff;
        this.portraitSprite.alpha = 1;
        this.dead = false;
        this._fitPortrait();
        this.needsRender = true;
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

    // Played on the DEFENDER whenever a sword/skull match actually damages
    // them - a real knockback (pushed back and staggered, not just jittered
    // in place) plus a stronger flash, so landing a hit is unmistakable
    // instead of reading as a generic sparkle. skull hits knock back harder
    // than sword, matching its bigger damage number.
    async playHitReaction(tileType, delayMs) {
        await this.ready;
        if (delayMs) await cgWait(delayMs);
        const severity = tileType === 'skull' ? 1.5 : 1;
        this._knockback(this.portraitSprite, 18 * severity, 520);
        this._flash(this.portraitSprite, 650, 0xff3b30); // hurt = red
        const effect = HIT_EFFECT_SPRITES[tileType];
        if (effect) this._burst([effect], 1.4 * severity, 850);
    }

    // The one big moment per class - a three-layer particle burst plus a
    // stronger shake/flash. `classKey` picks the effect combo (see
    // ULT_EFFECT_SPRITES); falls back to a generic spark burst for an
    // unrecognized key rather than silently doing nothing.
    async playUlt(classKey) {
        await this.ready;
        this._shake(this.portraitSprite, 10, 700);
        this._flash(this.portraitSprite, 900, 0xfff2a0);
        const effects = ULT_EFFECT_SPRITES[classKey] || [HIT_EFFECT_SPRITES.energy];
        this._burst(effects, 2.1, 1200);
    }

    // Played on the ATTACKER's own portrait (as opposed to playHit/
    // playHitReaction, which play on whoever's getting hit) whenever that
    // class's own tile match lands - `tileType` picks which of that class's
    // 5 motions plays (see CLASS_MOTIONS), so the SAME class visibly does a
    // different thing for a sword match than a shield match, and two
    // different classes doing the same tile type still look distinct from
    // each other. Silently does nothing for an unrecognized class (a
    // monster has no class) or tile type rather than guessing at a
    // fallback motion that wouldn't mean anything for it.
    async playClassMotion(classKey, tileType) {
        await this.ready;
        const fn = CLASS_MOTIONS[classKey] && CLASS_MOTIONS[classKey][tileType];
        if (!fn) return;
        const sprite = this.portraitSprite;
        this._tween(420, t => {
            const m = fn(t);
            sprite.x = this.baseX + m.dx;
            sprite.y = this.baseY + m.dy;
            sprite.rotation = m.rot;
            sprite.scale.set(this.portraitBaseScale * m.scale);
        }, () => {
            sprite.x = this.baseX;
            sprite.y = this.baseY;
            sprite.rotation = 0;
            sprite.scale.set(this.portraitBaseScale);
        });
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
            target.x = this.baseX + push;
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
        const start = performance.now();
        const ticker = cgShared.ticker;
        this.activeTweens++;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / durationMs);
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

    // G3 (roadmap v2) - a monster has no class motion set, so its own
    // landed hit used to read as nothing at all. A short wind-up, a lunge
    // toward its target (`direction` -1 = left, +1 = right) and back.
    async playAttack(direction) {
        await this.ready;
        const dir = direction || -1;
        const sprite = this.portraitSprite;
        this._tween(380, t => {
            const lunge = t < 0.3 ? -4 * (t / 0.3) : 16 * Math.sin(((t - 0.3) / 0.7) * Math.PI);
            sprite.x = this.baseX + dir * lunge;
            sprite.scale.set(this.portraitBaseScale * (1 + 0.08 * Math.max(0, lunge) / 16));
        }, () => { sprite.x = this.baseX; sprite.scale.set(this.portraitBaseScale); });
    }

    // G3 - topples and fades out; stays down until setPortrait()/revive().
    async playDeath() {
        await this.ready;
        const sprite = this.portraitSprite;
        this.dead = true;
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
        this.portraitSprite.alpha = 1;
        this.portraitSprite.tint = 0xffffff;
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
    sword: '#ffffff', skull: '#e74c3c', shield: '#3b82f6', heart: '#ff6b9d', energy: '#f1c40f', teamheal: '#2ecc71'
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
function cgSetClassGlow(canvasId, classKey) {
    const el = document.getElementById(canvasId);
    if (!el) return;
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
