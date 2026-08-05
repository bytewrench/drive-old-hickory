// ──────────────────────────────────────────────────────────────
// Bake the real Cumberland River / Old Hickory Lake geometry around
// Hunters Point into a compact asset the game loads at boot.
//
//   node tools/build-terrain.mjs
//
// Output: src/world/cumberland-data.js
//   · WATER   – Uint8 water mask, RES x RES over the map square
//   · DIST    – signed distance to the shoreline, metres, Int16 (x4 fixed point)
//   · CHANNEL – Cumberland navigation centreline as local-metre polyline
//   · RAMP    – Hunters Point ramp position + the bearing out to open water
// ──────────────────────────────────────────────────────────────

import fs from 'node:fs';
import { buildElevationSampler } from './dem.mjs';

// Two reference points, deliberately separate:
//   ORIGIN — local (0,0), the map centre. Sat on the corridor midpoint so the
//            square fits Hunters Point, Old Hickory Dam AND downtown Nashville.
//   RAMP_LATLON — Hunters Point Access Area, the player's home dock, which now
//            sits toward the NE of the map rather than at its centre.
const ORIGIN = { lat: 36.2455, lon: -86.5200 };          // corridor midpoint
const RAMP_LATLON = { lat: 36.29922, lon: -86.26471 };   // Hunters Point

/** Map covers MAP_SIZE x MAP_SIZE metres, centred on ORIGIN. 1:1 scale. */
const MAP_SIZE = 56000;
const RES = 2048;                      // raster resolution (27.3 m / texel)
const DEM_ZOOM = 13;                   // terrarium tiles (~19 m native)

const M_PER_DEG_LAT = 111132.0;
const M_PER_DEG_LON = 111320.0 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const project = (lon, lat) => ({
  x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
  z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT,
});

const els = JSON.parse(fs.readFileSync('tools/osm-hp.json', 'utf8')).elements;
const near = (a, b) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;

// ── 1. collect every water polygon ────────────────────────────
function assembleRings(members) {
  const byRole = { outer: [], inner: [] };
  for (const m of members) {
    if (!m.geometry || m.geometry.length < 2) continue;
    byRole[m.role === 'inner' ? 'inner' : 'outer'].push(m.geometry.slice());
  }
  const rings = [];
  for (const role of ['outer', 'inner']) {
    const pool = byRole[role].slice();
    while (pool.length) {
      let cur = pool.shift();
      let joined = true;
      while (joined) {
        joined = false;
        const head = cur[0], tail = cur[cur.length - 1];
        if (near(head, tail) && cur.length > 3) break;
        for (let i = 0; i < pool.length; i++) {
          const p = pool[i];
          if (near(tail, p[0]))            { cur = cur.concat(p.slice(1)); pool.splice(i,1); joined = true; break; }
          if (near(tail, p[p.length - 1])) { cur = cur.concat(p.slice().reverse().slice(1)); pool.splice(i,1); joined = true; break; }
          if (near(head, p[p.length - 1])) { cur = p.slice(0,-1).concat(cur); pool.splice(i,1); joined = true; break; }
          if (near(head, p[0]))            { cur = p.slice().reverse().slice(0,-1).concat(cur); pool.splice(i,1); joined = true; break; }
        }
      }
      if (cur.length > 3) rings.push({ role, pts: cur });
    }
  }
  return rings;
}

const outers = [];   // water
const inners = [];   // islands

for (const e of els) {
  if (e.type === 'way' && e.tags?.natural === 'water' && e.geometry?.length > 3) {
    outers.push(e.geometry.map((p) => project(p.lon, p.lat)));
  }
  if (e.type === 'relation' && e.tags?.natural === 'water') {
    for (const r of assembleRings(e.members)) {
      (r.role === 'inner' ? inners : outers).push(r.pts.map((p) => project(p.lon, p.lat)));
    }
  }
}
console.log(`water polygons: ${outers.length} outer, ${inners.length} island`);

