// ──────────────────────────────────────────────────────────────
// Touch controls — a tap-target + slingshot scheme.
//
//   • TAP a spot on the water/land  → the boat auto-steers and throttles
//     toward it (a pulsing reticle marks the target). Tap again to redirect.
//
//   • PULL BACK & RELEASE (slingshot) → drag away from the boat to draw a
//     slingshot band; the aim arrow points the OPPOSITE way (where you'll
//     launch). Release to fling the boat that way with a nitro burst, power
//     scaled by how far you pulled. It also drops a target out ahead so the
//     boat keeps going after the launch.
//
// The scheme writes into Input.virtual so the existing vehicle controller
// needs no knowledge of touch at all. The turret auto-aims at the target.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { game } from '../game.js';
import { WATER_LEVEL } from '../config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DRAG_THRESHOLD = 22;      // px before a press becomes a slingshot
const MAX_PULL = 190;           // px pull for full power

export class MobileControls {
  constructor(canvas, input, engine) {
    this.canvas = canvas;
    this.input = input;
    this.engine = engine;
    this.enabled = false;

    this.target = null;          // THREE.Vector3 world point, or null
    this.boostTimer = 0;

    // Slingshot state.
    this.sling = { active: false, id: -1, sx: 0, sy: 0, cx: 0, cy: 0, power: 0 };

    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    this._buildMarkers();
    this._buildOverlay();
    this._bind();
  }

  // ── world markers (target reticle + aim arrow) ──────────────
  _buildMarkers() {
    const scene = this.engine.scene;

    const ringGeo = new THREE.RingGeometry(2.4, 3.4, 28);
    ringGeo.rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffd166, transparent: true, opacity: 0.9,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    this.reticle.renderOrder = 20;
    this.reticle.visible = false;
    this.reticle.frustumCulled = false;
    scene.add(this.reticle);

    // A flat arrow that lies on the water pointing at the target.
    const shape = new THREE.Shape();
    shape.moveTo(0, 3.2); shape.lineTo(1.5, 0.2); shape.lineTo(0.6, 0.2);
    shape.lineTo(0.6, -3); shape.lineTo(-0.6, -3); shape.lineTo(-0.6, 0.2);
    shape.lineTo(-1.5, 0.2); shape.lineTo(0, 3.2);
    const arrowGeo = new THREE.ShapeGeometry(shape);
    arrowGeo.rotateX(-Math.PI / 2);
    this.arrow = new THREE.Mesh(
      arrowGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff5d73, transparent: true, opacity: 0.85,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    this.arrow.renderOrder = 21;
    this.arrow.visible = false;
    this.arrow.frustumCulled = false;
    this.arrow.scale.setScalar(1.6);
    scene.add(this.arrow);
  }

  // ── 2D slingshot band overlay ───────────────────────────────
  _buildOverlay() {
    const c = document.createElement('canvas');
    c.id = 'touch-overlay';
    Object.assign(c.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: '15',
    });
    document.body.appendChild(c);
    this.overlay = c;
    this.octx = c.getContext('2d');
    this._resizeOverlay();
    addEventListener('resize', () => this._resizeOverlay());
  }

