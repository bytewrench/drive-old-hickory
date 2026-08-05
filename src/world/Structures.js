// ──────────────────────────────────────────────────────────────
// Fixed river furniture: bridges, spillway ramps, a dam, jump
// ramps on land, and the working lock gates.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from '../core/Physics.js';
import { game } from '../game.js';
import { HALF_MAP, WATER_LEVEL } from '../config.js';
import {
  sampleHeight, isWaterAt, shoreDistance, HUNTERS_POINT,
  channelPointAt, CHANNEL_LENGTH, ROADS, BRIDGES, DAMS, MARINAS,
} from './heightfield.js';

const CONCRETE = new THREE.MeshStandardMaterial({ color: '#b9b3aa', flatShading: true, roughness: 0.95 });
const DECK = new THREE.MeshStandardMaterial({ color: '#8d8378', flatShading: true, roughness: 0.9 });
const PAINT = new THREE.MeshStandardMaterial({
  color: '#ff5d73', flatShading: true, roughness: 0.6,
  emissive: new THREE.Color('#ff1744'), emissiveIntensity: 0.15,
});
const RAMP_MAT = new THREE.MeshStandardMaterial({
  color: '#ffd166', flatShading: true, roughness: 0.7,
  emissive: new THREE.Color('#ff9f1c'), emissiveIntensity: 0.15,
});
const GATE_MAT = new THREE.MeshStandardMaterial({
  color: '#3fa7a0', flatShading: true, roughness: 0.55, metalness: 0.35,
  emissive: new THREE.Color('#00e5ff'), emissiveIntensity: 0.25,
});
const TIMBER = new THREE.MeshStandardMaterial({ color: '#c9a678', flatShading: true, roughness: 0.9 });
const PILING = new THREE.MeshStandardMaterial({ color: '#5d4a37', flatShading: true, roughness: 0.95 });
const ASPHALT = new THREE.MeshStandardMaterial({ color: '#3c3f44', flatShading: true, roughness: 1.0 });
const LINE_MAT = new THREE.MeshBasicMaterial({ color: '#f4e9c8' });
const ROOF = new THREE.MeshStandardMaterial({
  color: '#2f8f7a', flatShading: true, roughness: 0.6, metalness: 0.3,
  emissive: new THREE.Color('#00e5ff'), emissiveIntensity: 0.12,
});