// ── 2. rasterise the water mask ───────────────────────────────
const CELL = MAP_SIZE / RES;
const HALF = MAP_SIZE / 2;
const water = new Uint8Array(RES * RES);

/** Scanline fill of one ring into `mask` with the given value. */
function fillPolygon(poly, mask, value) {
  let minZ = 1e9, maxZ = -1e9;
  for (const p of poly) { if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z; }
  const j0 = Math.max(0, Math.floor((minZ + HALF) / CELL));
  const j1 = Math.min(RES - 1, Math.ceil((maxZ + HALF) / CELL));

  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const zc = (j + 0.5) * CELL - HALF;
    xs.length = 0;
    for (let k = 0, n = poly.length; k < n; k++) {
      const a = poly[k], b = poly[(k + 1) % n];
      if ((a.z <= zc && b.z > zc) || (b.z <= zc && a.z > zc)) {
        xs.push(a.x + ((zc - a.z) / (b.z - a.z)) * (b.x - a.x));
      }
    }
    if (!xs.length) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let i0 = Math.max(0, Math.ceil((xs[k] + HALF) / CELL - 0.5));
      let i1 = Math.min(RES - 1, Math.floor((xs[k + 1] + HALF) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) mask[j * RES + i] = value;
    }
  }
}

for (const poly of outers) fillPolygon(poly, water, 1);
for (const poly of inners) fillPolygon(poly, water, 0);   // islands punch back out

let wet = 0;
for (let i = 0; i < water.length; i++) if (water[i]) wet++;
console.log(`water mask: ${(100 * wet / water.length).toFixed(1)}% of the map is navigable`);

// ── 3. signed distance to the shoreline (two-pass chamfer EDT) ─
function edt(binary, want) {
  // Distance in cells from every texel to the nearest texel where mask == want.
  const INF = 1e9;
  const d = new Float32Array(RES * RES).fill(INF);
  for (let i = 0; i < d.length; i++) if (binary[i] === want) d[i] = 0;

  const relax = (i, j, from, cost) => {
    const v = d[from] + cost;
    if (v < d[j * RES + i]) d[j * RES + i] = v;
  };
  const D1 = 1, D2 = Math.SQRT2;
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      if (i > 0) relax(i, j, j * RES + i - 1, D1);
      if (j > 0) relax(i, j, (j - 1) * RES + i, D1);
      if (i > 0 && j > 0) relax(i, j, (j - 1) * RES + i - 1, D2);
      if (i < RES - 1 && j > 0) relax(i, j, (j - 1) * RES + i + 1, D2);
    }
  }
  for (let j = RES - 1; j >= 0; j--) {
    for (let i = RES - 1; i >= 0; i--) {
      if (i < RES - 1) relax(i, j, j * RES + i + 1, D1);
      if (j < RES - 1) relax(i, j, (j + 1) * RES + i, D1);
      if (i < RES - 1 && j < RES - 1) relax(i, j, (j + 1) * RES + i + 1, D2);
      if (i > 0 && j < RES - 1) relax(i, j, (j + 1) * RES + i - 1, D2);
    }
  }
  return d;
}

const distToLand = edt(water, 0);   // cells from here to nearest dry texel
const distToWater = edt(water, 1);  // cells from here to nearest wet texel

// Signed: positive = metres out into open water, negative = metres inland.
const signed = new Int16Array(RES * RES);
for (let i = 0; i < signed.length; i++) {
  const m = water[i] ? distToLand[i] * CELL : -distToWater[i] * CELL;
  signed[i] = Math.max(-32000, Math.min(32000, Math.round(m * 4)));   // x4 fixed point
}

// ── 3b. real elevation ────────────────────────────────────────
// Terrarium tiles give ground elevation in metres above sea level. We
// re-datum them so that Old Hickory's pool surface reads as 0, taking the
// datum from the DEM itself over water rather than a book figure.
const unproject = (x, z) => ({
  lon: ORIGIN.lon + x / M_PER_DEG_LON,
  lat: ORIGIN.lat - z / M_PER_DEG_LAT,
});

