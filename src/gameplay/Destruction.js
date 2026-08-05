// ──────────────────────────────────────────────────────────────
// Decimation: props take damage, break into physical debris chunks
// and hand out points. Explosions apply a falloff impulse to every
// dynamic body in radius and chain-detonate barrels.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RAPIER } from '../core/Physics.js';
import { LIMITS } from '../config.js';
import { game, addScore } from '../game.js';

const CHUNK_GEO = new THREE.BoxGeometry(1, 1, 1);
// `vertexColors` needs a real colour attribute or the attribute defaults to
// black; a white one lets the per-instance colour come through unchanged.
CHUNK_GEO.setAttribute(
  'color',
  new THREE.BufferAttribute(new Float32Array(CHUNK_GEO.attributes.position.count * 3).fill(1), 3),
);

export class Destruction {
  constructor(physics, scene) {
    this.physics = physics;
    this.scene = scene;

    this.material = new THREE.MeshStandardMaterial({
      flatShading: true, roughness: 0.9, vertexColors: true,
    });

    this.max = LIMITS.maxDebris;
    this.mesh = new THREE.InstancedMesh(CHUNK_GEO, this.material, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.max * 3).fill(1), 3,
    );
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = this.max;
    scene.add(this.mesh);

    /** @type {Array<{body:any,collider:any,scale:THREE.Vector3,ttl:number}|null>} */
    this.slots = new Array(this.max).fill(null);
    this.cursor = 0;

    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;

    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._sv = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._c = new THREE.Color();
    this.combo = 0;
    this.comboTimer = 0;
  }

  // ── damage entry point ──────────────────────────────────────
  /**
   * @param {object} prop   from PropSystem
   * @param {number} amount
   * @param {{x,y,z}} point impact position
   * @param {{x,y,z}} dir   normalised push direction
   * @param {number} force  impulse magnitude applied on survival
   */
  damage(prop, amount, point, dir, force = 0) {
    if (!prop || !prop.alive) return false;
    // Scenery starts as a static body; the moment it's touched it wakes into a
    // dynamic one so it can be launched, split, or knocked over.
    game.props.activate(prop);
    prop.hp -= amount;

    if (prop.hp > 0) {
      if (force > 0 && prop.body) {
        prop.body.applyImpulse(
          { x: dir.x * force, y: dir.y * force + force * 0.25, z: dir.z * force }, true,
        );
        const spin = force * 0.06;
        prop.body.applyTorqueImpulse({
          x: (Math.random() - 0.5) * spin,
          y: (Math.random() - 0.5) * spin,
          z: (Math.random() - 0.5) * spin,
        }, true);
      }
      return false;
    }

    this.break(prop, point, dir, force);
    return true;
  }

  break(prop, point, dir, force = 0) {
    if (!prop.alive) return;
    const t = prop.body.translation();
    const spec = prop.spec;
    const pos = { x: t.x, y: t.y, z: t.z };

    game.props.remove(prop);

    // Score + combo.
    this.combo++;
    this.comboTimer = 2.0;
    const mult = Math.min(1 + (this.combo - 1) * 0.25, 5);
    addScore(Math.round((spec.points || 25) * mult), spec.duck ? 'RUBBER DUCK!' : null);
    if (this.combo > 2) game.hud?.setCombo(this.combo, mult);

    const col = new THREE.Color(spec.chunkColor ?? 0xcccccc);

    if (spec.duck) {
      game.fx.confetti(pos.x, pos.y + 1.5, pos.z, 110);
      game.audio?.quack();
      game.audio?.pickup();
    } else {
      game.fx.debrisPuff(pos.x, pos.y, pos.z, col.r, col.g, col.b, 18);
      game.audio?.wood();
    }

    // Split into chunks. `imp` is a target speed in m/s, converted to an
    // impulse per-chunk once the chunk's own mass is known.
    const n = spec.duck ? 6 : 7;
    const size = Math.max(0.35, Math.min(spec.half[0], spec.half[1]) * 0.55);
    const carried = force / Math.max(spec.mass, 1);
    for (let i = 0; i < n; i++) {
      const off = {
        x: (Math.random() - 0.5) * spec.half[0] * 1.6,
        y: (Math.random() - 0.5) * spec.half[1] * 1.6,
        z: (Math.random() - 0.5) * (spec.half[2] ?? spec.half[0]) * 1.6,
      };
      const imp = 6 + Math.min(carried, 30) + Math.random() * 10;
      this.spawnChunk(
        pos.x + off.x, pos.y + off.y, pos.z + off.z,
        size * (0.6 + Math.random() * 0.9),
        col,
        {
          x: dir.x * imp + (Math.random() - 0.5) * 12,
          y: Math.abs(dir.y) * imp + 5 + Math.random() * 11,
          z: dir.z * imp + (Math.random() - 0.5) * 12,
        },
      );
    }

    if (spec.explosive) {
      // Barrels cook off, which is how chain reactions happen.
      this.explode(pos, 20, 340, 1.25, prop);
    }
  }

  // ── explosions ──────────────────────────────────────────────
  /**
   * @param {{x,y,z}} pos
   * @param {number} radius
   * @param {number} power impulse at ground zero
   * @param {number} scale visual scale
   * @param {object|null} source prop to skip
   */
  explode(pos, radius = 16, power = 260, scale = 1, source = null) {
    game.fx.explosion(pos.x, pos.y, pos.z, scale);
    game.audio?.explosion();

    const v = game.vessel;
    if (v) {
      const d = Math.hypot(v.position.x - pos.x, v.position.y - pos.y, v.position.z - pos.z);
      game.engine.addShake(Math.max(0, 2.6 * scale * (1 - d / (radius * 3.2))));
    }

    const r2 = radius * radius;
    const hits = [];
    for (const prop of game.props.props) {
      if (!prop.alive || prop === source) continue;
      const t = prop.body.translation();
      const dx = t.x - pos.x, dy = t.y - pos.y, dz = t.z - pos.z;
      const dist2 = dx * dx + dy * dy + dz * dz;
      if (dist2 > r2) continue;
      hits.push({ prop, dx, dy, dz, dist: Math.sqrt(dist2) });
    }

    // `power` is a blast strength, not an impulse: multiplying by each body's
    // own mass means a boulder and a crate both get thrown.
    const kick = power * 0.04;

    for (const h of hits) {
      const falloff = 1 - h.dist / radius;
      const inv = 1 / Math.max(h.dist, 0.001);
      const dir = { x: h.dx * inv, y: h.dy * inv + 0.55, z: h.dz * inv };
      this.damage(h.prop, 40 * falloff, pos, dir, h.prop.body.mass() * kick * falloff);
    }

    // Shove the player too — explosions should feel dangerous.
    if (v && v.body) {
      const dx = v.position.x - pos.x, dy = v.position.y - pos.y, dz = v.position.z - pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < radius * 1.6) {
        const f = (1 - dist / (radius * 1.6)) * kick * 0.5 * v.mass;
        const inv = 1 / Math.max(dist, 0.001);
        v.body.applyImpulse({ x: dx * inv * f, y: dy * inv * f + f * 0.5, z: dz * inv * f }, true);
      }
    }

    // Loose debris gets tossed as well.
    for (const slot of this.slots) {
      if (!slot) continue;
      const t = slot.body.translation();
      const dx = t.x - pos.x, dy = t.y - pos.y, dz = t.z - pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > radius) continue;
      const f = (1 - dist / radius) * kick * slot.body.mass();
      const inv = 1 / Math.max(dist, 0.001);
      slot.body.applyImpulse({ x: dx * inv * f, y: dy * inv * f + f, z: dz * inv * f }, true);
    }
  }

  // ── debris pool ─────────────────────────────────────────────
  spawnChunk(x, y, z, size, color, impulse) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;

    const old = this.slots[i];
    if (old) {
      this.physics.unregister(old.collider);
      this.physics.removeBody(old.body);
    }

    const world = this.physics.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setLinearDamping(0.25)
        .setAngularDamping(0.4),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(size, size, size)
        .setDensity(2.2).setFriction(0.8).setRestitution(0.3),
      body,
    );

    // `impulse` arrives as a velocity; scale by the chunk's own mass so big
    // and small debris leave the wreck at the same speed.
    const cm = body.mass();
    body.applyImpulse(
      { x: impulse.x * cm, y: impulse.y * cm, z: impulse.z * cm }, true,
    );
    const spin = cm * size * 6;
    body.applyTorqueImpulse({
      x: (Math.random() - 0.5) * spin,
      y: (Math.random() - 0.5) * spin,
      z: (Math.random() - 0.5) * spin,
    }, true);

    const slot = { body, collider, scale: new THREE.Vector3(size * 2, size * 2, size * 2), ttl: 24 };
    this.slots[i] = slot;

    this._c.copy(color).multiplyScalar(0.7 + Math.random() * 0.5);
    this.mesh.setColorAt(i, this._c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; game.hud?.setCombo(0, 1); }
    }

    for (let i = 0; i < this.max; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      slot.ttl -= dt;
      if (slot.ttl <= 0) {
        this.physics.unregister(slot.collider);
        this.physics.removeBody(slot.body);
        this.slots[i] = null;
        this.mesh.setMatrixAt(i, this._hidden);
        continue;
      }
      const t = slot.body.translation();
      const r = slot.body.rotation();
      this._v.set(t.x, t.y, t.z);
      this._q.set(r.x, r.y, r.z, r.w);
      // Shrink out over the last second rather than popping.
      const s = slot.ttl < 1 ? slot.ttl : 1;
      this._sv.set(slot.scale.x * s, slot.scale.y * s, slot.scale.z * s);
      this._m.compose(this._v, this._q, this._sv);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
