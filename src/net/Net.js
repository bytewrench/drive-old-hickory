// ──────────────────────────────────────────────────────────────
// The socket. Transport only — it knows nothing about boats.
//
// Connects to /ws on our own origin (the relay is the same process
// that served the page, and vite proxies it in dev), keeps the
// connection alive across drops, throttles our outbound state to the
// tick rate, and dispatches everything inbound to listeners.
//
// Append ?mp=ws://host:port/ws to point a tab at another host.
// ──────────────────────────────────────────────────────────────

import {
  MSG, TICK_HZ, PROTOCOL_VERSION, packState,
} from '../../shared/protocol.js';

const SEND_INTERVAL = 1000 / TICK_HZ;
const PING_INTERVAL = 3000;
/** Reconnect backoff, in ms, walked through and then held at the last one. */
const BACKOFF = [500, 1000, 2000, 4000, 8000];

export class Net {
  constructor() {
    /** Our own player id once the server has welcomed us. */
    this.id = null;
    /** id → {id, name, vessel} for everyone else in the room. */
    this.players = new Map();
    this.status = 'offline';       // offline | connecting | live | retrying | full
    this.latency = 0;

    this._ws = null;
    this._handlers = new Map();
    this._lastSend = 0;
    this._lastPing = 0;
    this._attempt = 0;
    this._wantOpen = false;
    this._name = 'Skipper';
    this._vessel = 0;
  }

  // ── lifecycle ───────────────────────────────────────────────
  connect(name, vessel) {
    this._name = name;
    this._vessel = vessel | 0;
    this._wantOpen = true;
    this._open();
  }

  disconnect() {
    this._wantOpen = false;
    this._ws?.close();
    this._ws = null;
    this.id = null;
    this.players.clear();
    this._set('offline');
  }

  get connected() { return this.status === 'live'; }
  /** Everyone in the room including us. */
  get online() { return this.players.size + (this.id ? 1 : 0); }

  _url() {
    const override = new URLSearchParams(location.search).get('mp');
    if (override) return override;
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  _open() {
    if (!this._wantOpen) return;
    this._set(this._attempt ? 'retrying' : 'connecting');

    let ws;
    try {
      ws = new WebSocket(this._url());
    } catch (err) {
      console.warn('[net] could not open socket', err);
      this._scheduleRetry();
      return;
    }
    this._ws = ws;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: MSG.JOIN, name: this._name, vessel: this._vessel }));
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this._dispatch(msg);
    });

    ws.addEventListener('close', () => {
      if (this._ws !== ws) return;              // superseded by a newer socket
      this._ws = null;
      const wasLive = this.status === 'live';
      this.id = null;
      this.players.clear();
      if (wasLive) this._emit('down', {});
      this._scheduleRetry();
    });

    // 'error' is always followed by 'close', so retry scheduling lives there.
    ws.addEventListener('error', () => {});
  }

  _scheduleRetry() {
    if (!this._wantOpen || this.status === 'full') { this._set('offline'); return; }
    const wait = BACKOFF[Math.min(this._attempt, BACKOFF.length - 1)];
    this._attempt++;
    this._set('retrying');
    setTimeout(() => this._open(), wait);
  }

  _set(status) {
    if (this.status === status) return;
    this.status = status;
    this._emit('status', { status });
  }

  // ── events ──────────────────────────────────────────────────
  /** @param {string} type @param {(payload:any)=>void} fn */
  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, []);
    this._handlers.get(type).push(fn);
    return this;
  }

  _emit(type, payload) {
    const list = this._handlers.get(type);
    if (!list) return;
    for (const fn of list) {
      try { fn(payload); } catch (err) { console.error(`[net] ${type} handler`, err); }
    }
  }

  _dispatch(msg) {
    switch (msg.t) {
      case MSG.WELCOME:
        if (msg.v !== PROTOCOL_VERSION) {
          console.warn(`[net] protocol mismatch: server v${msg.v}, client v${PROTOCOL_VERSION}`);
        }
        this.id = msg.id;
        this._attempt = 0;
        this.players.clear();
        for (const p of msg.players || []) this.players.set(p.id, p);
        this._set('live');
        this._emit('welcome', msg);
        break;

      case MSG.JOINED:
        this.players.set(msg.player.id, msg.player);
        this._emit('joined', msg.player);
        break;

      case MSG.LEFT:
        this.players.delete(msg.id);
        this._emit('left', msg);
        break;

      case MSG.SNAPSHOT:
        this._emit('snapshot', msg.s);
        break;

      case MSG.FULL:
        this._wantOpen = false;
        this._set('full');
        this._emit('full', msg);
        break;

      case MSG.PONG:
        this.latency = Math.round(performance.now() - msg.c);
        break;

      default:
        // shot / hit / kill / brk / world all pass straight through.
        this._emit(msg.t, msg);
    }
  }

  // ── outbound ────────────────────────────────────────────────
  _send(obj) {
    if (this._ws?.readyState !== WebSocket.OPEN) return false;
    this._ws.send(JSON.stringify(obj));
    return true;
  }

  /**
   * Rate-limited to the tick. Called every frame; drops the ones in between.
   * @param {object} s flattened vessel state — see packState.
   */
  sendState(s) {
    if (!this.connected) return;
    const now = performance.now();
    if (now - this._lastSend < SEND_INTERVAL) return;
    this._lastSend = now;
    this._send({ t: MSG.STATE, s: packState(this.id, s) });

    if (now - this._lastPing > PING_INTERVAL) {
      this._lastPing = now;
      this._send({ t: MSG.PING, c: now });
    }
  }

  sendShot(pos, vel) {
    this._send({
      t: MSG.SHOT,
      p: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)],
      v: [+vel.x.toFixed(2), +vel.y.toFixed(2), +vel.z.toFixed(2)],
    });
  }

  /** Sent by the victim — see the authority note in shared/protocol.js. */
  sendHit(byId, dmg, killed) {
    this._send({ t: MSG.HIT, by: byId ?? null, dmg: Math.round(dmg), killed: !!killed });
  }

  sendBreak(index, pos, dir, force) {
    this._send({
      t: MSG.BREAK, i: index,
      p: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)],
      d: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)],
      f: Math.round(force),
    });
  }

  sendWorld(weather, night) {
    this._send({ t: MSG.WORLD, weather: weather | 0, night: night ? 1 : 0 });
  }
}
