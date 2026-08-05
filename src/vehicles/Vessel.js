// ──────────────────────────────────────────────────────────────
// The vehicle controller.
//
// One dynamic rigid body carries BOTH modes at once:
//   · hull buoyancy + hydrodynamic drag while it is in water
//   · four raycast suspension wheels that take over on land
// Neither is switched off; whichever surface the probes find wins,
// so riverbank transitions happen mid-slide without losing speed.
//
// Damping is deliberately near-zero and no force is velocity-capped
// — top speed is limited only by drag, and boost cuts drag as well
// as adding thrust, so speed keeps climbing as long as you hold it.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { RAPIER } from '../core/Physics.js';
import { WATER_LEVEL, GRAVITY, HALF_MAP } from '../config.js';
import { sampleHeight, isWaterAt, waveHeight, HUNTERS_POINT } from '../world/heightfield.js';
import { buildVessel } from './VesselMesh.js';
import { game } from '../game.js';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const MODE = { WATER: 'water', LAND: 'land', AIR: 'air' };

export class Vessel {
  constructor(physics, scene, cfg, spawn) {
    this.physics = physics;
    this.scene = scene;
    this.cfg = cfg;

    // ── scratch (allocation-free hot path) ──
    this.position = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.fwd = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._com = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ray = new THREE.Raycaster();

    this.submerged = 0;
    this.wheelContacts = 0;
    this.deploy = cfg.hover ? 1 : 0;
    this.mode = MODE.WATER;
    this.speed = 0;
    this.boostFuel = 1;
    this.boosting = false;
    this.heading = 0;
    this.airTime = 0;
    this.bestAir = 0;
    this.turretYaw = 0;
    this.turretPitch = 0;
    /** Smoothed helm position, −1 … +1. */
    this.steerCmd = 0;
    this.fireCooldown = 0;
    this.broadsideSide = 0;
    this._wasSubmerged = 0;

    this._buildBody(spawn ?? { x: HUNTERS_POINT.dockX, y: 2.5, z: HUNTERS_POINT.dockZ });
    this._buildMesh();
    this._buildProbes();
  }

  // ── construction ────────────────────────────────────────────
  _buildBody(spawn) {
    const world = this.physics.world;
    const c = this.cfg;

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(0.02)      // near-zero: speed must keep scaling
      .setAngularDamping(0.25)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = world.createRigidBody(desc);

    const hullDesc = RAPIER.ColliderDesc
      .cuboid(c.hull.hx, c.hull.hy, c.hull.hz)
      .setDensity(c.density)
      .setFriction(0.55)
      .setRestitution(0.22)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.hullCollider = world.createCollider(hullDesc, this.body);

    // Optional low ballast block keeps the centre of mass under the waterline.
    if (c.ballast) {
      const b = c.ballast;
      const bd = RAPIER.ColliderDesc
        .cuboid(b.hx, b.hy, b.hz)
        .setTranslation(0, b.y, 0)
        .setDensity(b.density)
        .setFriction(0.6)
        .setRestitution(0.1);
      this.ballastCollider = world.createCollider(bd, this.body);
    }

    this.entity = { kind: 'vessel', vessel: this };
    this.physics.register(this.hullCollider, this.entity);
    if (this.ballastCollider) this.physics.register(this.ballastCollider, this.entity);

    this.mass = this.body.mass();
  }

  _buildMesh() {
    this.model = buildVessel(this.cfg);
    this.scene.add(this.model.group);

    const L = this.cfg.land;
    this.wheels = this.cfg.wheels.map(([x, y, z, steer, drive], i) => ({
      local: new THREE.Vector3(x, y, z),
      steer, drive,
      radius: L.radius,
      rest: L.rest,
      susLen: L.rest,
      prevSusLen: L.rest,
      contact: false,
      spin: 0,
      view: this.model.wheels[i],
    }));
  }

