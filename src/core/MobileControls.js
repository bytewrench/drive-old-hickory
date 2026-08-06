// ──────────────────────────────────────────────────────────────
// Pointer controls — two schemes, picked by what you're using. Driving is
// ALWAYS the keyboard / joystick; the mouse is for aiming and a boost-dash.
//
//   MOUSE (desktop)
//     • W A S D drive the boat — always, primary. Shift = nitro.
//     • The mouse aims the Dreadnought's turret (SPACE fires).
//     • Press and drag AWAY from the boat, then release, to SLINGSHOT-DASH:
//       a launch impulse + a short nitro burst in the pulled direction. You
//       keep steering with WASD through the dash. While you're dragging, the
//       turret aim holds still so navigating doesn't swing it around.
//
//   TOUCH (mobile) → a floating virtual joystick.
//     • Left ~60%: joystick (steer + throttle). Right side aims the turret.
//     • NITRO / FIRE buttons on the right.
//
// The slingshot no longer sets an autopilot target, so it never fights the
// keyboard — that's what restores full WASD control while keeping the dash.
// ──────────────────────────────────────────────────────────────

import { game } from '../game.js';
import { WATER_LEVEL } from '../config.js';
import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const JOY_R = 62;
const DEADZONE = 0.16;
const DRAG_THRESHOLD = 20;
const MAX_PULL = 190;

export class MobileControls {
  constructor(canvas, input, engine) {
    this.canvas = canvas;
    this.input = input;
    this.engine = engine;
    this.enabled = false;
    this.touchEnabled = false;

    this.joy = { id: -1, bx: 0, by: 0, kx: 0, ky: 0 };
    this.aimId = -1;
    this.boostTimer = 0;
    this.sling = { down: false, id: -1, sx: 0, sy: 0, cx: 0, cy: 0, power: 0, active: false, moved: 0 };

    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    this._buildOverlay();
    this._buildJoystick();
    this._bind();
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
        if (s.moved > DRAG_THRESHOLD && !s.active) {
          s.active = true;
          this.input.aimLocked = true;      // freeze the turret while dragging
        }
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
        s.active = false; s.power = 0; s.id = -1;
        this.input.aimLocked = false;       // turret follows the mouse again
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

  // ── slingshot dash ──────────────────────────────────────────
  // A launch impulse + a short nitro burst in the pulled direction. It does
  // NOT set a driving target — you keep steering with WASD (or the joystick).
  _release() {
    const v = game.vessel;
    if (!v) return;
    const dir = this._slingWorldDir();
    if (!dir) return;
    const power = this.sling.power;
    const imp = v.mass * (7 + power * 30);
    v.body.applyImpulse({ x: dir.x * imp, y: imp * 0.05, z: dir.z * imp }, true);
    this.boostTimer = 0.4 + power * 1.4;
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

  /**
   * Launch direction = opposite the drag, in world space — exactly the arrow
   * the overlay draws. It's built from the DRAG (start → current), not from the
   * boat's screen position: anchoring on the boat made the direction flip
   * whenever the drag didn't start right on the hull, so a pull could fire the
   * boat the wrong way. Drag-relative is consistent no matter where you grab.
   */
  _slingWorldDir() {
    const v = game.vessel;
    if (!v) return null;
    const start = this._screenToGround(this.sling.sx, this.sling.sy);
    const cur = this._screenToGround(this.sling.cx, this.sling.cy);
    if (!start || !cur) return null;
    // pull-back: you drag away from where you want to go, so launch = start−cur.
    this._dir.set(start.x - cur.x, 0, start.z - cur.z);
    if (this._dir.lengthSq() < 1e-3) this._dir.set(Math.sin(v.heading), 0, Math.cos(v.heading));
    return this._dir.normalize().clone();
  }

  // ── per-frame ───────────────────────────────────────────────
  update() {
    if (!this.enabled) return;
    const vr = this.input.virtual;
    if (this.boostTimer > 0) this.boostTimer -= 1 / 60;

    if (this.touchEnabled) {
      vr.active = true;
      if (this.joy.id !== -1) {
        let sx = -this.joy.kx / JOY_R, ty = -this.joy.ky / JOY_R;
        if (Math.hypot(sx, ty) < DEADZONE) { sx = 0; ty = 0; }
        vr.steer = clamp(sx, -1, 1); vr.throttle = clamp(ty, -1, 1);
      } else { vr.steer = 0; vr.throttle = 0; }
      vr.boost = !!(game._holdBoost && game._holdBoost()) || this.boostTimer > 0;
      if (game._holdFire && game._holdFire()) this.input.fireQueued = true;
    } else {
      // Mouse mode: the keyboard drives (virtual.active stays false); the
      // slingshot only injects a nitro burst on top.
      vr.active = false;
      vr.boost = this.boostTimer > 0;
    }

    this._drawOverlay();
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
