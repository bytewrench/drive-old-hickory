// ──────────────────────────────────────────────────────────────
// Keyboard + mouse + a virtual axis layer driven by MobileControls.
// Exposes a poll-style API (axes for the vehicle controller,
// edge-triggered `consume` for one-shot actions).
// ──────────────────────────────────────────────────────────────

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedThisFrame = new Set();

    /** Normalised device coords of the pointer, for turret aiming. */
    this.ndc = { x: 0, y: 0 };
    this.enabled = false;

    /**
     * Virtual axes written by MobileControls. When `active`, they REPLACE the
     * keyboard axes (throttle/steer/boost) so a tap-target autopilot and the
     * slingshot can drive the boat without a keyboard.
     */
    this.virtual = { active: false, throttle: 0, steer: 0, boost: false };
    /** Set by the on-screen fire button; consumed once like a key press. */
    this.fireQueued = false;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
      // Stop the page scrolling / the browser stealing our keys.
      if (SWALLOW.has(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => { this.down.delete(e.code); };
    this._onBlur = () => { this.down.clear(); };

    // The mouse is for navigation (slingshot) and turret aim — never firing.
    // Firing is its own trigger: SPACE on desktop, the FIRE button on mobile.
    this._onMove = (e) => {
      this.ndc.x = (e.clientX / innerWidth) * 2 - 1;
      this.ndc.y = -(e.clientY / innerHeight) * 2 + 1;
    };

    addEventListener('keydown', this._onKeyDown, { passive: false });
    addEventListener('keyup', this._onKeyUp);
    addEventListener('blur', this._onBlur);
    addEventListener('pointermove', this._onMove);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── axes ──────────────────────────────────────────────────
  /** −1 reverse … +1 forward */
  get throttle() {
    if (this.virtual.active) return this.virtual.throttle;
    return (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
  }

  /** +1 = turn left (positive yaw), −1 = turn right */
  get steer() {
    if (this.virtual.active) return this.virtual.steer;
    return (this.has('KeyA', 'ArrowLeft') ? 1 : 0) - (this.has('KeyD', 'ArrowRight') ? 1 : 0);
  }

  get boost() {
    if (this.virtual.active && this.virtual.boost) return true;
    return this.down.has('ShiftLeft') || this.down.has('ShiftRight');
  }

  get handbrake() {
    return this.down.has('KeyX');
  }

  has(...codes) {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** True exactly once per physical key press. */
  consume(code) {
    if (this.pressedThisFrame.has(code)) {
      this.pressedThisFrame.delete(code);
      return true;
    }
    return false;
  }

  consumeFire() {
    // SPACE (desktop — held auto-repeats at the weapon cooldown) or the
    // on-screen FIRE button (mobile). Never the mouse: the mouse navigates.
    const space = this.down.has('Space');
    const btn = this.fireQueued;
    this.fireQueued = false;
    return space || btn;
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  dispose() {
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('blur', this._onBlur);
    removeEventListener('pointermove', this._onMove);
  }
}

const SWALLOW = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);
