// ──────────────────────────────────────────────────────────────
// Destructible scenery: trees, rocks, fences, signs, crates,
// barrels, plus the floating rubber ducks and channel buoys.
//
// Every prop is a dynamic Rapier body (so it can be launched) but
// renders through shared InstancedMeshes, so ~900 props cost a
// dozen draw calls.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RAPIER } from '../core/Physics.js';
import { game } from '../game.js';
import { MAP_SIZE, HALF_MAP, WATER_LEVEL } from '../config.js';
import {
  sampleHeight, sampleSlope, isWaterAt, shoreDistance,
  waveHeight, HUNTERS_POINT, channelPointAt, CHANNEL_LENGTH, ROADS,
} from './heightfield.js';

/**
 * Keep-clear test for the built environment: nothing should be scattered on
 * the boat dock apron or growing up through the real US 231 alignment.
 */
function onBuiltGround(x, z) {
  const HP = HUNTERS_POINT;
  if (Math.hypot(x - HP.shoreX, z - HP.shoreZ) < 70) return true;

  for (const road of ROADS) {
    const pts = road.pts;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], az = pts[i - 1][1];
      const bx = pts[i][0], bz = pts[i][1];
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1) continue;
      let t = ((x - ax) * dx + (z - az) * dz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      if ((x - px) ** 2 + (z - pz) ** 2 < 196) return true;   // 14 m
    }
  }
  return false;
}

// ── seeded RNG ────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── shared geometry / materials ───────────────────────────────
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    flatShading: true,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.0,
    emissive: new THREE.Color(opts.emissive ?? '#000000'),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

class InstancedPart {
  constructor(scene, geometry, material, capacity) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  alloc() {
    if (this.mesh.count >= this.capacity) return -1;
    return this.mesh.count++;
  }

  set(id, m) {
    this.mesh.setMatrixAt(id, m);
  }

  hide(id) {
    this.mesh.setMatrixAt(id, this._hidden);
  }