const corner = (x, z) => unproject(x, z);
const c0 = corner(-HALF, -HALF), c1 = corner(HALF, HALF);
const elevation = await buildElevationSampler({
  west: Math.min(c0.lon, c1.lon) - 0.01,
  east: Math.max(c0.lon, c1.lon) + 0.01,
  north: Math.max(c0.lat, c1.lat) + 0.01,
  south: Math.min(c0.lat, c1.lat) - 0.01,
}, DEM_ZOOM);

const demRaw = new Float32Array(RES * RES);
for (let j = 0; j < RES; j++) {
  const z = (j + 0.5) * CELL - HALF;
  for (let i = 0; i < RES; i++) {
    const x = (i + 0.5) * CELL - HALF;
    const ll = unproject(x, z);
    demRaw[j * RES + i] = elevation(ll.lon, ll.lat);
  }
}

// Datum = median DEM height over open water (the reservoir surface).
const wetSamples = [];
for (let i = 0; i < water.length; i++) if (water[i]) wetSamples.push(demRaw[i]);
wetSamples.sort((a, b) => a - b);
const DATUM = wetSamples.length
  ? wetSamples[Math.floor(wetSamples.length / 2)]
  : 135.6;                                    // 445 ft, the published pool
console.log(`DEM datum (pool surface): ${DATUM.toFixed(1)} m above sea level`
  + `  [${wetSamples.length} wet samples]`);

let hi = -1e9, lo = 1e9;
const dem = new Int16Array(RES * RES);
for (let i = 0; i < dem.length; i++) {
  const h = demRaw[i] - DATUM;
  if (h > hi) hi = h;
  if (h < lo) lo = h;
  dem[i] = Math.max(-32000, Math.min(32000, Math.round(h * 8)));   // x8 fixed point
}
console.log(`land relief: ${lo.toFixed(1)} m to ${hi.toFixed(1)} m above pool`);

const inBounds = (p) => Math.abs(p.x) < HALF * 1.25 && Math.abs(p.z) < HALF * 1.25;

// ── 4. Cumberland navigation channel ──────────────────────────
// The river is dozens of OSM ways over 56 km; stitch them end-to-end into one
// ordered centreline so the game can navigate the whole reach, place buoys,
// and hang structures off it. (The old build used a single OSM way, which was
// only valid on the tiny 8 km map.)
const eps = 1.5;   // metres; endpoints this close are the same node
const key = (p) => `${Math.round(p.x / eps)}:${Math.round(p.z / eps)}`;

function stitch(ways) {
  const pool = ways
    .filter((w) => w.geometry?.length > 1)
    .map((w) => w.geometry.map((p) => project(p.lon, p.lat)));
  const paths = [];
  while (pool.length) {
    let cur = pool.shift();
    let joined = true;
    while (joined) {
      joined = false;
      const head = key(cur[0]), tail = key(cur[cur.length - 1]);
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const ph = key(p[0]), pt = key(p[p.length - 1]);
        if (tail === ph)      { cur = cur.concat(p.slice(1)); pool.splice(i, 1); joined = true; break; }
        if (tail === pt)      { cur = cur.concat(p.slice().reverse().slice(1)); pool.splice(i, 1); joined = true; break; }
        if (head === pt)      { cur = p.slice(0, -1).concat(cur); pool.splice(i, 1); joined = true; break; }
        if (head === ph)      { cur = p.slice().reverse().slice(0, -1).concat(cur); pool.splice(i, 1); joined = true; break; }
      }
    }
    paths.push(cur);
  }
  return paths;
}

