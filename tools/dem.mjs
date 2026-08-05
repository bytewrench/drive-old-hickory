// ──────────────────────────────────────────────────────────────
// Real elevation, from the AWS "terrarium" terrain tiles (SRTM/NED
// derived, free, no key). Tiles are cached on disk so a rebuild is
// offline after the first run.
//
// Terrarium encoding:  elevation_m = (R * 256 + G + B / 256) - 32768
// ──────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const CACHE = 'tools/dem-cache';
const BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';

/** lon/lat -> fractional Web-Mercator pixel coords at a zoom level. */
export function lonLatToPixel(lon, lat, z) {
  const n = 2 ** z * 256;
  const latRad = (lat * Math.PI) / 180;
  return {
    px: ((lon + 180) / 360) * n,
    py: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

async function fetchTile(z, x, y) {
  const file = path.join(CACHE, `${z}_${x}_${y}.png`);
  if (fs.existsSync(file)) return fs.readFileSync(file);

  const url = `${BASE}/${z}/${x}/${y}.png`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, buf);
  return buf;
}

/**
 * Download every tile covering the lat/lon box and return a sampler.
 * @returns {(lon:number, lat:number) => number} bilinear elevation in metres
 */
export async function buildElevationSampler(bounds, z = 14) {
  const a = lonLatToPixel(bounds.west, bounds.north, z);
  const b = lonLatToPixel(bounds.east, bounds.south, z);

  const tx0 = Math.floor(a.px / 256), tx1 = Math.floor(b.px / 256);
  const ty0 = Math.floor(a.py / 256), ty1 = Math.floor(b.py / 256);
  const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;

  const W = cols * 256, H = rows * 256;
  const grid = new Float32Array(W * H);
  let fetched = 0, cached = 0;

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const file = path.join(CACHE, `${z}_${tx}_${ty}.png`);
      const wasCached = fs.existsSync(file);
      const raw = await fetchTile(z, tx, ty);
      wasCached ? cached++ : fetched++;

      const png = PNG.sync.read(raw);
      const ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
      for (let j = 0; j < 256; j++) {
        for (let i = 0; i < 256; i++) {
          const k = (j * png.width + i) * 4;
          const e = png.data[k] * 256 + png.data[k + 1] + png.data[k + 2] / 256 - 32768;
          grid[(oy + j) * W + (ox + i)] = e;
        }
      }
    }
  }
  console.log(`DEM: ${cols}x${rows} tiles at z${z} (${fetched} downloaded, ${cached} cached)`);

  const originPx = tx0 * 256, originPy = ty0 * 256;

  return (lon, lat) => {
    const p = lonLatToPixel(lon, lat, z);
    const fx = p.px - originPx, fy = p.py - originPy;
    const i0 = Math.floor(fx), j0 = Math.floor(fy);
    const tx = fx - i0, tyf = fy - j0;
    const cx = (v, m) => (v < 0 ? 0 : v > m ? m : v);
    const ia = cx(i0, W - 1), ib = cx(i0 + 1, W - 1);
    const ja = cx(j0, H - 1), jb = cx(j0 + 1, H - 1);
    const e00 = grid[ja * W + ia], e10 = grid[ja * W + ib];
    const e01 = grid[jb * W + ia], e11 = grid[jb * W + ib];
    return (e00 * (1 - tx) + e10 * tx) * (1 - tyf) + (e01 * (1 - tx) + e11 * tx) * tyf;
  };
}
