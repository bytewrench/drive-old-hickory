// ──────────────────────────────────────────────────────────────
// Where the socket meets the river.
//
// Owns the Net transport and the set of RemoteVessels, pushes our own
// boat's state out every tick, and turns everyone else's messages into
// things that happen here: ghosts moving, shells in the air, props
// coming apart, the sky changing, boats blowing up.
//
// The damage rule this whole file is built around: YOU decide when you
// get hurt. We never apply damage to a remote boat — we tell the server
// what happened to ours and let their client do the same. Two clients
// can disagree about a near miss; they can never disagree about a kill.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { Net } from './Net.js';
import { RemoteVessel } from './RemoteVessel.js';
import { unpackState, FLAG, MSG } from '../../shared/protocol.js';
import { VESSELS } from '../vehicles/vesselConfigs.js';
import { game, addScore } from '../game.js';

/** Points for sinking somebody. */
const KILL_SCORE = 2000;

export class Multiplayer {
  constructor(physics, scene) {
    this.physics = physics;
    this.scene = scene;
    this.net = new Net();
    /** @type {Map<number, RemoteVessel>} */
    this.remotes = new Map();
    /** Set while applying a networked event, so we don't echo it back out. */
    this._applying = false;
    this._state = {
      px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1,
      vx: 0, vy: 0, vz: 0, vessel: 0, turretYaw: 0, turretPitch: 0, flags: 0, hp: 100,
    };
    this._tmp = new THREE.Vector3();

    this._wire();
  }

  get connected() { return this.net.connected; }
  get id() { return this.net.id; }
  get online() { return this.net.online; }
  get latency() { return this.net.latency; }

  /** Display name for a player id — used by the feed and nameplates. */
  nameOf(id) {
    if (id == null) return 'the river';
    if (id === this.net.id) return 'you';
    return this.remotes.get(id)?.name ?? this.net.players.get(id)?.name ?? 'someone';
  }

  connect(name, vesselIndex) {
    this.net.connect(name, vesselIndex);
  }

  // ── inbound ─────────────────────────────────────────────────
  _wire() {
    const net = this.net;

    net.on('welcome', (msg) => {
      for (const p of msg.players) this._addRemote(p);
      // The room's sky wins over ours, so a joiner sees what everyone sees.
      if (msg.world) game.applyNetWorld?.(msg.world.weather, msg.world.night);
      game.netHud?.setStatus('live');
      game.netHud?.feed(`joined the river — ${this.online} on the water`);
    });

    net.on('joined', (p) => {
      this._addRemote(p);
      game.netHud?.feed(`${p.name} launched`);
      game.audio?.whoosh();
    });

    net.on('left', (msg) => {
      this.remotes.get(msg.id)?.dispose();
      this.remotes.delete(msg.id);
      game.netHud?.feed(`${msg.name ?? 'someone'} left`);
    });

    net.on('snapshot', (rows) => {
      const now = performance.now();
      for (const row of rows) {
        const s = unpackState(row);
        if (s.id === net.id) continue;                 // that one's ours
        let r = this.remotes.get(s.id);
        if (!r) r = this._addRemote({ id: s.id, name: net.players.get(s.id)?.name, vessel: s.vessel });
        r.applyState(s, now);
      }
    });

    net.on('status', ({ status }) => game.netHud?.setStatus(status));

    net.on('down', () => {
      for (const r of this.remotes.values()) r.dispose();
      this.remotes.clear();
      game.netHud?.feed('connection lost — reconnecting');
    });

    net.on('full', (msg) => {
      game.hud?.toast(`RIVER FULL (${msg.max} BOATS)`, true);
    });

    // Somebody else fired: run their shell through our own physics so it can
    // hit us, hit scenery, and be seen arcing overhead.
    net.on(MSG.SHOT, (msg) => {
      game.weapons?.spawnRemote(msg.p, msg.v, msg.vi, msg.from);
    });

    // Our shot landed on somebody — their client says so.
    net.on(MSG.HIT, (msg) => {
      game.netHud?.hitMarker(`HIT ${msg.victimName ?? this.nameOf(msg.victim)}  −${msg.dmg}`);
      game.audio?.pickup?.();
    });

    net.on(MSG.KILL, (msg) => {
      const victim = msg.victim === net.id ? 'YOU' : (msg.victimName ?? this.nameOf(msg.victim));
      if (msg.by == null) {
        game.netHud?.feed(`${victim} wrecked`);
      } else {
        const killer = msg.by === net.id ? 'YOU' : (msg.byName ?? this.nameOf(msg.by));
        game.netHud?.feed(`${killer} sank ${victim}`, msg.by === net.id || msg.victim === net.id);
        if (msg.by === net.id) addScore(KILL_SCORE, `SANK ${victim}`);
      }
    });

    net.on(MSG.BREAK, (msg) => {
      const prop = game.props?.byNetId.get(msg.i);
      if (!prop || !prop.alive) return;
      this._applying = true;
      try {
        game.destruction?.break(
          prop,
          { x: msg.p[0], y: msg.p[1], z: msg.p[2] },
          { x: msg.d[0], y: msg.d[1], z: msg.d[2] },
          msg.f, true,                                  // remote: no score, no echo
        );
      } finally { this._applying = false; }
    });

    net.on(MSG.WORLD, (msg) => {
      this._applying = true;
      try { game.applyNetWorld?.(msg.weather, msg.night); } finally { this._applying = false; }
    });
  }

