// ──────────────────────────────────────────────────────────────
// 100% synthesised audio — no asset files, no licences.
//
// Tuned for a deep, rumbly character and to be gentle on sensitive
// hearing: a master low-pass caps the whole mix below the harsh
// range, oscillators are triangle/sine (few high harmonics — no
// sawtooth/square buzz), and every one-shot lives low with no
// bandpass "sss"/spiky content. A low shelf adds body underneath.
// ──────────────────────────────────────────────────────────────

/** Global ceiling — nothing bright/harsh gets past this (Hz). */
const MASTER_LP = 1500;

export class AudioKit {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
  }

  /**
   * Toggle sound. Ramps the master gain to silence rather than just skipping
   * updates — otherwise the continuous engine drone would keep sounding at its
   * last level. Safe to call before the context exists.
   * @returns {boolean} the new muted state
   */
  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, t, 0.04);
    }
    return this.muted;
  }

  /** Must be called from a user gesture (the LAUNCH button). */
  start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;

    // Master tone shaping: a gentle low-pass kills the harsh top end for the
    // whole mix, and a low shelf lifts the rumble. This is the main reason the
    // game shouldn't trigger tinnitus — no sharp, hissy or spiky frequencies.
    this.masterLP = this.ctx.createBiquadFilter();
    this.masterLP.type = 'lowpass';
    this.masterLP.frequency.value = MASTER_LP;
    this.masterLP.Q.value = 0.2;

    this.lowShelf = this.ctx.createBiquadFilter();
    this.lowShelf.type = 'lowshelf';
    this.lowShelf.frequency.value = 160;
    this.lowShelf.gain.value = 5;

    // A soft limiter so the added low end never clips into a nasty crackle.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.005;
    this.limiter.release.value = 0.15;

    this.master.connect(this.masterLP);
    this.masterLP.connect(this.lowShelf);
    this.lowShelf.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    // Shared noise buffer for splashes / explosions / boost air.
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

    // Warm, low cutoff with barely any resonance — a rounded rumble, not a
    // whine. (The old cutoff swept to ~3.4 kHz with a high-Q peak, which is
    // exactly the piercing kind of tone to avoid.)
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 320;
    this.engFilter.Q.value = 0.9;

    // Deep sub-bass sine — the core of the rumble.
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'sine';
    this.engSub.frequency.value = 42;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.6;

    // Body: a triangle (few harmonics) an octave up, plus a softer one below.
    this.oscA = ctx.createOscillator();
    this.oscA.type = 'triangle';
    this.oscA.frequency.value = 60;

    this.oscB = ctx.createOscillator();
    this.oscB.type = 'triangle';
    this.oscB.frequency.value = 30;
    const bGain = ctx.createGain();
    bGain.gain.value = 0.4;

    // Slow tremolo → a chugging diesel rumble instead of a flat drone.
    this.chug = ctx.createOscillator();
    this.chug.type = 'sine';
    this.chug.frequency.value = 7;
    this.chugGain = ctx.createGain();
    this.chugGain.gain.value = 0.18;
    this.chug.connect(this.chugGain).connect(this.engGain.gain);

    this.oscA.connect(this.engFilter);
    this.oscB.connect(bGain).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    // Sub bypasses the body filter and goes low + direct for weight.
    this.engSub.connect(this.subGain).connect(this.engGain);

    this.engSub.start();
    this.oscA.start();
    this.oscB.start();
    this.chug.start();
  }

  _buildBoost() {
    const ctx = this.ctx;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;

    // Low-passed noise = a low airy roar, NOT the old hissy 1.6 kHz bandpass.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    lp.Q.value = 0.5;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(lp).connect(this.boostGain).connect(this.master);
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
    const base = inWater ? 38 : 48;
    const f = base + rpm * (inWater ? 110 : 150) + (boost ? 34 : 0);

    this.engSub.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.oscA.frequency.setTargetAtTime(f, t, 0.08);
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    // Cutoff stays low and rounded — tops out well under 1 kHz.
    this.engFilter.frequency.setTargetAtTime(180 + rpm * 380 + load * 140, t, 0.09);
    // Chug speeds up with revs.
    this.chug.frequency.setTargetAtTime(5 + rpm * 9, t, 0.15);
    this.engGain.gain.setTargetAtTime(0.06 + load * 0.08 + rpm * 0.05, t, 0.1);
    this.boostGain.gain.setTargetAtTime(boost ? 0.11 : 0, t, boost ? 0.05 : 0.25);
  }

  _noise(dur, freq, q, gain, type = 'lowpass', sweepTo = null) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.6 + Math.random() * 0.5;

    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) filt.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
    filt.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, gain, type = 'sine', slideTo = null) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // All one-shots live low and lean on sine/triangle — deep booms and thuds,
  // no cracks, hisses or spikes. The master low-pass is a safety net on top.
  cannon() { this._noise(0.42, 380, 0.7, 0.55, 'lowpass', 55); this._tone(78, 0.3, 0.42, 'sine', 36); }
  explosion() { this._noise(1.0, 560, 0.6, 0.7, 'lowpass', 40); this._tone(52, 0.7, 0.5, 'sine', 24); }
  splash(power = 1) { this._noise(0.4, 620 * power, 0.6, 0.14 * power, 'lowpass', 180); }
  crash() { this._noise(0.5, 460, 0.9, 0.36, 'lowpass', 150); this._tone(66, 0.24, 0.28, 'sine', 40); }
  wood() { this._noise(0.24, 340, 1.6, 0.26, 'lowpass', 160); this._tone(120, 0.12, 0.16, 'sine', 90); }
  pickup() { this._tone(330, 0.16, 0.22, 'sine'); setTimeout(() => this._tone(495, 0.2, 0.18, 'triangle'), 90); }
  quack() { this._tone(300, 0.17, 0.26, 'triangle', 190); setTimeout(() => this._tone(250, 0.22, 0.22, 'triangle', 150), 120); }
  gate() { this._noise(0.8, 300, 1.4, 0.32, 'lowpass', 90); }
  whoosh() { this._noise(0.5, 460, 0.5, 0.2, 'lowpass', 150); }
}
