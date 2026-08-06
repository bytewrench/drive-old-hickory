// ──────────────────────────────────────────────────────────────
// The multiplayer layer of the HUD: who's on the river, what just
// happened to whom, and a nameplate floating over every other boat.
//
// Nameplates are DOM rather than sprites — they stay crisp at any
// distance, never need a texture atlas, and cost nothing at the
// player counts this room holds. Every name goes in with textContent,
// never innerHTML: names come off the wire from other people.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { game } from '../game.js';

/** Past this, a boat is a dot on the minimap, not a nameplate. */
const PLATE_RANGE = 900;
const FEED_MAX = 5;

export class NetHud {
  constructor(mp) {
    this.mp = mp;
    this.root = document.getElementById('net-layer');
    this.rosterEl = document.getElementById('net-roster');
    this.listEl = document.getElementById('net-list');
    this.countEl = document.getElementById('net-count');
    this.statusEl = document.getElementById('net-status');
    this.feedEl = document.getElementById('net-feed');
    this.platesEl = document.getElementById('net-plates');

    /** @type {Map<number, HTMLElement>} player id → nameplate */
    this.plates = new Map();
    this._v = new THREE.Vector3();
    this._rosterTimer = 0;
  }

  show() { this.root.classList.remove('hidden'); }

  // ── connection state ────────────────────────────────────────
  setStatus(status) {
    const label = {
      offline: 'OFFLINE',
      connecting: 'CONNECTING…',
      live: 'LIVE',
      retrying: 'RECONNECTING…',
      full: 'RIVER FULL',
    }[status] ?? status.toUpperCase();
    this.statusEl.textContent = label;
    this.statusEl.className = `net-${status}`;
    this._syncRoster();
  }

  // ── event feed ──────────────────────────────────────────────
  /** @param {string} text @param {boolean} loud involves us — highlight it */
  feed(text, loud = false) {
    const el = document.createElement('div');
    el.className = 'feed-item' + (loud ? ' loud' : '');
    el.textContent = text;
    this.feedEl.appendChild(el);
    setTimeout(() => el.remove(), 7000);
    while (this.feedEl.childElementCount > FEED_MAX) this.feedEl.firstChild.remove();
  }

  /** Confirmation that one of our shells landed on somebody. */
  hitMarker(text) {
    const el = document.createElement('div');
    el.className = 'hit-marker';
    el.textContent = text;
    this.feedEl.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  // ── per-frame ───────────────────────────────────────────────
  update(dt, camera) {
    this._rosterTimer -= dt;
    if (this._rosterTimer <= 0) { this._rosterTimer = 0.5; this._syncRoster(); }
    this._syncPlates(camera);
  }

  _syncRoster() {
    const mp = this.mp;
    this.countEl.textContent = mp.connected ? String(mp.online) : '—';

    const rows = [];
    if (mp.connected) {
      rows.push({ name: `${this._selfName()} (you)`, self: true, hp: this._selfHp() });
      for (const r of mp.remotes.values()) {
        rows.push({ name: r.name, self: false, hp: r.hp / 100, dead: r.dead });
      }
    }

    this.listEl.textContent = '';
    for (const row of rows) {
      const li = document.createElement('div');
      li.className = 'net-row' + (row.self ? ' self' : '') + (row.dead ? ' down' : '');
      const n = document.createElement('span');
      n.className = 'nrn';
      n.textContent = row.name;              // never innerHTML — remote input
      const bar = document.createElement('i');
      bar.style.width = `${Math.max(0, Math.min(1, row.hp)) * 100}%`;
      const wrap = document.createElement('em');
      wrap.appendChild(bar);
      li.append(n, wrap);
      this.listEl.appendChild(li);
    }

    const ping = mp.connected && mp.latency ? ` · ${mp.latency}ms` : '';
    this.rosterEl.dataset.ping = ping;
  }

  _selfName() { return this.mp.selfName || 'you'; }
  _selfHp() {
    const v = game.vessel;
    return v ? v.health / v.maxHealth : 1;
  }

  /** Project each remote boat to screen space and park its plate there. */
  _syncPlates(camera) {
    const remotes = this.mp.remotes;

    // Retire plates for boats that have left.
    for (const [id, el] of this.plates) {
      if (!remotes.has(id)) { el.remove(); this.plates.delete(id); }
    }

    const cam = game.engine?.camera ?? camera;
    if (!cam) return;
    const w = innerWidth, h = innerHeight;

    for (const r of remotes.values()) {
      let el = this.plates.get(r.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'plate';
        el.innerHTML = '<b></b><i><s></s></i>';
        this.platesEl.appendChild(el);
        this.plates.set(r.id, el);
      }

      const p = this._v.copy(r.position);
      p.y += r.cfg.hull.hy * 2 + 2.2;
      const dist = cam.position.distanceTo(p);
      p.project(cam);

      // z > 1 means it projected out behind the camera.
      if (dist > PLATE_RANGE || p.z > 1) { el.style.display = 'none'; continue; }

      el.style.display = '';
      el.style.transform =
        `translate(-50%,-100%) translate(${(p.x * 0.5 + 0.5) * w}px, ${(-p.y * 0.5 + 0.5) * h}px)`;
      el.style.opacity = String(Math.max(0.25, 1 - dist / PLATE_RANGE));
      el.classList.toggle('down', r.dead);

      const label = el.firstChild;
      const text = dist > 120 ? `${r.name}  ${Math.round(dist)}m` : r.name;
      if (label.textContent !== text) label.textContent = text;
      el.querySelector('s').style.width = `${Math.max(0, Math.min(100, r.hp))}%`;
    }
  }
}