/** Keep only the contiguous in-bounds runs of a polyline, preserving order. */
function clipRuns(path) {
  const runs = [];
  let run = [];
  for (const p of path) {
    if (inBounds(p)) run.push(p);
    else if (run.length > 2) { runs.push(run); run = []; }
    else run = [];
  }
  if (run.length > 2) runs.push(run);
  return runs;
}

const riverWays = els.filter(
  (e) => e.type === 'way' && e.tags?.waterway === 'river' && e.tags?.name === 'Cumberland River',
);
const channel = stitch(riverWays)
  .flatMap(clipRuns)
  .sort((a, b) => b.length - a.length);

const namedCreek = (n) => els.filter(
  (e) => e.type === 'way' && e.tags?.waterway === 'river' && e.tags?.name === n,
);
const tributaries = {};
for (const name of ['Spring Creek', 'Bledsoe Creek', 'Goose Creek', 'Rocky Creek',
  'Stones River', 'Drakes Creek', 'Mansker Creek']) {
  const segs = stitch(namedCreek(name)).flatMap(clipRuns).filter((s) => s.length > 2);
  if (segs.length) tributaries[name] = segs.sort((a, b) => b.length - a.length).slice(0, 2);
}

const segLen = (seg) => {
  let L = 0;
  for (let i = 1; i < seg.length; i++) L += Math.hypot(seg[i].x - seg[i - 1].x, seg[i].z - seg[i - 1].z);
  return L;
};
const chanLen = channel.reduce((s, seg) => s + segLen(seg), 0);
console.log(`Cumberland channel in map: ${channel.length} run(s), ${(chanLen / 1000).toFixed(2)} km`
  + ` (longest ${(segLen(channel[0]) / 1000).toFixed(2)} km)`);
console.log('tributaries in map:', Object.keys(tributaries).join(', ') || '(none)');

// ── 5. the Hunters Point ramp ─────────────────────────────────
// The ramp is NOT the map centre anymore — project its lat/lon, then walk to
// the nearest genuinely wet texel and out to ~60 m offshore.
const rampLocal = project(RAMP_LATLON.lon, RAMP_LATLON.lat);
function nearestWater(x, z) {
  let best = null, bestD = 1e9;
  const gi = Math.round((x + HALF) / CELL), gj = Math.round((z + HALF) / CELL);
  const span = Math.ceil(1500 / CELL);          // search within 1.5 km
  for (let dj = -span; dj <= span; dj++) {
    for (let di = -span; di <= span; di++) {
      const i = gi + di, j = gj + dj;
      if (i < 0 || j < 0 || i >= RES || j >= RES || !water[j * RES + i]) continue;
      const px = (i + 0.5) * CELL - HALF, pz = (j + 0.5) * CELL - HALF;
      const d = Math.hypot(px - x, pz - z);
      if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
    }
  }
  return best ? { ...best, dist: bestD } : { x, z, dist: 1e9 };
}
const w0 = nearestWater(rampLocal.x, rampLocal.z);
console.log(`Hunters Point local (${rampLocal.x.toFixed(0)}, ${rampLocal.z.toFixed(0)}); `
  + `nearest water ${w0.dist.toFixed(0)} m away`);

// Bearing from the ramp toward the channel, and a dock point ~60 m offshore.
const bear = Math.atan2(w0.x - rampLocal.x, w0.z - rampLocal.z);
let dockX = w0.x, dockZ = w0.z;
for (let t = 0; t < 400; t += 4) {
  const px = w0.x + Math.sin(bear) * t, pz = w0.z + Math.cos(bear) * t;
  const i = Math.floor((px + HALF) / CELL), j = Math.floor((pz + HALF) / CELL);
  if (i < 0 || j < 0 || i >= RES || j >= RES || !water[j * RES + i]) break;
  dockX = px; dockZ = pz;
  if (signed[j * RES + i] / 4 > 55) break;
}

