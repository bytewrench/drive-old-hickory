/**
 * vesselCatalog.js
 * ---------------------------------------------------------------------------
 * Declarative vessel definitions for the nautical speed + battle game.
 * Pure data. No Three.js import here on purpose — see buildVessel.js for the
 * renderer-side consumer.
 *
 * CONVENTIONS
 *   Units      : meters, kilograms-ish (mass is relative, 1.0 = runabout)
 *   Axes       : Y up, +Z forward (bow), +X starboard. Right-handed.
 *   Origin     : hull center at the static waterline (y = 0 is the waterline)
 *   Rotations  : radians, XYZ euler order
 *   Colors     : palette KEY strings, resolved at build time from vessel.palette
 *
 * PART SCHEMA
 *   {
 *     name  : string                       // unique within the vessel
 *     geom  : 'box'|'cyl'|'cone'|'wedge'|'sphere'
 *     args  : number[]                     // see below
 *     pos   : [x, y, z]
 *     rot   : [x, y, z]                    // optional, default [0,0,0]
 *     color : palette key                  // 'hull'|'deck'|'accent'|'trim'|'dark'|'glass'
 *     opts  : {                            // all optional
 *       spin      : 'fan'|'prop'|null      // animate rotation about local Z
 *       wire      : boolean                // render as wireframe (cages, foils)
 *       opacity   : number                 // < 1 enables transparency
 *       group     : 'hull'|'foil'|'skid'|'fan'|'weapon'|'landgear'
 *       hideOnLand: boolean
 *       showOnLand: boolean                // land-mode-only geometry
 *     }
 *   }
 *
 * GEOM ARGS
 *   box    [w, h, d]
 *   cyl    [rTop, rBottom, h, radialSegments]        // axis = local Y
 *   cone   [r, h, radialSegments]                    // axis = local Y
 *   wedge  [w, h, d]                                 // triangular prism, point toward +Z
 *   sphere [r, widthSeg, heightSeg]
 *
 * STATS: all 1-10 unless noted. Tune freely; they are intentionally readable.
 */

const P = Math.PI;

export const VESSEL_STAT_KEYS = [
  'topSpeed',     // terminal speed on water
  'accel',        // time-to-plane
  'turnRate',     // yaw authority
  'drift',        // how much the stern slides out (high = arcadey)
  'hullHP',
  'armor',        // flat damage reduction
  'mass',         // relative, drives ram damage + knockback resistance
  'landSpeed',    // speed multiplier applied in land mode
  'landHandling', // turn multiplier applied in land mode
];