  flush() {
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ──────────────────────────────────────────────────────────────
export class PropSystem {
  constructor(physics, scene) {
    this.physics = physics;
    this.scene = scene;
    /** @type {Array<object>} */
    this.props = [];
    this.parts = new Map();
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this.floaters = [];
    /** Destroyed props queued to grow back: {spec, x, y, z, yaw, at}. */
    this.respawnQueue = [];

    // Stable identity for the network. The scatter pass is seeded, so every
    // client builds the same props in the same order and therefore agrees on
    // these ids — that's what lets "I blew up prop 812" mean the same thing
    // everywhere. A prop keeps its id when it grows back, so the mapping
    // survives respawns even though respawn *timing* is local.
    this._nextNetId = 0;
    /** @type {Map<number, object>} netId → prop */
    this.byNetId = new Map();

    this._defineParts();
    this._scatter();
    this.flushAll();
  }

  /** Schedule a destroyed prop to grow back later (persists during play). */
  scheduleRespawn(prop) {
    if (!prop?.spawn || !prop.spec) return;
    // Longer for the big landmarks, so they stay wrecked a good while.
    const delay = 70 + Math.random() * 50 + (prop.spec.points || 0) * 0.08;
    this.respawnQueue.push({
      spec: prop.spec, ...prop.spawn, netId: prop.netId, at: game.time + delay,
    });
  }

  _processRespawns() {
    if (!this.respawnQueue.length) return;
    const now = game.time;
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      if (now < r.at) continue;
      this.respawnQueue.splice(i, 1);
      this.add(r.spec, r.x, r.y, r.z, r.yaw, r.netId);
    }
  }

  // ── part table ──────────────────────────────────────────────
  _defineParts() {
    const P = (key, geo, material, cap) => {
      this.parts.set(key, new InstancedPart(this.scene, geo, material, cap));
    };

    P('trunk', new THREE.CylinderGeometry(0.34, 0.55, 1, 6), mat('#6b4a2f'), 950);
    P('canopy', new THREE.IcosahedronGeometry(1, 0), mat('#4fae4a'), 600);
    P('pineCone', new THREE.ConeGeometry(1, 1, 7), mat('#2f7d55'), 760);
    P('rock', new THREE.DodecahedronGeometry(1, 0), mat('#98938c'), 330);
    P('crate', new THREE.BoxGeometry(1, 1, 1), mat('#c08a4a'), 220);
    P('barrel', new THREE.CylinderGeometry(0.55, 0.55, 1, 10), mat('#d1483f', { metalness: 0.25, roughness: 0.5 }), 160);
    P('post', new THREE.BoxGeometry(1, 1, 1), mat('#8a6a44'), 380);
    P('rail', new THREE.BoxGeometry(1, 1, 1), mat('#a3805a'), 580);
    P('signBoard', new THREE.BoxGeometry(1, 1, 1), mat('#f0f3f5', { emissive: '#334', emissiveIntensity: 0.2 }), 80);
    P('duckBody', new THREE.SphereGeometry(1, 10, 8), mat('#ffd23f', { emissive: '#ffae00', emissiveIntensity: 0.25 }), 60);
    P('duckHead', new THREE.SphereGeometry(1, 9, 7), mat('#ffd23f', { emissive: '#ffae00', emissiveIntensity: 0.25 }), 60);
    P('duckBeak', new THREE.ConeGeometry(1, 1, 6), mat('#ff7a1a', { emissive: '#ff5500', emissiveIntensity: 0.35 }), 60);
    P('buoy', new THREE.CylinderGeometry(0.7, 1.0, 1, 8), mat('#ff3b5c', { emissive: '#ff0033', emissiveIntensity: 0.5 }), 180);
    P('buoyTop', new THREE.ConeGeometry(1, 1, 8), mat('#ffe66d', { emissive: '#ffcc00', emissiveIntensity: 0.9 }), 180);
    P('hay', new THREE.CylinderGeometry(1, 1, 1, 9), mat('#e0c169'), 130);
  }

  // ── prop construction ───────────────────────────────────────
  /**
   * @param {object} spec
   *   parts   : [{ key, pos:[x,y,z], scale:[x,y,z], rotY? , rotX? }]  (local space)
   *   half    : [hx,hy,hz] collider half-extents (or radius for 'ball')
   *   shape   : 'box' | 'ball' | 'cyl'
   *   mass, hp, points, chunkColor, float, explosive
   */
  add(spec, x, y, z, yaw = 0, netId = null) {
    const world = this.physics.world;
    // Floating props (buoys, ducks, crates on water) must be dynamic to bob.
    // Land scenery starts FIXED and only becomes dynamic when hit — otherwise
    // ~1,900 dynamic bodies micro-jitter on the coarse 55 m terrain and never
    // sleep, which alone cost the whole physics budget on the big map.
    const dyn = !!spec.float;
    const bodyDesc = (dyn ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed())
      .setTranslation(x, y, z)
      .setRotation(quatFromYaw(yaw))
      .setLinearDamping(spec.float ? 0.9 : 0.12)
      .setAngularDamping(spec.float ? 1.4 : 0.5);
    const body = world.createRigidBody(bodyDesc);

    let cd;
    const h = spec.half;
    if (spec.shape === 'ball') cd = RAPIER.ColliderDesc.ball(h[0]);
    else if (spec.shape === 'cyl') cd = RAPIER.ColliderDesc.cylinder(h[1], h[0]);
    else cd = RAPIER.ColliderDesc.cuboid(h[0], h[1], h[2]);

    const volume = spec.shape === 'ball'
      ? (4 / 3) * Math.PI * h[0] ** 3
      : spec.shape === 'cyl'
        ? Math.PI * h[0] * h[0] * 2 * h[1]
        : 8 * h[0] * h[1] * h[2];

    cd.setDensity(Math.max(0.05, spec.mass / Math.max(volume, 0.01)))
      .setFriction(0.85)
      .setRestitution(0.18);
    if (spec.colliderY) cd.setTranslation(0, spec.colliderY, 0);

    const collider = world.createCollider(cd, body);

    const prop = {
      kind: 'prop',
      spec,
      body,
      collider,
      hp: spec.hp,
      alive: true,
      dynamic: dyn,
      instances: [],
      awake: true,
      restTimer: 0,
      spawn: { x, y, z, yaw },          // where it grows back
      netId: netId ?? this._nextNetId++,
    };
    this.byNetId.set(prop.netId, prop);

    for (const p of spec.parts) {
      const part = this.parts.get(p.key);
      const id = part.alloc();
      if (id < 0) continue;
      const local = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(p.rotX || 0, p.rotY || 0, p.rotZ || 0),
      );
      local.compose(
        new THREE.Vector3(...p.pos),
        q,
        new THREE.Vector3(...p.scale),
      );
      prop.instances.push({ part, id, local });
    }

    this.physics.register(collider, prop);
    this.props.push(prop);
    if (spec.float) {
      this.floaters.push(prop);
      // Start asleep at the waterline; the near-player buoyancy pass wakes it.
      // Distant floaters then stay at the surface instead of sinking off-screen.
      body.sleep();
    }
    this.syncProp(prop);
    return prop;
  }

