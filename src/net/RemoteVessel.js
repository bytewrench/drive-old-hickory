// ──────────────────────────────────────────────────────────────
// Another player's boat, as seen from here.
//
// It is NOT simulated: no buoyancy, no wheels, no forces. Its owner
// is the only authority on where it is, and we just replay what they
// tell us, ~90 ms in the past so there are always two samples to
// blend between. What it *does* have is a real kinematic collider,
// which is what lets you ram somebody and lets your shells hit them.
//
// Kinematic bodies win every contact against dynamic ones, so the
// ghost never gets shoved off its owner's reported path — the local
// player is the one who bounces. That's the correct asymmetry: each
// client is only ever wrong about boats it doesn't own.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RAPIER } from '../core/Physics.js';
import { INTERP_DELAY_MS, EXTRAPOLATE_MS, FLAG } from '../../shared/protocol.js';
import { VESSELS } from '../vehicles/vesselConfigs.js';
import { buildVessel } from '../vehicles/VesselMesh.js';
import { WATER_LEVEL } from '../config.js';
import { game } from '../game.js';

/** Snapshots kept per boat — a second of history at 20 Hz is plenty. */
const BUFFER_MAX = 24;

export class RemoteVessel {
  constructor(physics, scene, { id, name, vessel = 0 }) {
    this.physics = physics;
    this.scene = scene;
    this.id = id;
    this.name = name;
    this.vesselIndex = -1;
    /** Hull integrity as a percentage — see Multiplayer.update. */
    this.hp = 100;
    this.dead = false;
    this.boosting = false;
    this.speed = 0;

    /** @type {Array<{t:number,p:THREE.Vector3,q:THREE.Quaternion,v:THREE.Vector3}>} */
    this.buffer = [];
    this.position = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this._fxClock = 0;
    this._v = new THREE.Vector3();

    this._setVessel(vessel);
  }