export const VESSELS = [

  /* =======================================================================
   * 1. RUNABOUT — the all-rounder. Start here; nothing it does is bad.
   * ===================================================================== */
  {
    id: 'runabout',
    name: 'Bowrider',
    class: 'Runabout',
    role: 'All-rounder',
    blurb: 'Deck boat with an outdrive and no bad habits. Forgiving on water, ' +
           'clumsy but capable on land.',
    unlock: 'default',

    stats: {
      topSpeed: 7, accel: 7, turnRate: 6, drift: 5,
      hullHP: 6, armor: 5, mass: 1.0,
      landSpeed: 0.55, landHandling: 0.6,
    },

    weapons: {
      primary:   { id: 'twin_water_cannon', damage: 4, rof: 6, range: 18, note: 'Sustained spray; pushes light hulls off line.' },
      secondary: { id: 'wake_mine',         damage: 22, cooldown: 8, note: 'Drops behind; detonates on contact or 6s fuse.' },
    },

    palette: {
      hull:  '#1d2836',
      deck:  '#b48ee8',
      accent:'#ff5f6d',
      trim:  '#f2c94c',
      dark:  '#0d1219',
      glass: '#7fd4d4',
    },

    collider: { type: 'box', size: [2.05, 1.15, 5.4], offset: [0, 0.1, 0.25] },
    buoyancy: { draft: 0.30, planeAtSpeed: 0.45, bowRiseDeg: 6 },

    helm: [-0.45, 1.02, 0.95],

    parts: [
      // One lofted skin replaces the old box + prism-bow stack. A planing
      // runabout is hard-chined aft (sectionAft 5.5) and fine forward
      // (sectionFwd 1.3) with strong flare and a lifted forefoot.
      {
        name: 'hull', geom: 'hull', pos: [0, 0.10, 0.15], color: 'hull',
        shape: {
          len: 5.30, beam: 2.02, draft: 0.48, freeboard: 0.52,
          sectionAft: 5.5, sectionFwd: 1.30, flare: 0.24,
          sheer: 0.52, sheerAft: 0.12, rocker: 0.95, rockerAft: 0.05,
          transom: 0.80, entry: 1.90, beamPeak: 0.54, deck: false,
        },
        opts: { finish: 'gloss', doubleSided: true },
      },
      // Bottom paint below the chine — a second, slightly smaller loft rather
      // than a box, so the boot stripe follows the real hull curve.
      {
        name: 'hullBottom', geom: 'hull', pos: [0, 0.06, 0.15], color: 'dark',
        shape: {
          len: 5.26, beam: 1.98, draft: 0.50, freeboard: 0.06,
          sectionAft: 5.2, sectionFwd: 1.28, flare: 0.06,
          sheer: 0.30, rocker: 0.95, transom: 0.80, entry: 1.90, deck: false,
        },
        opts: { finish: 'satin', doubleSided: true },
      },
      { name: 'cockpitSole', geom: 'box',   args: [1.72, 0.10, 2.30], pos: [0, 0.42, 0.50],  color: 'deck', opts: { finish: 'matte' } },
      { name: 'foredeck',    geom: 'box',   args: [1.80, 0.12, 1.70], pos: [0, 0.70, 2.05],  color: 'trim', opts: { finish: 'gloss' } },
      // Curved wrap-around screen, not a flat pane on its edge.
      { name: 'windshield',  geom: 'cyl',   args: [0.92, 0.92, 0.42, 14], pos: [0, 0.92, 1.30], rot: [-0.20, 0, 0], color: 'glass', opts: { opacity: 0.55, finish: 'glass', doubleSided: true } },
      { name: 'screenFrame', geom: 'torus', args: [0.92, 0.032, 6, 14],   pos: [0, 1.13, 1.26], rot: [P / 2 - 0.20, 0, 0], color: 'trim', opts: { finish: 'metal' } },
      { name: 'console',     geom: 'box',   args: [0.74, 0.34, 0.44], pos: [-0.45, 0.62, 1.02], color: 'deck', opts: { finish: 'satin' } },
      { name: 'wheelRim',    geom: 'torus', args: [0.15, 0.026, 6, 14], pos: [-0.45, 0.86, 0.86], rot: [1.15, 0, 0], color: 'dark', opts: { finish: 'metal' } },
      { name: 'seatPort',    geom: 'box',   args: [0.52, 0.16, 0.54], pos: [-0.45, 0.56, 0.30], color: 'accent', opts: { finish: 'matte' } },
      { name: 'seatPortBack',geom: 'box',   args: [0.52, 0.46, 0.13], pos: [-0.45, 0.78, 0.04], rot: [-0.16, 0, 0], color: 'accent', opts: { finish: 'matte' } },
      { name: 'seatStbd',    geom: 'box',   args: [0.52, 0.16, 0.54], pos: [0.45, 0.56, 0.30],  color: 'accent', opts: { finish: 'matte' } },
      { name: 'seatStbdBack',geom: 'box',   args: [0.52, 0.46, 0.13], pos: [0.45, 0.78, 0.04], rot: [-0.16, 0, 0], color: 'accent', opts: { finish: 'matte' } },
      { name: 'engineCowl',  geom: 'box',   args: [1.24, 0.34, 1.05], pos: [0, 0.60, -1.45],  color: 'trim', opts: { finish: 'gloss' } },
      // Rub rail follows the sheer, so it sits proud of the curve instead of
      // running dead straight past a hull that isn't.
      { name: 'rubRailPort', geom: 'box',   args: [0.09, 0.13, 2.60], pos: [-1.02, 0.60, -0.75], rot: [0.05, 0.03, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'rubRailStbd', geom: 'box',   args: [0.09, 0.13, 2.60], pos: [1.02, 0.60, -0.75], rot: [0.05, -0.03, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'railFwdPort', geom: 'box',   args: [0.09, 0.13, 2.30], pos: [-0.82, 0.80, 1.35], rot: [-0.16, 0.20, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'railFwdStbd', geom: 'box',   args: [0.09, 0.13, 2.30], pos: [0.82, 0.80, 1.35], rot: [-0.16, -0.20, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'cleatBow',    geom: 'box',   args: [0.30, 0.07, 0.09], pos: [0, 0.86, 2.55], color: 'trim', opts: { finish: 'metal' } },
      { name: 'outdrive',    geom: 'box',   args: [0.30, 0.70, 0.46], pos: [0, -0.28, -2.32],  color: 'dark', opts: { finish: 'metal' } },
      { name: 'skeg',        geom: 'wedge', args: [0.10, 0.34, 0.55], pos: [0, -0.62, -2.28],  color: 'dark', opts: { finish: 'metal' } },
      // A real screw instead of a flat disc.
      { name: 'prop',        geom: 'prop',  shape: { radius: 0.26, blades: 4, hub: 0.055, pitch: 0.6 }, pos: [0, -0.42, -2.58], color: 'accent', opts: { spin: 'prop', finish: 'metal' } },
    ],

    landMode: {
      id: 'wheel_deploy',
      name: 'Trailer Gear',
      description:
        'Four wheels swing down out of the topsides on trailing arms and the ' +
        'hull settles onto them. Quick in a straight line, still steers like a ' +
        'boat that has been asked to do something unreasonable.',
      deploySeconds: 0.8,
      animation: 'wheels unfold from the hull sides, hull drops and pitches nose-down',
      motion: { style: 'rolling', bounceAmpl: 0.05, bounceHz: 4.5, yawLagDeg: 22 },
      sfx: ['pneumatic_thunk', 'rubber_rumble_loop'],
      vfx: ['dust_puff_on_deploy', 'dirt_spray_from_wheels'],
    },
  },

  /* =======================================================================
   * 2. AIRBOAT — the amphibian. Fastest on land by a mile, made of paper.
   * ===================================================================== */
  {
    id: 'airboat',
    name: 'Fanjack',
    class: 'Airboat',
    role: 'Skirmisher / amphibian',
    blurb: 'Flat-bottom pan and a caged fan. Slides across water, mud, grass ' +
           'and parking lots with equal contempt. Hit it once and it knows.',
    unlock: 'default',

    stats: {
      topSpeed: 8, accel: 8, turnRate: 9, drift: 9,
      hullHP: 4, armor: 2, mass: 0.65,
      landSpeed: 0.92, landHandling: 0.95,
    },

    weapons: {
      primary:   { id: 'fan_blast',  damage: 3, rof: 3, range: 12, note: 'Rear-facing cone; heavy knockback, tiny damage. Aim it by spinning.' },
      secondary: { id: 'chum_slick', damage: 0, cooldown: 10, note: 'Lays a slick that kills grip for 5s. Works on land AND water.' },
    },

    palette: {
      hull:  '#2a3550',
      deck:  '#f2c94c',
      accent:'#ff5f6d',
      trim:  '#7fd4d4',
      dark:  '#0d1219',
      glass: '#7fd4d4',
    },

    collider: { type: 'box', size: [2.25, 1.60, 5.6], offset: [0, 0.45, 0] },
    buoyancy: { draft: 0.12, planeAtSpeed: 0.20, bowRiseDeg: 3 },

    // High chair above the pan, in front of the fan cage.
    helm: [0, 1.58, -0.22],

    parts: [
      // Flat-bottom pan: near-rectangular sections all the way (sectionAft 8,
      // sectionFwd 4.2), almost no draft, and a bow that sweeps up out of the
      // water rather than cutting into it (rocker 1.0).
      {
        name: 'hullPan', geom: 'hull', pos: [0, 0.06, 0.10], color: 'hull',
        shape: {
          len: 5.40, beam: 2.24, draft: 0.26, freeboard: 0.34,
          sectionAft: 8.0, sectionFwd: 4.2, flare: 0.10,
          sheer: 0.55, sheerAft: 0.05, rocker: 1.00, rockerAft: 0.02,
          transom: 0.96, entry: 1.15, beamPeak: 0.45, deck: false,
        },
        opts: { finish: 'satin', doubleSided: true },
      },
      { name: 'deckPlate',  geom: 'box',   args: [2.00, 0.10, 3.40], pos: [0, 0.30, 0.20],  color: 'deck', opts: { finish: 'matte' } },
      { name: 'gunwalePort',geom: 'box',   args: [0.09, 0.26, 4.00], pos: [-1.08, 0.46, 0.10], rot: [0, 0.02, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'gunwaleStbd',geom: 'box',   args: [0.09, 0.26, 4.00], pos: [1.08, 0.46, 0.10], rot: [0, -0.02, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'seatPost',   geom: 'cyl',   args: [0.11, 0.13, 0.72, 10], pos: [0, 0.66, -0.30], color: 'dark', opts: { finish: 'metal' } },
      { name: 'seatBase',   geom: 'box',   args: [0.72, 0.16, 0.72], pos: [0, 1.06, -0.30], color: 'accent', opts: { finish: 'matte' } },
      { name: 'seatBack',   geom: 'box',   args: [0.72, 0.70, 0.14], pos: [0, 1.42, -0.62], rot: [-0.12, 0, 0], color: 'accent', opts: { finish: 'matte' } },
      { name: 'stickPost',  geom: 'cyl',   args: [0.035, 0.035, 0.62, 8], pos: [0.30, 1.34, 0.06], rot: [-0.22, 0, 0], color: 'dark', opts: { finish: 'metal' } },
      { name: 'fanFramePort',geom:'cyl',   args: [0.07, 0.07, 1.70, 8], pos: [-0.72, 0.95, -1.85], color: 'dark', opts: { finish: 'metal' } },
      { name: 'fanFrameStbd',geom:'cyl',   args: [0.07, 0.07, 1.70, 8], pos: [0.72, 0.95, -1.85], color: 'dark', opts: { finish: 'metal' } },
      { name: 'fanCage',    geom: 'cyl',   args: [1.00, 1.00, 0.28, 16], pos: [0, 1.35, -1.95], rot: [P / 2, 0, 0], color: 'dark', opts: { wire: true } },
      { name: 'cageRimF',   geom: 'torus', args: [1.00, 0.028, 6, 22], pos: [0, 1.35, -1.81], rot: [0, 0, 0], color: 'dark', opts: { finish: 'metal' } },
      { name: 'cageRimA',   geom: 'torus', args: [1.00, 0.028, 6, 22], pos: [0, 1.35, -2.09], rot: [0, 0, 0], color: 'dark', opts: { finish: 'metal' } },
      { name: 'fanHub',     geom: 'cyl',   args: [0.16, 0.20, 0.30, 12], pos: [0, 1.35, -1.90], rot: [P / 2, 0, 0], color: 'trim', opts: { finish: 'metal' } },
      // A real 6-blade fan with twist, instead of two crossed boxes.
      { name: 'fanBlades',  geom: 'prop',  shape: { radius: 0.92, blades: 6, hub: 0.16, pitch: 0.42 }, pos: [0, 1.35, -1.90], color: 'trim', opts: { spin: 'fan', group: 'fan', finish: 'satin' } },
      { name: 'rudderPort', geom: 'foil',  shape: { span: 0.06, chord: 0.68, thickness: 0.14, taper: 0.95, sections: 8, segments: 4 }, pos: [-0.40, 1.30, -2.45], rot: [0, 0, P / 2], color: 'accent', opts: { group: 'weapon', finish: 'satin' } },
      { name: 'rudderStbd', geom: 'foil',  shape: { span: 0.06, chord: 0.68, thickness: 0.14, taper: 0.95, sections: 8, segments: 4 }, pos: [0.40, 1.30, -2.45], rot: [0, 0, P / 2], color: 'accent', opts: { group: 'weapon', finish: 'satin' } },
      { name: 'skidPort',   geom: 'box',   args: [0.16, 0.10, 3.60], pos: [-0.92, -0.16, 0], color: 'dark', opts: { group: 'skid', finish: 'rubber' } },
      { name: 'skidStbd',   geom: 'box',   args: [0.16, 0.10, 3.60], pos: [0.92, -0.16, 0],  color: 'dark', opts: { group: 'skid', finish: 'rubber' } },
    ],

    landMode: {
      id: 'just_keep_going',
      name: 'Just Keep Going',
      description:
        'No transformation. The fan does not care what is underneath it. The ' +
        'airboat is the reference vessel for land traversal and every other ' +
        'hull is measured against how badly it does this by comparison.',
      deploySeconds: 0.0,
      animation: 'none — fan RPM raises, pan skims, small pitch bob over terrain',
      motion: { style: 'skimming', bounceAmpl: 0.04, bounceHz: 6.0, yawLagDeg: 34 },
      sfx: ['fan_whine_up', 'grass_scrape_loop'],
      vfx: ['grass_and_leaf_spray', 'flattened_terrain_decal'],
    },
  },

  /* =======================================================================
   * 3. TUG — the brick. Slow, mean, unkillable, and it drags you along.
   * ===================================================================== */
  {
    id: 'tug',
    name: 'Bollard',
    class: 'Harbor Tug',
    role: 'Bruiser / control',
    blurb: 'Displacement hull, fat fenders, more mass than sense. Wins any ' +
           'argument it can physically reach.',
    unlock: 'default',

    stats: {
      topSpeed: 4, accel: 3, turnRate: 3, drift: 2,
      hullHP: 10, armor: 9, mass: 2.4,
      landSpeed: 0.35, landHandling: 0.35,
    },

    weapons: {
      primary:   { id: 'ram_prow',      damage: 'mass * relSpeed * 6', rof: null, note: 'Passive. Contact damage scales with closing speed.' },
      secondary: { id: 'harpoon_winch', damage: 8, cooldown: 9, range: 22, note: 'Hooks a target and reels it in for 3s. Works as a grapple to yank yourself onto land.' },
    },

    palette: {
      hull:  '#1a2430',
      deck:  '#ff5f6d',
      accent:'#f2c94c',
      trim:  '#b48ee8',
      dark:  '#0b0f15',
      glass: '#7fd4d4',
    },

    collider: { type: 'box', size: [2.9, 1.9, 5.2], offset: [0, 0.55, 0.1] },
    buoyancy: { draft: 0.62, planeAtSpeed: null, bowRiseDeg: 0 },

    // In the wheelhouse, behind the forward windows.
    helm: [0, 1.72, 0.62],

    parts: [
      // A working tug is a round-bilge displacement hull: soft sections
      // (sectionAft 2.2 ≈ a true circular arc), a bluff bow that barely tapers
      // (entry 1.1), and enormous freeboard forward.
      {
        name: 'hull', geom: 'hull', pos: [0, 0.20, 0.05], color: 'hull',
        shape: {
          len: 5.10, beam: 2.44, draft: 1.05, freeboard: 0.72,
          sectionAft: 2.4, sectionFwd: 1.85, flare: 0.16,
          sheer: 0.46, sheerAft: 0.16, rocker: 0.62, rockerAft: 0.18,
          transom: 0.88, entry: 1.10, beamPeak: 0.50, deckCamber: 0.07,
        },
        opts: { finish: 'satin' },
      },
      {
        name: 'hullBelly', geom: 'hull', pos: [0, 0.16, 0.05], color: 'dark',
        shape: {
          len: 5.06, beam: 2.40, draft: 1.08, freeboard: 0.02,
          sectionAft: 2.3, sectionFwd: 1.8, flare: 0.04,
          sheer: 0.2, rocker: 0.62, transom: 0.88, entry: 1.10, deck: false,
        },
        opts: { finish: 'matte', doubleSided: true },
      },
      { name: 'bowFender',   geom: 'torus', args: [0.86, 0.19, 8, 20], pos: [0, 0.62, 2.30], rot: [P / 2, 0, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'deck',        geom: 'box',   args: [2.10, 0.14, 3.00], pos: [0, 0.86, -0.40],  color: 'deck', opts: { finish: 'matte' } },
      { name: 'house',       geom: 'box',   args: [1.50, 1.10, 1.60], pos: [0, 1.48, 0.30],   color: 'hull', opts: { finish: 'satin' } },
      // Four separate panes in a frame, instead of one shrink-wrapped glass
      // belt around the whole deckhouse.
      { name: 'winFwd',      geom: 'box',   args: [1.22, 0.44, 0.06], pos: [0, 1.76, 1.12],   color: 'glass', opts: { opacity: 0.6, finish: 'glass' } },
      { name: 'winAft',      geom: 'box',   args: [1.22, 0.44, 0.06], pos: [0, 1.76, -0.52],  color: 'glass', opts: { opacity: 0.6, finish: 'glass' } },
      { name: 'winPort',     geom: 'box',   args: [0.06, 0.44, 1.30], pos: [-0.76, 1.76, 0.30], color: 'glass', opts: { opacity: 0.6, finish: 'glass' } },
      { name: 'winStbd',     geom: 'box',   args: [0.06, 0.44, 1.30], pos: [0.76, 1.76, 0.30],  color: 'glass', opts: { opacity: 0.6, finish: 'glass' } },
      { name: 'mullionP',    geom: 'box',   args: [0.07, 0.48, 0.07], pos: [-0.40, 1.76, 1.14], color: 'trim', opts: { finish: 'metal' } },
      { name: 'mullionS',    geom: 'box',   args: [0.07, 0.48, 0.07], pos: [0.40, 1.76, 1.14],  color: 'trim', opts: { finish: 'metal' } },
      { name: 'roof',        geom: 'box',   args: [1.72, 0.12, 1.82], pos: [0, 2.08, 0.30],   color: 'accent', opts: { finish: 'satin' } },
      { name: 'mast',        geom: 'cyl',   args: [0.05, 0.05, 1.10, 8], pos: [0, 2.66, 0.60], color: 'dark', opts: { finish: 'metal' } },
      { name: 'stack',       geom: 'cyl',   args: [0.30, 0.34, 0.90, 14], pos: [0, 2.50, -0.45], color: 'accent', opts: { finish: 'satin' } },
      { name: 'stackCap',    geom: 'torus', args: [0.32, 0.06, 6, 14], pos: [0, 2.95, -0.45], rot: [P / 2, 0, 0], color: 'dark', opts: { finish: 'metal' } },
      { name: 'winchDrum',   geom: 'cyl',   args: [0.40, 0.40, 1.20, 14], pos: [0, 1.12, -1.60], rot: [0, 0, P / 2], color: 'trim', opts: { group: 'weapon', finish: 'metal' } },
      { name: 'bittPort',    geom: 'cyl',   args: [0.11, 0.11, 0.46, 10], pos: [-0.74, 1.12, -2.05], color: 'dark', opts: { finish: 'metal' } },
      { name: 'bittStbd',    geom: 'cyl',   args: [0.11, 0.11, 0.46, 10], pos: [0.74, 1.12, -2.05],  color: 'dark', opts: { finish: 'metal' } },
      { name: 'cleatBow',    geom: 'cyl',   args: [0.09, 0.09, 0.38, 10], pos: [0, 1.14, 1.95], rot: [0, 0, P / 2], color: 'trim', opts: { finish: 'metal' } },
      { name: 'fenderPort',  geom: 'cyl',   args: [0.26, 0.26, 3.20, 12], pos: [-1.24, 0.60, -0.30], rot: [P / 2, 0, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'fenderStbd',  geom: 'cyl',   args: [0.26, 0.26, 3.20, 12], pos: [1.24, 0.60, -0.30],  rot: [P / 2, 0, 0], color: 'dark', opts: { finish: 'rubber' } },
      { name: 'prop',        geom: 'prop',  shape: { radius: 0.44, blades: 4, hub: 0.10, pitch: 0.7 }, pos: [0, -0.62, -2.52], color: 'accent', opts: { spin: 'prop', finish: 'metal' } },
      { name: 'rudder',      geom: 'foil',  shape: { span: 0.10, chord: 0.72, thickness: 0.18, taper: 0.9, sections: 8, segments: 4 }, pos: [0, -0.55, -2.80], rot: [0, 0, P / 2], color: 'dark', opts: { finish: 'metal' } },
    ],

    landMode: {
      id: 'wheel_deploy',
      name: 'Dozer Gear',
      description:
        'Four absurdly oversized tyres drop out of the skirts and the whole ' +
        '91-tonne hull settles onto them. It does not so much drive overland ' +
        'as evict it. Slow to wind up, impossible to stop, and it flattens ' +
        'anything it meets.',
      deploySeconds: 1.2,
      animation: 'tyres crank down out of the hull skirts, hull settles heavily onto them',
      motion: { style: 'rolling', bounceAmpl: 0.04, bounceHz: 2.2, yawLagDeg: 55 },
      sfx: ['hydraulic_crank', 'hull_scrape_gravel', 'diesel_lug'],
      vfx: ['gouged_earth_trench_decal', 'dust_wall_from_tyres'],
    },
  },

  /* =======================================================================
   * 4. HYDROFOIL CAT — glass cannon. Untouchable up to speed, awful below it.
   * ===================================================================== */
  {
    id: 'hydrofoil',
    name: 'Skimmer',
    class: 'Foiling Catamaran',
    role: 'Speed / glass cannon',
    blurb: 'Two needle hulls on retractable foils. Above 60% throttle it lifts ' +
           'clear of the water and becomes the fastest thing on the lake. ' +
           'Below that it is a very expensive raft.',
    unlock: 'wins:5',

    stats: {
      topSpeed: 10, accel: 5, turnRate: 4, drift: 3,
      hullHP: 4, armor: 3, mass: 0.8,
      landSpeed: 0.5, landHandling: 0.45,
    },

    weapons: {
      primary:   { id: 'bow_torpedo', damage: 18, rof: 1, range: 30, note: 'Straight-line only. Rewards committing to a heading.' },
      secondary: { id: 'foil_boost',  damage: 0, cooldown: 7, note: '2s overspeed; while boosting, contact does ram damage.' },
    },

    palette: {
      hull:  '#16202c',
      deck:  '#ff5f6d',
      accent:'#7fd4d4',
      trim:  '#f2c94c',
      dark:  '#0b0f15',
      glass: '#b48ee8',
    },

    collider: { type: 'box', size: [2.3, 1.4, 5.6], offset: [0, 0.35, 0] },
    buoyancy: { draft: 0.28, planeAtSpeed: 0.60, bowRiseDeg: 2, foilLiftHeight: 0.85 },

    // Under the canopy, on the centreline pod.
    helm: [0, 1.16, 0.42],

    parts: [
      // Needle hulls: extremely fine sections (sectionFwd 1.15) on a long
      // narrow waterline. This is where the loft pays off most — a 0.55 m box
      // and a 0.55 m needle read as completely different craft.
      {
        name: 'hullPort', geom: 'hull', pos: [-0.85, 0.02, 0.10], color: 'hull',
        shape: {
          len: 5.60, beam: 0.58, draft: 0.34, freeboard: 0.30,
          sectionAft: 2.6, sectionFwd: 1.15, flare: 0.10,
          sheer: 0.60, sheerAft: 0.10, rocker: 0.85, transom: 0.70,
          entry: 2.40, beamPeak: 0.44, ribs: 7, stations: 22,
        },
        opts: { finish: 'gloss' },
      },
      {
        name: 'hullStbd', geom: 'hull', pos: [0.85, 0.02, 0.10], color: 'hull',
        shape: {
          len: 5.60, beam: 0.58, draft: 0.34, freeboard: 0.30,
          sectionAft: 2.6, sectionFwd: 1.15, flare: 0.10,
          sheer: 0.60, sheerAft: 0.10, rocker: 0.85, transom: 0.70,
          entry: 2.40, beamPeak: 0.44, ribs: 7, stations: 22,
        },
        opts: { finish: 'gloss' },
      },
      { name: 'stripePort',  geom: 'box',   args: [0.60, 0.07, 3.20], pos: [-0.85, 0.26, 0.10], color: 'accent', opts: { finish: 'gloss' } },
      { name: 'stripeStbd',  geom: 'box',   args: [0.60, 0.07, 3.20], pos: [0.85, 0.26, 0.10],  color: 'accent', opts: { finish: 'gloss' } },
      { name: 'bridgeDeck',  geom: 'box',   args: [2.20, 0.22, 2.60], pos: [0, 0.48, -0.20],    color: 'deck', opts: { finish: 'matte' } },
      { name: 'crossBeam',   geom: 'foil',  shape: { span: 2.20, chord: 0.42, thickness: 0.16, taper: 1, sections: 8, segments: 4 }, pos: [0, 0.42, 1.90], color: 'dark', opts: { finish: 'satin' } },
      { name: 'pod',         geom: 'box',   args: [1.00, 0.48, 1.60], pos: [0, 0.84, 0.10],     color: 'hull', opts: { finish: 'gloss' } },
      // Domed bubble canopy rather than a flat translucent slab.
      { name: 'canopy',      geom: 'sphere',args: [0.50, 16, 10], pos: [0, 1.02, 0.32], color: 'glass', opts: { opacity: 0.55, finish: 'glass', doubleSided: true } },
      { name: 'canopyRail',  geom: 'torus', args: [0.50, 0.028, 6, 18], pos: [0, 1.02, 0.32], rot: [P / 2, 0, 0], color: 'trim', opts: { finish: 'metal' } },
      { name: 'fin',         geom: 'foil',  shape: { span: 0.11, chord: 0.90, thickness: 0.20, taper: 0.55, sweep: 0.5, sections: 8, segments: 6 }, pos: [0, 1.30, -1.05], rot: [0, 0, P / 2], color: 'trim', opts: { finish: 'satin' } },
      // Struts and foils are aerofoil sections now. A hydrofoil rendered as a
      // 0.10 m rectangular slab was the single most obviously-wrong part in
      // the whole catalog.
      { name: 'strutFwdPort',geom: 'foil',  shape: { span: 0.13, chord: 0.30, thickness: 0.13, taper: 1, sections: 8, segments: 4 }, pos: [-0.85, -0.48, 1.60], rot: [0, 0, P / 2], color: 'dark', opts: { group: 'foil', finish: 'metal' } },
      { name: 'strutFwdStbd',geom: 'foil',  shape: { span: 0.13, chord: 0.30, thickness: 0.13, taper: 1, sections: 8, segments: 4 }, pos: [0.85, -0.48, 1.60], rot: [0, 0, P / 2], color: 'dark', opts: { group: 'foil', finish: 'metal' } },
      { name: 'foilFwd',     geom: 'foil',  shape: { span: 2.40, chord: 0.46, thickness: 0.11, taper: 0.6, sweep: 0.2 }, pos: [0, -0.95, 1.60], color: 'trim', opts: { group: 'foil', finish: 'metal' } },
      { name: 'strutAft',    geom: 'foil',  shape: { span: 0.17, chord: 0.34, thickness: 0.15, taper: 1, sections: 8, segments: 4 }, pos: [0, -0.53, -1.75], rot: [0, 0, P / 2], color: 'dark', opts: { group: 'foil', finish: 'metal' } },
      { name: 'foilAft',     geom: 'foil',  shape: { span: 1.60, chord: 0.42, thickness: 0.11, taper: 0.6, sweep: 0.2 }, pos: [0, -1.05, -1.75], color: 'trim', opts: { group: 'foil', finish: 'metal' } },
      { name: 'jetPort',     geom: 'tube',  args: [0.18, 0.18, 0.44, 14], pos: [-0.85, 0.05, -2.62], rot: [P / 2, 0, 0], color: 'accent', opts: { finish: 'metal', doubleSided: true } },
      { name: 'jetStbd',     geom: 'tube',  args: [0.18, 0.18, 0.44, 14], pos: [0.85, 0.05, -2.62],  rot: [P / 2, 0, 0], color: 'accent', opts: { finish: 'metal', doubleSided: true } },
      { name: 'torpedoTube', geom: 'cyl',   args: [0.16, 0.16, 0.90, 12], pos: [0, 0.45, 2.30], rot: [P / 2, 0, 0], color: 'trim', opts: { group: 'weapon', finish: 'metal' } },
    ],

    landMode: {
      id: 'stilt_walk',
      name: 'Stilt Walk',
      description:
        'The foils were never wheels and never will be. On land the struts ' +
        'rotate down past vertical and the whole boat picks its way forward on ' +
        'four legs like an embarrassed heron — high off the ground, stepping ' +
        'over obstacles other hulls have to go around, wobbling the entire ' +
        'time. Fast in a straight line, and one good hit tips it over.',
      deploySeconds: 1.0,
      animation: 'struts pivot down 40deg, hull rises 0.85m, alternating diagonal 4-leg gait',
      motion: { style: 'walking', gaitPeriod: 0.55, bodySwayDeg: 7, stepHeight: 0.45, tipOverOnHit: true },
      sfx: ['servo_whir', 'metal_leg_clack', 'nervous_creak'],
      vfx: ['four_footprint_decals', 'tiny_dust_at_each_footfall'],
    },
  },

  /* =======================================================================
   * 5. PWC — unlockable. Tiny, twitchy, hilarious. Ship after the four.
   * ===================================================================== */
  {
    id: 'pwc',
    name: 'Skipjack',
    class: 'Personal Watercraft',
    role: 'Duelist / trickster',
    blurb: 'A jet ski with a grudge. Turns inside everything, survives nothing, ' +
           'and can jump its own wake.',
    unlock: 'unlockable',

    stats: {
      topSpeed: 8, accel: 9, turnRate: 10, drift: 8,
      hullHP: 3, armor: 1, mass: 0.35,
      landSpeed: 0.7, landHandling: 0.8,
    },

    weapons: {
      primary:   { id: 'spray_jet',   damage: 3, rof: 8, range: 10, note: 'Short range, blinds the target camera briefly.' },
      secondary: { id: 'wake_hop',    damage: 0, cooldown: 4, note: 'Launches off any wake or crest. Contact while airborne = 14 dmg.' },
    },

    palette: {
      hull:  '#1d2836',
      deck:  '#7fd4d4',
      accent:'#ff5f6d',
      trim:  '#f2c94c',
      dark:  '#0d1219',
      glass: '#b48ee8',
    },

    collider: { type: 'box', size: [1.05, 1.0, 3.4], offset: [0, 0.25, 0.1] },
    buoyancy: { draft: 0.22, planeAtSpeed: 0.30, bowRiseDeg: 9 },

    parts: [
      { name: 'hull',        geom: 'box',   args: [1.00, 0.55, 2.60], pos: [0, 0.10, 0],      color: 'hull' },
      { name: 'hullBottom',  geom: 'box',   args: [0.78, 0.28, 2.50], pos: [0, -0.22, -0.05], color: 'dark' },
      { name: 'bow',         geom: 'wedge', args: [1.00, 0.55, 0.90], pos: [0, 0.10, 1.75],   color: 'hull' },
      { name: 'deck',        geom: 'box',   args: [0.95, 0.12, 1.80], pos: [0, 0.42, -0.10],  color: 'deck' },
      { name: 'stripe',      geom: 'box',   args: [1.02, 0.12, 2.00], pos: [0, 0.24, 0.10],   color: 'accent' },
      { name: 'seat',        geom: 'box',   args: [0.70, 0.34, 1.10], pos: [0, 0.62, -0.48],  color: 'accent' },
      { name: 'tankCover',   geom: 'box',   args: [0.60, 0.30, 0.60], pos: [0, 0.60, 0.52],   color: 'trim' },
      { name: 'handlePole',  geom: 'box',   args: [0.16, 0.36, 0.28], pos: [0, 0.72, 0.94],   color: 'dark' },
      { name: 'bars',        geom: 'cyl',   args: [0.05, 0.05, 0.86, 8], pos: [0, 0.92, 0.94], rot: [0, 0, P / 2], color: 'dark' },
      { name: 'gripPort',    geom: 'cyl',   args: [0.07, 0.07, 0.18, 8], pos: [-0.42, 0.92, 0.94], rot: [0, 0, P / 2], color: 'accent' },
      { name: 'gripStbd',    geom: 'cyl',   args: [0.07, 0.07, 0.18, 8], pos: [0.42, 0.92, 0.94],  rot: [0, 0, P / 2], color: 'accent' },
      { name: 'rearGrab',    geom: 'box',   args: [0.50, 0.08, 0.30], pos: [0, 0.50, -1.35],  color: 'dark' },
      { name: 'jetNozzle',   geom: 'cyl',   args: [0.16, 0.16, 0.32, 8], pos: [0, 0.02, -1.46], rot: [P / 2, 0, 0], color: 'trim', opts: { spin: 'prop' } },
      // land gear
      { name: 'slickHead',   geom: 'cyl',   args: [0.10, 0.10, 0.34, 8], pos: [0, -0.05, 1.55], rot: [P / 2, 0, 0], color: 'glass', opts: { group: 'landgear', showOnLand: true } },
    ],

    landMode: {
      id: 'slip_n_slide',
      name: "Slip 'n' Slide",
      description:
        'The jet pump reverses to a bow nozzle and sprays its own ballast ' +
        'water onto the dirt ahead of itself, then surfs the mud it just made. ' +
        'Genuinely fast, completely uncontrollable, and it burns a limited ' +
        'water reserve — run dry and you are beached until you touch water ' +
        'again. The slick it leaves behind is a hazard for anyone following.',
      deploySeconds: 0.5,
      animation: 'nozzle flips forward, water arc sprays 3m ahead, hull settles into the slick and fishtails',
      motion: { style: 'sliding', yawLagDeg: 65, gripFalloff: 0.35 },
      resource: { id: 'water_reserve', max: 100, drainPerSecond: 9, refillOnWaterContact: 35 },
      sfx: ['pump_reverse_clunk', 'water_hiss', 'mud_slither'],
      vfx: ['wet_mud_trail_decal', 'forward_water_arc', 'reserve_gauge_on_hud'],
    },
  },

  /* =======================================================================
   * 6. SEAPLANE — the only craft that leaves the river entirely.
   * ===================================================================== */
  {
    id: 'seaplane',
    name: 'Osprey',
    class: 'Floatplane',
    role: 'Aviator',
    blurb: 'A high-wing bush plane on a flying-boat hull. Takes off down the ' +
           'channel, and once the wing bites, the whole 152 km of Cumberland ' +
           'is just scenery.',
    unlock: 'default',

    stats: {
      topSpeed: 9, accel: 6, turnRate: 7, drift: 4,
      hullHP: 3, armor: 2, mass: 0.5,
      landSpeed: 0.4, landHandling: 0.5,
    },

    weapons: {
      primary:   { id: 'nose_gun',   damage: 8, rof: 5, range: 40, note: 'Fixed forward. You aim it by aiming the aeroplane.' },
      secondary: { id: 'water_drop', damage: 0, cooldown: 12, note: 'Dumps a scooped load. Douses fires, ruins someone\'s day.' },
    },

    palette: {
      hull:  '#e8e4d9',
      deck:  '#2b4a6f',
      accent:'#ff5f6d',
      trim:  '#f2c94c',
      dark:  '#161b24',
      glass: '#7fd4d4',
    },

    collider: { type: 'box', size: [2.8, 1.55, 6.60], offset: [0, 0.30, 0.05] },
    buoyancy: { draft: 0.26, planeAtSpeed: 0.35, bowRiseDeg: 5 },

    // Cockpit, just behind the windscreen and under the wing.
    helm: [0, 1.06, 1.15],

    parts: [
      // Flying-boat hull: a planing step aft, fine entry forward, high sheer.
      {
        name: 'hull', geom: 'hull', pos: [0, 0.12, 0.10], color: 'hull',
        shape: {
          len: 6.30, beam: 1.30, draft: 0.44, freeboard: 0.56,
          sectionAft: 4.4, sectionFwd: 1.25, flare: 0.16,
          sheer: 0.44, sheerAft: 0.22, rocker: 0.92, rockerAft: 0.30,
          transom: 0.42, entry: 2.20, beamPeak: 0.52, deck: true,
        },
        opts: { finish: 'gloss' },
      },
      { name: 'bootStripe',  geom: 'box',   args: [1.34, 0.10, 4.20], pos: [0, 0.26, 0.10], color: 'accent', opts: { finish: 'gloss' } },
      { name: 'cabin',       geom: 'box',   args: [1.12, 0.60, 1.90], pos: [0, 0.92, 0.95], color: 'hull', opts: { finish: 'gloss' } },
      { name: 'windscreen',  geom: 'box',   args: [1.02, 0.46, 0.10], pos: [0, 1.14, 1.86], rot: [-0.42, 0, 0], color: 'glass', opts: { opacity: 0.5, finish: 'glass' } },
      { name: 'sideGlassP',  geom: 'box',   args: [0.06, 0.36, 1.30], pos: [-0.57, 1.06, 0.95], color: 'glass', opts: { opacity: 0.5, finish: 'glass' } },
      { name: 'sideGlassS',  geom: 'box',   args: [0.06, 0.36, 1.30], pos: [0.57, 1.06, 0.95],  color: 'glass', opts: { opacity: 0.5, finish: 'glass' } },

      // High wing on a cabane, with dihedral struts down to the hull.
      { name: 'wing',        geom: 'foil',  shape: { span: 8.40, chord: 1.15, thickness: 0.17, taper: 0.72, sweep: 0.12, segments: 18 }, pos: [0, 1.42, 0.55], color: 'deck', opts: { finish: 'satin' } },
      { name: 'wingTipP',    geom: 'sphere',args: [0.10, 10, 6], pos: [-4.18, 1.42, 0.60], color: 'accent', opts: { finish: 'gloss' } },
      { name: 'wingTipS',    geom: 'sphere',args: [0.10, 10, 6], pos: [4.18, 1.42, 0.60],  color: 'accent', opts: { finish: 'gloss' } },
      { name: 'strutWingP',  geom: 'foil',  shape: { span: 0.07, chord: 0.20, thickness: 0.10, taper: 1, sections: 6, segments: 3 }, pos: [-1.55, 0.92, 0.55], rot: [0, 0, 0.42], color: 'dark', opts: { finish: 'metal' } },
      { name: 'strutWingS',  geom: 'foil',  shape: { span: 0.07, chord: 0.20, thickness: 0.10, taper: 1, sections: 6, segments: 3 }, pos: [1.55, 0.92, 0.55], rot: [0, 0, -0.42], color: 'dark', opts: { finish: 'metal' } },

      // Engine and a real four-blade propeller.
      { name: 'cowl',        geom: 'cyl',   args: [0.34, 0.40, 0.70, 16], pos: [0, 1.04, 2.62], rot: [P / 2, 0, 0], color: 'accent', opts: { finish: 'gloss' } },
      { name: 'spinner',     geom: 'cone',  args: [0.16, 0.36, 14], pos: [0, 1.04, 3.06], rot: [P / 2, 0, 0], color: 'trim', opts: { finish: 'gloss' } },
      { name: 'propeller',   geom: 'prop',  shape: { radius: 1.05, blades: 4, hub: 0.10, pitch: 0.5 }, pos: [0, 1.04, 3.02], color: 'dark', opts: { spin: 'fan', finish: 'satin' } },

      // Empennage.
      { name: 'tailplane',   geom: 'foil',  shape: { span: 2.90, chord: 0.62, thickness: 0.12, taper: 0.66, sweep: 0.15, segments: 10 }, pos: [0, 0.86, -2.72], color: 'deck', opts: { finish: 'satin' } },
      { name: 'fin',         geom: 'foil',  shape: { span: 0.10, chord: 1.05, thickness: 0.14, taper: 0.50, sweep: 0.62, sections: 8, segments: 8 }, pos: [0, 1.30, -2.70], rot: [0, 0, P / 2], color: 'accent', opts: { finish: 'satin' } },
      { name: 'rudderTail',  geom: 'foil',  shape: { span: 0.08, chord: 0.42, thickness: 0.11, taper: 0.7, sections: 8, segments: 5 }, pos: [0, 1.34, -3.16], rot: [0, 0, P / 2], color: 'trim', opts: { finish: 'satin' } },

      // Wingtip floats on struts — what makes it a floatplane rather than a
      // land aeroplane that happens to be over water.
      { name: 'floatPort',   geom: 'hull',  shape: { len: 1.50, beam: 0.40, draft: 0.20, freeboard: 0.16, sectionAft: 3.4, sectionFwd: 1.3, sheer: 0.5, rocker: 0.9, transom: 0.6, entry: 2.0, ribs: 6, stations: 12 }, pos: [-3.15, -0.16, 0.35], color: 'trim', opts: { finish: 'gloss' } },
      { name: 'floatStbd',   geom: 'hull',  shape: { len: 1.50, beam: 0.40, draft: 0.20, freeboard: 0.16, sectionAft: 3.4, sectionFwd: 1.3, sheer: 0.5, rocker: 0.9, transom: 0.6, entry: 2.0, ribs: 6, stations: 12 }, pos: [3.15, -0.16, 0.35], color: 'trim', opts: { finish: 'gloss' } },
      { name: 'floatStrutP', geom: 'foil',  shape: { span: 0.06, chord: 0.18, thickness: 0.09, taper: 1, sections: 6, segments: 3 }, pos: [-3.15, 0.62, 0.42], rot: [0, 0, P / 2], color: 'dark', opts: { finish: 'metal' } },
      { name: 'floatStrutS', geom: 'foil',  shape: { span: 0.06, chord: 0.18, thickness: 0.09, taper: 1, sections: 6, segments: 3 }, pos: [3.15, 0.62, 0.42], rot: [0, 0, P / 2], color: 'dark', opts: { finish: 'metal' } },
    ],

    landMode: {
      id: 'beach_skid',
      name: 'Beach Skid',
      description:
        'It has no undercarriage, because it is a boat with a wing. Ashore it ' +
        'simply slides on the hull and the two wingtip floats, steering badly ' +
        'and complaining. The answer to being on land is to stop being on land.',
      deploySeconds: 0.4,
      animation: 'hull settles onto its keel, wing rocks as the floats take the weight',
      motion: { style: 'sliding', yawLagDeg: 40, gripFalloff: 0.5 },
      sfx: ['gravel_scrape', 'prop_idle'],
      vfx: ['dust_from_keel'],
    },
  },
];

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

export const getVessel = (id) => VESSELS.find((v) => v.id === id) || null;

export const SELECTABLE_VESSELS = VESSELS.filter((v) => v.unlock === 'default');

export const LAND_MODES = Object.fromEntries(
  VESSELS.map((v) => [v.id, v.landMode])
);

export default VESSELS;
