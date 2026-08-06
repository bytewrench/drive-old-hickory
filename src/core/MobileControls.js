// ──────────────────────────────────────────────────────────────
// Pointer controls — two schemes, picked by what you're using:
//
//   MOUSE (desktop) → slingshot navigation.
//     • Click a spot on the water to set a drive-to target (a reticle marks
//       it); the boat auto-steers and throttles there.
//     • Press and drag AWAY from the boat to draw a slingshot, then release to
//       fling it the opposite way with a nitro burst (power = pull length).
//     Firing is NOT the mouse — it's SPACE. The mouse is free to navigate/aim.
//
//   TOUCH (mobile) → a floating virtual joystick.
//     • Left ~60% of the screen: touch to spawn a joystick under your thumb;
//       push to steer (x) and throttle (up = forward, down = reverse).
//     • Right side aims the turret. NITRO / FIRE buttons on the right.
//
// Everything writes into Input.virtual, so the vehicle controller is unaware
// of any of it. Keyboard keeps working — using WASD just ignores the target.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { game } from '../game.js';
import { WATER_LEVEL } from '../config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const JOY_R = 62;               // joystick travel radius, px
const DEADZONE = 0.16;
const DRAG_THRESHOLD = 20;      // px before a mouse press becomes a slingshot
const MAX_PULL = 190;           // px pull for full slingshot power

export class MobileControls {
  constructor(canvas, input, engine) {
    this.canvas = canvas;
    this.input = input;
    this.engine = engine;
    this.enabled = false;
    this.touchEnabled = false;

    // Touch joystick + right-side aim.
    this.joy = { id: -1, bx: 0, by: 0, kx: 0, ky: 0 };
    this.aimId = -1;

    // Mouse slingshot / tap-to-target.
    this.target = null;         // THREE.Vector3 world point
    this.boostTimer = 0;
    this.sling = { down: false, id: -1, sx: 0, sy: 0, cx: 0, cy: 0, power: 0, active: false, moved: 0 };

    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    this._buildMarkers();
    this._buildOverlay();
    this._buildJoystick();
    this._bind();
  }

