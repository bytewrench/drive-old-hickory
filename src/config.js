// ──────────────────────────────────────────────────────────────
// Global tuning constants. Everything world-scale lives here.
// ──────────────────────────────────────────────────────────────

// World extent comes from the baked OSM asset (4.6 km square at 1:1 scale,
// centred on the Hunters Point ramp) — see world/cumberland-data.js.
import { MAP_SIZE as _MAP_SIZE } from './world/cumberland-data.js';

export const MAP_SIZE = _MAP_SIZE;
export const HALF_MAP = MAP_SIZE * 0.5;

/** Heightfield resolution — shared by the render mesh and the Rapier collider.
 *  Over the 56 km Nashville-corridor map this is ~55 m cells: coarse for land
 *  driving, but river handling rides the finer SDF, not this mesh. */
export const TERRAIN_SEG = 1024;

/** Resolution of the CPU-baked height texture the water shader samples. */
export const HEIGHT_TEX_RES = 1024;

/** Baked summer-pool datum. Raised ~6 ft over the old 0 so shallow coves fill
 *  in and read as real depth instead of patchy shallows. Terrain tint, the map
 *  bake and every static structure are built once against WATER_BASE. */
export const WATER_BASE = 1.83;   // +6 ft

/** Live still-water plane height. This is a MUTABLE binding: the weather system
 *  reassigns it through setWaterLevel(), and every consumer that reads it inside
 *  a function — buoyancy, wake/splash FX, the water shader — picks the new value
 *  up on the next frame (ES-module live binding). Do NOT capture it into a
 *  module-level const at load time or you'll freeze the pool. */
export let WATER_LEVEL = WATER_BASE;
export function setWaterLevel(y) { WATER_LEVEL = y; }

/** Weather presets. `depth` is metres of pool relative to the baked datum, so
 *  Fair sits exactly at the structures' build height and the rest swing a modest
 *  amount around it — enough to move the shoreline and change how deep the river
 *  reads without drowning the docks. Every preset still floats deeper than the
 *  old 0 datum, so the channel never strands. fog / deep are light visual mood. */
export const WEATHER = [
  { id: 'fair',     name: 'Fair',      icon: '☀️', depth:  0.00, fog: 1.00, deep: '#14607f' },
  { id: 'overcast', name: 'Overcast',  icon: '⛅', depth:  0.35, fog: 1.45, deep: '#125a72' },
  { id: 'rain',     name: 'Rain',      icon: '🌧️', depth:  0.85, fog: 2.10, deep: '#0e4d63' },
  { id: 'storm',    name: 'Storm',     icon: '⛈️', depth:  1.25, fog: 3.00, deep: '#0a3d54' },
  { id: 'drought',  name: 'Low Water', icon: '🌵', depth: -0.75, fog: 0.75, deep: '#1c7290' },
];

/**
 * Render layer for the LOCAL vessel's hull meshes. First-person masks this layer
 * off the main camera while the shadow camera keeps it enabled, so the boat
 * disappears from view but still casts its shadow. Lives here rather than in
 * Engine.js so vehicle code can import it without pulling in the renderer.
 */
export const LAYER_HULL = 1;

export const GRAVITY = -24;

/** Fixed physics timestep. All vehicle force tuning assumes this rate. */
export const FIXED_DT = 1 / 60;
export const MAX_SUBSTEPS = 4;

/** Analytic wave params — duplicated verbatim in the water GLSL. */
export const WAVE = {
  a1: 0.32, f1: 0.13, s1: 1.1,
  a2: 0.22, f2: 0.17, s2: 1.4,
  a3: 0.14, f3: 0.09, s3: 0.7,
};

// The spawn point is Hunters Point Boat Dock — see HUNTERS_POINT in
// world/heightfield.js, which derives it from the terrain field itself.

export const LIMITS = {
  maxProjectiles: 40,
  maxDebris: 320,
  maxProps: 1100,
};