/** Canvas-drawn sign face — cheaper and sharper than modelling letters. */
function signTexture(lines, bg, fg, accent) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = accent;
  x.lineWidth = 18;
  x.strokeRect(24, 24, c.width - 48, c.height - 48);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const step = c.height / (lines.length + 1);
  lines.forEach((line, i) => {
    x.font = `900 ${Math.round(step * (line.big ? 0.92 : 0.5))}px "Trebuchet MS", sans-serif`;
    x.fillStyle = line.color || fg;
    x.fillText(line.text, c.width / 2, step * (i + 1));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Vertical centre of a lock gate leaf (half-height 6.5 → spans −6 … +7). */
const GATE_Y = 0.5;

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export class Structures {
  constructor(physics, scene) {
    this.physics = physics;
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.locks = [];
    this.emissiveMats = [PAINT, RAMP_MAT, GATE_MAT];
    /** material -> array of transformed geometries, merged in _finalizeBatches. */
    this._batches = new Map();

    // Fictional gameplay furniture is anchored to Hunters Point's own station
    // on the 150 km channel, not the river's far upstream end.
    const hp = HUNTERS_POINT.channelDist;

    this._buildHuntersPoint();
    this._buildRoads();
    this._buildBridges();
    this._buildDams();
    this._buildMarinas();
    this._buildSpillway(hp + 2600);
    this._buildLock(hp - 3200);
    this._buildLandRamps();
    this._buildRiverRamps();

    this._finalizeBatches();
  }

  // ── helpers ─────────────────────────────────────────────────
  /**
   * Static box: a fixed collider plus render geometry BATCHED by material.
   * On the 56 km map the corridor holds ~5,000 slabs; as individual meshes the
   * per-frame scene traversal alone cost ~70 ms. Batching every slab of a
   * given material into one merged mesh at finalize collapses that to ~10
   * draw-list objects. Colliders are still created per-slab (Rapier needs them).
   */
  slab(cx, cy, cz, hx, hy, hz, yaw = 0, pitch = 0, material = CONCRETE) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    this._pushBatch(material, cx, cy, cz, hx * 2, hy * 2, hz * 2, q);

    const world = this.physics.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(cx, cy, cz)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    const col = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9).setRestitution(0.1),
      body,
    );
    this.physics.register(col, { kind: 'structure' });
    return { body, collider: col };
  }

  /** Queue a unit-box instance, transformed, into this material's batch. */
  _pushBatch(material, cx, cy, cz, sx, sy, sz, q) {
    let arr = this._batches.get(material);
    if (!arr) { arr = []; this._batches.set(material, arr); }
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(sx, sy, sz),
    );
    const g = BOX.clone();
    g.applyMatrix4(m);
    arr.push(g);
  }

  /** Merge every batch into one mesh per material — call after all builders. */
  _finalizeBatches() {
    for (const [material, geos] of this._batches) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;   // spans the map; a few big static meshes
      this.group.add(mesh);
    }
    this._batches.clear();
  }

  /**
   * Mesh-only decoration — no collider. Untextured boxes (road lines) are
   * batched like slabs; uniquely-textured decos (signs) stay individual, but
   * there are only a few dozen of those.
   */
  deco(geo, material, pos, scale, rot) {
    if (geo === BOX && material.map == null) {
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rot?.[0] || 0, rot?.[1] || 0, rot?.[2] || 0));
      this._pushBatch(material, pos[0], pos[1], pos[2], scale[0], scale[1], scale[2], q);
      return null;
    }
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos);
    m.scale.set(...scale);
    if (rot) m.rotation.set(...rot);
    m.castShadow = false;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  /** Yaw that makes +z point downstream at a distance along the channel. */
  channelYaw(dist) {
    const c = channelPointAt(dist);
    return Math.atan2(c.tx, c.tz);
  }

  /**
   * Half-width of navigable water at a channel station, measured by walking
   * out to each bank through the real shoreline field.
   */
  channelHalfWidth(c, max = 260) {
    let best = 12;
    for (const side of [-1, 1]) {
      let w = 0;
      for (let step = 6; step < max; step += 6) {
        if (shoreDistance(c.x - c.tz * step * side, c.z + c.tx * step * side) < 2) break;
        w = step;
      }
      best = Math.max(best, w);
    }
    return best;
  }

  // ── Hunters Point Boat Dock ─────────────────────────────────
  /**
   * The player's home ramp: a launch ramp, a main pier on pilings with finger
   * slips, a covered boathouse, a parking lot and HWY 231 N running inland.
   * Everything is laid out along HUNTERS_POINT's shore-to-water axis, so it
   * stays put if the terrain function is ever retuned.
   */
  _buildHuntersPoint() {
    const HP = HUNTERS_POINT;
    const yaw = HP.yaw;                       // local +z points out over water
    const ox = HP.outX, oz = HP.outZ;         // outward (toward open water)
    const sx = Math.cos(yaw), sz = -Math.sin(yaw);   // sideways across the dock

    const at = (out, side) => ({
      x: HP.shoreX + ox * out + sx * side,
      z: HP.shoreZ + oz * out + sz * side,
    });

    // ── launch ramp: sloping from the lot down under the waterline ──
    const rampTop = at(-16, 0), rampBot = at(10, 0);
    const topY = Math.max(sampleHeight(rampTop.x, rampTop.z), WATER_LEVEL + 1.4);
    const botY = WATER_LEVEL - 2.2;
    this.slab(
      (rampTop.x + rampBot.x) / 2, (topY + botY) / 2, (rampTop.z + rampBot.z) / 2,
      7, 0.5, 14.5, yaw, -Math.atan2(botY - topY, 26) * -1, CONCRETE,
    );
    // Ramp edge stripes.
    for (const s of [-7.2, 7.2]) {
      const a = at(-16, s), b = at(10, s);
      this.deco(BOX, LINE_MAT,
        [(a.x + b.x) / 2, (topY + botY) / 2 + 0.3, (a.z + b.z) / 2],
        [0.35, 0.1, 28], [-Math.atan2(botY - topY, 26) * -1, yaw, 0]);
    }

    // ── main pier ──
    const deckY = WATER_LEVEL + 1.9;
    const pierLen = 52;
    const pierMid = at(6 + pierLen / 2, -13);
    this.slab(pierMid.x, deckY, pierMid.z, 2.6, 0.35, pierLen / 2, yaw, 0, TIMBER);

    // Pilings down to the lake bed.
    for (let d = 0; d <= pierLen; d += 8) {
      for (const s of [-15.4, -10.6]) {
        const p = at(6 + d, s);
        const bed = sampleHeight(p.x, p.z);
        const h = (deckY - bed) / 2;
        if (h < 0.4) continue;
        this.slab(p.x, bed + h, p.z, 0.32, h, 0.32, yaw, 0, PILING);
      }
    }

    // ── finger piers / slips ──
    for (let i = 0; i < 6; i++) {
      const out = 12 + i * 8;
      const f = at(out, -13 + 8.5);
      this.slab(f.x, deckY, f.z, 5.5, 0.32, 1.1, yaw, 0, TIMBER);
      const p = at(out, -13 + 14);
      const bed = sampleHeight(p.x, p.z);
      const h = (deckY - bed) / 2;
      if (h > 0.4) this.slab(p.x, bed + h, p.z, 0.28, h, 0.28, yaw, 0, PILING);
    }

    // ── covered boathouse over the inner slips ──
    const houseMid = at(20, -6);
    this.slab(houseMid.x, deckY + 5.2, houseMid.z, 9, 0.3, 11, yaw, 0, ROOF);
    for (const [o, s] of [[10, -14.5], [10, 2.5], [30, -14.5], [30, 2.5]]) {
      const p = at(o, s);
      this.slab(p.x, deckY + 2.6, p.z, 0.3, 2.6, 0.3, yaw, 0, TIMBER);
    }

    // ── parking lot ──
    const lot = at(-42, 4);
    const lotY = Math.max(sampleHeight(lot.x, lot.z), WATER_LEVEL + 1.6);
    this.slab(lot.x, lotY, lot.z, 22, 0.4, 15, yaw, 0, ASPHALT);
    for (let i = -4; i <= 4; i++) {
      const p = at(-42 + i * 4, 4);
      this.deco(BOX, LINE_MAT, [p.x, lotY + 0.42, p.z], [0.3, 0.08, 11], [0, yaw, 0]);
    }

    // ── signage ──
    const dockSign = signTexture(
      [{ text: 'HUNTERS POINT', big: true }, { text: 'BOAT DOCK' },
       { text: 'WILSON COUNTY, TN', color: '#ffd166' }],
      '#123a5c', '#ffffff', '#ffd166',
    );
    const sp = at(-22, -14);
    const spY = Math.max(sampleHeight(sp.x, sp.z), WATER_LEVEL + 1.5);
    for (const s of [-3.4, 3.4]) {
      const q = at(-22, -14 + s);
      this.slab(q.x, spY + 2.2, q.z, 0.28, 2.4, 0.28, yaw, 0, TIMBER);
    }
    this.slab(sp.x, spY + 5.4, sp.z, 0.3, 1.9, 4.4, yaw, 0, CONCRETE);
    this.deco(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: dockSign, toneMapped: false }),
      [sp.x + ox * -0.35, spY + 5.4, sp.z + oz * -0.35],
      [8.6, 3.7, 1], [0, yaw + Math.PI / 2, 0],
    );

    // Route shield beside the lot — US 231 itself is laid from the real
    // OSM alignment in _buildRoads().
    const shield = signTexture(
      [{ text: 'TENNESSEE', color: '#dbe4ea' }, { text: '231', big: true }, { text: 'NORTH', color: '#dbe4ea' }],
      '#1d2a35', '#ffffff', '#dbe4ea',
    );
    const shp = at(-58, -16);
    const shy = Math.max(sampleHeight(shp.x, shp.z), WATER_LEVEL + 1.2);
    this.slab(shp.x, shy + 2.6, shp.z, 0.24, 2.8, 0.24, yaw, 0, TIMBER);
    this.deco(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shield, toneMapped: false, side: THREE.DoubleSide }),
      [shp.x, shy + 6.2, shp.z], [4.4, 4.0, 1], [0, yaw + Math.PI / 2, 0],
    );
  }

  // ── road crossings ──────────────────────────────────────────
  /**
   * Lay the real US 231 alignment as drivable asphalt, and wherever it runs
   * over water, carry it on a bridge deck with piers down to the river bed.
   */
  _buildRoads() {
    let bridges = 0;
    for (const road of ROADS) {
      const pts = road.pts;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1][0], az = pts[i - 1][1];
        const bx = pts[i][0], bz = pts[i][1];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 1) continue;
        if (Math.max(Math.abs(ax), Math.abs(az), Math.abs(bx), Math.abs(bz)) > HALF_MAP * 0.99) continue;

        const yaw = Math.atan2(dx, dz);
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const overWater = isWaterAt(mx, mz);

        if (overWater) {
          // Bridge deck held clear of the water.
          const deckY = WATER_LEVEL + 13;
          this.slab(mx, deckY, mz, 8, 0.7, len / 2 + 0.5, yaw, 0, DECK);
          for (const s of [-1, 1]) {
            this.slab(mx + Math.cos(yaw) * 7.4 * s, deckY + 1.1, mz - Math.sin(yaw) * 7.4 * s,
              0.6, 0.8, len / 2 + 0.5, yaw, 0, PAINT);
          }
          const bed = Math.min(sampleHeight(mx, mz), -1);
          const hy = (deckY - bed) / 2;
          if (hy > 1) this.slab(mx, bed + hy, mz, 2.2, hy, 2.8, yaw, 0, CONCRETE);
          bridges++;
        } else {
          const ay = Math.max(sampleHeight(ax, az), WATER_LEVEL + 0.6);
          const by = Math.max(sampleHeight(bx, bz), WATER_LEVEL + 0.6);
          const pitch = -Math.atan2(by - ay, len);
          this.slab(mx, (ay + by) / 2, mz, 8, 0.45, len / 2 + 0.5, yaw, pitch, ASPHALT);
          if (i % 3 === 0) {
            this.deco(BOX, LINE_MAT, [mx, (ay + by) / 2 + 0.47, mz],
              [0.4, 0.08, Math.min(len * 0.45, 9)], [pitch, yaw, 0]);
          }
        }
      }
    }
    console.info(`[structures] US 231 laid, ${bridges} water crossings bridged`);
  }

  // ── real bridges / overpasses ───────────────────────────────
  /**
   * Every OSM bridge that actually spans open water, rendered as an elevated
   * deck on piers with a girder underside and guard rails — the highway
   * overpasses the player asked to see, at their true positions and heights.
   */
  _buildBridges() {
    let built = 0;
    for (const b of BRIDGES) {
      const pts = b.pts;
      if (!pts || pts.length < 2) continue;

      // Interstates/trunks ride higher and wider than a county road.
      const major = b.hw === 'motorway' || b.hw === 'trunk' || /I ?\d/.test(b.ref || b.name);
      const halfW = major ? 11 : 7.5;
      const railMat = major ? CONCRETE : PAINT;

      // Deck height: clear the water with headroom, following any real incline.
      const deckY = WATER_LEVEL + (major ? 17 : 12);

      let spanned = false;
      // Bridge ways are often just two nodes across the whole river, so
      // subdivide each segment into ~24 m spans: one deck panel per span, and
      // a pier wherever a span sits over open water. Without this a river
      // bridge would be a single unsupported plank.
      const SPAN = 24;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1][0], az = pts[i - 1][1];
        const bx = pts[i][0], bz = pts[i][1];
        const segLen = Math.hypot(bx - ax, bz - az);
        if (segLen < 2) continue;
        const yaw = Math.atan2(bx - ax, bz - az);
        const panels = Math.max(1, Math.ceil(segLen / SPAN));

        for (let s = 0; s < panels; s++) {
          const t0 = s / panels, t1 = (s + 1) / panels, tm = (t0 + t1) / 2;
          const mx = ax + (bx - ax) * tm, mz = az + (bz - az) * tm;
          const halfLen = (segLen / panels) / 2 + 0.6;

          this.slab(mx, deckY, mz, halfW, 0.6, halfLen, yaw, 0, DECK);
          for (const sd of [-1, 1]) {
            this.slab(mx + Math.cos(yaw) * (halfW - 0.4) * sd, deckY + 1.0,
              mz - Math.sin(yaw) * (halfW - 0.4) * sd, 0.5, 0.9, halfLen, yaw, 0, railMat);
          }
          this.slab(mx, deckY - 1.1, mz, halfW * 0.8, 0.7, halfLen, yaw, 0, CONCRETE);

          // Pier down to the bed under every second panel that's over water.
          if (s % 2 === 0 && isWaterAt(mx, mz)) {
            const bed = Math.min(sampleHeight(mx, mz), WATER_LEVEL - 1);
            const hy = (deckY - 1.4 - bed) / 2;
            if (hy > 1) {
              this.slab(mx, bed + hy, mz, major ? 2.8 : 2.0, hy, major ? 2.8 : 2.2, yaw, 0, CONCRETE);
              spanned = true;
            }
          }
        }
      }
      if (spanned) built++;

      // A name plaque on the approach, for the notable named crossings.
      if (b.name && b.name.length > 3 && (major || built <= 10)) {
        const end = pts[0];
        const tex = signTexture([{ text: b.name.toUpperCase(), big: false }],
          '#14324f', '#ffffff', '#ffd166');
        this.deco(new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, transparent: true }),
          [end[0], deckY + 3.4, end[1]], [Math.min(b.name.length * 1.1, 22), 3.0, 1], [0, 0, 0]);
      }
    }
    console.info(`[structures] ${built} real bridges spanned (of ${BRIDGES.length})`);
  }

  // ── dams (Old Hickory Lock & Dam and friends) ───────────────
  _buildDams() {
    for (const dam of DAMS) {
      const pts = dam.pts;
      if (!pts || pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1][0], az = pts[i - 1][1];
        const bx = pts[i][0], bz = pts[i][1];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 2 || len > 400) continue;
        const yaw = Math.atan2(dx, dz);
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const bed = Math.min(sampleHeight(mx, mz), WATER_LEVEL - 2);
        const crest = WATER_LEVEL + 7;
        const hy = (crest - bed) / 2;
        this.slab(mx, bed + hy, mz, 5, hy, len / 2 + 0.5, yaw, 0, CONCRETE);
        // A spillway lip in signal red so it reads as a landmark, not a wall.
        this.slab(mx, crest, mz, 5.4, 0.6, len / 2 + 0.5, yaw, 0, PAINT);
      }
      if (dam.name && dam.name !== 'Dam') {
        const mid = pts[Math.floor(pts.length / 2)];
        const tex = signTexture([{ text: dam.name.toUpperCase(), big: false }],
          '#3a1f1f', '#ffffff', '#ff5d73');
        this.deco(new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, transparent: true }),
          [mid[0], WATER_LEVEL + 12, mid[1]], [Math.min(dam.name.length * 1.3, 30), 4, 1], [0, 0, 0]);
      }
    }
    console.info(`[structures] ${DAMS.length} dams placed`);
  }

  // ── marinas ─────────────────────────────────────────────────
  _buildMarinas() {
    for (const m of MARINAS) {
      if (!isWaterAt(m.x, m.z)) continue;
      // A little cluster of floating docks + a sign, at the real location.
      for (let k = 0; k < 4; k++) {
        this.slab(m.x + (k - 1.5) * 6, WATER_LEVEL + 0.6, m.z, 0.9, 0.3, 7, 0, 0, TIMBER);
      }
      this.slab(m.x, WATER_LEVEL + 0.6, m.z + 8, 10, 0.3, 1.0, 0, 0, TIMBER);
      const tex = signTexture([{ text: (m.name || 'MARINA').toUpperCase(), big: false }],
        '#123a5c', '#ffffff', '#4ecdc4');
      this.deco(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide, transparent: true }),
        [m.x, WATER_LEVEL + 4, m.z + 8], [Math.min((m.name || 'Marina').length * 1.1, 18), 2.6, 1], [0, 0, 0]);
    }
    console.info(`[structures] ${MARINAS.length} marinas placed`);
  }

  // ── spillway kicker ─────────────────────────────────────────
  /**
   * A stylised spillway ramp on the bank. Deliberately NOT a dam across the
   * channel — the Cumberland has to stay navigable end to end.
   */
  _buildSpillway(dist) {
    const c = channelPointAt(dist);
    const w = this.channelHalfWidth(c);
    const yaw = Math.atan2(c.tx, c.tz);
    const side = 1;
    const px = c.x - c.tz * (w * 0.72) * side;
    const pz = c.z + c.tx * (w * 0.72) * side;

    this.slab(px, WATER_LEVEL + 3.0, pz, 12, 0.9, 20, yaw, -0.34, RAMP_MAT);
    this.slab(px + c.tx * 22, WATER_LEVEL + 7.4, pz + c.tz * 22, 12, 0.9, 11, yaw, -0.06, RAMP_MAT);
    for (const s of [-1, 1]) {
      this.slab(px - c.tz * 12.6 * s, WATER_LEVEL + 5.2, pz + c.tx * 12.6 * s,
        0.8, 2.4, 20, yaw, -0.34, PAINT);
    }
  }

  // ── lock chamber + gates ────────────────────────────────────
  /**
   * Placed at a channel station, sized to the real water width there. The
   * gates swing open on approach so the reach stays passable.
   */
  _buildLock(dist) {
    const c = channelPointAt(dist);
    const cx = c.x, z = c.z;
    const yaw = Math.atan2(c.tx, c.tz);
    const sx = Math.cos(yaw), sz = -Math.sin(yaw);

    const w = this.channelHalfWidth(c);
    const chamberHalf = 30;
    const gapHalf = Math.max(14, Math.min(w * 0.55, 34));   // the navigable opening

    // Chamber walls flanking the channel.
    for (const side of [-1, 1]) {
      const off = (gapHalf + 8) * side;
      this.slab(cx + sx * off, 3.0, z + sz * off, 8, 10, chamberHalf, yaw);
    }

    // Guide walls upstream / downstream.
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const off = (gapHalf + 16) * side;
        this.slab(
          cx + sx * off + Math.sin(yaw) * chamberHalf * 1.5 * end,
          2.0,
          z + sz * off + Math.cos(yaw) * chamberHalf * 1.5 * end,
          3, 7, chamberHalf * 0.6, yaw,
        );
      }
    }

    // Two mitre gate leaves, hinged on the chamber walls. Each leaf's local
    // +z axis runs along its length; closed it points across the channel,
    // open it swings 90° to lie flat against the wall.
    const world = this.physics.world;
    const leaves = [];
    for (const side of [-1, 1]) {
      const hingeX = cx + sx * gapHalf * side;
      const hingeZ = z + sz * gapHalf * side;
      const leafHalfLen = gapHalf * 0.98;

      const mesh = new THREE.Mesh(BOX, GATE_MAT);
      mesh.scale.set(1.6, 13, leafHalfLen * 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hingeX, GATE_Y, hingeZ),
      );
      const col = world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.8, 6.5, leafHalfLen).setFriction(0.4).setRestitution(0.35),
        body,
      );
      this.physics.register(col, { kind: 'gate' });

      leaves.push({ side, hingeX, hingeZ, leafHalfLen, body, collider: col, mesh });
    }

    this.locks.push({
      x: cx, z, yaw, leaves,
      open: 0,            // 0 shut … 1 fully swung back
      target: 0,
      rammed: false,
      cooldown: 0,
    });
  }

  // ── ramps ───────────────────────────────────────────────────
  /** Kickers on the bank, aimed at the water so you can launch into the river. */
  _buildLandRamps() {
    // Clustered along the reach around Hunters Point, where the player starts,
    // rather than spread across 150 km of river.
    const hp = HUNTERS_POINT.channelDist;
    const n = 8;
    for (let k = 0; k < n; k++) {
      const c = channelPointAt(hp + (k - n / 2) * 1400);
      const side = k % 2 === 0 ? 1 : -1;

      // Walk inland from the channel until we are safely on dry ground.
      let px = c.x, pz = c.z, found = false;
      for (let step = 20; step < 320; step += 8) {
        const tx = c.x - c.tz * step * side;
        const tz = c.z + c.tx * step * side;
        if (Math.abs(tx) > HALF_MAP * 0.95 || Math.abs(tz) > HALF_MAP * 0.95) break;
        if (shoreDistance(tx, tz) < -34) { px = tx; pz = tz; found = true; break; }
      }
      if (!found) continue;

      const h = sampleHeight(px, pz);
      // Point the ramp back at the river.
      const yaw = Math.atan2(c.x - px, c.z - pz);
      this.slab(px, h + 2.8, pz, 9, 0.8, 15, yaw, -0.42, RAMP_MAT);
      this.slab(px, h + 0.9, pz, 9.6, 1.0, 4, yaw, 0, CONCRETE);
    }
  }

  /** Ramps that launch straight out of the water at a few bends. */
  _buildRiverRamps() {
    const hp = HUNTERS_POINT.channelDist;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const c = channelPointAt(hp + (k - n / 2) * 1100);
      const w = this.channelHalfWidth(c);
      const side = k % 2 === 0 ? 1 : -1;
      const px = c.x - c.tz * (w * 0.6) * side;
      const pz = c.z + c.tx * (w * 0.6) * side;
      if (!isWaterAt(px, pz)) continue;
      const yaw = Math.atan2(c.tx, c.tz);
      this.slab(px, WATER_LEVEL + 2.2, pz, 8, 0.8, 16, yaw, -0.36, RAMP_MAT);
    }
  }

  // ── lock behaviour ──────────────────────────────────────────
  update(dt) {
    const v = game.vessel;
    if (!v) return;
    const p = v.position;
    const speed = v.speed;

    for (const lock of this.locks) {
      const d = Math.hypot(p.x - lock.x, p.z - lock.z);

      if (d < 26 && speed > 26 && !lock.rammed && lock.open < 0.7) {
        // Rammed at speed — burst the gates open.
        lock.rammed = true;
        lock.target = 1;
        lock.open = Math.max(lock.open, 0.45);
        game.audio?.gate();
        game.audio?.crash();
        game.engine?.addShake(1.6);
        for (const leaf of lock.leaves) {
          game.fx?.sparks(leaf.hingeX, 6, leaf.hingeZ, 26, 0.5, 0.95, 1.0);
        }
        game.hud?.toast('GATES RAMMED!', true);
      } else if (d < 62) {
        lock.target = 1;                       // polite approach: they open for you
      } else {
        lock.target = 0;
        lock.rammed = false;
      }

      const rate = lock.rammed ? 4.2 : 1.1;
      lock.open += Math.sign(lock.target - lock.open) * Math.min(rate * dt, Math.abs(lock.target - lock.open));

      for (const leaf of lock.leaves) {
        // Closed → leaf points across the channel; open → along the bank.
        const leafYaw = lock.yaw - leaf.side * (Math.PI / 2) * (1 - lock.open);
        const centerX = leaf.hingeX + Math.sin(leafYaw) * leaf.leafHalfLen;
        const centerZ = leaf.hingeZ + Math.cos(leafYaw) * leaf.leafHalfLen;

        _q.setFromAxisAngle(_up, leafYaw);
        leaf.body.setNextKinematicTranslation({ x: centerX, y: GATE_Y, z: centerZ });
        leaf.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
        leaf.mesh.position.set(centerX, GATE_Y, centerZ);
        leaf.mesh.quaternion.copy(_q);
      }
    }
  }

  setNight(n) {
    PAINT.emissiveIntensity = 0.15 + n * 1.6;
    RAMP_MAT.emissiveIntensity = 0.15 + n * 1.8;
    GATE_MAT.emissiveIntensity = 0.25 + n * 2.4;
  }
}
