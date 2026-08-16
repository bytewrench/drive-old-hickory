// ──────────────────────────────────────────────────────────────
// DOM HUD: speed, mode, score, boost bar, vessel strip, toasts, a
// canvas minimap, and a full-screen zoomable route map you open by
// clicking the minimap (which pauses the game).
// ──────────────────────────────────────────────────────────────

import { MAP_SIZE, HALF_MAP, WATER_LEVEL } from '../config.js';
import { VESSELS } from '../vehicles/vesselConfigs.js';
import { CHANNEL_PATH, HUNTERS_POINT, MARINAS, BRIDGES } from '../world/heightfield.js';
import { game } from '../game.js';

const MINIMAP_RES = 180;
const VIEW_SPAN = 2600;   // world metres shown across the minimap (local context)

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
    this.hullEl = document.getElementById('hull-bar');
    this.hullWrap = document.getElementById('hull-wrap');
    this.hurtEl = document.getElementById('hurt-flash');

    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.heightData = heightData;
    this.heightRes = heightRes;

    this.displayScore = 0;
    this.displaySpeed = 0;
    this._mapTimer = 0;

    this._bakeMapTexture();
    this._buildStrip();
    this._buildBigMap();

    // Click / tap the minimap → open the route map.
    this.canvas.style.cursor = 'pointer';
    this.canvas.addEventListener('pointerup', (e) => { e.preventDefault(); this.openMap(); });
  }

  // ── baked map texture (terrain + the channel line) ──────────
  _bakeMapTexture() {
    const R = Math.min(this.heightRes, 1024);
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
          r = 44 - d * 22; g = 132 - d * 66; b = 178 - d * 62;
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

    // Trace the navigable channel so the route reads clearly at any zoom.
    const toPx = (v) => ((v + HALF_MAP) / MAP_SIZE) * R;
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = 'rgba(150, 230, 255, 0.75)';
    c.lineWidth = Math.max(1.5, R / 700);
    for (const seg of CHANNEL_PATH) {
      c.beginPath();
      seg.pts.forEach((p, i) => { const x = toPx(p.x), y = toPx(p.z); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    }

    this.mapTex = off;
    this.mapTexRes = R;
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

  /** Red vignette pulse when the hull takes a hit. @param {number} severity 0–1 */
  damageFlash(severity) {
    if (!this.hurtEl) return;
    this.hurtEl.style.opacity = String(Math.min(0.75, 0.2 + severity * 1.6));
    clearTimeout(this._hurtTimer);
    this._hurtTimer = setTimeout(() => { this.hurtEl.style.opacity = '0'; }, 90);
  }

  bumpScore(n, label) { if (label) this.toast(`${label}  +${n}`, true); }
  setCombo(count, mult) { this.comboEl.textContent = count > 1 ? `${count}× CHAIN · ${mult.toFixed(2)}×` : ''; }

  // ── per-frame ───────────────────────────────────────────────
  update(dt, vessel) {
    if (!vessel) return;

    this.displayScore += (game.score - this.displayScore) * Math.min(1, 9 * dt);
    this.scoreEl.textContent = Math.round(this.displayScore).toLocaleString();

    const kmh = vessel.speed * 3.6;
    this.displaySpeed += (kmh - this.displaySpeed) * Math.min(1, 12 * dt);
    this.speedEl.textContent = Math.round(this.displaySpeed);

    const mode = vessel.mode;
    this.modeEl.textContent = mode === 'water' ? '◈ WATER MODE'
      : mode === 'land' ? '▲ ATV MODE'
        : mode === 'fly' ? '✈ FLYING'
          : '✦ AIRBORNE';
    this.modeEl.className = mode === 'land' ? 'land' : mode === 'air' ? 'air' : mode === 'fly' ? 'fly' : '';

    this.boostEl.style.transform = `scaleX(${vessel.boostFuel})`;
    this.boostWrap.classList.toggle('empty', vessel.boostFuel < 0.05);

    const hull = Math.max(0, vessel.health / vessel.maxHealth);
    this.hullEl.style.transform = `scaleX(${hull})`;
    this.hullWrap.classList.toggle('critical', hull > 0 && hull < 0.3);
    this.hullWrap.classList.toggle('sunk', vessel.dead);

    this._mapTimer -= dt;
    if (this._mapTimer <= 0) { this._mapTimer = 1 / 15; this._drawMap(vessel); }
  }

  _drawMap(vessel) {
    const ctx = this.ctx;
    const R = MINIMAP_RES;
    ctx.clearRect(0, 0, R, R);
    ctx.save();
    ctx.beginPath(); ctx.arc(R / 2, R / 2, R / 2 - 2, 0, Math.PI * 2); ctx.clip();

    const px = vessel.position.x, pz = vessel.position.z;
    const scale = R / VIEW_SPAN;
    const texScale = this.mapTexRes / MAP_SIZE;
    ctx.translate(R / 2, R / 2);

    const sw = VIEW_SPAN * texScale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapTex,
      (px + HALF_MAP) * texScale - sw / 2, (pz + HALF_MAP) * texScale - sw / 2, sw, sw,
      -R / 2, -R / 2, R, R);

    const half = VIEW_SPAN / 2;
    // Dock.
    const ddx = HUNTERS_POINT.dockX - px, ddz = HUNTERS_POINT.dockZ - pz;
    if (Math.abs(ddx) < half && Math.abs(ddz) < half) {
      ctx.fillStyle = '#4ecdc4';
      ctx.fillRect(ddx * scale - 3, ddz * scale - 3, 6, 6);
    }
    // Rubber ducks.
    if (game.props) {
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

    // Player arrow.
    ctx.save();
    ctx.translate(R / 2, R / 2);
    ctx.rotate(Math.PI - vessel.heading);
    ctx.fillStyle = '#ff5d73'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.5, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();

    // "tap to expand" affordance.
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '9px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TAP TO EXPAND', R / 2, R - 8);
    ctx.restore();
  }

  // ── full-screen route map (pauses the game) ─────────────────
  _buildBigMap() {
    const wrap = document.createElement('div');
    wrap.id = 'bigmap';
    wrap.className = 'hidden';
    wrap.innerHTML = `
      <canvas id="bigmap-canvas"></canvas>
      <div id="bigmap-bar">
        <span id="bigmap-title">ROUTE MAP — Cumberland River</span>
        <span id="bigmap-hint">drag to pan · scroll / pinch to zoom</span>
        <button id="bigmap-close">CLOSE ✕</button>
      </div>
      <div id="bigmap-zoom">
        <button data-z="in">＋</button>
        <button data-z="out">－</button>
        <button data-z="fit">FIT</button>
        <button data-z="me">SHIP</button>
      </div>`;
    document.body.appendChild(wrap);
    this.bigWrap = wrap;
    this.bigCanvas = wrap.querySelector('#bigmap-canvas');
    this.bigCtx = this.bigCanvas.getContext('2d');
    this.view = { cx: 0, cz: 0, zoom: 0.02 };   // world centre + px per metre

    wrap.querySelector('#bigmap-close').addEventListener('pointerup', (e) => { e.preventDefault(); this.closeMap(); });
    wrap.querySelector('#bigmap-zoom').addEventListener('pointerup', (e) => {
      const z = e.target.dataset.z; if (!z) return; e.preventDefault();
      if (z === 'in') this._zoomBy(1.5);
      else if (z === 'out') this._zoomBy(1 / 1.5);
      else if (z === 'fit') this._fit();
      else if (z === 'me') this._center(game.vessel);
      this._drawBigMap();
    });

    this._bindBigMapGestures();
  }

  _bindBigMapGestures() {
    const cv = this.bigCanvas;
    const pts = new Map();
    let panning = false, lastX = 0, lastY = 0, pinchDist = 0;

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { panning = true; lastX = e.clientX; lastY = e.clientY; }
      else if (pts.size === 2) { panning = false; pinchDist = this._pairDist(pts); }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const d = this._pairDist(pts);
        if (pinchDist > 0) this._zoomBy(d / pinchDist);
        pinchDist = d;
        this._drawBigMap();
      } else if (panning) {
        this.view.cx -= (e.clientX - lastX) / this.view.zoom;
        this.view.cz -= (e.clientY - lastY) / this.view.zoom;
        lastX = e.clientX; lastY = e.clientY;
        this._clampView();
        this._drawBigMap();
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinchDist = 0; if (pts.size === 0) panning = false; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      this._drawBigMap();
    }, { passive: false });
  }

  _pairDist(pts) {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _zoomBy(f) {
    this.view.zoom = Math.max(this._fitZoom() * 0.9, Math.min(this.view.zoom * f, 0.5));
    this._clampView();
  }

  _fitZoom() { return Math.min(this.bigCanvas.width, this.bigCanvas.height) / MAP_SIZE; }
  _fit() { this.view.zoom = this._fitZoom(); this.view.cx = 0; this.view.cz = 0; }
  _center(vessel) { if (vessel) { this.view.cx = vessel.position.x; this.view.cz = vessel.position.z; this.view.zoom = Math.max(this.view.zoom, 0.06); } this._clampView(); }

  _clampView() {
    const w = this.bigCanvas.width / this.view.zoom / 2, h = this.bigCanvas.height / this.view.zoom / 2;
    this.view.cx = Math.max(-HALF_MAP + w * 0.5, Math.min(HALF_MAP - w * 0.5, this.view.cx));
    this.view.cz = Math.max(-HALF_MAP + h * 0.5, Math.min(HALF_MAP - h * 0.5, this.view.cz));
  }

  openMap() {
    if (game.paused || !game.running) return;
    game.paused = true;
    this.bigWrap.classList.remove('hidden');
    this._resizeBigMap();
    this._center(game.vessel);
    this._drawBigMap();
  }

  closeMap() {
    game.paused = false;
    this.bigWrap.classList.add('hidden');
  }

  _resizeBigMap() {
    const dpr = Math.min(devicePixelRatio, 2);
    this.bigCanvas.width = this.bigCanvas.clientWidth * dpr;
    this.bigCanvas.height = this.bigCanvas.clientHeight * dpr;
    this.bigCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _drawBigMap() {
    const ctx = this.bigCtx;
    const dpr = Math.min(devicePixelRatio, 2);
    const W = this.bigCanvas.width / dpr, H = this.bigCanvas.height / dpr;
    const { cx, cz, zoom } = this.view;
    const w2s = (x, z) => [W / 2 + (x - cx) * zoom, H / 2 + (z - cz) * zoom];

    ctx.fillStyle = '#0b1026';
    ctx.fillRect(0, 0, W, H);

    // Map image: source window in texture px, drawn to the whole canvas region.
    const texScale = this.mapTexRes / MAP_SIZE;
    const worldL = cx - W / 2 / zoom, worldT = cz - H / 2 / zoom;
    const worldW = W / zoom, worldH = H / zoom;
    ctx.imageSmoothingEnabled = zoom < 0.08;
    ctx.drawImage(this.mapTex,
      (worldL + HALF_MAP) * texScale, (worldT + HALF_MAP) * texScale, worldW * texScale, worldH * texScale,
      0, 0, W, H);

    const dot = (x, z, col, r = 4) => { const [sx, sy] = w2s(x, z); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill(); };
    const label = (x, z, text, col, dy = -9) => {
      const [sx, sy] = w2s(x, z); ctx.fillStyle = col; ctx.font = '600 12px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
      ctx.strokeText(text, sx, sy + dy); ctx.fillText(text, sx, sy + dy);
    };

    // Marinas + Nashville / dock labels (only when zoomed enough to read).
    if (MARINAS) for (const m of MARINAS) { dot(m.x, m.z, '#4ecdc4', 4); if (zoom > 0.03) label(m.x, m.z, m.name, '#bdeee9'); }
    if (BRIDGES && zoom > 0.05) for (const b of BRIDGES) { const p = b.pts[Math.floor(b.pts.length / 2)]; dot(p[0], p[1], '#ff9f45', 3); }

    // Surviving ducks.
    if (game.props) for (const p of game.props.props) { if (p.alive && p.spec.duck) dot(p.body.translation().x, p.body.translation().z, '#ffd23f', 3); }

    // Dock.
    dot(HUNTERS_POINT.dockX, HUNTERS_POINT.dockZ, '#4ecdc4', 6);
    label(HUNTERS_POINT.dockX, HUNTERS_POINT.dockZ, 'HUNTERS POINT ⚓', '#ffffff', -12);

    // The ship, with heading.
    const v = game.vessel;
    if (v) {
      const [sx, sy] = w2s(v.position.x, v.position.z);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(v.heading + Math.PI);
      ctx.fillStyle = '#ff5d73'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.restore();
      label(v.position.x, v.position.z, 'YOU', '#ffd166', 20);
    }

    // Scale bar.
    const barM = zoom > 0.06 ? 500 : zoom > 0.02 ? 2000 : 10000;
    const barPx = barM * zoom;
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(20, H - 24); ctx.lineTo(20 + barPx, H - 24); ctx.stroke();
    ctx.font = '11px "Trebuchet MS", sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(barM >= 1000 ? `${barM / 1000} km` : `${barM} m`, 20, H - 30);
  }
}
