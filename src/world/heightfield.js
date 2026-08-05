// ──────────────────────────────────────────────────────────────
// Terrain field, driven by the REAL Cumberland River.
//
// Covers the whole corridor from Hunters Point down to downtown Nashville
// (~56 km square). The shoreline comes from OpenStreetMap water polygons,
// baked into a signed distance field (positive = navigable water, negative =
// inland). Land elevation is REAL — sampled from AWS terrarium DEM tiles and
// re-datumed to the reservoir pool. Only the bathymetry (below the waterline)
// is synthetic, shaped from shoreline distance, because SRTM can't see the bed.
// ──────────────────────────────────────────────────────────────

import {
  MAP_SIZE, SDF_RES, SDF_CELL, SDF_SCALE, SDF_URL,
  DEM_URL, DEM_SCALE, DEM_DATUM_MSL,
  CHANNEL, TRIBUTARIES, ROADS, RAMP, ORIGIN,
  BRIDGES, DAMS, MARINAS,
} from './cumberland-data.js';
import { WATER_LEVEL, WAVE } from '../config.js';

export { MAP_SIZE, CHANNEL, TRIBUTARIES, ROADS, ORIGIN, BRIDGES, DAMS, MARINAS };

const HALF_MAP = MAP_SIZE / 2;
export { HALF_MAP };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ── deterministic value noise (land relief only) ──────────────
function hash2(i, j) {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  n = (n ^ (n >> 13)) | 0;
  n = Math.imul(n, 1274126177) | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return lerp(
    lerp(hash2(xi, zi), hash2(xi + 1, zi), u),
    lerp(hash2(xi, zi + 1), hash2(xi + 1, zi + 1), u),
    v,
  );
}

export function fbm(x, z, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * f, z * f) * amp;
    norm += amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

// ── baked rasters ─────────────────────────────────────────────
/** Signed distance to the shoreline. @type {Int16Array|null} */
let SDF = null;
/** Real ground elevation above pool. @type {Int16Array|null} */
let DEM = null;

