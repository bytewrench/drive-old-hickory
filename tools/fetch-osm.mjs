// Re-download the OpenStreetMap source data for the terrain build.
//
//   node tools/fetch-osm.mjs && node tools/build-terrain.mjs
//
// Map data © OpenStreetMap contributors, ODbL 1.0.
// Covers the whole Cumberland corridor from Hunters Point down to downtown
// Nashville, including bridges, the Old Hickory dam/lock, and marinas.

import fs from 'node:fs';

// Corridor bounding box: Gallatin loop (N) down past downtown Nashville (SW),
// comfortably larger than the ~56 km game map so nothing is clipped.
const BBOX = '35.98,-86.85,36.51,-86.19';

const QUERY = `[out:json][timeout:240];
(
  way["natural"="water"](${BBOX});
  relation["natural"="water"](${BBOX});
  way["waterway"~"^(river|stream|canal)$"](${BBOX});
  way["waterway"="dam"](${BBOX});
  way["waterway"="lock_gate"](${BBOX});
  way["leisure"="marina"](${BBOX});
  way["leisure"="slipway"](${BBOX});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["bridge"](${BBOX});
  way["man_made"="bridge"](${BBOX});
  way["highway"~"^(motorway|trunk|primary|secondary)$"](${BBOX});
);
out geom;`;

async function run() {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'DriveOldHickory/1.0 (offline game terrain build)',
    },
    body: `data=${encodeURIComponent(QUERY)}`,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.length < 1000) throw new Error(`suspiciously small response (${text.length} bytes)`);
  fs.mkdirSync('tools', { recursive: true });
  fs.writeFileSync('tools/osm-hp.json', text);
  console.log(`wrote tools/osm-hp.json (${(text.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log('now run: node tools/build-terrain.mjs');
}

// Overpass is a shared public resource and 504s under load — retry a few times.
let lastErr;
for (let attempt = 1; attempt <= 4; attempt++) {
  try { await run(); process.exit(0); }
  catch (e) {
    lastErr = e;
    console.warn(`attempt ${attempt} failed: ${e.message}${attempt < 4 ? ' — retrying in 20s' : ''}`);
    if (attempt < 4) await new Promise((r) => setTimeout(r, 20000));
  }
}
console.error(`giving up: ${lastErr.message}`);
process.exit(1);
