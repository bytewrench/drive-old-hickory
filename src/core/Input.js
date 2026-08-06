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
    this.firing = false;
    this.firePressed = false;
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
    this._onBlur = () => { this.down.clear(); this.firing = false; };

    this._onMove = (e) => {
      this.ndc.x = (e.clientX / innerWidth) * 2 - 1;
      this.ndc.y = -(e.clientY / innerHeight) * 2 + 1;
    };
    this._onDown = (e) => {
      // Touch pointers belong to MobileControls (steering + slingshot); only
      // a real mouse click fires the cannon this way.
      if (!this.enabled || e.button !== 0 || e.pointerType === 'touch') return;
      this.firing = true;
      this.firePressed = true;
    };
    this._onUp = (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) this.firing = false;
    };

    addEventListener('keydown', this._onKeyDown, { passive: false });
    addEventListener('keyup', this._onKeyUp);
    addEventListener('blur', this._onBlur);
    addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerdown', this._onDown);
    addEventListener('pointerup', this._onUp);
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
    // Space is edge-triggered; the mouse button auto-repeats via `firing`;
    // the on-screen FIRE button queues one shot per tap.
    const space = this.consume('Space');
    const click = this.firePressed;
    const btn = this.fireQueued;
    this.firePressed = false;
    this.fireQueued = false;
    return space || click || btn || this.firing;
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  dispose() {
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
    removeEventListener('blur', this._onBlur);
    removeEventListener('pointermove', this._onMove);
    removeEventListener('pointerup', this._onUp);
  }
}

const SWALLOW = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
]);