  /**
   * Eight probes at the corners of the hull box — top ones included. Sampling
   * the whole volume rather than just the bottom face makes displacement
   * orientation-independent: a rolled or inverted hull still reports real
   * submersion, so it keeps its buoyancy and can be pushed back upright.
   *
   * `probeDepth` = half the hull height puts the resting waterline at ~45% of
   * the hull for a `strength` of ~2.2× weight.
   */
  _buildProbes() {
    const { hx, hy, hz } = this.cfg.hull;
    this.probeDepth = hy;
    this.probes = [];
    for (const sy of [-1, 1]) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          this.probes.push(new THREE.Vector3(hx * 0.78 * sx, hy * sy, hz * 0.82 * sz));
        }
      }
    }
  }

  // ── frame helpers ───────────────────────────────────────────
  readTransform() {
    // Touching a removed rigid body panics the Rapier WASM module, and a
    // panicked module stays broken, so every entry point checks this first.
    if (this.disposed) return;
    const t = this.body.translation();
    const r = this.body.rotation();
    this.position.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);

    const lv = this.body.linvel();
    const av = this.body.angvel();
    this.vel.set(lv.x, lv.y, lv.z);
    this.angVel.set(av.x, av.y, av.z);
    this.speed = this.vel.length();

    const com = this.body.worldCom();
    this._com.set(com.x, com.y, com.z);

    this.heading = Math.atan2(this.fwd.x, this.fwd.z);
  }

  /** World velocity of a point rigidly attached to the hull. */
  pointVelocity(p, out) {
    out.copy(p).sub(this._com).cross(this.angVel).multiplyScalar(-1).add(this.vel);
    return out;
  }

  addForceAt(fx, fy, fz, p) {
    this.body.addForceAtPoint({ x: fx, y: fy, z: fz }, { x: p.x, y: p.y, z: p.z }, true);
  }

  /**
   * Torque that rotates the hull's up-axis back onto world up, with a
   * magnitude proportional to the tilt *angle* rather than its sine — so a
   * fully inverted hull gets the strongest push instead of the weakest.
   * (`UP × up` vanishes at both 0° and 180°, which is what let a capsized
   * boat float upside down forever.)
   */
  _uprightTorque(m, k) {
    const axis = this._v.copy(UP).cross(this.up);
    let len = axis.length();
    if (len < 1e-4) {
      if (this.up.y > 0) return;          // already level
      axis.copy(this.right);              // exactly inverted — any axis will do
      len = 1;
    } else {
      axis.multiplyScalar(1 / len);
    }
    const angle = Math.atan2(len, this.up.y);   // 0 … π
    const s = angle * k * m;
    this.body.addTorque({ x: -axis.x * s, y: -axis.y * s, z: -axis.z * s }, true);
  }

  // ── the physics step ────────────────────────────────────────
  fixedUpdate(dt, input, time) {
    if (this.disposed) return;

    // Rapier accumulates user forces until they are explicitly cleared — every
    // force we add below is a *this step only* force, so wipe last step's first.
    this.body.resetForces(false);
    this.body.resetTorques(false);

    this.readTransform();
    const c = this.cfg;
    const m = this.mass;

    const throttle = input.throttle;

    // Smooth the raw ±1 key input into a helm position. A real wheel takes
    // time to wind on, and this single change is most of what separates
    // "boat" from "go-kart" — taps no longer jolt the bow.
    const rawSteer = input.steer;
    this.steerCmd += (rawSteer - this.steerCmd)
      * (1 - Math.exp(-(rawSteer === 0 ? c.helm.centre : c.helm.rate) * dt));
    if (Math.abs(this.steerCmd) < 1e-4) this.steerCmd = 0;
    const steer = this.steerCmd;

    // ── boost fuel ──
    const wantBoost = input.boost && this.boostFuel > 0.02 && throttle !== 0;
    this.boosting = wantBoost;
    const B = c.boost;
    this.boostFuel = clamp(
      this.boostFuel + (wantBoost ? -B.drain : B.refill) * dt, 0, 1,
    );
    const boostMul = wantBoost ? B.mult : 1;

    // ── buoyancy ──
    this._wasSubmerged = this.submerged;
    let sub = 0;
    const bq = c.buoyancy;
    const n = this.probes.length;
    for (let i = 0; i < n; i++) {
      const wp = this._v.copy(this.probes[i]).applyQuaternion(this.quat).add(this.position);
      if (!isWaterAt(wp.x, wp.z)) continue;
      const surf = WATER_LEVEL + waveHeight(wp.x, wp.z, time);
      const depth = surf - wp.y;
      if (depth <= 0) continue;
      const s = Math.min(depth / this.probeDepth, 1);
      sub += s;

      const pv = this.pointVelocity(wp, this._v2);
      const lift = (s * bq.strength * m * -GRAVITY) / n;
      const damp = -pv.y * bq.vertDamp * m / n;
      this.addForceAt(0, lift + damp, 0, wp);
    }
    this.submerged = sub / n;

    // ── aerodynamic drag (always on) ──
    // Everything below is gated on being submerged, which left the
    // Hover-Cruiser — never submerged by design — with no resistance at all.
    // It just accelerated forever and became uncontrollable.
    const airCd = c.drag.air ?? 0.0008;
    if (airCd > 0 && this.speed > 0.1) {
      const k = -this.speed * airCd * m;
      this.body.addForce({ x: this.vel.x * k, y: this.vel.y * k * 0.4, z: this.vel.z * k }, true);
    }

    // ── hydrodynamic drag ──
    if (this.submerged > 0.001) {
      const s = this.submerged;
      const vf = this.vel.dot(this.fwd);
      const vr = this.vel.dot(this.right);
      const vy = this.vel.y;
      const d = c.drag;

      // Boost slices through the water — that's what keeps top speed open-ended.
      const fwdCd = d.fwd * (wantBoost ? 0.25 : 1);

      const f = this._v.set(0, 0, 0)
        .addScaledVector(this.fwd, -vf * Math.abs(vf) * fwdCd * m * s)
        .addScaledVector(this.right, -vr * Math.abs(vr) * d.lat * m * s);
      f.y += -vy * Math.abs(vy) * d.vert * m * s;
      this.body.addForce({ x: f.x, y: f.y, z: f.z }, true);

      // Yaw is damped only lightly because the servo below owns the rate of
      // turn. Roll/pitch damping lives in the attitude keeper further down.
      this.body.addTorque({ x: 0, y: -this.angVel.y * d.yaw * m * s, z: 0 }, true);

      // ── thrust + rudder ──
      const W = c.water;
      const sternLocal = this._v2.set(0, 0, W.sternZ).applyQuaternion(this.quat).add(this.position);
      const drive = throttle > 0 ? throttle : throttle * W.reverse;
      const thrust = W.thrust * m * drive * boostMul * s;
      this.addForceAt(this.fwd.x * thrust, this.fwd.y * thrust, this.fwd.z * thrust, sternLocal);

      // Hydrodynamic settling: the faster you go, the harder the hull is
      // sucked onto the water. Without this a light hull launches off every
      // wave crest at speed and spends the turn airborne and uncontrollable.
      const planted = clamp(this.speed / 26, 0, 1) * W.settle * m * s;
      this.body.addForce({ x: 0, y: -planted, z: 0 }, true);

      // Rudder authority scales with how fast water flows past the blade, so
      // the boat goes slack when you cut the throttle — as it should. Kept
      // small: this is the stern-swing *feel*, while the servo below owns the
      // actual rate of turn.
      const flow = clamp(Math.abs(vf), 0, 34);
      if (this.steerCmd !== 0) {
        const rf = -this.steerCmd * W.rudder * m * (flow + 5) * s;
        this.addForceAt(this.right.x * rf, this.right.y * rf, this.right.z * rf, sternLocal);
      }

      // Yaw-rate servo: steering asks for a *rate of turn*, and we apply only
      // the torque needed to reach it. That is what makes a boat feel soft and
      // controlled instead of car-like — you cannot snap the bow around or
      // spin out, and letting go settles smoothly instead of pinballing.
      const targetYaw = this.steerCmd * W.turnRate * clamp(flow / 9, 0, 1);
      const yawErr = targetYaw - this.angVel.y;
      this.body.addTorque({ x: 0, y: yawErr * W.yawServo * m * s, z: 0 }, true);

      // Heel into the turn — but as a servo onto a target *angle*, not a raw
      // torque. A constant roll torque against a rate-damper settles at a
      // constant roll *rate*, which just rolls the boat over and over.
      const heelNow = Math.asin(clamp(this.right.y, -1, 1));
      const heelWant = this.steerCmd * clamp(flow / 26, 0, 1) * W.heel;
      const heelTorque = (heelWant - heelNow) * W.heelServo * m * s;
      this.body.addTorque({
        x: this.fwd.x * heelTorque, y: 0, z: this.fwd.z * heelTorque,
      }, true);

    }

    // ── ATV wheels ──
    const wantWheels = c.hover ? 1 : (this.submerged < 0.34 ? 1 : 0);
    this.deploy += (wantWheels - this.deploy) * (1 - Math.exp(-4.5 * dt));
    this._updateWheels(dt, throttle, steer, boostMul, input.handbrake, time);

    // ── airborne handling ──
    if (this.wheelContacts === 0 && this.submerged < 0.05) {
      this.airTime += dt;

      // Bleed off yaw spin so a bad landing settles instead of pirouetting.
      this.body.addTorque({ x: 0, y: -this.angVel.y * m * 0.5, z: 0 }, true);
      // Light stunt control — enough to tweak a jump, never enough to loop.
      this.body.addTorque({
        x: this.right.x * throttle * m * 0.45 + this.fwd.x * steer * m * 0.3,
        y: steer * m * 0.8,
        z: this.right.z * throttle * m * 0.45 + this.fwd.z * steer * m * 0.3,
      }, true);
    } else {
      if (this.airTime > 0.9) {
        this.bestAir = Math.max(this.bestAir, this.airTime);
        game.hud?.toast(`${this.airTime.toFixed(1)}s AIRTIME`, this.airTime > 2);
        game.addScoreFromAir?.(this.airTime);
      }
      this.airTime = 0;
    }

    // ── mode ──
    this.mode = this.submerged > 0.15 ? MODE.WATER
      : this.wheelContacts > 0 ? MODE.LAND
        : MODE.AIR;

    // ── attitude keeper (every mode, no gaps) ──
    // This used to live inside the water and airborne branches, which left a
    // hole exactly where the Hover-Cruiser lives: never submerged, always in
    // pad contact, so it got no roll damping or self-righting at all and
    // flipped constantly. Roll and pitch are now always looked after.
    {
      const wet = this.submerged;
      const grounded = this.wheelContacts > 0 ? 1 : 0;
      const upK = Math.max(wet * 4.0, grounded * (c.land.uprightK ?? 4.5),
        this.mode === MODE.AIR ? 3.4 : 0);
      this._uprightTorque(m, upK);

      // The floor matters: airborne is exactly when a tumble runs away, and a
      // craft that spends time off the surface needs roll bled off in the air.
      const rollDamp = Math.max(wet * c.drag.roll, grounded * (c.land.rollDamp ?? 9.0), 3.2);
      this.body.addTorque({
        x: -this.angVel.x * rollDamp * m,
        y: 0,
        z: -this.angVel.z * rollDamp * m,
      }, true);
    }

    // ── rescues ──
    // Only rescue for falling through the world or actually leaving the map —
    // the edge margin scales with the real map size (this used to be a
    // hardcoded 520 from the old 900 m map, which teleported you home 460 m
    // out on the 8 km map).
    const edge = HALF_MAP - 12;
    if (this.position.y < -60 || Math.abs(this.position.x) > edge || Math.abs(this.position.z) > edge) {
      this.reset();
    }

    // Beached on its back somewhere the righting torque can't help: after a few
    // seconds of going nowhere, flip it upright in place rather than stranding
    // the player. (`R` does a full respawn; this is the automatic version.)
    if (this.up.y < 0.15 && this.speed < 2.5) {
      this.stuckTimer = (this.stuckTimer || 0) + dt;
      if (this.stuckTimer > 3) {
        this.stuckTimer = 0;
        this.body.setRotation({ x: 0, y: Math.sin(this.heading / 2), z: 0, w: Math.cos(this.heading / 2) }, true);
        this.body.setTranslation({ x: this.position.x, y: this.position.y + 2, z: this.position.z }, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        game.hud?.toast('RIGHTED');
      }
    } else {
      this.stuckTimer = 0;
    }

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
  }

  _updateWheels(dt, throttle, steer, boostMul, handbrake, time) {
    const c = this.cfg;
    const L = c.land;
    const m = this.mass;
    const nW = this.wheels.length;
    // A wheeled suspension pushes along the chassis' own up axis — correct for
    // a car, which stays roughly level. An air cushion instead presses
    // straight down on the surface, so its reaction is world-vertical. Using
    // body-up for the hovercraft meant that once it tilted, the pads pushed
    // sideways and tipped it further, and it would slowly roll itself over in
    // open water. World-up makes the low pad compress more and push it back.
    const upDir = c.hover ? UP : this.up;
    const down = this._v2.copy(upDir).multiplyScalar(-1);
    let contacts = 0;

    if (this.deploy < 0.02) {
      for (const w of this.wheels) { w.contact = false; w.susLen = w.rest; }
      this.wheelContacts = 0;
      return;
    }

    // First pass: how many wheels are actually on something?
    for (const w of this.wheels) {
      const anchor = this._v.copy(w.local).applyQuaternion(this.quat).add(this.position);
      const maxToi = w.rest + w.radius;
      let d = this.physics.castDown(anchor, down, maxToi);

      if (c.hover && isWaterAt(anchor.x, anchor.z)) {
        // Hover pads treat the water surface as solid ground.
        const surf = WATER_LEVEL + waveHeight(anchor.x, anchor.z, time);
        const dw = anchor.y - surf;                 // upDir is world-vertical
        if (dw > 0 && dw <= maxToi && (d < 0 || dw < d)) d = dw;
      }

      w.contact = d >= 0;
      w.hitDist = d;
      w.anchor = w.anchor || new THREE.Vector3();
      w.anchor.copy(anchor);
      if (w.contact) contacts++;
    }
    this.wheelContacts = contacts;
    if (contacts === 0) {
      for (const w of this.wheels) {
        w.prevSusLen = w.susLen;
        w.susLen += (w.rest - w.susLen) * Math.min(1, 10 * dt);
      }
      return;
    }

    // Suspension pushes along the *body's* up axis, which is only meaningful
    // while the hull is roughly the right way up. Past ~50° of tilt those
    // forces point sideways and drive the roll instead of resisting it — that
    // is what used to flip the hovercraft onto its back. Fade them out.
    const uprightness = clamp((this.up.y - 0.30) / 0.35, 0, 1);

    const gripShare = (handbrake ? L.grip * 0.12 : L.grip) / nW * uprightness;
    const contactPt = new THREE.Vector3();
    const wheelFwd = new THREE.Vector3();
    const wheelRight = new THREE.Vector3();
    const steerQ = new THREE.Quaternion();
    const pv = new THREE.Vector3();

    for (const w of this.wheels) {
      w.prevSusLen = w.susLen;

      if (!w.contact) {
        w.susLen += (w.rest - w.susLen) * Math.min(1, 10 * dt);
        continue;
      }

      const susLen = clamp(w.hitDist - w.radius, 0, w.rest);
      w.susLen = susLen;

      // ── suspension spring ──
      const compression = 1 - susLen / w.rest;
      const susVel = (w.prevSusLen - susLen) / dt;
      let F = (compression * L.stiffness + susVel * L.damping) * m * this.deploy * uprightness;
      F = clamp(F, 0, L.stiffness * m * 1.6);

      // Apply the spring at a point pulled toward the centreline. At full
      // lever arm a light craft turns every wave slap into a roll impulse
      // bigger than anything that can damp it out — this is an anti-roll bar
      // in all but name, and it is what keeps the hovercraft on its feet.
      const lever = L.rollLever ?? 1;
      const fp = lever === 1 ? w.anchor
        : this._v3.set(w.local.x * lever, w.local.y, w.local.z)
          .applyQuaternion(this.quat).add(this.position)
          .addScaledVector(upDir, -w.susLen);
      this.addForceAt(upDir.x * F, upDir.y * F, upDir.z * F, fp);

      // ── contact frame ──
      contactPt.copy(w.anchor).addScaledVector(upDir, -w.hitDist);
      const steerAng = w.steer ? steer * L.maxSteer : 0;
      steerQ.setFromAxisAngle(upDir, steerAng);
      wheelFwd.copy(this.fwd).applyQuaternion(steerQ);
      wheelRight.copy(this.right).applyQuaternion(steerQ);
      // Project onto the ground plane so grip doesn't fight the suspension.
      wheelFwd.addScaledVector(upDir, -wheelFwd.dot(upDir)).normalize();
      wheelRight.addScaledVector(upDir, -wheelRight.dot(upDir)).normalize();

      this.pointVelocity(contactPt, pv);
      const vLat = pv.dot(wheelRight);
      const vFwd = pv.dot(wheelFwd);

      // ── lateral grip (impulse: kills a fraction of sideways speed) ──
      // Applied at a "roll centre" lifted toward the centre of mass. Cornering
      // force acting way down at the contact patch is a rollover lever, which
      // is what tipped the hovercraft over even after its cushion was fixed.
      const latImp = -vLat * m * gripShare * this.deploy;
      const gripPt = L.rollCentre
        ? this._v4.copy(contactPt).lerp(this._com, L.rollCentre)
        : contactPt;
      this.body.applyImpulseAtPoint(
        { x: wheelRight.x * latImp, y: wheelRight.y * latImp, z: wheelRight.z * latImp },
        { x: gripPt.x, y: gripPt.y, z: gripPt.z }, true,
      );

      // ── drive / brake ──
      if (w.drive && throttle !== 0) {
        const drive = throttle > 0 ? throttle : throttle * L.reverse;
        const eng = L.engine * m * drive * boostMul * this.deploy / nW;
        this.addForceAt(wheelFwd.x * eng, wheelFwd.y * eng, wheelFwd.z * eng, contactPt);
      } else {
        const roll = -vFwd * m * (handbrake ? L.brake * 4 : 0.012) * this.deploy / nW;
        this.body.applyImpulseAtPoint(
          { x: wheelFwd.x * roll, y: wheelFwd.y * roll, z: wheelFwd.z * roll },
          { x: contactPt.x, y: contactPt.y, z: contactPt.z }, true,
        );
      }

      w.spin += (vFwd / Math.max(w.radius, 0.1)) * dt;
      w.steerAng = steerAng;
      w.lastSlip = Math.abs(vLat);
      w.contactPoint = w.contactPoint || new THREE.Vector3();
      w.contactPoint.copy(contactPt);
    }

    // Same rate-limited servo on land, so the ATV mode is planted rather than
    // twitchy and the heavy hulls still come round.
    if (contacts > 1) {
      const target = steer * L.turnRate * clamp(this.speed / 8, 0, 1);
      const err = target - this.angVel.y;
      this.body.addTorque({ x: 0, y: err * L.yawServo * m * this.deploy, z: 0 }, true);
    }
  }

  // ── visuals ─────────────────────────────────────────────────
  updateVisual(dt, input, camera, time) {
    if (this.disposed) return;
    const g = this.model.group;
    g.position.copy(this.position);
    g.quaternion.copy(this.quat);

    for (const w of this.wheels) {
      const v = w.view;
      v.pivot.scale.setScalar(Math.max(0.001, this.deploy));
      v.pivot.position.set(w.local.x, w.local.y - w.susLen * this.deploy, w.local.z);
      v.pivot.rotation.y = w.steerAng || 0;
      v.spin.rotation.x = this.cfg.hover ? 0 : w.spin;
    }

    if (this.model.turretYaw) this._aimTurret(dt, input, camera);
    g.updateMatrixWorld(true);

    this._emitFx(dt, time);
  }

  _aimTurret(dt, input, camera) {
    // Project the cursor onto a horizontal plane through the turret.
    this._plane.constant = -(this.position.y + this.cfg.weapon.turret.y);
    this._ray.setFromCamera(input.ndc, camera);
    const hit = this._ray.ray.intersectPlane(this._plane, this._v);
    if (hit) {
      const dx = hit.x - this.position.x;
      const dz = hit.z - this.position.z;
      const worldYaw = Math.atan2(dx, dz);
      let local = worldYaw - this.heading;
      while (local > Math.PI) local -= Math.PI * 2;
      while (local < -Math.PI) local += Math.PI * 2;

      let delta = local - this.turretYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.turretYaw += delta * (1 - Math.exp(-9 * dt));

      const dist = Math.hypot(dx, dz);
      const targetPitch = clamp(-0.06 - dist * 0.0016, -0.55, 0.22);
      this.turretPitch += (targetPitch - this.turretPitch) * (1 - Math.exp(-7 * dt));
    }
    this.model.turretYaw.rotation.y = this.turretYaw;
    this.model.turretPitch.rotation.x = this.turretPitch;
  }

  /**
   * Wake / spray / dust / flame.
   *
   * Emission is rate-based (bursts per second, accumulated against dt) rather
   * than once per rendered frame: per-frame emission quadrupled the particle
   * count on a 240 Hz display and, at any framerate, packed enough overlapping
   * sprites around the hull to hide the boat completely.
   */
  _emitFx(dt, time) {
    const fx = game.fx;
    if (!fx) return;
    const sp = this.speed;
    const f = this.cfg.fx;

    // Fire each emitter at a fixed rate, independent of framerate.
    this._fxClock = (this._fxClock || 0) + dt;
    const bursts = Math.min(Math.floor(this._fxClock * 34), 3);
    if (bursts > 0) this._fxClock -= bursts / 34;

    if (bursts > 0 && this.mode === MODE.WATER && sp > 3) {
      const i = clamp(sp / 42, 0.12, 0.85);
      // Keep the wake well astern so it trails the boat instead of veiling it.
      const stern = this._v.copy(this.fwd)
        .multiplyScalar(-this.cfg.hull.hz * 1.55).add(this.position);
      for (let b = 0; b < bursts; b++) {
        fx.wake(stern.x, WATER_LEVEL + 0.1, stern.z, this.vel.x, this.vel.z, i * f.wakeScale);
      }

      // Bow spray only once genuinely planing, thrown outboard and low.
      if (sp > 14) {
        const bow = this._v.copy(this.fwd)
          .multiplyScalar(this.cfg.hull.hz * 1.05).add(this.position);
        for (const s of [1, -1]) {
          const p = this._v2.copy(this.right)
            .multiplyScalar(s * this.cfg.hull.hx * 1.5).add(bow);
          fx.spray(p.x, WATER_LEVEL + 0.1, p.z,
            this.right.x * s, this.right.z * s, i * f.sprayScale * 0.4);
        }
      }
    }

    if (bursts > 0 && this.mode === MODE.LAND && sp > 6) {
      for (const w of this.wheels) {
        if (!w.contact || !w.contactPoint) continue;
        const slip = (w.lastSlip || 0) + sp * 0.2;
        if (slip < 8) continue;
        fx.dust(w.contactPoint.x, w.contactPoint.y, w.contactPoint.z,
          this.vel.x, this.vel.z, clamp(slip / 30, 0.15, 0.9));
      }
    }

    if (this.boosting && bursts > 0) {
      const stern = this._v.copy(this.fwd).multiplyScalar(-this.cfg.hull.hz * 1.15)
        .add(this.position).addScaledVector(this.up, 0.25);
      const back = this._v2.copy(this.fwd).multiplyScalar(-12);
      fx.boostFlame(stern.x, stern.y, stern.z,
        back.x + this.vel.x * 0.25, back.y + 1.2, back.z + this.vel.z * 0.25, 1);
    }

    // Splash when the hull slams back into the water.
    if (this.submerged > 0.12 && this._wasSubmerged < 0.03 && Math.abs(this.vel.y) > 6) {
      fx.splash(this.position.x, WATER_LEVEL, this.position.z, clamp(Math.abs(this.vel.y) / 12, 0.6, 2.4));
      game.audio?.splash(clamp(Math.abs(this.vel.y) / 14, 0.4, 1.4));
      game.engine?.addShake(0.5);
    }
  }

  // ── weapons interface ───────────────────────────────────────
  /** @returns {Array<{pos: THREE.Vector3, dir: THREE.Vector3}>} */
  getMuzzles() {
    const out = [];
    const w = this.cfg.weapon;
    const anchors = this.model.muzzleAnchors;
    if (!anchors.length) return out;

    if (w.type === 'turret') {
      const a = anchors[0];
      const pos = a.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(a.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
      out.push({ pos, dir });
      return out;
    }

    if (w.type === 'broadside') {
      // Alternate port / starboard so the barge rocks as it fires.
      this.broadsideSide = 1 - this.broadsideSide;
      const a = anchors[this.broadsideSide] ?? anchors[0];
      const pos = a.getWorldPosition(new THREE.Vector3());
      const dir = this.right.clone().multiplyScalar(this.broadsideSide === 0 ? 1 : -1)
        .addScaledVector(UP, 0.16).normalize();
      out.push({ pos, dir });
      return out;
    }

    const a = anchors[0];
    out.push({
      pos: a.getWorldPosition(new THREE.Vector3()),
      dir: this.fwd.clone().addScaledVector(UP, 0.04).normalize(),
    });
    return out;
  }

  /** @param {number} power weapon blast strength; recoil scales with hull mass. */
  applyRecoil(dir, power) {
    const imp = this.mass * power * 0.004;
    this.body.applyImpulse({
      x: -dir.x * imp, y: -dir.y * imp * 0.4, z: -dir.z * imp,
    }, true);
    game.engine?.addShake(Math.min(power / 700, 1.4));
  }

  // ── lifecycle ───────────────────────────────────────────────
  /** No target = back to Hunters Point Boat Dock, facing open water. */
  reset(target) {
    const x = target?.x ?? HUNTERS_POINT.dockX;
    const z = target?.z ?? HUNTERS_POINT.dockZ;
    const heading = target?.heading ?? HUNTERS_POINT.heading;
    const ground = sampleHeight(x, z);
    const y = Math.max(WATER_LEVEL, ground) + this.cfg.hull.hy + 2.0;

    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(
      { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true,
    );
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.boostFuel = 1;
    this.airTime = 0;
    game.fx?.splash(x, WATER_LEVEL, z, 1.4);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.unregister(this.hullCollider);
    if (this.ballastCollider) this.physics.unregister(this.ballastCollider);
    this.physics.removeBody(this.body);
    this.body = null;
    this.scene.remove(this.model.group);
    this.model.dispose?.();
  }

  setNight(n) {
    for (const m of this.model.neon) m.emissiveIntensity = 0.35 + n * 3.2;
  }
}