  // ── model + collider ────────────────────────────────────────
  /** Swapping vessels rebuilds both, exactly as the local player does. */
  _setVessel(index) {
    const i = Math.max(0, Math.min(VESSELS.length - 1, index | 0));
    if (i === this.vesselIndex) return;
    this.vesselIndex = i;
    this.cfg = VESSELS[i];

    this._disposeModel();
    this._disposeBody();

    this.model = buildVessel(this.cfg);
    this.model.group.position.copy(this.position);
    this.model.group.quaternion.copy(this.quat);
    this.scene.add(this.model.group);
    this.setNight(game.night ?? 0);

    const { hx, hy, hz } = this.cfg.hull;
    this.body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.position.x, this.position.y, this.position.z)
        .setRotation({ x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w }),
    );
    this.collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(0.5)
        .setRestitution(0.3)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    this.entity = { kind: 'remote', id: this.id, remote: this };
    this.physics.register(this.collider, this.entity);
  }

  // ── inbound state ───────────────────────────────────────────
  /** @param {object} s unpacked snapshot row */
  applyState(s, now = performance.now()) {
    if (s.vessel !== this.vesselIndex) this._setVessel(s.vessel);

    this.hp = s.hp;
    const wasDead = this.dead;
    this.dead = (s.flags & FLAG.DEAD) !== 0;
    this.boosting = (s.flags & FLAG.BOOSTING) !== 0;
    this.onLand = (s.flags & FLAG.ONLAND) !== 0;
    this.turretYaw = s.turretYaw;
    this.turretPitch = s.turretPitch;

    if (this.dead && !wasDead) this._onRemoteDeath();

    this.buffer.push({
      t: now,
      p: new THREE.Vector3(s.px, s.py, s.pz),
      q: new THREE.Quaternion(s.qx, s.qy, s.qz, s.qw).normalize(),
      v: new THREE.Vector3(s.vx, s.vy, s.vz),
    });
    while (this.buffer.length > BUFFER_MAX) this.buffer.shift();

    // First packet: jump straight there rather than sliding in from origin.
    if (this.buffer.length === 1) {
      this.position.copy(this.buffer[0].p);
      this.quat.copy(this.buffer[0].q);
      this._teleportBody();
    }
  }

  _onRemoteDeath() {
    game.fx?.explosion(this.position.x, this.position.y + 1, this.position.z, 2.2);
    game.audio?.explosion();
  }

  // ── per-frame ───────────────────────────────────────────────
  /** Replay the buffer at (now − INTERP_DELAY) and drive the body there. */
  update(dt, now = performance.now()) {
    const target = now - INTERP_DELAY_MS;
    const buf = this.buffer;
    if (!buf.length) return;

    // Drop samples we're fully past, always keeping one to blend from.
    while (buf.length > 2 && buf[1].t <= target) buf.shift();

    if (buf.length >= 2 && buf[0].t <= target) {
      const a = buf[0], b = buf[1];
      const span = b.t - a.t;
      const k = span > 0 ? Math.min(1, (target - a.t) / span) : 1;
      this.position.lerpVectors(a.p, b.p, k);
      this.quat.slerpQuaternions(a.q, b.q, k);
      this.velocity.lerpVectors(a.v, b.v, k);
    } else {
      // Nothing new: carry on along the last known velocity for a moment,
      // then hold still rather than sailing off into the hills.
      const last = buf[buf.length - 1];
      const ahead = Math.min(target - last.t, EXTRAPOLATE_MS) / 1000;
      this.velocity.copy(last.v);
      if (ahead > 0) {
        this.position.copy(last.p).addScaledVector(last.v, ahead);
      } else {
        this.position.copy(last.p);
      }
      this.quat.copy(last.q);
    }

    this.speed = this.velocity.length();

    // Kinematic bodies are moved by *asking* for a pose; Rapier resolves the
    // sweep against anything in the way during the step.
    this.body.setNextKinematicTranslation(this.position);
    this.body.setNextKinematicRotation({
      x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w,
    });

    const g = this.model.group;
    g.visible = !this.dead;
    g.position.copy(this.position);
    g.quaternion.copy(this.quat);
    this.model.update?.(dt, { throttle: Math.min(this.speed / 20, 1), onLand: !!this.onLand });
    if (this.model.turretYaw) {
      this.model.turretYaw.rotation.y = this.turretYaw || 0;
      this.model.turretPitch.rotation.x = this.turretPitch || 0;
    }

    if (!this.dead) this._emitFx(dt);
  }

  /** A wake and a boost flame, so remote boats read as moving, not sliding. */
  _emitFx(dt) {
    const fx = game.fx;
    if (!fx || this.speed < 3) return;

    this._fxClock += dt;
    const bursts = Math.min(Math.floor(this._fxClock * 24), 2);
    if (bursts <= 0) return;
    this._fxClock -= bursts / 24;

    const fwd = this._v.set(0, 0, 1).applyQuaternion(this.quat);
    const stern = fwd.clone().multiplyScalar(-this.cfg.hull.hz * 1.55).add(this.position);

    if (!this.onLand && Math.abs(this.position.y - WATER_LEVEL) < 3) {
      const i = Math.min(Math.max(this.speed / 42, 0.12), 0.85);
      for (let b = 0; b < bursts; b++) {
        fx.wake(stern.x, WATER_LEVEL + 0.1, stern.z,
          this.velocity.x, this.velocity.z, i * this.cfg.fx.wakeScale);
      }
    }

    if (this.boosting) {
      fx.boostFlame(
        stern.x, stern.y + 0.25, stern.z,
        -fwd.x * 12 + this.velocity.x * 0.25, 1.2, -fwd.z * 12 + this.velocity.z * 0.25, 1,
      );
    }
  }

  setNight(n) {
    for (const m of this.model?.neon ?? []) m.emissiveIntensity = 0.35 + n * 3.2;
  }

  // ── teardown ────────────────────────────────────────────────
  _teleportBody() {
    if (!this.body) return;
    this.body.setTranslation(this.position, true);
    this.body.setRotation(
      { x: this.quat.x, y: this.quat.y, z: this.quat.z, w: this.quat.w }, true,
    );
  }

  _disposeModel() {
    if (!this.model) return;
    this.scene.remove(this.model.group);
    this.model.dispose?.();
    this.model = null;
  }

  _disposeBody() {
    if (!this.body) return;
    this.physics.unregister(this.collider);
    this.physics.removeBody(this.body);
    this.body = null;
    this.collider = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._disposeModel();
    this._disposeBody();
  }
}
