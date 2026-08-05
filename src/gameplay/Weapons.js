// ──────────────────────────────────────────────────────────────
// Ballistics: physical cannonballs with CCD, detonating on any
// contact (prop, terrain, structure or water surface).
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RAPIER } from '../core/Physics.js';
import { LIMITS, WATER_LEVEL } from '../config.js';
import { isWaterAt } from '../world/heightfield.js';
import { game } from '../game.js';

const BALL_GEO = new THREE.IcosahedronGeometry(1, 1);

export class Weapons {
  constructor(physics, scene) {
    this.physics = physics;
    this.scene = scene;

    this.material = new THREE.MeshStandardMaterial({
      color: '#2b2f3a', flatShading: true, roughness: 0.4, metalness: 0.7,
      emissive: new THREE.Color('#ff6b35'), emissiveIntensity: 0.9,
    });

    this.max = LIMITS.maxProjectiles;
    this.mesh = new THREE.InstancedMesh(BALL_GEO, this.material, this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = this.max;
    scene.add(this.mesh);

    this._hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this._hidden);
    this.mesh.instanceMatrix.needsUpdate = true;

    /** @type {Array<null|{body,collider,ttl,radius,spec,slot}>} */
    this.slots = new Array(this.max).fill(null);
    this.cursor = 0;
    this.pending = [];

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();

    this.physics.onCollision((a, b, started) => {
      if (!started) return;
      const shellA = a?.kind === 'shell' ? a : null;
      const shellB = b?.kind === 'shell' ? b : null;
      if (!shellA && !shellB) return;
      const shell = shellA ?? shellB;
      const other = shellA ? b : a;
      // Don't let a shell detonate on the barrel it just left.
      if (other?.kind === 'vessel' && shell.age < 0.08) return;
      if (other?.kind === 'shell') return;
      this.detonate(shell, other);
    });
  }

  // ── firing ──────────────────────────────────────────────────
  tryFire(vessel, wantsFire) {
    if (!wantsFire || vessel.fireCooldown > 0) return;
    const w = vessel.cfg.weapon;
    if (!w || w.type === 'none') return;

    const muzzles = vessel.getMuzzles();
    if (!muzzles.length) return;

    vessel.fireCooldown = w.cooldown;
    for (const mz of muzzles) {
      this.spawn(vessel, mz.pos, mz.dir, w);
      game.fx.muzzle(mz.pos.x, mz.pos.y, mz.pos.z, mz.dir.x, mz.dir.y, mz.dir.z);
      vessel.applyRecoil(mz.dir, w.power);
    }
    game.audio?.cannon();
  }

  spawn(vessel, pos, dir, spec) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    if (this.slots[i]) this._despawn(i);

    const world = this.physics.world;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(0.012)
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setLinvel(
          dir.x * spec.speed + vessel.vel.x,
          dir.y * spec.speed + vessel.vel.y,
          dir.z * spec.speed + vessel.vel.z,
        ),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.ball(spec.ballRadius)
        .setDensity(spec.ballDensity)
        .setRestitution(0.25)
        .setFriction(0.4)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );

    const shell = {
      kind: 'shell', body, collider, spec,
      ttl: 8, age: 0, slot: i, dead: false,
    };
    this.slots[i] = shell;
    this.physics.register(collider, shell);
  }

  // ── detonation ──────────────────────────────────────────────
  detonate(shell, other) {
    if (shell.dead) return;
    shell.dead = true;
    const t = shell.body.translation();
    const lv = shell.body.linvel();
    const pos = { x: t.x, y: t.y, z: t.z };
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const inv = 1 / Math.max(speed, 0.001);
    const dir = { x: lv.x * inv, y: lv.y * inv, z: lv.z * inv };

    const spec = shell.spec;

    // Direct hit does concentrated damage on top of the blast.
    if (other?.kind === 'prop') {
      game.destruction.damage(other, spec.damage, pos, dir, spec.power);
    }

    game.destruction.explode(
      pos, spec.radius, spec.power, Math.max(0.6, spec.radius / 16),
      other?.kind === 'prop' ? other : null,
    );

    // Water hits also throw a column of spray.
    if (isWaterAt(pos.x, pos.z) && pos.y < WATER_LEVEL + 3) {
      game.fx.splash(pos.x, WATER_LEVEL, pos.z, 2.2);
    }

    this.pending.push(shell.slot);
  }

  _despawn(i) {
    const s = this.slots[i];
    if (!s) return;
    this.physics.unregister(s.collider);
    this.physics.removeBody(s.body);
    this.slots[i] = null;
    this.mesh.setMatrixAt(i, this._hidden);
  }

  // ── per-frame ───────────────────────────────────────────────
  update(dt) {
    // Deferred removal: never mutate the physics world inside an event callback.
    while (this.pending.length) this._despawn(this.pending.pop());

    for (let i = 0; i < this.max; i++) {
      const s = this.slots[i];
      if (!s) continue;
      s.ttl -= dt;
      s.age += dt;

      const t = s.body.translation();
      // Sinking shells fizzle out rather than bouncing around the riverbed.
      if (s.ttl <= 0 || t.y < -30) {
        this._despawn(i);
        continue;
      }

      const r = s.body.rotation();
      this._p.set(t.x, t.y, t.z);
      this._q.set(r.x, r.y, r.z, r.w);
      this._s.setScalar(s.spec.ballRadius);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);

      // Smoke trail.
      if (s.age > 0.02) {
        game.fx.glow.emit(
          t.x, t.y, t.z,
          (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
          1.0, 0.5, 0.15,
          s.spec.ballRadius * 3.4, 0.24, 0, 2.5,
        );
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setNight(n) {
    this.material.emissiveIntensity = 0.9 + n * 1.6;
  }
}