  _resizeOverlay() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.overlay.width = innerWidth * dpr;
    this.overlay.height = innerHeight * dpr;
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ── touch binding ───────────────────────────────────────────
  _bind() {
    const opts = { passive: false };
    this._onDown = (e) => {
      if (e.pointerType !== 'touch') return;
      this._enable();
      e.preventDefault();
      if (this.sling.active) return;                 // one finger drives
      this.sling.id = e.pointerId;
      this.sling.sx = this.sling.cx = e.clientX;
      this.sling.sy = this.sling.cy = e.clientY;
      this.sling.active = false;                      // not a drag yet
      this.sling.down = true;
      this.sling.moved = 0;
    };
    this._onMove = (e) => {
      if (e.pointerType !== 'touch' || !this.sling.down || e.pointerId !== this.sling.id) return;
      e.preventDefault();
      this.sling.cx = e.clientX;
      this.sling.cy = e.clientY;
      const dx = this.sling.cx - this.sling.sx, dy = this.sling.cy - this.sling.sy;
      this.sling.moved = Math.hypot(dx, dy);
      if (this.sling.moved > DRAG_THRESHOLD) this.sling.active = true;
      this.sling.power = clamp((this.sling.moved - DRAG_THRESHOLD) / MAX_PULL, 0, 1);
    };
    this._onUp = (e) => {
      if (e.pointerType !== 'touch' || !this.sling.down || e.pointerId !== this.sling.id) return;
      e.preventDefault();
      this.sling.down = false;
      if (this.sling.active && this.sling.power > 0.05) this._release();
      else this._tap(this.sling.cx, this.sling.cy);
      this.sling.active = false;
      this.sling.power = 0;
      this.sling.id = -1;
    };
    this.canvas.addEventListener('pointerdown', this._onDown, opts);
    addEventListener('pointermove', this._onMove, opts);
    addEventListener('pointerup', this._onUp, opts);
    addEventListener('pointercancel', this._onUp, opts);
  }

