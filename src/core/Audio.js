// ──────────────────────────────────────────────────────────────
// 100% synthesised audio — no asset files, no licences.
// Engine drone (two detuned saws through a moving low-pass),
// plus one-shot noise/FM hits for cannons, splashes and wrecks.
// ──────────────────────────────────────────────────────────────

export class AudioKit {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
  }

  /** Must be called from a user gesture (the LAUNCH button). */
  start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // Shared noise buffer for splashes / explosions / boost hiss.
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._buildEngine();
    this._buildBoost();
    this.ready = true;
  }

  _buildEngine() {
    const ctx = this.ctx;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;

    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.engFilter.Q.value = 5;

    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscA.frequency.value = 60;

    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    this.oscB.frequency.value = 30;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.45;

    this.oscA.connect(this.engFilter);
    this.oscB.connect(subGain).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);

    this.oscA.start();
    this.oscB.start();
  }

  _buildBoost() {
    const ctx = this.ctx;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600;
    bp.Q.value = 0.8;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(bp).connect(this.boostGain).connect(this.master);
    src.start();
    this.boostSrc = src;
  }

  /**
   * @param {number} rpm    0..1 normalised engine load
   * @param {number} load   0..1 throttle
   * @param {boolean} boost
   * @param {boolean} inWater
   */
  updateEngine(rpm, load, boost, inWater) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const base = inWater ? 42 : 58;
    const f = base + rpm * (inWater ? 150 : 230) + (boost ? 60 : 0);

    this.oscA.frequency.setTargetAtTime(f, t, 0.08);
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(320 + rpm * 2400 + load * 700, t, 0.09);
    this.engGain.gain.setTargetAtTime(0.055 + load * 0.075 + rpm * 0.05, t, 0.1);
    this.boostGain.gain.setTargetAtTime(boost ? 0.13 : 0, t, boost ? 0.05 : 0.25);
  }

  _noise(dur, freq, q, gain, type = 'lowpass', sweepTo = null) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;

    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    filt.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, gain, type = 'triangle', slideTo = null) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  cannon() { this._noise(0.42, 900, 1.2, 0.55, 'lowpass', 90); this._tone(120, 0.28, 0.35, 'square', 42); }
  explosion() { this._noise(0.95, 1800, 0.9, 0.7, 'lowpass', 55); this._tone(78, 0.6, 0.4, 'sawtooth', 30); }
  splash(power = 1) { this._noise(0.35, 2600 * power, 1.6, 0.22 * power, 'bandpass', 700); }
  crash() { this._noise(0.5, 2400, 2.4, 0.4, 'bandpass', 220); this._tone(90, 0.22, 0.25, 'square', 45); }
  wood() { this._noise(0.26, 1400, 4.0, 0.3, 'bandpass', 400); }
  pickup() { this._tone(660, 0.14, 0.24, 'square'); setTimeout(() => this._tone(990, 0.18, 0.2, 'square'), 80); }
  quack() { this._tone(420, 0.16, 0.3, 'sawtooth', 240); setTimeout(() => this._tone(360, 0.2, 0.26, 'sawtooth', 180), 110); }
  gate() { this._noise(0.8, 400, 3.0, 0.35, 'bandpass', 120); }
  whoosh() { this._noise(0.5, 300, 0.8, 0.25, 'bandpass', 2200); }
}
