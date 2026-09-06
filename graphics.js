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

const CHARACTER_SPRITES = {
    warrior: 'assets/characters/warrior.png',
    berserker: 'assets/characters/berserker.png',
    rogue: 'assets/characters/rogue.png',
    archer: 'assets/characters/archer.png',
    mage: 'assets/characters/mage.png',
    necromancer: 'assets/characters/necromancer.png',
    paladin: 'assets/characters/paladin.png',
};

const MONSTER_SPRITES = {
    normal: 'assets/characters/monster_normal.png',
    armored: 'assets/characters/monster_armored.png',
    swift: 'assets/characters/monster_swift.png',
    drain: 'assets/characters/monster_drain.png',
    boss: 'assets/characters/monster_boss.png',
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

// Two-layer bursts (a base shape + an accent) for the one big moment each
// class's ultimate is - chosen to echo that class's own flavor (see the
// class_asset_plan.png shared with the user during asset selection).
const ULT_EFFECT_SPRITES = {
    warrior: [{ sprite: 'assets/effects/scorch_01.png', tint: 0xdfe6e9 }, { sprite: 'assets/effects/spark_06.png', tint: 0xffffff }],
    berserker: [{ sprite: 'assets/effects/flame_04.png', tint: 0xff4500 }, { sprite: 'assets/effects/fire_01.png', tint: 0xff8c00 }],
    rogue: [{ sprite: 'assets/effects/slash_04.png', tint: 0x9b59b6 }, { sprite: 'assets/effects/spark_06.png', tint: 0xe0c3fc }],
    archer: [{ sprite: 'assets/effects/muzzle_02.png', tint: 0x2ecc71 }, { sprite: 'assets/effects/spark_06.png', tint: 0xffffff }],
    mage: [{ sprite: 'assets/effects/magic_03.png', tint: 0x3498db }, { sprite: 'assets/effects/star_04.png', tint: 0x00d4ff }],
    necromancer: [{ sprite: 'assets/effects/symbol_01.png', tint: 0x8e44ad }, { sprite: 'assets/effects/smoke_04.png', tint: 0x2c3e50 }],
    paladin: [{ sprite: 'assets/effects/light_01.png', tint: 0xf1c40f }, { sprite: 'assets/effects/circle_04.png', tint: 0xffd700 }],
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
        const app = new PIXI.Application();
        await app.init({
            canvas: this.canvasEl,
            width: this.canvasEl.width || 96,
            height: this.canvasEl.height || 96,
            backgroundAlpha: 0,
            antialias: false, // crisp pixel art, not smoothed
            resolution: Math.min(window.devicePixelRatio || 1, 2),
            autoDensity: true,
        });
        this.app = app;

        this.portraitSprite = new PIXI.Sprite();
        this.portraitSprite.anchor.set(0.5, 1);
        this.portraitSprite.x = app.screen.width / 2;
        this.portraitSprite.y = app.screen.height;
        this.portraitSprite.scale.set(1);
        this.portraitSprite.texture.source && (this.portraitSprite.texture.source.scaleMode = 'nearest');
        app.stage.addChild(this.portraitSprite);

        this.effectLayer = new PIXI.Container();
        app.stage.addChild(this.effectLayer);
        return this;
    }

    // Swaps which character/monster art this stage shows. Safe to call before
    // init finishes (awaits internally) or repeatedly (e.g. a fresh monster
    // every level) - always resets any hit-shake left over from the last one.
    async setPortrait(url) {
        await this.ready;
        const texture = await cgLoadTexture(url);
        texture.source.scaleMode = 'nearest';
        this.portraitSprite.texture = texture;
        // Fit within the canvas height while preserving aspect ratio - source
        // art varies a few px in width/height per character (see assets/CREDITS.md).
        const maxH = this.app.screen.height * 0.95;
        const maxW = this.app.screen.width * 0.9;
        const scale = Math.min(maxH / texture.height, maxW / texture.width, 4);
        this.portraitSprite.scale.set(scale);
        this.portraitSprite.x = this.app.screen.width / 2;
        this.portraitSprite.y = this.app.screen.height;
        this.portraitSprite.rotation = 0;
        this.portraitSprite.tint = 0xffffff;
    }

    // A quick shake + white hit-flash on the portrait itself, plus a small
    // type-specific burst sprite - this is the "vuruş efekti" the user asked
    // for, and it fires on every ordinary tile match, not just ultimates.
    async playHit(tileType) {
        await this.ready;
        this._shake(this.portraitSprite, 6, 220);
        this._flash(this.portraitSprite, 120);
        const effect = HIT_EFFECT_SPRITES[tileType];
        if (effect) this._burst([effect], 1.1, 380);
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

document.addEventListener('DOMContentLoaded', cgPreloadAll);
