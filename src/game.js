// ──────────────────────────────────────────────────────────────
// Mutable service locator. Modules import this and read fields at
// *runtime* only, which keeps the import graph acyclic while still
// letting every subsystem reach the renderer / world / fx pools.
// ──────────────────────────────────────────────────────────────

export const game = {
  /** @type {import('./core/Engine.js').Engine|null} */      engine: null,
  /** @type {import('./core/Physics.js').Physics|null} */    physics: null,
  /** @type {import('./core/Input.js').Input|null} */        input: null,
  /** @type {import('./core/Audio.js').AudioKit|null} */     audio: null,
  /** @type {import('./fx/Particles.js').ParticleFX|null} */ fx: null,
  /** @type {import('./ui/Hud.js').Hud|null} */              hud: null,

  terrain: null,
  water: null,
  props: null,
  structures: null,
  destruction: null,
  weapons: null,

  /** @type {import('./vehicles/Vessel.js').Vessel|null} */  vessel: null,

  /** Seconds since launch (physics clock, drives the wave function). */
  time: 0,
  /** 0 = bright morning, 1 = synthwave night. Smoothly animated. */
  night: 0,
  nightTarget: 0,
  score: 0,
  running: false,
};

export function addScore(n, label) {
  game.score += n;
  game.hud?.bumpScore(n, label);
}

/** Airtime bonus, called from the vehicle controller on landing. */
game.addScoreFromAir = (seconds) => {
  addScore(Math.round(seconds * 120), null);
};
