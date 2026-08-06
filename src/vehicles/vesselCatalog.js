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

    parts: [
      { name: 'hull',        geom: 'box',   args: [2.00, 0.75, 4.00], pos: [0, 0.15, 0],     color: 'hull' },
      { name: 'hullBottom',  geom: 'box',   args: [1.60, 0.35, 3.80], pos: [0, -0.25, 0],    color: 'dark' },
      { name: 'bow',         geom: 'wedge', args: [2.00, 0.75, 1.30], pos: [0, 0.15, 2.65],  color: 'hull' },
      { name: 'bowBottom',   geom: 'wedge', args: [1.60, 0.35, 1.10], pos: [0, -0.25, 2.45], color: 'dark' },
      { name: 'cockpitSole', geom: 'box',   args: [1.85, 0.14, 2.20], pos: [0, 0.56, 0.50],  color: 'deck' },
      { name: 'foredeck',    geom: 'box',   args: [1.85, 0.14, 1.60], pos: [0, 0.56, 2.20],  color: 'trim' },
      { name: 'windshield',  geom: 'box',   args: [1.50, 0.45, 0.10], pos: [0, 0.82, 1.28],  rot: [-0.28, 0, 0], color: 'glass', opts: { opacity: 0.75 } },
      { name: 'console',     geom: 'box',   args: [0.70, 0.35, 0.40], pos: [-0.45, 0.78, 1.00], color: 'deck' },
      { name: 'seatPort',    geom: 'box',   args: [0.55, 0.50, 0.55], pos: [-0.45, 0.85, 0.35], color: 'accent' },
      { name: 'seatStbd',    geom: 'box',   args: [0.55, 0.50, 0.55], pos: [0.45, 0.85, 0.35],  color: 'accent' },
      { name: 'engineCowl',  geom: 'box',   args: [1.30, 0.55, 1.00], pos: [0, 0.62, -1.40],  color: 'trim' },
      { name: 'transom',     geom: 'box',   args: [2.00, 0.70, 0.25], pos: [0, 0.15, -2.00],  color: 'dark' },
      { name: 'rubRailPort', geom: 'box',   args: [0.10, 0.16, 4.60], pos: [-1.00, 0.50, 0.20], color: 'dark' },
      { name: 'rubRailStbd', geom: 'box',   args: [0.10, 0.16, 4.60], pos: [1.00, 0.50, 0.20],  color: 'dark' },
      { name: 'outdrive',    geom: 'box',   args: [0.35, 0.65, 0.50], pos: [0, -0.20, -2.15],  color: 'dark' },
      { name: 'prop',        geom: 'cyl',   args: [0.24, 0.24, 0.10, 8], pos: [0, -0.38, -2.42], rot: [P / 2, 0, 0], color: 'accent', opts: { spin: 'prop' } },
      // land gear (hidden until beached)
      { name: 'rollerFwd',   geom: 'cyl',   args: [0.36, 0.36, 2.10, 10], pos: [0, -0.30, 1.60], rot: [0, 0, P / 2], color: 'accent', opts: { group: 'landgear', showOnLand: true, spin: 'prop' } },
      { name: 'rollerAft',   geom: 'cyl',   args: [0.36, 0.36, 2.10, 10], pos: [0, -0.30, -1.40], rot: [0, 0, P / 2], color: 'accent', opts: { group: 'landgear', showOnLand: true, spin: 'prop' } },
    ],

    landMode: {
      id: 'roller_bumpers',
      name: 'Roller Bumpers',
      description:
        'Two inflatable fenders bang out of the topsides and drop under the ' +
        'keel. The boat rolls forward like a rolling pin — quick in a straight ' +
        'line, terrible at turning, and it visibly bounces over every rock.',
      deploySeconds: 0.8,
      animation: 'fenders punch outward, hull drops onto them, hull pitches nose-down 8deg',
      motion: { style: 'rolling', bounceAmpl: 0.09, bounceHz: 4.5, yawLagDeg: 22 },
      sfx: ['pneumatic_thunk', 'rubber_rumble_loop'],
      vfx: ['dust_puff_on_deploy', 'dirt_spray_from_rollers'],
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

    parts: [
      { name: 'hullPan',    geom: 'box',   args: [2.20, 0.35, 4.20], pos: [0, 0.00, 0],     color: 'hull' },
      { name: 'bowRamp',    geom: 'wedge', args: [2.20, 0.35, 1.40], pos: [0, 0.00, 2.80],  color: 'hull' },
      { name: 'deckPlate',  geom: 'box',   args: [2.00, 0.12, 3.40], pos: [0, 0.23, 0.20],  color: 'deck' },
      { name: 'gunwalePort',geom: 'box',   args: [0.10, 0.30, 4.20], pos: [-1.05, 0.32, 0], color: 'dark' },
      { name: 'gunwaleStbd',geom: 'box',   args: [0.10, 0.30, 4.20], pos: [1.05, 0.32, 0],  color: 'dark' },
      { name: 'seatPost',   geom: 'box',   args: [0.30, 0.70, 0.30], pos: [0, 0.55, -0.30], color: 'dark' },
      { name: 'seatBase',   geom: 'box',   args: [0.72, 0.16, 0.72], pos: [0, 0.96, -0.30], color: 'accent' },
      { name: 'seatBack',   geom: 'box',   args: [0.72, 0.70, 0.16], pos: [0, 1.32, -0.62], color: 'accent' },
      { name: 'fanFramePort',geom:'box',   args: [0.14, 1.60, 0.14], pos: [-0.72, 0.90, -1.85], color: 'dark' },
      { name: 'fanFrameStbd',geom:'box',   args: [0.14, 1.60, 0.14], pos: [0.72, 0.90, -1.85],  color: 'dark' },
      { name: 'fanCage',    geom: 'cyl',   args: [1.00, 1.00, 0.28, 14], pos: [0, 1.35, -1.95], rot: [P / 2, 0, 0], color: 'dark', opts: { wire: true } },
      { name: 'fanHub',     geom: 'cyl',   args: [0.18, 0.18, 0.30, 8], pos: [0, 1.35, -1.90], rot: [P / 2, 0, 0], color: 'trim' },
      { name: 'fanBladeA',  geom: 'box',   args: [1.70, 0.16, 0.06], pos: [0, 1.35, -1.90], color: 'trim', opts: { spin: 'fan', group: 'fan' } },
      { name: 'fanBladeB',  geom: 'box',   args: [0.16, 1.70, 0.06], pos: [0, 1.35, -1.90], color: 'trim', opts: { spin: 'fan', group: 'fan' } },
      { name: 'rudderPort', geom: 'box',   args: [0.08, 0.90, 0.70], pos: [-0.40, 1.30, -2.45], color: 'accent', opts: { group: 'weapon' } },
      { name: 'rudderStbd', geom: 'box',   args: [0.08, 0.90, 0.70], pos: [0.40, 1.30, -2.45],  color: 'accent', opts: { group: 'weapon' } },
      { name: 'skidPort',   geom: 'box',   args: [0.16, 0.12, 3.80], pos: [-0.92, -0.20, 0], color: 'dark', opts: { group: 'skid' } },
      { name: 'skidStbd',   geom: 'box',   args: [0.16, 0.12, 3.80], pos: [0.92, -0.20, 0],  color: 'dark', opts: { group: 'skid' } },
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

    parts: [
      { name: 'hull',        geom: 'box',   args: [2.40, 1.10, 4.20], pos: [0, 0.15, 0],     color: 'hull' },
      { name: 'hullBelly',   geom: 'box',   args: [2.00, 0.55, 3.90], pos: [0, -0.55, -0.10], color: 'dark' },
      { name: 'bow',         geom: 'wedge', args: [2.40, 1.10, 0.90], pos: [0, 0.15, 2.55],  color: 'hull' },
      { name: 'bowFender',   geom: 'cyl',   args: [0.34, 0.34, 2.30, 10], pos: [0, 0.30, 2.95], rot: [0, 0, P / 2], color: 'dark' },
      { name: 'deck',        geom: 'box',   args: [2.20, 0.16, 3.00], pos: [0, 0.78, -0.30],  color: 'deck' },
      { name: 'house',       geom: 'box',   args: [1.50, 1.10, 1.60], pos: [0, 1.40, 0.30],   color: 'hull' },
      { name: 'houseBand',   geom: 'box',   args: [1.54, 0.36, 1.64], pos: [0, 1.68, 0.30],   color: 'glass', opts: { opacity: 0.8 } },
      { name: 'roof',        geom: 'box',   args: [1.72, 0.12, 1.82], pos: [0, 2.00, 0.30],   color: 'accent' },
      { name: 'stack',       geom: 'cyl',   args: [0.30, 0.30, 0.90, 8], pos: [0, 2.42, -0.45], color: 'accent' },
      { name: 'stackCap',    geom: 'cyl',   args: [0.34, 0.34, 0.14, 8], pos: [0, 2.92, -0.45], color: 'dark' },
      { name: 'winchDrum',   geom: 'cyl',   args: [0.40, 0.40, 1.20, 10], pos: [0, 1.05, -1.55], rot: [0, 0, P / 2], color: 'trim', opts: { group: 'weapon' } },
      { name: 'bittPort',    geom: 'box',   args: [0.24, 0.46, 0.24], pos: [-0.70, 1.05, -2.05], color: 'dark' },
      { name: 'bittStbd',    geom: 'box',   args: [0.24, 0.46, 0.24], pos: [0.70, 1.05, -2.05],  color: 'dark' },
      { name: 'fenderPort',  geom: 'cyl',   args: [0.28, 0.28, 3.40, 8], pos: [-1.26, 0.42, -0.20], rot: [P / 2, 0, 0], color: 'dark' },
      { name: 'fenderStbd',  geom: 'cyl',   args: [0.28, 0.28, 3.40, 8], pos: [1.26, 0.42, -0.20],  rot: [P / 2, 0, 0], color: 'dark' },
      { name: 'transom',     geom: 'box',   args: [2.40, 1.00, 0.24], pos: [0, 0.10, -2.10],  color: 'dark' },
      { name: 'prop',        geom: 'cyl',   args: [0.40, 0.40, 0.12, 8], pos: [0, -0.55, -2.35], rot: [P / 2, 0, 0], color: 'accent', opts: { spin: 'prop' } },
      // land gear
      { name: 'anchorShank', geom: 'box',   args: [0.16, 0.16, 1.10], pos: [0, 0.30, 3.40],  color: 'accent', opts: { group: 'landgear', showOnLand: true } },
      { name: 'anchorFluke', geom: 'wedge', args: [0.90, 0.20, 0.60], pos: [0, 0.15, 4.00],  color: 'accent', opts: { group: 'landgear', showOnLand: true } },
    ],

    landMode: {
      id: 'anchor_crawl',
      name: 'Anchor Crawl',
      description:
        'The tug cannot drive on land, so it cheats. It fires its anchor ' +
        'forward, bites the dirt, and winches its own hull along in lurching ' +
        'one-boat-length heaves. Slowest thing in the game overland and the ' +
        'funniest to watch. The winch line is the same hardware as its ' +
        'harpoon, so a clever player uses terrain to slingshot itself.',
      deploySeconds: 1.2,
      animation: 'anchor launches on a taut line, bites, hull drags forward in a 3-beat lurch cycle',
      motion: { style: 'lurching', cyclePeriod: 1.35, lurchDistance: 4.2, yawLagDeg: 55 },
      sfx: ['chain_ratchet', 'hull_scrape_gravel', 'diesel_lug'],
      vfx: ['gouged_earth_trench_decal', 'taut_line_between_anchor_and_bow'],
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

    parts: [
      { name: 'hullPort',    geom: 'box',   args: [0.55, 0.55, 4.60], pos: [-0.85, 0.05, 0],    color: 'hull' },
      { name: 'hullStbd',    geom: 'box',   args: [0.55, 0.55, 4.60], pos: [0.85, 0.05, 0],     color: 'hull' },
      { name: 'bowPort',     geom: 'wedge', args: [0.55, 0.55, 1.30], pos: [-0.85, 0.05, 2.95], color: 'accent' },
      { name: 'bowStbd',     geom: 'wedge', args: [0.55, 0.55, 1.30], pos: [0.85, 0.05, 2.95],  color: 'accent' },
      { name: 'bridgeDeck',  geom: 'box',   args: [2.20, 0.25, 2.60], pos: [0, 0.48, -0.20],    color: 'deck' },
      { name: 'crossBeam',   geom: 'box',   args: [2.20, 0.18, 0.35], pos: [0, 0.40, 1.90],     color: 'dark' },
      { name: 'pod',         geom: 'box',   args: [1.00, 0.50, 1.60], pos: [0, 0.85, 0.10],     color: 'hull' },
      { name: 'canopy',      geom: 'box',   args: [0.90, 0.34, 1.00], pos: [0, 1.20, 0.25],     color: 'glass', opts: { opacity: 0.8 } },
      { name: 'fin',         geom: 'box',   args: [0.12, 0.70, 0.90], pos: [0, 1.28, -1.05],    color: 'trim' },
      { name: 'strutFwdPort',geom: 'box',   args: [0.14, 0.95, 0.22], pos: [-0.85, -0.48, 1.60], color: 'dark',  opts: { group: 'foil' } },
      { name: 'strutFwdStbd',geom: 'box',   args: [0.14, 0.95, 0.22], pos: [0.85, -0.48, 1.60],  color: 'dark',  opts: { group: 'foil' } },
      { name: 'foilFwd',     geom: 'box',   args: [2.40, 0.10, 0.46], pos: [0, -0.95, 1.60],    color: 'trim',  opts: { group: 'foil' } },
      { name: 'strutAft',    geom: 'box',   args: [0.18, 1.05, 0.24], pos: [0, -0.53, -1.75],   color: 'dark',  opts: { group: 'foil' } },
      { name: 'foilAft',     geom: 'box',   args: [1.60, 0.10, 0.42], pos: [0, -1.05, -1.75],   color: 'trim',  opts: { group: 'foil' } },
      { name: 'jetPort',     geom: 'cyl',   args: [0.18, 0.18, 0.40, 8], pos: [-0.85, 0.05, -2.50], rot: [P / 2, 0, 0], color: 'accent' },
      { name: 'jetStbd',     geom: 'cyl',   args: [0.18, 0.18, 0.40, 8], pos: [0.85, 0.05, -2.50],  rot: [P / 2, 0, 0], color: 'accent' },
      { name: 'torpedoTube', geom: 'cyl',   args: [0.16, 0.16, 0.90, 8], pos: [0, 0.45, 2.30], rot: [P / 2, 0, 0], color: 'trim', opts: { group: 'weapon' } },
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
