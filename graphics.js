// --- 2D COMBAT GRAPHICS (PixiJS character portraits + hit/ultimate effects) ---
// Purely a presentation layer bolted onto the existing DOM/CSS game - no combat
// rule, RNG, or network logic lives here. Every mode (solo/PvP/co-op) creates
// one "stage" per portrait slot it needs (see cgCreateStage) and calls into it
// at three moments: when a combatant is decided (cgStage.setPortrait), when a
// tile match resolves (cgStage.playHit), and when an ultimate fires
// (cgStage.playUlt). Nothing here assumes which mode is calling it.
//
// A PIXI.Application keeps its ticker running (and burning a little CPU/GPU)
// even while its canvas is display:none - multiplied across solo/PvP/co-op's
// several portrait slots, that adds up to real waste for screens the player
// isn't even looking at. cgCreateStage() is deliberately lazy (the caller
// decides when to instantiate) and every stage exposes pause()/resume() so a
// mode can stop the ticker the moment its modal closes.
//
// Character/monster art credit: Batareya (FreePixel.art). Effect art credit:
// Kenney (kenney.nl). See assets/CREDITS.md.

// Each file is a 4-frame horizontal idle-animation strip (cropped from the
// artist's 8-direction spritesheet's front-facing row - see
// scratchpad-era CREDITS.md notes) rather than one static frame, so the
// portrait actually breathes/bobs instead of standing frozen.
const CHARACTER_SPRITES = {
    warrior: 'assets/characters/warrior_idle.png',
    berserker: 'assets/characters/berserker_idle.png',
    rogue: 'assets/characters/rogue_idle.png',
    archer: 'assets/characters/archer_idle.png',
    mage: 'assets/characters/mage_idle.png',
    necromancer: 'assets/characters/necromancer_idle.png',
    paladin: 'assets/characters/paladin_idle.png',
};

const MONSTER_SPRITES = {
    normal: 'assets/characters/monster_normal_idle.png',
    armored: 'assets/characters/monster_armored_idle.png',
    swift: 'assets/characters/monster_swift_idle.png',
    drain: 'assets/characters/monster_drain_idle.png',
    boss: 'assets/characters/monster_boss_idle.png',
};

// Every idle strip is 4 equal frames side by side.
const IDLE_FRAME_COUNT = 4;

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
    sword: { sprite: 'assets/effects/scorch_01.png', tint: 0xffffff },
    skull: { sprite: 'assets/effects/scorch_01.png', tint: 0xe74c3c },
    shield: { sprite: 'assets/effects/circle_03.png', tint: 0x3b82f6 },
    heart: { sprite: 'assets/effects/light_02.png', tint: 0xff6b9d },
    energy: { sprite: 'assets/effects/star_04.png', tint: 0xf1c40f },
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
    warrior: [{ sprite: 'assets/effects/scorch_01.png', tint: 0xdfe6e9 }, { sprite: 'assets/effects/spark_06.png', tint: 0xffffff }, { sprite: 'assets/effects/circle_03.png', tint: 0xecf0f1 }],
    berserker: [{ sprite: 'assets/effects/flame_04.png', tint: 0xff4500 }, { sprite: 'assets/effects/fire_01.png', tint: 0xff8c00 }, { sprite: 'assets/effects/smoke_04.png', tint: 0x8b0000 }],
    rogue: [{ sprite: 'assets/effects/slash_04.png', tint: 0x9b59b6 }, { sprite: 'assets/effects/spark_06.png', tint: 0xe0c3fc }, { sprite: 'assets/effects/star_04.png', tint: 0xd6a4ff }],
    archer: [{ sprite: 'assets/effects/muzzle_02.png', tint: 0x2ecc71 }, { sprite: 'assets/effects/spark_06.png', tint: 0xffffff }, { sprite: 'assets/effects/circle_04.png', tint: 0x27ae60 }],
    mage: [{ sprite: 'assets/effects/magic_03.png', tint: 0x3498db }, { sprite: 'assets/effects/star_04.png', tint: 0x00d4ff }, { sprite: 'assets/effects/spark_06.png', tint: 0x00eaff }],
    necromancer: [{ sprite: 'assets/effects/symbol_01.png', tint: 0x8e44ad }, { sprite: 'assets/effects/smoke_04.png', tint: 0x2c3e50 }, { sprite: 'assets/effects/circle_03.png', tint: 0x4a148c }],
    paladin: [{ sprite: 'assets/effects/light_01.png', tint: 0xf1c40f }, { sprite: 'assets/effects/circle_04.png', tint: 0xffd700 }, { sprite: 'assets/effects/star_04.png', tint: 0xfff9c4 }],
};

// Every texture is tiny (character portraits are a few KB, effects ~50-100KB)
// and reused across every stage/mode, so one shared, load-once cache beats
// each stage fetching its own copies.
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
function cgPortraitSize(canvasEl) {
    if (!cgSizeProbe) {
        cgSizeProbe = document.createElement('div');
        cgSizeProbe.style.cssText = 'position:absolute; top:0; left:0; visibility:hidden; pointer-events:none; width:var(--portrait-w); height:var(--portrait-h);';
        document.body.appendChild(cgSizeProbe);
    }
    const rect = cgSizeProbe.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return [rect.width, rect.height];
    return [canvasEl.width || 56, canvasEl.height || 70];
}

