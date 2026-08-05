// ──────────────────────────────────────────────────────────────
// DOM HUD: speed, mode, score, boost bar, vessel strip, toasts and
// a canvas minimap baked from the same height field as the terrain.
// ──────────────────────────────────────────────────────────────

import { MAP_SIZE, HALF_MAP, WATER_LEVEL } from '../config.js';
import { VESSELS } from '../vehicles/vesselConfigs.js';
import { game } from '../game.js';

const MINIMAP_RES = 180;
const VIEW_SPAN = 420;   // world metres shown across the minimap

export class Hud {
  constructor(heightData, heightRes) {
    this.root = document.getElementById('hud');
    this.nameEl = document.getElementById('vessel-name');
    this.modeEl = document.getElementById('vessel-mode');
    this.scoreEl = document.getElementById('score');
    this.comboEl = document.getElementById('combo');
    this.speedEl = document.getElementById('speed-val');
    this.boostEl = document.getElementById('boost-bar');
    this.boostWrap = document.getElementById('boost-wrap');
    this.stripEl = document.getElementById('vessel-strip');
    this.toastEl = document.getElementById('toast');
    this.crosshair = document.getElementById('crosshair');

    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.heightData = heightData;
    this.heightRes = heightRes;

    this.displayScore = 0;
    this.displaySpeed = 0;
    this._mapTimer = 0;

    this._bakeMapTexture();
    this._buildStrip();
  }

  // ── minimap base layer ──────────────────────────────────────
  _bakeMapTexture() {
    const R = 256;
    const off = document.createElement('canvas');
    off.width = off.height = R;
    const c = off.getContext('2d');
    const img = c.createImageData(R, R);
    const hr = this.heightRes;

    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const si = Math.min(hr - 1, ((i / (R - 1)) * (hr - 1)) | 0);
        const sj = Math.min(hr - 1, ((j / (R - 1)) * (hr - 1)) | 0);
        const h = this.heightData[sj * hr + si];
        const k = (j * R + i) * 4;
        let r, g, b;
        if (h < WATER_LEVEL - 0.25) {
          const d = Math.min(1, (WATER_LEVEL - h) / 9);
          r = 40 - d * 20; g = 130 - d * 60; b = 175 - d * 60;
        } else if (h < 1.8) {
          r = 214; g = 197; b = 150;                 // shore
        } else {
          const t = Math.min(1, h / 90);             // pasture → ridge scrub
          r = 96 + t * 74; g = 152 - t * 26; b = 80 + t * 34;
        }
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    this.mapTex = off;
  }

  _buildStrip() {
    this.stripEl.innerHTML = '';
    this.pills = VESSELS.map((v, i) => {
      const el = document.createElement('div');
      el.className = 'vpill';
      el.innerHTML = `<em>${i + 1}</em>${v.name}`;
      this.stripEl.appendChild(el);
      return el;
    });
  }

  show() { this.root.classList.remove('hidden'); }

  setVessel(index) {
    const cfg = VESSELS[index];
    this.nameEl.textContent = cfg.name.toUpperCase();
    this.pills.forEach((p, i) => p.classList.toggle('active', i === index));
    this.crosshair.classList.toggle('on', cfg.weapon.type === 'turret');
  }

  // ── notifications ───────────────────────────────────────────
  toast(text, big = false) {
    const el = document.createElement('div');
    el.className = 'toast-item' + (big ? ' big' : '');
    el.textContent = text;
    this.toastEl.appendChild(el);
    setTimeout(() => el.remove(), 2100);
    while (this.toastEl.childElementCount > 4) this.toastEl.firstChild.remove();
  }

  bumpScore(n, label) {
    if (label) this.toast(`${label}  +${n}`, true);
  }

  setCombo(count, mult) {
    this.comboEl.textContent = count > 1 ? `${count}× CHAIN · ${mult.toFixed(2)}×` : '';
  }

  // ── per-frame ───────────────────────────────────────────────
  update(dt, vessel) {
    if (!vessel) return;

    // Score and speed both ease toward their true value.
    this.displayScore += (game.score - this.displayScore) * Math.min(1, 9 * dt);
    this.scoreEl.textContent = Math.round(this.displayScore).toLocaleString();

    const kmh = vessel.speed * 3.6;
    this.displaySpeed += (kmh - this.displaySpeed) * Math.min(1, 12 * dt);
    this.speedEl.textContent = Math.round(this.displaySpeed);

    const mode = vessel.mode;
    this.modeEl.textContent =
      mode === 'water' ? '◈ WATER MODE'
        : mode === 'land' ? '▲ ATV MODE'
          : '✦ AIRBORNE';
    this.modeEl.className = mode === 'land' ? 'land' : mode === 'air' ? 'air' : '';

    this.boostEl.style.transform = `scaleX(${vessel.boostFuel})`;
    this.boostWrap.classList.toggle('empty', vessel.boostFuel < 0.05);

    this._mapTimer -= dt;
    if (this._mapTimer <= 0) {
      this._mapTimer = 1 / 20;
      this._drawMap(vessel);
    }
  }

  _drawMap(vessel) {
    const ctx = this.ctx;
    const R = MINIMAP_RES;
    ctx.clearRect(0, 0, R, R);
    ctx.save();

    // Circular mask.
    ctx.beginPath();
    ctx.arc(R / 2, R / 2, R / 2 - 2, 0, Math.PI * 2);
    ctx.clip();

    const px = vessel.position.x, pz = vessel.position.z;
    const scale = R / VIEW_SPAN;                        // canvas px per world metre
    const texScale = 256 / MAP_SIZE;                    // texture px per world metre

    // North-up: world +x → screen right, world +z → screen down.
    ctx.translate(R / 2, R / 2);

    const sw = VIEW_SPAN * texScale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      this.mapTex,
      (px + HALF_MAP) * texScale - sw / 2,
      (pz + HALF_MAP) * texScale - sw / 2,
      sw, sw,
      -R / 2, -R / 2, R, R,
    );

    // Surviving rubber ducks, so you can go hunting for them.
    if (game.props) {
      const half = VIEW_SPAN / 2;
      ctx.fillStyle = '#ffd23f';
      for (const p of game.props.props) {
        if (!p.alive || !p.spec.duck) continue;
        const t = p.body.translation();
        const dx = t.x - px, dz = t.z - pz;
        if (Math.abs(dx) > half || Math.abs(dz) > half) continue;
        ctx.fillRect(dx * scale - 2, dz * scale - 2, 4, 4);
      }
    }
    ctx.restore();

    // Player arrow: drawn pointing up, rotated to the heading.
    ctx.save();
    ctx.translate(R / 2, R / 2);
    ctx.rotate(Math.PI - vessel.heading);
    ctx.fillStyle = '#ff5d73';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
