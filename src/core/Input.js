// ──────────────────────────────────────────────────────────────
// Keyboard + mouse. Exposes a poll-style API (axes for the vehicle
// controller, edge-triggered `consume` for one-shot actions).
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
      if (!this.enabled || e.button !== 0) return;
      this.firing = true;
      this.firePressed = true;
    };
    this._onUp = (e) => { if (e.button === 0) this.firing = false; };

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
    return (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
  }

  /** +1 = turn left (positive yaw), −1 = turn right */
  get steer() {
    return (this.has('KeyA', 'ArrowLeft') ? 1 : 0) - (this.has('KeyD', 'ArrowRight') ? 1 : 0);
  }

  get boost() {
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
    // Space is edge-triggered; the mouse button auto-repeats via `firing`.
    const space = this.consume('Space');
    const click = this.firePressed;
    this.firePressed = false;
    return space || click || this.firing;
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