  // ── world markers (mouse target reticle + aim arrow) ────────
  _buildMarkers() {
    const scene = this.engine.scene;
    const ring = new THREE.RingGeometry(2.4, 3.4, 28);
    ring.rotateX(-Math.PI / 2);
    this.reticle = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({
      color: 0xffd166, transparent: true, opacity: 0.9,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.reticle.renderOrder = 20; this.reticle.frustumCulled = false; this.reticle.visible = false;
    scene.add(this.reticle);

    const s = new THREE.Shape();
    s.moveTo(0, 3.2); s.lineTo(1.5, 0.2); s.lineTo(0.6, 0.2);
    s.lineTo(0.6, -3); s.lineTo(-0.6, -3); s.lineTo(-0.6, 0.2);
    s.lineTo(-1.5, 0.2); s.lineTo(0, 3.2);
    const ag = new THREE.ShapeGeometry(s); ag.rotateX(-Math.PI / 2);
    this.arrow = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({
      color: 0xff5d73, transparent: true, opacity: 0.85,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.arrow.renderOrder = 21; this.arrow.frustumCulled = false; this.arrow.visible = false;
    this.arrow.scale.setScalar(1.6);
    scene.add(this.arrow);
  }

  _buildOverlay() {
    const c = document.createElement('canvas');
    c.id = 'touch-overlay';
    Object.assign(c.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '15' });
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

  _buildJoystick() {
    const base = document.createElement('div'); base.id = 'joy-base';
    const knob = document.createElement('div'); knob.id = 'joy-knob';
    base.appendChild(knob); document.body.appendChild(base);
    this.jbase = base; this.jknob = knob;
  }

  // ── binding ─────────────────────────────────────────────────
  _bind() {
    const opts = { passive: false };

    this._onDown = (e) => {
      if (e.target.closest('#mobile-fire, #mobile-boost, #mobile-actions, #vessel-strip, #sound-toggle')) return;

      if (e.pointerType === 'touch') {
        this._enableTouch(); e.preventDefault();
        if (e.clientX < innerWidth * 0.6 && this.joy.id === -1) {
          this.joy.id = e.pointerId;
          this.joy.bx = e.clientX; this.joy.by = e.clientY;
          this.joy.kx = 0; this.joy.ky = 0;
          this._showJoy(true);
        } else if (this.aimId === -1) {
          this.aimId = e.pointerId; this._aim(e.clientX, e.clientY);
        }
      } else {
        // Mouse slingshot / tap.
        if (e.button !== 0) return;
        this._enableMouse(); e.preventDefault();
        const s = this.sling;
        s.down = true; s.id = e.pointerId; s.active = false; s.moved = 0; s.power = 0;
        s.sx = s.cx = e.clientX; s.sy = s.cy = e.clientY;
      }
    };

    this._onMove = (e) => {
      if (e.pointerId === this.joy.id) {
        e.preventDefault();
        let dx = e.clientX - this.joy.bx, dy = e.clientY - this.joy.by;
        const len = Math.hypot(dx, dy);
        if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
        this.joy.kx = dx; this.joy.ky = dy;
        this.jknob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (e.pointerId === this.aimId) {
        e.preventDefault(); this._aim(e.clientX, e.clientY);
      } else if (this.sling.down && e.pointerId === this.sling.id) {
        const s = this.sling;
        s.cx = e.clientX; s.cy = e.clientY;
        s.moved = Math.hypot(s.cx - s.sx, s.cy - s.sy);
        if (s.moved > DRAG_THRESHOLD) s.active = true;
        s.power = clamp((s.moved - DRAG_THRESHOLD) / MAX_PULL, 0, 1);
      }
    };

    this._onUp = (e) => {
      if (e.pointerId === this.joy.id) {
        this.joy.id = -1; this.joy.kx = 0; this.joy.ky = 0; this._showJoy(false);
      } else if (e.pointerId === this.aimId) {
        this.aimId = -1;
      } else if (this.sling.down && e.pointerId === this.sling.id) {
        const s = this.sling; s.down = false;
        if (s.active && s.power > 0.05) this._release();
        else this._tap(s.cx, s.cy);
        s.active = false; s.power = 0; s.id = -1;
      }
    };

    this.canvas.addEventListener('pointerdown', this._onDown, opts);
    addEventListener('pointermove', this._onMove, opts);
    addEventListener('pointerup', this._onUp, opts);
    addEventListener('pointercancel', this._onUp, opts);
  }

  _enableTouch() { this.enabled = true; this.touchEnabled = true; this.input.virtual.active = true; document.body.classList.add('touch-mode'); }
  _enableMouse() { this.enabled = true; }
  _aim(px, py) { this.input.ndc.x = (px / innerWidth) * 2 - 1; this.input.ndc.y = -(py / innerHeight) * 2 + 1; }
  _showJoy(on) {
    if (on) { this.jbase.style.left = `${this.joy.bx}px`; this.jbase.style.top = `${this.joy.by}px`; this.jknob.style.transform = 'translate(0,0)'; }
    this.jbase.classList.toggle('on', on);
  }

  // ── mouse gesture outcomes ──────────────────────────────────
  _tap(px, py) {
    const p = this._screenToGround(px, py);
    if (!p) return;
    const v = game.vessel;
    if (v) {
      const dx = p.x - v.position.x, dz = p.z - v.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const MIN = 90, MAX = 320;                 // reachable waypoint window
      const nd = clamp(d, MIN, MAX);
      p.x = v.position.x + (dx / d) * nd;
      p.z = v.position.z + (dz / d) * nd;
    }
    this.target = p;
  }

  _release() {
    const v = game.vessel;
    if (!v) return;
    const dir = this._slingWorldDir();
    if (!dir) return;
    const power = this.sling.power;
    const imp = v.mass * (5 + power * 26);
    v.body.applyImpulse({ x: dir.x * imp, y: imp * 0.05, z: dir.z * imp }, true);
    this.target = new THREE.Vector3(
      v.position.x + dir.x * (80 + power * 320), 0,
      v.position.z + dir.z * (80 + power * 320),
    );
    this.boostTimer = 0.5 + power * 1.8;
    game.audio?.whoosh();
    game.engine?.addShake(power * 0.7);
  }

  _screenToGround(px, py) {
    const ndc = { x: (px / innerWidth) * 2 - 1, y: -(py / innerHeight) * 2 + 1 };
    this._plane.constant = -WATER_LEVEL;
    this._ray.setFromCamera(ndc, this.engine.camera);
    const hit = this._ray.ray.intersectPlane(this._plane, this._v);
    return hit ? this._v.clone() : null;
  }

  _slingWorldDir() {
    const v = game.vessel;
    if (!v) return null;
    const fg = this._screenToGround(this.sling.cx, this.sling.cy);
    if (!fg) return null;
    this._dir.set(v.position.x - fg.x, 0, v.position.z - fg.z);
    if (this._dir.lengthSq() < 1e-3) this._dir.set(Math.sin(v.heading), 0, Math.cos(v.heading));
    return this._dir.normalize().clone();
  }

  // ── per-frame ───────────────────────────────────────────────
  update() {
    if (!this.enabled) return;
    const vr = this.input.virtual;
    const v = game.vessel;

    if (this.boostTimer > 0) this.boostTimer -= 1 / 60;

    if (this.touchEnabled) {
      // ── joystick drives ──
      vr.active = true;
      if (this.joy.id !== -1) {
        let sx = -this.joy.kx / JOY_R, ty = -this.joy.ky / JOY_R;
        if (Math.hypot(sx, ty) < DEADZONE) { sx = 0; ty = 0; }
        vr.steer = clamp(sx, -1, 1); vr.throttle = clamp(ty, -1, 1);
      } else { vr.steer = 0; vr.throttle = 0; }
      vr.boost = !!(game._holdBoost && game._holdBoost()) || this.boostTimer > 0;
      if (game._holdFire && game._holdFire()) this.input.fireQueued = true;
    } else {
      // ── mouse slingshot/target drives — but only while there IS a target,
      // so keyboard reclaims control the moment you press WASD. ──
      if (this.input.has('KeyW', 'KeyS', 'KeyA', 'KeyD',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight')) this.target = null;
      const driving = !!this.target || this.boostTimer > 0;
      vr.active = driving;
      if (v && this.target) {
        const dx = this.target.x - v.position.x, dz = this.target.z - v.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 40) { this.target = null; vr.throttle = 0; vr.steer = 0; }
        else {
          let err = Math.atan2(dx, dz) - v.heading;
          while (err > Math.PI) err -= Math.PI * 2;
          while (err < -Math.PI) err += Math.PI * 2;
          vr.steer = clamp(err * 1.7, -1, 1);
          vr.throttle = clamp(Math.cos(err) * 1.1, 0.4, 1) * clamp(dist / 130, 0.45, 1);
        }
      } else if (driving) { vr.throttle = 0; vr.steer = 0; }
      vr.boost = this.boostTimer > 0;
    }

    this._drawMarkers(v);
    this._drawOverlay();
  }

  _drawMarkers(v) {
    const t = game.time;
    if (this.target && !this.touchEnabled) {
      this.reticle.visible = true;
      this.reticle.position.set(this.target.x, WATER_LEVEL + 0.4, this.target.z);
      this.reticle.scale.setScalar(1 + Math.sin(t * 5) * 0.12);
      this.reticle.material.opacity = 0.55 + Math.sin(t * 5) * 0.25;
      if (v) {
        this.arrow.visible = true;
        this.arrow.position.set((v.position.x + this.target.x) / 2, WATER_LEVEL + 0.4, (v.position.z + this.target.z) / 2);
        this.arrow.rotation.y = Math.atan2(this.target.x - v.position.x, this.target.z - v.position.z);
      }
    } else { this.reticle.visible = false; this.arrow.visible = false; }
  }

  _drawOverlay() {
    const ctx = this.octx;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!this.sling.active) return;
    const { sx, sy, cx, cy, power } = this.sling;

    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,209,102,${0.5 + power * 0.4})`;
    ctx.lineWidth = 5 + power * 5;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cx, cy); ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,93,115,0.95)';
    ctx.beginPath(); ctx.arc(cx, cy, 16 + power * 8, 0, 7); ctx.fill();

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
