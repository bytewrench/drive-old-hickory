/**
 * hullGeometry.js
 * ---------------------------------------------------------------------------
 * Parametric boat hulls as real lofted surfaces.
 *
 * The catalog used to build every hull from a BoxGeometry with a triangular
 * prism stuck on the bow. That can never read as a boat, because the things
 * that make a hull recognisable are all curves a box has no way to express:
 *
 *   sheer    the deck edge sweeping up toward the bow
 *   flare    topsides widening above the waterline to throw spray
 *   deadrise the V of the bottom, sharp forward and flattening aft
 *   rocker   the keel lifting at the forefoot so the stem clears the water
 *   entry    the waterline tapering to a point at the stem
 *
 * All five are parameters here. A hull is a loft: a series of stations along Z
 * (stern -> bow), each a cross-section curve from keel to sheer, skinned into
 * one surface and capped at the transom and deck.
 *
 * Convention matches the vessel catalog: metres, Y up, +Z forward (bow),
 * +X starboard, origin at the hull centre on the static waterline.
 */

/**
 * Cross-section shape. A superellipse quadrant swept from keel to sheer:
 *
 *   (x/B)^n + (y'/D)^n = 1
 *
 * where y' is measured DOWN from the sheer. The exponent is the whole trick:
 *   n ~ 1.3  fine V section  (bow, hydrofoil needles)
 *   n = 2    round bilge     (displacement hulls, tugs)
 *   n ~ 6    hard chine      (planing powerboats, flat-bottom pans)
 * Interpolating n from bow to stern is what gives a real planing hull its
 * "sharp forward, flat aft" character in a single continuous surface.
 */
function sectionPoint(u, halfBeam, keelY, sheerY, n, flare) {
  const th = u * Math.PI * 0.5;
  const e = 2 / n;
  const s = Math.sin(th);
  const c = Math.cos(th);
  // pow() of an exact 0 base is a NaN risk on some drivers; clamp both away.
  let x = halfBeam * Math.pow(Math.max(s, 1e-5), e);
  const down = Math.pow(Math.max(c, 1e-5), e);
  // Flare widens the topsides only — it must vanish at the keel or the boat
  // gets a bulge along its bottom instead of above the waterline.
  x *= 1 + flare * u * u * u;
  return { x, y: keelY + (sheerY - keelY) * (1 - down) };
}

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * Phones get a coarser loft. The silhouette — which is the whole point of
 * lofting instead of using a box — survives the reduction; only the shading
 * facets get chunkier, which suits the art direction anyway.
 */
const LOFT_SCALE = /Mobi|Android|iPhone|iPad|iPod/i.test(
  typeof navigator === 'undefined' ? '' : navigator.userAgent,
) ? 0.6 : 1;