  _enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.input.virtual.active = true;
    document.body.classList.add('touch-mode');
  }

  // ── gesture outcomes ────────────────────────────────────────
  /** Quick tap → drive-to target at the tapped world point. */
  _tap(px, py) {
    const p = this._screenToGround(px, py);
    if (!p) return;
    const v = game.vessel;
    // A tap toward the horizon projects kilometres out; clamp it to a nearby
    // waypoint so the reticle stays on-screen and the boat heads that way.
    // Tap again as you go to follow the river's bends.
    if (v) {
      let dx = p.x - v.position.x, dz = p.z - v.position.z;
      const d = Math.hypot(dx, dz) || 1;
      // The top-down chase cam compresses the near field: a tap just ahead maps
      // to only a few metres. Push every target out to at least MIN so a tap
      // always makes the boat travel, and cap it at MAX so horizon taps stay a
      // reachable waypoint (arrive radius is 40 m, so MIN must clear it).
      const MIN = 90, MAX = 320;
      const nd = Math.min(Math.max(d, MIN), MAX);
      p.x = v.position.x + (dx / d) * nd;
      p.z = v.position.z + (dz / d) * nd;
    }
    this.target = p;
  }

  /** Slingshot release → launch + boost toward the aim, and set a far target. */
  _release() {
    const v = game.vessel;
    if (!v) return;
    const dir = this._slingWorldDir();
    if (!dir) return;

    const power = this.sling.power;
    // Fling: an impulse scaled by hull mass so every vessel launches the same.
    const imp = v.mass * (5 + power * 26);
    v.body.applyImpulse({ x: dir.x * imp, y: imp * 0.05, z: dir.z * imp }, true);

    // Keep going: target well out ahead, and a nitro burst to get there.
    this.target = new THREE.Vector3(
      v.position.x + dir.x * (80 + power * 320), 0,
      v.position.z + dir.z * (80 + power * 320),
    );
    this.boostTimer = 0.5 + power * 1.8;
    game.audio?.whoosh();
    game.engine?.addShake(power * 0.7);
  }

  // ── projection helpers ──────────────────────────────────────
  _screenToGround(px, py) {
    const ndc = { x: (px / innerWidth) * 2 - 1, y: -(py / innerHeight) * 2 + 1 };
    this._plane.constant = -WATER_LEVEL;
    this._ray.setFromCamera(ndc, this.engine.camera);
    const hit = this._ray.ray.intersectPlane(this._plane, this._v);
    return hit ? this._v.clone() : null;
  }

  /** Launch direction: from the pulled-back finger toward the boat, on the ground. */
  _slingWorldDir() {
    const v = game.vessel;
    if (!v) return null;
    // Ground point under the finger; launch AWAY from it (pull-back slingshot).
    const fg = this._screenToGround(this.sling.cx, this.sling.cy);
    if (!fg) return null;
    this._dir.set(v.position.x - fg.x, 0, v.position.z - fg.z);
    if (this._dir.lengthSq() < 1e-3) {
      this._dir.set(Math.sin(v.heading), 0, Math.cos(v.heading));
    }
    return this._dir.normalize().clone();
  }

  // ── per-frame ───────────────────────────────────────────────
  update(dt) {
    if (!this.enabled) return;
    const v = game.vessel;
    const vr = this.input.virtual;

    // Boost pulse from a slingshot launch.
    if (this.boostTimer > 0) { this.boostTimer -= dt; vr.boost = true; }
    else vr.boost = false;

    // Autopilot toward the target.
    if (v && this.target) {
      const dx = this.target.x - v.position.x, dz = this.target.z - v.position.z;
      const dist = Math.hypot(dx, dz);
      // Arrive at a generous radius: a fast boat with a soft helm can't hit a
      // point — it orbits — so we call it "arrived" well before that and coast.
      if (dist < 40) {
        this.target = null;
        vr.throttle = 0; vr.steer = 0;
      } else {
        let err = Math.atan2(dx, dz) - v.heading;
        while (err > Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        vr.steer = clamp(err * 1.7, -1, 1);
        // Ease the throttle down on the final approach (and in hard turns) so
        // it settles onto the target instead of overshooting into an orbit.
        const approach = clamp(dist / 130, 0.45, 1);
        vr.throttle = clamp(Math.cos(err) * 1.1, 0.4, 1) * approach;

        // Turret auto-aims at the target: feed its screen NDC to the vessel.
        const s = this.target.clone().project(this.engine.camera);
        this.input.ndc.x = s.x; this.input.ndc.y = s.y;
      }
    } else if (v) {
      vr.throttle = 0; vr.steer = 0;
    }

    this._drawMarkers(v);
    this._drawOverlay();
  }

  _drawMarkers(v) {
    const t = game.time;
    if (this.target) {
      this.reticle.visible = true;
      this.reticle.position.set(this.target.x, WATER_LEVEL + 0.4, this.target.z);
      const pulse = 1 + Math.sin(t * 5) * 0.12;
      this.reticle.scale.setScalar(pulse);
      this.reticle.material.opacity = 0.55 + Math.sin(t * 5) * 0.25;

      // Arrow midway between boat and target, pointing at it.
      if (v) {
        const mx = (v.position.x + this.target.x) / 2, mz = (v.position.z + this.target.z) / 2;
        this.arrow.visible = true;
        this.arrow.position.set(mx, WATER_LEVEL + 0.4, mz);
        this.arrow.rotation.y = Math.atan2(this.target.x - v.position.x, this.target.z - v.position.z);
      }
    } else {
      this.reticle.visible = false;
      this.arrow.visible = false;
    }
  }

  _drawOverlay() {
    const ctx = this.octx;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!this.sling.active) return;

    const { sx, sy, cx, cy, power } = this.sling;
    // Slingshot band: anchor at start, pulled to the finger.
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,209,102,${0.5 + power * 0.4})`;
    ctx.lineWidth = 5 + power * 5;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cx, cy); ctx.stroke();

    // Anchor + finger pucks.
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(255,93,115,0.95)`;
    ctx.beginPath(); ctx.arc(cx, cy, 16 + power * 8, 0, 7); ctx.fill();

    // Launch arrow (opposite the pull) + power ring around the anchor.
    const ang = Math.atan2(sy - cy, sx - cx);
    const len = 46 + power * 90;
    const ex = sx + Math.cos(ang) * len, ey = sy + Math.sin(ang) * len;
    ctx.strokeStyle = `rgba(255,93,115,${0.7 + power * 0.3})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.4) * 16, ey - Math.sin(ang - 0.4) * 16);
    ctx.lineTo(ex - Math.cos(ang + 0.4) * 16, ey - Math.sin(ang + 0.4) * 16);
    ctx.closePath(); ctx.fillStyle = `rgba(255,93,115,${0.7 + power * 0.3})`; ctx.fill();

    ctx.strokeStyle = 'rgba(78,205,196,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(sx, sy, 26, -Math.PI / 2, -Math.PI / 2 + power * Math.PI * 2); ctx.stroke();
  }
}