  /**
   * Wake a static scenery prop into a dynamic body so it can be launched.
   * Called the instant something hits it; a no-op for props already dynamic.
   */
  activate(prop) {
    if (!prop || !prop.alive || prop.dynamic) return;
    prop.dynamic = true;
    prop.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    prop.body.setLinearDamping(0.12);
    prop.body.setAngularDamping(0.5);
    prop.body.wakeUp();
  }

  // ── scatter pass ────────────────────────────────────────────
  _scatter() {
    const rng = mulberry32(0xC0FFEE);
    const R = (a, b) => a + rng() * (b - a);

    // Scenery is biased to a corridor along the river rather than scattered
    // uniformly — over a 56 km map, uniform placement would put trees kilometres
    // apart and leave the banks the player actually travels bare.
    const landSpot = (minH, maxH, maxSlope, tries = 28) => {
      for (let i = 0; i < tries; i++) {
        const c = channelPointAt(R(0, CHANNEL_LENGTH));
        const side = rng() < 0.5 ? -1 : 1;
        const off = R(30, 700);                     // metres inland from the bank
        const x = c.x - c.tz * off * side;
        const z = c.z + c.tx * off * side;
        if (Math.abs(x) > HALF_MAP * 0.96 || Math.abs(z) > HALF_MAP * 0.96) continue;
        const h = sampleHeight(x, z);
        if (h < minH || h > maxH) continue;
        if (sampleSlope(x, z) > maxSlope) continue;
        if (onBuiltGround(x, z)) continue;
        return { x, z, h };
      }
      return null;
    };

    /** A point out on open water, biased to the navigable channel. */
    const waterSpot = (tries = 40, minDepth = 6) => {
      for (let i = 0; i < tries; i++) {
        const c = channelPointAt(R(0, CHANNEL_LENGTH));
        // Offset perpendicular to the channel heading.
        const off = R(-90, 90);
        const x = c.x - c.tz * off;
        const z = c.z + c.tx * off;
        if (Math.abs(x) > HALF_MAP * 0.96 || Math.abs(z) > HALF_MAP * 0.96) continue;
        if (shoreDistance(x, z) < minDepth) continue;
        return { x, z };
      }
      return null;
    };

    /** A point on the bank, just above the waterline. */
    const bankSpot = (tries = 40) => {
      for (let i = 0; i < tries; i++) {
        const c = channelPointAt(R(0, CHANNEL_LENGTH));
        const side = rng() < 0.5 ? -1 : 1;
        for (let step = 20; step < 340; step += 12) {
          const x = c.x - c.tz * step * side;
          const z = c.z + c.tx * step * side;
          if (Math.abs(x) > HALF_MAP * 0.95 || Math.abs(z) > HALF_MAP * 0.95) break;
          const d = shoreDistance(x, z);
          if (d < -6 && d > -46) {                  // 6–46 m inland
            if (onBuiltGround(x, z)) break;
            return { x, z, h: sampleHeight(x, z) };
          }
        }
      }
      return null;
    };

    // Broadleaf trees on the gentle low ground.
    for (let i = 0; i < 520; i++) {
      const s = landSpot(3, 34, 0.34);
      if (!s) continue;
      const th = R(4.5, 9.5), cw = R(2.4, 4.2);
      this.add({
        parts: [
          { key: 'trunk', pos: [0, -th * 0.5 + th * 0.3, 0], scale: [1, th * 0.6, 1] },
          { key: 'canopy', pos: [0, th * 0.22, 0], scale: [cw, cw * R(0.75, 1.15), cw] },
        ],
        shape: 'box',
        half: [cw * 0.55, th * 0.5, cw * 0.55],
        mass: 240, hp: 26, points: 50,
        chunkColor: 0x4fae4a,
      }, s.x, s.h + th * 0.5 - 0.6, s.z, R(0, 6.28));
    }

    // Conifers up on the ridges.
    for (let i = 0; i < 330; i++) {
      const s = landSpot(16, 90, 0.46);
      if (!s) continue;
      const th = R(7, 14), cw = R(2.0, 3.4);
      this.add({
        parts: [
          { key: 'trunk', pos: [0, -th * 0.28, 0], scale: [0.85, th * 0.5, 0.85] },
          { key: 'pineCone', pos: [0, th * 0.02, 0], scale: [cw, th * 0.52, cw] },
          { key: 'pineCone', pos: [0, th * 0.30, 0], scale: [cw * 0.7, th * 0.4, cw * 0.7] },
        ],
        shape: 'box',
        half: [cw * 0.5, th * 0.5, cw * 0.5],
        mass: 300, hp: 30, points: 50,
        chunkColor: 0x2f7d55,
      }, s.x, s.h + th * 0.5 - 0.8, s.z, R(0, 6.28));
    }

    // Boulders.
    for (let i = 0; i < 270; i++) {
      const s = landSpot(-6, 100, 0.85);
      if (!s) continue;
      const r = R(1.1, 3.4);
      this.add({
        parts: [{ key: 'rock', pos: [0, 0, 0], scale: [r, r * R(0.6, 1.0), r * R(0.8, 1.2)], rotY: R(0, 6.28) }],
        shape: 'ball',
        half: [r * 0.86],
        mass: 900, hp: 55, points: 30,
        chunkColor: 0x98938c,
      }, s.x, s.h + r * 0.5, s.z, R(0, 6.28));
    }

    // Fence runs on flat pasture.
    for (let f = 0; f < 30; f++) {
      const s = landSpot(4, 30, 0.14);
      if (!s) continue;
      const dir = R(0, 6.28);
      const dx = Math.cos(dir), dz = Math.sin(dir);
      for (let k = 0; k < 8; k++) {
        const x = s.x + dx * k * 3.4;
        const z = s.z + dz * k * 3.4;
        if (Math.abs(x) > HALF_MAP * 0.95 || Math.abs(z) > HALF_MAP * 0.95) break;
        const h = sampleHeight(x, z);
        if (h < 1.5 || isWaterAt(x, z)) break;
        this.add({
          parts: [
            { key: 'post', pos: [0, 0, 0], scale: [0.28, 2.2, 0.28] },
            { key: 'rail', pos: [0, 0.35, 1.7], scale: [0.16, 0.26, 3.2] },
            { key: 'rail', pos: [0, -0.35, 1.7], scale: [0.16, 0.26, 3.2] },
          ],
          shape: 'box',
          half: [0.35, 1.1, 1.8],
          mass: 45, hp: 6, points: 15,
          chunkColor: 0x8a6a44,
        }, x, h + 1.1, z, dir + Math.PI / 2);
      }
    }

    // Roadside signs.
    for (let i = 0; i < 52; i++) {
      const s = landSpot(1.5, 40, 0.3);
      if (!s) continue;
      this.add({
        parts: [
          { key: 'post', pos: [0, -0.6, 0], scale: [0.22, 1.6, 0.22] },
          { key: 'signBoard', pos: [0, 1.2, 0], scale: [2.6, 1.5, 0.16] },
        ],
        shape: 'box',
        half: [1.3, 1.9, 0.3],
        mass: 55, hp: 8, points: 25,
        chunkColor: 0xf0f3f5,
      }, s.x, s.h + 1.9, s.z, R(0, 6.28));
    }

    // Hay bales.
    for (let i = 0; i < 90; i++) {
      const s = landSpot(3, 32, 0.2);
      if (!s) continue;
      const r = R(1.1, 1.7);
      this.add({
        parts: [{ key: 'hay', pos: [0, 0, 0], scale: [r, r * 1.1, r], rotZ: Math.PI / 2 }],
        shape: 'cyl',
        half: [r, r * 1.1],
        mass: 160, hp: 14, points: 35,
        chunkColor: 0xe0c169,
      }, s.x, s.h + r, s.z, R(0, 6.28));
    }

    // Shipping crates — banks and shallows.
    for (let i = 0; i < 175; i++) {
      const bank = rng() < 0.55;
      let x, z, h;
      if (bank) {
        const s = bankSpot();
        if (!s || s.h > 18) continue;
        x = s.x; z = s.z; h = s.h;
      } else {
        const s = waterSpot(40, 3);
        if (!s) continue;
        x = s.x; z = s.z; h = WATER_LEVEL;
      }
      const c = R(1.1, 2.1);
      this.add({
        parts: [{ key: 'crate', pos: [0, 0, 0], scale: [c * 2, c * 2, c * 2] }],
        shape: 'box',
        half: [c, c, c],
        mass: bank ? 130 : 90, hp: 10, points: 40,
        chunkColor: 0xc08a4a,
        float: !bank,
      }, x, (bank ? h + c : WATER_LEVEL + c * 0.4), z, R(0, 6.28));
    }

    // Explosive barrels near the banks — chain reactions.
    for (let i = 0; i < 115; i++) {
      const s = bankSpot();
      if (!s || s.h > 16) continue;
      this.add({
        parts: [{ key: 'barrel', pos: [0, 0, 0], scale: [1, 1.7, 1] }],
        shape: 'cyl',
        half: [0.62, 0.9],
        mass: 70, hp: 5, points: 60,
        chunkColor: 0xd1483f,
        explosive: true,
      }, s.x, s.h + 0.9, s.z, R(0, 6.28));
    }

    // Giant rubber ducks. Big points, big confetti.
    for (let i = 0; i < 46; i++) {
      const s = waterSpot();
      if (!s) continue;
      const d = R(1.6, 2.8);
      this.add({
        parts: [
          { key: 'duckBody', pos: [0, 0, 0], scale: [d * 1.25, d * 0.95, d * 1.6] },
          { key: 'duckHead', pos: [0, d * 0.95, d * 0.85], scale: [d * 0.62, d * 0.66, d * 0.62] },
          { key: 'duckBeak', pos: [0, d * 0.82, d * 1.5], scale: [d * 0.3, d * 0.55, d * 0.3], rotX: Math.PI / 2 },
        ],
        shape: 'box',
        half: [d * 1.2, d * 0.9, d * 1.5],
        mass: 240, hp: 12, points: 500,
        chunkColor: 0xffd23f,
        float: true,
        duck: true,
      }, s.x, WATER_LEVEL + d * 0.35, s.z, R(0, 6.28));
    }

    // Channel buoys, walked along the real Cumberland centreline and pushed
    // out toward each bank so they actually mark the navigable water. Spaced
    // wide because the channel is now ~150 km — this lays a buoy trail you can
    // literally follow all the way to Nashville (~165 buoys within the cap).
    const BUOY_SPACING = 920;
    for (let d = 60, i = 0; d < CHANNEL_LENGTH; d += BUOY_SPACING, i++) {
      const c = channelPointAt(d);
      const side = i % 2 === 0 ? -1 : 1;
      let x = c.x, z = c.z;
      // Step outward until we are close to the bank, then back off a little.
      for (let step = 10; step < 220; step += 6) {
        const px = c.x - c.tz * step * side;
        const pz = c.z + c.tx * step * side;
        if (shoreDistance(px, pz) < 12) break;
        x = px; z = pz;
      }
      if (Math.abs(x) > HALF_MAP * 0.95 || Math.abs(z) > HALF_MAP * 0.95) continue;
      if (!isWaterAt(x, z)) continue;
      this.add({
        parts: [
          { key: 'buoy', pos: [0, 0, 0], scale: [1, 2.4, 1] },
          { key: 'buoyTop', pos: [0, 1.9, 0], scale: [0.7, 1.5, 0.7] },
        ],
        shape: 'cyl',
        half: [0.9, 1.2],
        mass: 90, hp: 6, points: 100,
        chunkColor: 0xff3b5c,
        float: true,
      }, x, WATER_LEVEL + 0.5, z, 0);
    }

    console.info(`[props] ${this.props.length} destructible props placed`);
  }

