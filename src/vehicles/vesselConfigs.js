// ──────────────────────────────────────────────────────────────
// The four vessels. Every number here is tuned against the
// FIXED_DT = 1/60 physics step in config.js.
//
// Forces are expressed as multiples of the hull mass, so changing
// `density` re-scales the boat without retuning the handling.
// `buoyancy.strength` is the upward force at full submersion as a
// multiple of weight — ~2.2 floats the hull at roughly 45% depth.
//
// HANDLING MODEL — these boats steer like boats, not cars:
//   helm.rate / helm.centre  how fast the wheel winds on / self-centres
//   water.turnRate           the *rate of turn* full helm asks for (rad/s)
//   water.yawServo           how firmly we chase that rate
//   water.rudder             stern-swinging blade force (the "boaty" part)
//   drag.roll                roll/pitch damping — high means hard to capsize
// The servo means you can never snap the bow round or spin out; the boat
// eases into a turn, holds it, and eases out.
// ──────────────────────────────────────────────────────────────

export const VESSELS = [
  // ── 1 · SPEEDBOAT ─────────────────────────────────────────
  {
    key: 'speedboat',
    catalog: 'runabout',
    name: 'Bowrider',
    blurb: 'Deck boat with an outdrive and no bad habits. Forgiving on the water, clumsy but capable on land.',
    stats: { speed: 1.0, mass: 0.2, guns: 0.2, grip: 0.55 },
    color: '#b48ee8',
    accent: '#ff5f6d',
    neon: '#f2c94c',

    hull: { hx: 1.25, hy: 0.55, hz: 3.1 },
    density: 76,          // kg/m³ over a 17 m³ hull box ≈ 1.3 t
    ballast: null,

    buoyancy: { strength: 2.20, vertDamp: 3.6 },
    drag: { fwd: 0.0075, lat: 0.22, vert: 0.55, roll: 7.0, yaw: 0.9 },

    helm: { rate: 3.6, centre: 5.0 },
    water: {
      thrust: 26, reverse: 0.42, sternZ: -2.8,
      rudder: 0.09, turnRate: 0.85, yawServo: 3.4, heel: 0.22, heelServo: 5.0, settle: 7.0, weathervane: 1.0,
    },
    land: {
      engine: 26, reverse: 0.45, maxSteer: 0.52, grip: 0.30,
      turnRate: 1.5, yawServo: 3.0,
      stiffness: 46, damping: 3.6, rest: 1.1, radius: 0.85, brake: 0.12, rollCentre: 0.35,
    },
    wheels: [
      [1.35, -0.35, 2.05, true, false],
      [-1.35, -0.35, 2.05, true, false],
      [1.35, -0.35, -2.05, false, true],
      [-1.35, -0.35, -2.05, false, true],
    ],
    boost: { mult: 3.4, drain: 0.30, refill: 0.24 },
    weapon: {
      type: 'forward', damage: 14, speed: 145, cooldown: 0.22,
      radius: 8, power: 160, ballRadius: 0.32, ballDensity: 12,
    },
    fx: { sprayScale: 1.7, wakeScale: 1.5 },
  },

  // ── 2 · BATTLE BARGE ──────────────────────────────────────
  {
    key: 'barge',
    catalog: 'tug',
    name: 'Bollard',
    blurb: 'Displacement hull, fat fenders, more mass than sense. Broadside cannons and a prow that wins any argument it can reach.',
    stats: { speed: 0.45, mass: 1.0, guns: 0.85, grip: 0.9 },
    color: '#ff5f6d',
    accent: '#f2c94c',
    neon: '#b48ee8',

    hull: { hx: 2.9, hy: 1.15, hz: 5.6 },
    density: 380,         // ≈ 57 t of hull …
    ballast: { hx: 2.4, hy: 0.5, hz: 4.4, y: -1.0, density: 800 },   // … + 34 t low down ≈ 91 t

    buoyancy: { strength: 2.20, vertDamp: 3.8 },
    drag: { fwd: 0.020, lat: 0.45, vert: 0.9, roll: 12.0, yaw: 1.6 },

    helm: { rate: 1.5, centre: 2.2 },
    water: {
      thrust: 14, reverse: 0.40, sternZ: -5.2,
      rudder: 0.05, turnRate: 0.30, yawServo: 2.6, heel: 0.08, heelServo: 7.0, settle: 4.5, weathervane: 1.9,
    },
    land: {
      engine: 15, reverse: 0.45, maxSteer: 0.34, grip: 0.44,
      turnRate: 0.70, yawServo: 2.6,
      stiffness: 42, damping: 3.8, rest: 1.5, radius: 1.35, brake: 0.16, rollCentre: 0.35,
    },
    wheels: [
      [3.0, -0.85, 3.8, true, true],
      [-3.0, -0.85, 3.8, true, true],
      [3.0, -0.85, -3.8, false, true],
      [-3.0, -0.85, -3.8, false, true],
    ],
    boost: { mult: 2.6, drain: 0.26, refill: 0.22 },
    weapon: {
      type: 'broadside', damage: 46, speed: 105, cooldown: 0.85,
      radius: 20, power: 520, ballRadius: 0.7, ballDensity: 34,
    },
    fx: { sprayScale: 2.4, wakeScale: 2.6 },
  },

  // ── 3 · HOVER-CRUISER ─────────────────────────────────────
  {
    key: 'hover',
    catalog: 'airboat',
    name: 'Fanjack',
    blurb: 'Flat-bottom pan and a caged fan. Skims water, mud, grass and parking lots with equal contempt. Grips nowhere.',
    stats: { speed: 0.8, mass: 0.35, guns: 0.35, grip: 0.2 },
    color: '#f2c94c',
    accent: '#ff5f6d',
    neon: '#7fd4d4',

    hull: { hx: 1.9, hy: 0.7, hz: 3.4 },
    density: 45,          // ≈ 1.6 t
    ballast: null,

    // Hover pads do most of the lifting; buoyancy is only a safety net.
    buoyancy: { strength: 1.30, vertDamp: 3.2 },
    drag: { fwd: 0.0280, lat: 0.18, vert: 0.35, roll: 12.0, yaw: 0.9, air: 0.019 },

    helm: { rate: 4.2, centre: 5.5 },
    water: {
      thrust: 15, reverse: 0.50, sternZ: -3.1,
      rudder: 0.07, turnRate: 0.85, yawServo: 3.4, heel: 0.09, heelServo: 6.5, settle: 4.5, weathervane: 0.32,
    },
    land: {
      engine: 20, reverse: 0.5, maxSteer: 0.40, grip: 0.30,
      turnRate: 1.60, yawServo: 2.4,
      stiffness: 18, damping: 5.4, rest: 2.0, radius: 0.9, brake: 0.05,
      rollLever: 0.30, rollCentre: 0.85, uprightK: 9.0, rollDamp: 18.0,
    },
    wheels: [
      [1.75, -0.5, 2.4, true, true],
      [-1.75, -0.5, 2.4, true, true],
      [1.75, -0.5, -2.4, false, true],
      [-1.75, -0.5, -2.4, false, true],
    ],
    hover: true,
    boost: { mult: 1.9, drain: 0.24, refill: 0.26 },
    weapon: {
      type: 'forward', damage: 18, speed: 130, cooldown: 0.28,
      radius: 10, power: 210, ballRadius: 0.36, ballDensity: 14,
    },
    fx: { sprayScale: 1.2, wakeScale: 1.1 },
  },

  // ── 4 · DREADNOUGHT ───────────────────────────────────────
  {
    key: 'dreadnought',
    catalog: 'hydrofoil',
    name: 'Skimmer',
    blurb: 'Two needle hulls on retractable foils, with a 360° mouse-aimed turret bolted amidships. Fast, sharp, decisive.',
    stats: { speed: 0.6, mass: 0.85, guns: 1.0, grip: 0.75 },
    color: '#ff5f6d',
    accent: '#7fd4d4',
    neon: '#b48ee8',

    hull: { hx: 2.3, hy: 0.95, hz: 4.7 },
    density: 210,         // ≈ 17 t of hull …
    ballast: { hx: 1.9, hy: 0.45, hz: 3.6, y: -0.85, density: 600 },  // … + 15 t low down ≈ 32 t

    buoyancy: { strength: 2.20, vertDamp: 3.6 },
    drag: { fwd: 0.016, lat: 0.38, vert: 0.8, roll: 10.0, yaw: 1.3 },

    helm: { rate: 2.2, centre: 3.2 },
    water: {
      thrust: 17, reverse: 0.42, sternZ: -4.3,
      rudder: 0.07, turnRate: 0.45, yawServo: 3.0, heel: 0.10, heelServo: 6.0, settle: 5.5, weathervane: 1.1,
    },
    land: {
      engine: 18, reverse: 0.45, maxSteer: 0.38, grip: 0.38,
      turnRate: 0.90, yawServo: 2.8,
      stiffness: 44, damping: 3.8, rest: 1.35, radius: 1.15, brake: 0.15, rollCentre: 0.35,
    },
    wheels: [
      [2.45, -0.7, 3.2, true, true],
      [-2.45, -0.7, 3.2, true, true],
      [2.45, -0.7, -3.2, false, true],
      [-2.45, -0.7, -3.2, false, true],
    ],
    boost: { mult: 2.8, drain: 0.26, refill: 0.22 },
    weapon: {
      type: 'turret', damage: 70, speed: 120, cooldown: 0.7,
      radius: 26, power: 900, ballRadius: 0.85, ballDensity: 42,
      turret: { y: 1.5, barrelLen: 4.2 },
    },
    fx: { sprayScale: 2.0, wakeScale: 2.0 },
  },
];

export const vesselByKey = (k) => VESSELS.find((v) => v.key === k) ?? VESSELS[0];