export function makeHull(THREE, opts = {}) {
  const {
    len = 4.0,          // overall length, along Z
    beam = 2.0,         // maximum width
    draft = 0.42,       // keel depth below the waterline at midship
    freeboard = 0.46,   // sheer height above the waterline at midship
    stations: _stations = 26,   // longitudinal resolution
    ribs: _ribs = 9,            // points per half-section, keel -> sheer
    sectionAft = 5.0,   // chine hardness at the transom
    sectionFwd = 1.45,  // section fineness at the stem
    flare = 0.20,
    sheer = 0.42,       // deck-edge rise toward the bow, as a fraction of freeboard
    sheerAft = 0.10,
    rocker = 0.92,      // how much the keel lifts at the forefoot (0..1)
    rockerAft = 0.06,
    transom = 0.74,     // transom width as a fraction of max beam
    entry = 1.85,       // waterline taper exponent forward — higher = finer bow
    beamPeak = 0.56,    // where max beam sits, 0 = transom, 1 = stem
    deckCamber = 0.05,
    deck = true,
  } = opts;

  const stations = Math.max(8, Math.round(_stations * LOFT_SCALE));
  const ribs = Math.max(4, Math.round(_ribs * LOFT_SCALE));

  const halfBeamMax = beam * 0.5;

  // ── longitudinal curves, t = 0 at the transom, 1 at the stem ──
  const widthAt = (t) => {
    const w = t <= beamPeak
      ? transom + (1 - transom) * smooth(t / beamPeak)
      : Math.pow(1 - (t - beamPeak) / (1 - beamPeak), entry);
    return Math.max(w, 0.012) * halfBeamMax;   // never fully degenerate
  };

  const keelAt = (t) => {
    const fwd = Math.pow(clamp01((t - 0.42) / 0.58), 1.7);
    const aft = Math.pow(clamp01((0.35 - t) / 0.35), 2);
    return -draft * (1 - rocker * fwd - rockerAft * aft);
  };

  const sheerAt = (t) => {
    const fwd = Math.pow(clamp01((t - 0.30) / 0.70), 1.8);
    const aft = Math.pow(clamp01((0.30 - t) / 0.30), 2);
    return freeboard * (1 + sheer * fwd + sheerAft * aft);
  };

  const sectionAt = (t) => sectionAft + (sectionFwd - sectionAft) * smooth(clamp01(t));

  const pos = [];
  const idx = [];
  const ring = ribs * 2;             // starboard sheer -> keel -> port sheer
  const vertsPerStation = ring + 1;

  // ── skin ──────────────────────────────────────────────────────
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const z = (t - 0.5) * len;
    const B = widthAt(t);
    const kY = keelAt(t);
    const sY = sheerAt(t);
    const n = sectionAt(t);

    for (let j = 0; j <= ring; j++) {
      // j runs STARBOARD sheer -> keel -> PORT sheer. That direction (rather
      // than the reverse) is what makes the triangle winding below produce
      // outward-facing normals.
      const side = j <= ribs ? 1 : -1;
      const u = j <= ribs ? 1 - j / ribs : (j - ribs) / ribs;
      const p = sectionPoint(u, B, kY, sY, n, flare);
      pos.push(p.x * side, p.y, z);
    }
  }

  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < ring; j++) {
      const a = i * vertsPerStation + j;
      const b = (i + 1) * vertsPerStation + j;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }

  // ── transom cap: fan the stern section to its own centre ──────
  {
    const t = 0, z = -len / 2;
    const B = widthAt(t), kY = keelAt(t), sY = sheerAt(t), n = sectionAt(t);
    const centre = pos.length / 3;
    pos.push(0, (kY + sY) * 0.5, z);
    const first = pos.length / 3;
    for (let j = 0; j <= ring; j++) {
      const side = j <= ribs ? 1 : -1;
      const u = j <= ribs ? 1 - j / ribs : (j - ribs) / ribs;
      const p = sectionPoint(u, B, kY, sY, n, flare);
      pos.push(p.x * side, p.y, z);
    }
    // Wound the opposite way from the skin — the transom faces -Z.
    for (let j = 0; j < ring; j++) idx.push(centre, first + j + 1, first + j);
  }

  // ── deck: a cambered surface closing the top ──────────────────
  if (deck) {
    const K = ribs * 2;
    const base = pos.length / 3;
    for (let i = 0; i <= stations; i++) {
      const t = i / stations;
      const z = (t - 0.5) * len;
      const B = widthAt(t) * (1 + flare);   // meet the flared sheer edge exactly
      const sY = sheerAt(t);
      for (let k = 0; k <= K; k++) {
        const f = k / K;                    // 0 = port, 1 = starboard
        const x = (f * 2 - 1) * B;
        // Crown the deck so water runs off — and so it catches a highlight
        // instead of reading as a flat lid.
        const crown = deckCamber * B * (1 - Math.pow(f * 2 - 1, 2));
        pos.push(x, sY + crown, z);
      }
    }
    for (let i = 0; i < stations; i++) {
      for (let k = 0; k < K; k++) {
        const a = base + i * (K + 1) + k;
        const b = base + (i + 1) * (K + 1) + k;
        idx.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A slab with a rounded leading edge and a tapered trailing edge — for foils,
 * wings, rudders and fins. The catalog rendered these as 0.10 m boxes, which is
 * the single most obviously-wrong part on the hydrofoil.
 */
export function makeFoil(THREE, {
  span = 2.4,
  chord = 0.46,
  thickness = 0.12,
  segments = 14,
  taper = 0.62,      // tip chord as a fraction of root chord
  sweep = 0.10,      // tip trailing-edge offset
  sections = 10,
} = {}) {
  const pos = [];
  const idx = [];
  const per = sections * 2;

  for (let i = 0; i <= segments; i++) {
    const f = i / segments;              // 0 = port tip, 1 = starboard tip
    const s = Math.abs(f * 2 - 1);       // 0 at root, 1 at tip
    const c = chord * (1 - (1 - taper) * s);
    const th = thickness * (1 - 0.75 * s);
    const x = (f * 2 - 1) * span * 0.5;
    const zOff = sweep * s * chord;

    for (let j = 0; j < per; j++) {
      // NACA-ish symmetric section walked over the top then back under.
      const a = (j / per) * Math.PI * 2;
      const u = (1 - Math.cos(a)) * 0.5;                       // cosine spacing
      const yt = 5 * th * (0.2969 * Math.sqrt(Math.max(u, 0)) - 0.126 * u
        - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u ** 4);
      pos.push(x, (a < Math.PI ? yt : -yt), (u - 0.5) * c + zOff);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < per; j++) {
      const j2 = (j + 1) % per;
      const a = i * per + j, b = (i + 1) * per + j;
      const a2 = i * per + j2, b2 = (i + 1) * per + j2;
      idx.push(a, b, b2, a, b2, a2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A proper propeller: hub plus twisted, tapered blades. Replaces the flat
 * cylinder disc the catalog used, which read as a coin rather than a screw.
 */
export function makeProp(THREE, { radius = 0.24, blades = 4, hub = 0.06, pitch = 0.55 } = {}) {
  const pos = [];
  const idx = [];
  const STEPS = 8;

  // hub
  const hubSteps = 10;
  const hubBase = 0;
  for (let i = 0; i <= 1; i++) {
    for (let k = 0; k < hubSteps; k++) {
      const a = (k / hubSteps) * Math.PI * 2;
      pos.push(Math.cos(a) * hub, Math.sin(a) * hub, (i - 0.5) * hub * 1.6);
    }
  }
  for (let k = 0; k < hubSteps; k++) {
    const k2 = (k + 1) % hubSteps;
    idx.push(hubBase + k, hubBase + hubSteps + k, hubBase + hubSteps + k2);
    idx.push(hubBase + k, hubBase + hubSteps + k2, hubBase + k2);
  }

  for (let b = 0; b < blades; b++) {
    const rot = (b / blades) * Math.PI * 2;
    const base = pos.length / 3;
    for (let i = 0; i <= STEPS; i++) {
      const f = i / STEPS;
      const r = hub + (radius - hub) * f;
      // Blade width peaks mid-span and the twist washes out toward the tip.
      const w = radius * 0.42 * Math.sin(Math.PI * Math.min(1, f * 1.15 + 0.08));
      const tw = pitch * (1 - f * 0.45);
      for (const sgn of [-1, 1]) {
        const lx = r, lz = sgn * w;
        const y = lz * tw;
        pos.push(
          Math.cos(rot) * lx - Math.sin(rot) * y,
          Math.sin(rot) * lx + Math.cos(rot) * y,
          lz * 0.35,
        );
      }
    }
    for (let i = 0; i < STEPS; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