  // ── per-frame ───────────────────────────────────────────────
  syncProp(prop) {
    const t = prop.body.translation();
    const r = prop.body.rotation();
    this._q.set(r.x, r.y, r.z, r.w);
    this._p.set(t.x, t.y, t.z);
    this._m.compose(this._p, this._q, this._s);
    for (const inst of prop.instances) {
      this._m2.multiplyMatrices(this._m, inst.local);
      inst.part.set(inst.id, this._m2);
    }
  }

  /**
   * Runs on the fixed physics step. Bobs floating props on the analytic wave
   * field; forces must be cleared first because Rapier keeps them until reset.
   */
  fixedUpdate(dt, time) {
    this._processRespawns();

    // Only float (and keep awake) props near the player. Across the 150 km
    // corridor there are hundreds of buoys and floating targets; waking all of
    // them every step dominated the physics budget. Beyond ~700 m they just
    // sleep on the water — nobody is there to see them bob.
    const v = game.vessel;
    const px = v ? v.position.x : 0, pz = v ? v.position.z : 0;
    const R2 = 700 * 700;

    for (const prop of this.floaters) {
      if (!prop.alive) continue;
      const b = prop.body;
      const t = b.translation();
      const dx = t.x - px, dz = t.z - pz;
      if (dx * dx + dz * dz > R2) continue;         // far away → let it sleep
      b.resetForces(false);
      if (!isWaterAt(t.x, t.z)) continue;
      const surf = WATER_LEVEL + waveHeight(t.x, t.z, time);
      const depth = surf - t.y;
      if (depth <= -0.6) continue;
      const m = b.mass();
      const sub = Math.min(Math.max(depth / (prop.spec.half[1] * 2), 0), 1);
      const lv = b.linvel();
      b.addForce({
        x: -lv.x * m * 0.9,
        y: sub * 26 * m * 1.35 - lv.y * m * 2.6,
        z: -lv.z * m * 0.9,
      }, true);
      b.wakeUp();
    }
  }

