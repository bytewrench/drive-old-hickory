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

    helm: { rate: 2.2, centre: 3.4 },
    water: {
      thrust: 26, reverse: 0.42, sternZ: -2.8,
      rudder: 0.09, turnRate: 0.60, yawServo: 2.5, heel: 0.42, heelServo: 100, weathervane: 1.0,
      // Planing runabout: comes up onto the plane early and rides high.
      planeAt: 10, planeLift: 10.5, trimDeg: 5.0, trimServo: 2.6, launchDamp: 3.2,
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

    helm: { rate: 1.1, centre: 1.7 },
    water: {
      thrust: 14, reverse: 0.40, sternZ: -5.2,
      rudder: 0.05, turnRate: 0.22, yawServo: 2.1, heel: 0.17, heelServo: 85, weathervane: 1.9,
      // A displacement hull does not plane, by definition — it pushes water
      // aside rather than climbing on top of it. Near-zero lift is correct.
      planeAt: 22, planeLift: 1.0, trimDeg: 0.8, trimServo: 2.0, launchDamp: 4.5,
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

    helm: { rate: 2.6, centre: 3.6 },
    water: {
      thrust: 15, reverse: 0.50, sternZ: -3.1,
      rudder: 0.07, turnRate: 0.62, yawServo: 2.5, heel: 0.10, heelServo: 20, heelDamp: 20, weathervane: 0.32,
      // The pan already skims on its hover pads, so it needs only a little
      // extra lift to sit up on the surface rather than in it.
      planeAt: 8, planeLift: 3.4, trimDeg: 2.2, trimServo: 2.4, launchDamp: 3.0,
    },
    land: {
      engine: 20, reverse: 0.5, maxSteer: 0.40, grip: 0.30,
      turnRate: 1.60, yawServo: 2.4,
      stiffness: 18, damping: 5.4, rest: 2.0, radius: 0.9, brake: 0.05,
      rollLever: 0.10, rollCentre: 1.0, uprightK: 9.0, rollDamp: 18.0,
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

    helm: { rate: 1.6, centre: 2.4 },
    water: {
      thrust: 17, reverse: 0.42, sternZ: -4.3,
      rudder: 0.07, turnRate: 0.34, yawServo: 2.4, heel: 0.40, heelServo: 260, weathervane: 1.1,
      // Foils: the whole point of the hull is that it lifts clear of the water
      // once it is up to speed, so this gets the strongest lift of the fleet.
      planeAt: 13, planeLift: 12.5, trimDeg: 2.5, trimServo: 3.0, launchDamp: 3.6,
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

  // ── 5 · SEAPLANE ──────────────────────────────────────────
  // The only hull with a `fly` block, which is what switches the aerodynamic
  // model on in Vessel._updateFlight. It is an ordinary (if slippery) boat
  // until airspeed builds enough lift to unstick it.
  {
    key: 'seaplane',
    catalog: 'seaplane',
    name: 'Osprey',
    blurb: 'High-wing floatplane. Hold W down the channel until the wing bites, then keep holding it to climb. W/S pitch, A/D roll, Shift for power.',
    stats: { speed: 0.92, mass: 0.18, guns: 0.3, grip: 0.3 },
    color: '#e8e4d9',
    accent: '#ff5f6d',
    neon: '#7fd4d4',

    hull: { hx: 1.4, hy: 0.62, hz: 3.3 },
    density: 42,          // ≈ 1.0 t — light, as an aeroplane must be
    ballast: null,

    buoyancy: { strength: 2.20, vertDamp: 3.4 },
    // `air` is zeroed because _updateFlight computes real aerodynamic drag;
    // leaving the generic term on would double-count it.
    drag: { fwd: 0.0068, lat: 0.30, vert: 0.55, roll: 6.0, yaw: 0.9, air: 0 },

    helm: { rate: 2.6, centre: 3.5 },
    water: {
      thrust: 22, reverse: 0.35, sternZ: -2.6,
      rudder: 0.07, turnRate: 0.55, yawServo: 2.5, heel: 0.28, heelServo: 80, weathervane: 1.2,
      // Gets up on the step early and trims bow-high — that attitude is what
      // gives the wing its angle of attack for the unstick.
      planeAt: 9, planeLift: 9.0, trimDeg: 6.0, trimServo: 2.4, launchDamp: 2.2,
    },
    land: {
      engine: 12, reverse: 0.40, maxSteer: 0.45, grip: 0.22,
      turnRate: 1.10, yawServo: 2.4,
      // Deliberately stubby: the raycast reach is rest + radius, and a long one
      // let the "wheels" find the bank from several metres up, flipping the
      // aeroplane into LAND mode while it was genuinely flying.
      stiffness: 30, damping: 3.4, rest: 0.45, radius: 0.35, brake: 0.10, rollCentre: 0.35,
    },
    wheels: [
      [1.20, -0.42, 2.10, true, false],
      [-1.20, -0.42, 2.10, true, false],
      [1.20, -0.42, -2.10, false, true],
      [-1.20, -0.42, -2.10, false, true],
    ],

    /**
     * Aerodynamics. `rho` folds air density and wing area into one number:
     * lift = 0.5·rho·v²·Cl·mass, so level flight needs 0.5·rho·v²·Cl ≈ 24
     * (that being |GRAVITY|). At Cl ≈ 1.35 near the stall that puts unstick
     * at roughly 100 km/h, and cruise Cl ≈ 0.43 at 180 km/h.
     */
    fly: {
      rho: 0.045, cl0: 0.10, clAlpha: 4.4, clMax: 1.35, stallAlpha: 0.34,
      cd0: 0.022, k: 0.055, sideCd: 0.07,
      thrust: 4.6, authCap: 90, authFloor: 16, stallPitchDown: 2.4,
      // These two set the TRIMMED angle of attack at full elevator:
      // alpha_trim = pitchAuth / pitchStab. It has to stay comfortably under
      // stallAlpha (0.34) or holding W simply stalls the aeroplane — at 0.20 /
      // 0.30 it trimmed to 0.67 rad and stood the thing on its tail.
      // 0.11 / 0.55 trims to 0.20 rad ≈ 11°, a healthy climb.
      pitchAuth: 0.11, pitchStab: 0.55,
      rollAuth: 0.36,
      yawStab: 0.26, turnCoord: 0.30, yawDamp: 2.2, rateDamp: 1.5,
    },

    boost: { mult: 2.2, drain: 0.20, refill: 0.22 },
    weapon: {
      type: 'forward', damage: 12, speed: 165, cooldown: 0.20,
      radius: 7, power: 130, ballRadius: 0.26, ballDensity: 10,
    },
    fx: { sprayScale: 1.4, wakeScale: 1.2 },
  },
];

export const vesselByKey = (k) => VESSELS.find((v) => v.key === k) ?? VESSELS[0];