async function loadRaster(baseUrl, url) {
  const res = await fetch(`${baseUrl}${url}`.replace(/([^:])\/\//g, '$1/'));
  if (!res.ok) throw new Error(`could not load ${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const expected = SDF_RES * SDF_RES * 2;
  if (buf.byteLength !== expected) {
    throw new Error(`${url} is ${buf.byteLength} bytes, expected ${expected}`);
  }
  return new Int16Array(buf);
}

/** Must be awaited before any sampleHeight call. */
export async function loadTerrainData(baseUrl = import.meta.env?.BASE_URL ?? '/') {
  [SDF, DEM] = await Promise.all([
    loadRaster(baseUrl, SDF_URL),
    loadRaster(baseUrl, DEM_URL),
  ]);
  return { SDF, DEM };
}

export const isTerrainReady = () => SDF !== null && DEM !== null;

/** Shared bilinear tap into either raster. */
function sampleRaster(raster, x, z, scale, fallback) {
  if (!raster) return fallback;
  const fx = (x + HALF_MAP) / SDF_CELL - 0.5;
  const fz = (z + HALF_MAP) / SDF_CELL - 0.5;

  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const last = SDF_RES - 1;
  const ia = clamp(i0, 0, last), ib = clamp(i0 + 1, 0, last);
  const ja = clamp(j0, 0, last), jb = clamp(j0 + 1, 0, last);

  const s00 = raster[ja * SDF_RES + ia], s10 = raster[ja * SDF_RES + ib];
  const s01 = raster[jb * SDF_RES + ia], s11 = raster[jb * SDF_RES + ib];

  return lerp(lerp(s00, s10, tx), lerp(s01, s11, tx), tz) / scale;
}

/** Surveyed ground elevation in metres above the reservoir pool. */
export function demHeight(x, z) {
  return sampleRaster(DEM, x, z, DEM_SCALE, 0);
}

/** Elevation above sea level, for reference/labelling. */
export const demHeightMSL = (x, z) => demHeight(x, z) + DEM_DATUM_MSL;
export { DEM_DATUM_MSL };

/**
 * Bilinear signed distance to the shoreline, in metres.
 * Positive = out in navigable water, negative = inland.
 */
export function shoreDistance(x, z) {
  return sampleRaster(SDF, x, z, SDF_SCALE, -50);
}

// ── the height field ──────────────────────────────────────────
/**
 * Water depth is synthetic, land elevation is surveyed.
 *
 * The DEM reads the reservoir *surface* over water (SRTM cannot see the bed),
 * so below the waterline we shape a plausible channel from the shoreline
 * distance instead. On land we use the real elevation, eased to zero right at
 * the waterline so the shore edge stays exactly on the OSM polygon.
 */
export function sampleHeight(x, z) {
  const d = shoreDistance(x, z);

  if (d > 0) {
    // Navigable water. The bank shelf is short and steep — the Cumberland is
    // an impounded river, not a beach — then it falls away to a ~9 m channel.
    const shelf = smoothstep(0, 9, d);             // quick drop-off at the bank
    const deep = smoothstep(7, 125, d);            // out toward mid-channel
    return -(1.5 * shelf + 8.0 * deep);
  }

  // Dry land: surveyed elevation, blended up from the waterline.
  const inland = -d;
  const ground = Math.max(demHeight(x, z), 0);
  const blend = smoothstep(0, 16, inland);

  // Sub-metre grain so the 7.8 m DEM posts don't read as terraces.
  const grain = (fbm(x * 0.085 + 3.7, z * 0.085 + 9.4, 2) - 0.5) * 1.1;

  return ground * blend + grain * blend;
}

/** Cheap central-difference normal. */
export function sampleNormal(x, z, out = { x: 0, y: 1, z: 0 }, e = 3.5) {
  const hl = sampleHeight(x - e, z), hr = sampleHeight(x + e, z);
  const hd = sampleHeight(x, z - e), hu = sampleHeight(x, z + e);
  const nx = hl - hr, ny = 2 * e, nz = hd - hu;
  const inv = 1 / Math.hypot(nx, ny, nz);
  out.x = nx * inv; out.y = ny * inv; out.z = nz * inv;
  return out;
}

/** Steepness 0 (flat) → 1 (cliff). */
export function sampleSlope(x, z) {
  return 1 - sampleNormal(x, z).y;
}

export function isWaterAt(x, z) {
  return shoreDistance(x, z) > 0.5;
}

// ── waves (must match the GLSL in Water.js exactly) ───────────
export function waveHeight(x, z, t) {
  return WAVE.a1 * Math.sin(x * WAVE.f1 + t * WAVE.s1)
       + WAVE.a2 * Math.sin(z * WAVE.f2 - t * WAVE.s2)
       + WAVE.a3 * Math.sin((x + z) * WAVE.f3 + t * WAVE.s3);
}

/** Height of the drivable surface: water where wet, ground where dry. */
export function surfaceHeight(x, z, t) {
  if (isWaterAt(x, z)) return WATER_LEVEL + waveHeight(x, z, t);
  return sampleHeight(x, z);
}

// ── baked height texture (water shader + minimap) ─────────────
export function bakeHeightData(res) {
  const data = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    const z = (j / (res - 1) - 0.5) * MAP_SIZE;
    for (let i = 0; i < res; i++) {
      const x = (i / (res - 1) - 0.5) * MAP_SIZE;
      data[j * res + i] = sampleHeight(x, z);
    }
  }
  return data;
}

// ── the navigation channel ────────────────────────────────────
/** Flattened Cumberland centreline with cumulative distance, for navigation. */
export const CHANNEL_PATH = (() => {
  const segs = CHANNEL.map((seg) => {
    const pts = seg.map(([x, z]) => ({ x, z }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    return { pts, cum, length: cum[cum.length - 1] };
  });
  segs.sort((a, b) => b.length - a.length);
  return segs;
})();

export const CHANNEL_LENGTH = CHANNEL_PATH.reduce((s, p) => s + p.length, 0);

/** Point a given distance along the main channel. */
export function channelPointAt(dist) {
  const seg = CHANNEL_PATH[0];
  if (!seg) return { x: 0, z: 0, tx: 0, tz: 1 };
  const d = ((dist % seg.length) + seg.length) % seg.length;
  let lo = 0, hi = seg.cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (seg.cum[mid] <= d) lo = mid; else hi = mid;
  }
  const a = seg.pts[lo], b = seg.pts[hi];
  const span = Math.max(seg.cum[hi] - seg.cum[lo], 1e-6);
  const t = (d - seg.cum[lo]) / span;
  const tx = (b.x - a.x) / span, tz = (b.z - a.z) / span;
  return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), tx, tz };
}

/** Squared distance from a point to the channel centreline (sampled). */
export function distanceToChannel(x, z) {
  let best = Infinity;
  for (const seg of CHANNEL_PATH) {
    for (let i = 0; i < seg.pts.length; i++) {
      const p = seg.pts[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/**
 * Distance ALONG the main channel to the point nearest (x,z). The channel
 * runs ~150 km from Carthage to below Nashville, so gameplay features (which
 * the player meets near the dock) must be placed relative to Hunters Point's
 * own station, not the river's far upstream end.
 */
export function nearestChannelDist(x, z) {
  const seg = CHANNEL_PATH[0];
  if (!seg) return 0;
  let bestD = 0, best = Infinity;
  for (let i = 0; i < seg.pts.length; i++) {
    const p = seg.pts[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) { best = d; bestD = seg.cum[i]; }
  }
  return bestD;
}

// ── Hunters Point ─────────────────────────────────────────────
// Spawn on the channel centreline beside the dock, NOT straight out from the
// ramp: the pier reaches ~60 m into a river only ~130 m wide, so a straight
// offset either lands on the slips or noses into the far bank. Mid-channel is
// clear deep water, and we face downstream — toward Nashville — so the default
// direction of travel is the fun one.
const _cd = nearestChannelDist(RAMP.dockX, RAMP.dockZ);
const _c = channelPointAt(_cd);
// Orient the channel tangent toward Nashville (downstream ≈ decreasing x).
const _flip = _c.tx > 0 ? -1 : 1;
const _tx = _c.tx * _flip, _tz = _c.tz * _flip;
const _spawnX = _c.x + _tx * 25;
const _spawnZ = _c.z + _tz * 25;
const _heading = Math.atan2(_tx, _tz);

export const HUNTERS_POINT = {
  name: 'Hunters Point Access Area',
  county: 'Wilson County, TN',
  shoreX: RAMP.shoreX,
  shoreZ: RAMP.shoreZ,
  dockX: _spawnX,
  dockZ: _spawnZ,
  /** Heading faces downstream toward Nashville. */
  heading: _heading,
  outX: Math.sin(RAMP.bearing),
  outZ: Math.cos(RAMP.bearing),
  yaw: RAMP.bearing,
  /** Distance along the channel to the dock, so features anchor here. */
  channelDist: _cd,
};

export { clamp, lerp, smoothstep };
