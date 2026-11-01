// Rune awakening - the first effect made for Pixel Dungeon itself (effects
// roadmap Faz 8), written with pixelfx's drawing kit (tools/vendor/pixelfx,
// MIT) the same way its own effects are. Plays when a hero's ultimate is
// charged: the board's five runes - sword, heart, shield, energy, skull -
// circle in toward the chest, meet, and burst in a white flash, a ring in
// each rune's color, sparks and motes. Baked by tools/make_pixelfx.mjs
// (tools/pixelfx-list.json: "src").
import { Particles, Lights, P, Rng, hex, fit, flare, clamp, ease, TAU, WHITE } from "../vendor/pixelfx/src/core/index.js";

export const meta = {
  name: "Rune awakening",
  desc: "The five runes of the board circle in toward the chest, meet, and burst in a white flash and five colored rings.",
  tags: ["own", "ultimate", "rune", "burst", "one-shot"],
  size: [176, 150],
  origin: [88, 128],
  duration: 1.4,
  loop: false,
  fps: 30,
  bg: "ground",
  options: { seed: 3 },
};

const CY = -30, GATHER = 0.55;
// the tile colors: sword, heart, shield, energy, skull
const RUNES = ["#ff6a3a", "#ff5ab0", "#4aa8ff", "#ffd24a", "#b05cff"].map(hex);
const GOLD = fit(["#4a3006", "#8a5a0a", "#d49a10", "#ffd24a", "#ffe98a", "#fff6cc", "#ffffff"].map(hex), 8);

// a rune's place while gathering: a shrinking, speeding circle, tilted into an ellipse
function at(i, t) {
  const k = clamp(t / GATHER), r = 40 * (1 - ease.inCubic(k)) + 3;
  const a = (i / RUNES.length) * TAU + k * k * 7 - Math.PI / 2;
  return [Math.cos(a) * r, CY + Math.sin(a) * r * 0.55];
}

export function create(o) {
  const R = new Rng(o.seed);
  const ps = new Particles({ rng: R, ground: () => 0, sparks: [WHITE, ...RUNES] }), lights = new Lights();
  let t = 0, burst = false;
  return {
    update(dt) {
      t += dt;
      if (t < GATHER)
        RUNES.forEach((c, i) => {
          const [x, y] = at(i, t);
          if (R.chance(0.5)) ps.spawn(P.MOTE, x, y, R.range(-8, 8), R.range(-14, -2), R.range(0.2, 0.4), c, 0.7);
        });
      if (t >= GATHER && !burst) {
        burst = true;
        lights.add(0, CY, 72, GOLD[4], 1, 0.45);
        lights.add(0, CY, 26, WHITE, 1, 0.12);
        for (let i = 0; i < 70; i++) {
          const a = R.range(0, TAU), sp = R.range(90, 230), dn = Math.sin(a) > 0 ? 0.5 : 1;
          ps.spawn(R.chance(0.6) ? P.MOTE : P.STAR, 0, CY, Math.cos(a) * sp, Math.sin(a) * sp * dn, R.range(0.3, 0.6), R.pick(RUNES), R.range(0.8, 1.7));
        }
        for (let i = 0; i < 24; i++) {
          const a = R.range(0, TAU), sp = R.range(120, 260);
          ps.spawn(P.SPARK, 0, CY, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.2, 0.45));
        }
      }
      ps.update(dt);
      lights.update(dt);
    },
    drawBack(p) {
      // the floor warms under the gathering runes, then cools
      const k = t < GATHER ? 0.5 * (t / GATHER) : Math.max(0, 1 - (t - GATHER) / 0.8);
      if (k > 0) p.glow(0, -1, 44, GOLD[3], 0.3 * k);
    },
    draw(p) {
      if (t < GATHER) {
        RUNES.forEach((c, i) => {
          const [x, y] = at(i, t);
          p.circle(x, y, 2.8, c);
          p.circle(x, y, 1.2, WHITE);
          p.glow(x, y, 9, c, 0.6);
        });
      } else {
        const q = (t - GATHER) / 0.6;
        if (q < 1) {
          const e = ease.outCubic(q);
          if (q < 0.3) flare(p, 0, CY, 26 * (1 - q / 0.3) + 4, 1 - q / 0.3, GOLD);
          // one ring per rune, each a little wider, cut off at the floor
          RUNES.forEach((c, i) => {
            const r = 6 + (28 + i * 6) * e;
            p.ring(0, CY, r, Math.max(1, 3 * (1 - q)), c, (v, ang) => (CY + Math.sin(ang) * r > 0 ? 0 : 1.1 - q));
          });
          p.glow(0, CY, 50 * (0.5 + 0.5 * e), GOLD[4], 0.8 * (1 - q));
        }
      }
      ps.draw(p);
      lights.draw(p);
    },
  };
}