// ── 6. roads ──────────────────────────────────────────────────
const roads = [];
for (const e of els) {
  if (e.type !== 'way' || !e.geometry) continue;
  const hw = e.tags?.highway;
  if (hw !== 'primary' && hw !== 'secondary' && hw !== 'trunk' && hw !== 'motorway') continue;
  if (e.tags?.bridge) continue;                  // bridges handled separately
  const pts = e.geometry.map((p) => project(p.lon, p.lat)).filter(inBounds);
  if (pts.length > 2) roads.push({ name: e.tags?.name ?? '', ref: e.tags?.ref ?? '', pts });
}
roads.sort((a, b) => b.pts.length - a.pts.length);
roads.length = Math.min(roads.length, 40);
console.log(`roads kept: ${roads.length}`);

// ── 6b. bridges, the dam, marinas ─────────────────────────────
// A bridge is worth rendering only where it actually spans water — otherwise
// it is just a road over a creek. Test each bridge way's midpoint.
const wetAt = (x, z) => {
  const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
  return i >= 0 && j >= 0 && i < RES && j < RES && water[j * RES + i] === 1;
};

const bridges = [];
for (const e of els) {
  if (e.type !== 'way' || !e.geometry) continue;
  const isBridge = e.tags?.bridge || e.tags?.man_made === 'bridge';
  if (!isBridge) continue;
  const pts = e.geometry.map((p) => project(p.lon, p.lat));
  if (pts.length < 2) continue;
  const mid = pts[Math.floor(pts.length / 2)];
  if (!inBounds(mid)) continue;
  // Only keep bridges that cross open water somewhere along their length.
  // Most bridge ways are just two nodes (one per bank) with the water in
  // between, so sample ALONG each segment (~12 m steps) rather than only the
  // nodes — otherwise every river bridge looks dry and gets dropped.
  let spansWater = false;
  for (let i = 1; i < pts.length && !spansWater; i++) {
    const a = pts[i - 1], b = pts[i];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(segLen / 12));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (wetAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) { spansWater = true; break; }
    }
  }
  if (!spansWater) continue;
  bridges.push({
    name: e.tags?.name || e.tags?.ref || '',
    ref: e.tags?.ref || '',
    hw: e.tags?.highway || '',
    layer: +(e.tags?.layer || 1),
    pts: pts.filter((p) => Math.abs(p.x) < HALF && Math.abs(p.z) < HALF),
  });
}
// Deduplicate near-identical parallel carriageways (same name, close midpoint).
const bridgeSeen = new Set();
const bridgesUniq = [];
for (const b of bridges.sort((a, z) => z.pts.length - a.pts.length)) {
  if (b.pts.length < 2) continue;
  const m = b.pts[Math.floor(b.pts.length / 2)];
  const k = `${b.name}|${Math.round(m.x / 120)}|${Math.round(m.z / 120)}`;
  if (bridgeSeen.has(k)) continue;
  bridgeSeen.add(k);
  bridgesUniq.push(b);
}
console.log(`bridges over water: ${bridgesUniq.length}`);
console.log('  ' + bridgesUniq.slice(0, 12).map((b) => b.name || b.hw || '?').join(', '));

const dams = [];
for (const e of els) {
  if (e.type !== 'way' || e.tags?.waterway !== 'dam' || !e.geometry) continue;
  const pts = e.geometry.map((p) => project(p.lon, p.lat)).filter(inBounds);
  if (pts.length > 1) dams.push({ name: e.tags?.name || 'Dam', pts });
}
console.log(`dams: ${dams.length}`, dams.map((d) => d.name).join(', '));

const marinas = [];
for (const e of els) {
  if (e.type !== 'way' || e.tags?.leisure !== 'marina' || !e.geometry) continue;
  const pts = e.geometry.map((p) => project(p.lon, p.lat));
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p.x; cz += p.z; }
  cx /= pts.length; cz /= pts.length;
  if (Math.abs(cx) < HALF && Math.abs(cz) < HALF) {
    marinas.push({ name: e.tags?.name || 'Marina', x: cx, z: cz });
  }
}
console.log(`marinas: ${marinas.length}`);