  /** Render-rate: push physics transforms into the instanced meshes. */
  update(dt, time) {
    let dirty = false;

    for (const prop of this.props) {
      if (!prop.alive) continue;
      // Static scenery is placed once at spawn and never moves until activated;
      // sleeping dynamic props are settled. Skip both.
      if (!prop.dynamic) continue;
      if (prop.body.isSleeping()) continue;
      this.syncProp(prop);
      dirty = true;
    }

    if (dirty) this.flushAll();
  }

  flushAll() {
    for (const part of this.parts.values()) part.flush();
  }

  remove(prop) {
    if (!prop.alive) return;
    prop.alive = false;
    for (const inst of prop.instances) inst.part.hide(inst.id);
    this.flushAll();
    this.physics.unregister(prop.collider);
    this.physics.removeBody(prop.body);
    prop.body = null;
    prop.collider = null;
  }

  /** Night mode cranks the emissive on the neon-ish props. */
  setNight(n) {
    for (const key of ['duckBody', 'duckHead', 'duckBeak', 'buoy', 'buoyTop', 'signBoard', 'barrel']) {
      const p = this.parts.get(key);
      if (!p) continue;
      const base = key.startsWith('duck') ? 0.25 : key.startsWith('buoy') ? 0.6 : 0.2;
      p.mesh.material.emissiveIntensity = base + n * 2.2;
    }
  }
}

function quatFromYaw(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