  _addRemote(info) {
    if (info.id === this.net.id) return null;
    let r = this.remotes.get(info.id);
    if (r) {
      if (info.name) r.name = info.name;
      return r;
    }
    r = new RemoteVessel(this.physics, this.scene, {
      id: info.id,
      name: info.name || `Boat ${info.id}`,
      vessel: info.vessel ?? 0,
    });
    this.remotes.set(info.id, r);
    return r;
  }

  // ── outbound ────────────────────────────────────────────────
  /** Called every frame from the main loop, after the local vessel updates. */
  update(dt) {
    const now = performance.now();
    for (const r of this.remotes.values()) r.update(dt, now);

    const v = game.vessel;
    if (!v || v.disposed || !this.net.connected) return;

    const s = this._state;
    s.px = v.position.x; s.py = v.position.y; s.pz = v.position.z;
    s.qx = v.quat.x; s.qy = v.quat.y; s.qz = v.quat.z; s.qw = v.quat.w;
    s.vx = v.vel.x; s.vy = v.vel.y; s.vz = v.vel.z;
    s.vessel = VESSELS.indexOf(v.cfg);
    s.turretYaw = v.turretYaw;
    s.turretPitch = v.turretPitch;
    // Sent as a percentage, not absolute hull points: every client can then
    // draw a health bar for a boat without knowing that hull's maximum.
    s.hp = Math.max(0, Math.round((v.health / v.maxHealth) * 100));
    s.flags = (v.boosting ? FLAG.BOOSTING : 0)
      | (v.mode === 'land' ? FLAG.ONLAND : 0)
      | (v.dead ? FLAG.DEAD : 0)
      | (v.mode === 'fly' ? FLAG.FLYING : 0);

    this.net.sendState(s);
  }

  // ── reports from the rest of the game ───────────────────────
  /** @param {THREE.Vector3} pos @param {{x,y,z}} vel */
  reportShot(pos, vel) {
    if (!this.connected) return;
    this.net.sendShot(pos, vel);
  }

  /** The local vessel took damage; `byId` is null for self-inflicted. */
  reportDamage(amount, byId, killed) {
    if (!this.connected) return;
    this.net.sendHit(byId, amount, killed);
  }

  reportBreak(prop, pos, dir, force) {
    if (!this.connected || this._applying || prop?.netId == null) return;
    this.net.sendBreak(prop.netId, pos, dir, force);
  }

  reportWorld(weather, night) {
    if (!this.connected || this._applying) return;
    this.net.sendWorld(weather, night);
  }

  setNight(n) {
    for (const r of this.remotes.values()) r.setNight(n);
  }

  /** Nearest remote boat within `range`, for the ram-damage check. */
  remoteById(id) { return this.remotes.get(id) ?? null; }
}