// One CombatStage per portrait slot (solo's player/enemy, PvP's me/opponent,
// co-op's me/ally/enemy - up to 7 across the whole app). Each owns exactly one
// PIXI.Application mounted into `canvasEl`.
class CombatStage {
    constructor(canvasEl) {
        this.canvasEl = canvasEl;
        this.app = null;
        this.portraitSprite = null;
        this.effectLayer = null;
        this.ready = this._init();
    }

    async _init() {
        const [w, h] = cgPortraitSize(this.canvasEl);
        const app = new PIXI.Application();
        await app.init({
            canvas: this.canvasEl,
            width: w,
            height: h,
            backgroundAlpha: 0,
            antialias: false, // crisp pixel art, not smoothed
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
        });
        this.app = app;

        // An AnimatedSprite (not a plain Sprite) so setPortrait can hand it a
        // 4-frame idle strip and have it actually play - see IDLE_FRAME_COUNT.
        // autoUpdate:false + the manual app.ticker.add below, rather than
        // AnimatedSprite's own default behavior of self-subscribing to
        // PIXI.Ticker.shared - each Application here owns its OWN ticker
        // (confirmed distinct from Ticker.shared), and Ticker.shared is never
        // separately driven anywhere in this file, so a sprite left on
        // autoUpdate's default silently never advances past frame 0.
        this.portraitSprite = new PIXI.AnimatedSprite([PIXI.Texture.EMPTY]);
        this.portraitSprite.autoUpdate = false;
        this.portraitSprite.anchor.set(0.5, 1);
        this.portraitSprite.x = app.screen.width / 2;
        this.portraitSprite.y = app.screen.height;
        this.portraitSprite.scale.set(1);
        this.portraitBaseScale = 1;
        app.stage.addChild(this.portraitSprite);
        app.ticker.add(() => this.portraitSprite.update(app.ticker));

        this.effectLayer = new PIXI.Container();
        app.stage.addChild(this.effectLayer);
        return this;
    }

    // Swaps which character/monster art this stage shows. Safe to call before
    // init finishes (awaits internally) or repeatedly (e.g. a fresh monster
    // every level) - always resets any hit-shake/motion left over from the
    // last one. `url` points at a 4-frame idle strip (see IDLE_FRAME_COUNT);
    // slicing it into per-frame textures happens here rather than once at
    // load time since the same cached strip texture is reused across every
    // stage showing that character (solo + PvP + co-op can all show a Mage).
    async setPortrait(url) {
        await this.ready;
        const strip = await cgLoadTexture(url);
        strip.source.scaleMode = 'nearest';
        const frameW = strip.width / IDLE_FRAME_COUNT;
        const frames = [];
        for (let i = 0; i < IDLE_FRAME_COUNT; i++) {
            frames.push(new PIXI.Texture({ source: strip.source, frame: new PIXI.Rectangle(i * frameW, 0, frameW, strip.height) }));
        }
        this.portraitSprite.textures = frames;
        this.portraitSprite.animationSpeed = 0.06; // slow, calm bob - not a run cycle
        this.portraitSprite.play();
        // Fit within the canvas height while preserving aspect ratio - source
        // art varies a few px in width/height per character (see assets/CREDITS.md).
        const maxH = this.app.screen.height * 0.95;
        const maxW = this.app.screen.width * 0.9;
        const scale = Math.min(maxH / strip.height, maxW / frameW, 4);
        this.portraitBaseScale = scale;
        this.portraitSprite.scale.set(scale);
        this.portraitSprite.x = this.app.screen.width / 2;
        this.portraitSprite.y = this.app.screen.height;
        this.portraitSprite.rotation = 0;
        this.portraitSprite.tint = 0xffffff;
    }

    // A quick shake + white hit-flash on the portrait itself, plus a small
    // type-specific burst sprite - used for a SELF-buff tile (shield/heart/
    // energy), where nobody is actually being hit, just a gentle "something
    // happened to me" cue. For sword/skull, which actually damage someone,
    // see playHitReaction instead - a shake reads as far too mild for "I
    // just got hit," which is exactly the gap the user called out.
    async playHit(tileType) {
        await this.ready;
        this._shake(this.portraitSprite, 6, 220);
        this._flash(this.portraitSprite, 120);
        const effect = HIT_EFFECT_SPRITES[tileType];
        if (effect) this._burst([effect], 1.1, 380);
    }

    // Played on the DEFENDER whenever a sword/skull match actually damages
    // them - a real knockback (pushed back and staggered, not just jittered
    // in place) plus a stronger flash, so landing a hit is unmistakable
    // instead of reading as a generic sparkle. skull hits knock back harder
    // than sword, matching its bigger damage number.
    async playHitReaction(tileType) {
        await this.ready;
        const severity = tileType === 'skull' ? 1.5 : 1;
        this._knockback(this.portraitSprite, 15 * severity, 280);
        this._flash(this.portraitSprite, 180);
        const effect = HIT_EFFECT_SPRITES[tileType];
        if (effect) this._burst([effect], 1.2 * severity, 400);
    }

