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

/** Still-water plane height (Old Hickory summer pool, as datum). */
export const WATER_LEVEL = 0;

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