// ── 7. emit ───────────────────────────────────────────────────
// The raster goes to public/ as a raw binary rather than base64 in the
// bundle: it is ~1 MB, it compresses well over HTTP, and keeping it out of
// the JS keeps the bundle parse fast.
const round = (segs, dp = 1) =>
  segs.map((s) => s.map((p) => [+p.x.toFixed(dp), +p.z.toFixed(dp)]));

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/cumberland-sdf.bin', Buffer.from(signed.buffer));
console.log(`wrote public/cumberland-sdf.bin (${(signed.byteLength / 1024).toFixed(0)} KB)`);
fs.writeFileSync('public/cumberland-dem.bin', Buffer.from(dem.buffer));
console.log(`wrote public/cumberland-dem.bin (${(dem.byteLength / 1024).toFixed(0)} KB)`);

const out = `// GENERATED by tools/build-terrain.mjs — do not edit by hand.
// Regenerate with:  node tools/build-terrain.mjs
//
// Real geometry of the Cumberland River / Old Hickory Lake around the
// Hunters Point Access Area, Wilson County TN (${ORIGIN.lat}, ${ORIGIN.lon}),
// projected to local metres at 1:1 scale. +x east, +z south.
//
// Map data © OpenStreetMap contributors, ODbL 1.0
// https://www.openstreetmap.org/copyright

export const MAP_SIZE = ${MAP_SIZE};
export const SDF_RES = ${RES};
export const SDF_CELL = ${CELL};
export const SDF_URL = 'cumberland-sdf.bin';
export const SDF_SCALE = 4;              // stored metres x4 in Int16

/** Real ground elevation, metres above the reservoir pool, x8 in Int16. */
export const DEM_URL = 'cumberland-dem.bin';
export const DEM_SCALE = 8;
export const DEM_DATUM_MSL = ${DATUM.toFixed(2)};   // pool surface, m above sea level

export const ORIGIN = ${JSON.stringify(ORIGIN)};

/** Cumberland River navigation centreline, [[x,z], ...] per segment. */
export const CHANNEL = ${JSON.stringify(round(channel))};

/** Named feeder creeks worth exploring. */
export const TRIBUTARIES = ${JSON.stringify(
  Object.fromEntries(Object.entries(tributaries).map(([k, v]) => [k, round(v)])),
)};

/** Major roads, for laying asphalt along the real alignments. */
export const ROADS = ${JSON.stringify(
  roads.slice(0, 24).map((r) => ({ name: r.name, ref: r.ref, pts: round([r.pts])[0] })),
)};

/** Real bridges that span open water — rendered as elevated overpasses. */
export const BRIDGES = ${JSON.stringify(
  bridgesUniq.map((b) => ({
    name: b.name, ref: b.ref, hw: b.hw, layer: b.layer, pts: round([b.pts])[0],
  })),
)};

/** Dams (Old Hickory Lock & Dam), as barrier polylines. */
export const DAMS = ${JSON.stringify(dams.map((d) => ({ name: d.name, pts: round([d.pts])[0] })))};

/** Marina locations, for a labelled marker + a cluster of slips. */
export const MARINAS = ${JSON.stringify(
  marinas.map((m) => ({ name: m.name, x: +m.x.toFixed(1), z: +m.z.toFixed(1) })),
)};

/** Hunters Point launch: the water in front of the ramp, and the way out. */
export const RAMP = {
  shoreX: ${w0.x.toFixed(1)}, shoreZ: ${w0.z.toFixed(1)},
  dockX: ${dockX.toFixed(1)}, dockZ: ${dockZ.toFixed(1)},
  bearing: ${bear.toFixed(5)},
};
`;

fs.writeFileSync('src/world/cumberland-data.js', out);
console.log(`wrote src/world/cumberland-data.js (${(out.length / 1024).toFixed(0)} KB)`);