    // The one big moment per class - a two-layer particle burst plus a
    // stronger shake/flash. `classKey` picks the effect combo (see
    // ULT_EFFECT_SPRITES); falls back to a generic spark burst for an
    // unrecognized key rather than silently doing nothing.
    async playUlt(classKey) {
        await this.ready;
        this._shake(this.portraitSprite, 10, 380);
        this._flash(this.portraitSprite, 220);
        const effects = ULT_EFFECT_SPRITES[classKey] || [HIT_EFFECT_SPRITES.energy];
        this._burst(effects, 1.9, 650);
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
        const baseX = this.app.screen.width / 2;
        const baseY = this.app.screen.height;
        const baseScale = this.portraitBaseScale;
        this._tween(420, t => {
            const m = fn(t);
            this.portraitSprite.x = baseX + m.dx;
            this.portraitSprite.y = baseY + m.dy;
            this.portraitSprite.rotation = m.rot;
            this.portraitSprite.scale.set(baseScale * m.scale);
        }, () => {
            this.portraitSprite.x = baseX;
            this.portraitSprite.y = baseY;
            this.portraitSprite.rotation = 0;
            this.portraitSprite.scale.set(baseScale);
        });
    }

    // `effects` is a list of {sprite, tint} - see HIT_EFFECT_SPRITES/
    // ULT_EFFECT_SPRITES' header comment for why every burst carries a tint
    // (the source art is a neutral grayscale mask, not colored art).
    async _burst(effects, scaleTo, durationMs) {
        const textures = await Promise.all(effects.map(e => cgLoadTexture(e.sprite)));
        const cx = this.app.screen.width / 2;
        const cy = this.app.screen.height * 0.55;
        textures.forEach((texture, i) => {
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);
            sprite.x = cx;
            sprite.y = cy;
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
            const baseScale = (this.app.screen.height / texture.height) * 0.5;
            sprite.scale.set(baseScale * 0.4);
            this.effectLayer.addChild(sprite);
            this._tween(durationMs + i * 80, t => {
                sprite.scale.set(baseScale * (0.4 + scaleTo * t));
                sprite.alpha = 0.95 * (1 - t);
            }, () => this.effectLayer.removeChild(sprite));
        });
    }

    _shake(target, magnitude, durationMs) {
        const originX = this.app.screen.width / 2;
        this._tween(durationMs, t => {
            const decay = 1 - t;
            target.x = originX + (Math.random() * 2 - 1) * magnitude * decay;
        }, () => { target.x = originX; });
    }

    // A sharp push away from rest plus a stagger tilt, unlike _shake's small
    // random jitter - meant to read as "that landed," not just "something
    // happened." Snaps out fast then eases back, with a brief rotational
    // stagger layered on top.
    _knockback(target, magnitude, durationMs) {
        const originX = this.app.screen.width / 2;
        this._tween(durationMs, t => {
            const push = magnitude * Math.sin(t * Math.PI) * (1 - t * 0.3);
            target.x = originX + push;
            target.rotation = Math.sin(t * Math.PI) * 0.18;
        }, () => { target.x = originX; target.rotation = 0; });
    }

    _flash(target, durationMs) {
        this._tween(durationMs, t => {
            const v = 1 - t;
            const c = Math.round(255 * v) << 16 | Math.round(255 * v) << 8 | 255;
            target.tint = t >= 0.98 ? 0xffffff : c;
        }, () => { target.tint = 0xffffff; });
    }

    // A tiny hand-rolled tween instead of pulling in a whole animation
    // library - every effect here is "interpolate one value over N ms then
    // clean up", which a single ticker callback covers completely.
    _tween(durationMs, onFrame, onDone) {
        const start = performance.now();
        const ticker = this.app.ticker;
        const step = () => {
            const t = Math.min(1, (performance.now() - start) / durationMs);
            onFrame(t);
            if (t >= 1) {
                ticker.remove(step);
                if (onDone) onDone();
            }
        };
        ticker.add(step);
    }

    pause() { if (this.app) this.app.ticker.stop(); }
    resume() { if (this.app) this.app.ticker.start(); }
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
    sword: '#ffffff', skull: '#e74c3c', shield: '#3b82f6', heart: '#ff6b9d', energy: '#f1c40f'
};
function cgTileBurst(tileEl, tileType) {
    if (!tileEl) return;
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
    if (!gridEl || !maxMultiplier || maxMultiplier < 2) return;
    const cls = maxMultiplier >= 3 ? 'shake-big' : 'shake';
    gridEl.classList.remove('shake', 'shake-big');
    void gridEl.offsetWidth; // force reflow so re-adding the class restarts the animation
    gridEl.classList.add(cls);
}

document.addEventListener('DOMContentLoaded', cgPreloadAll);
