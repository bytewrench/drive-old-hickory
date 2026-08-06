// ──────────────────────────────────────────────────────────────
// DRIVE OLD HICKORY — the multiplayer host.
//
// One process does two jobs:
//   · serves the built dist/ bundle (this replaced the nginx stage)
//   · runs the WebSocket relay at /ws that ties the rivers together
//
// The relay is deliberately dumb. It does not run Rapier, does not
// know where the river is, and never overrules a client about its own
// boat — replicating a 56 km heightfield and a full physics world
// server-side would buy nothing for a sandbox. What it does own is
// the roster, the shared world settings, and the kill ledger.
//
//   PORT   listen port           (default 8080; the image sets 80)
//   DIST   static root           (default ../dist)
// ──────────────────────────────────────────────────────────────

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

import { createStaticHandler } from './static.mjs';
import {
  PROTOCOL_VERSION, MSG, TICK_HZ, MAX_PLAYERS,
  cleanName, validState, validVec3, unpackState,
} from '../shared/protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const DIST = resolve(process.env.DIST || join(HERE, '..', 'dist'));

/** Inbound messages per second before we assume something is wrong and
 *  hang up. A well-behaved client sends 20 states + a handful of events. */
const MSG_RATE_LIMIT = 150;

// ── state ─────────────────────────────────────────────────────
let nextId = 1;
/** @type {Map<number, Player>} */
const players = new Map();

/** Shared world settings, held so a late joiner sees the same sky. */
const world = { weather: 0, night: 0 };

class Player {
  constructor(ws, req) {
    this.id = nextId++;
    this.ws = ws;
    this.name = null;              // set on JOIN; null = not joined yet
    this.vessel = 0;
    this.state = null;             // last packed snapshot row
    this.kills = 0;
    this.deaths = 0;
    this.alive = true;             // ws-level liveness (pong tracking)
    this.msgCount = 0;
    this.msgWindow = Date.now();
    this.ip = req.socket.remoteAddress;
  }

  send(obj) {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  /** Public roster entry. */
  info() {
    return { id: this.id, name: this.name, vessel: this.vessel };
  }
}

function broadcast(obj, exceptId = null) {
  const payload = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.id === exceptId || !p.name) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(payload);
  }
}

// ── http ──────────────────────────────────────────────────────
const serveStatic = createStaticHandler(DIST);

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ ok: true, players: players.size, uptime: process.uptime() }));
    return;
  }
  try {
    await serveStatic(req, res);
  } catch (err) {
    console.error('[http]', err);
    if (!res.headersSent) res.writeHead(500);
    res.end('server error');
  }
});

// ── websocket relay ───────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const path = (req.url || '').split('?')[0];
  if (path !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ t: MSG.FULL, max: MAX_PLAYERS }));
    ws.close();
    return;
  }

  const player = new Player(ws, req);
  players.set(player.id, player);

  ws.on('pong', () => { player.alive = true; });
  ws.on('message', (raw) => {
    if (rateLimited(player)) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(player, msg); } catch (err) { console.error('[ws]', err); }
  });

  ws.on('close', () => {
    players.delete(player.id);
    if (player.name) {
      broadcast({ t: MSG.LEFT, id: player.id, name: player.name });
      console.log(`[ws] ${player.name} (#${player.id}) left — ${players.size} online`);
    }
  });

  ws.on('error', () => ws.terminate());
});

function rateLimited(player) {
  const now = Date.now();
  if (now - player.msgWindow >= 1000) { player.msgWindow = now; player.msgCount = 0; }
  if (++player.msgCount <= MSG_RATE_LIMIT) return false;
  console.warn(`[ws] rate limit hit by #${player.id} (${player.ip}) — closing`);
  player.ws.close();
  return true;
}

// ── message handlers ──────────────────────────────────────────
function handle(p, msg) {
  switch (msg.t) {
    case MSG.JOIN: return onJoin(p, msg);
    case MSG.PING: return p.send({ t: MSG.PONG, c: msg.c });
    default:
      if (!p.name) return;         // nothing but JOIN/PING before joining
      return onGameMessage(p, msg);
  }
}

function onJoin(p, msg) {
  if (p.name) return;              // already joined; ignore repeats
  p.name = cleanName(msg.name);
  p.vessel = Number.isInteger(msg.vessel) ? Math.max(0, Math.min(3, msg.vessel)) : 0;

  p.send({
    t: MSG.WELCOME,
    v: PROTOCOL_VERSION,
    id: p.id,
    tickHz: TICK_HZ,
    world,
    players: [...players.values()].filter((o) => o.name && o !== p).map((o) => o.info()),
  });
  broadcast({ t: MSG.JOINED, player: p.info() }, p.id);
  console.log(`[ws] ${p.name} (#${p.id}) joined — ${countJoined()} online`);
}

function onGameMessage(p, msg) {
  switch (msg.t) {
    case MSG.STATE: {
      if (!validState(msg.s)) return;
      // The id field is whatever the client put there; stamp our own so a
      // client cannot pose as somebody else's boat.
      msg.s[0] = p.id;
      p.state = msg.s;
      p.vessel = unpackState(msg.s).vessel;
      return;
    }

    case MSG.SHOT: {
      if (!validVec3(msg.p) || !validVec3(msg.v, 1e4)) return;
      broadcast({ t: MSG.SHOT, from: p.id, p: msg.p, v: msg.v, vi: p.vessel }, p.id);
      return;
    }

    case MSG.HIT: {
      // Reported by the victim: "player `by` did `dmg` to me". Only the
      // victim's own client decides this, so it is always self-consistent.
      const by = players.get(msg.by);
      const dmg = Number(msg.dmg);
      if (!Number.isFinite(dmg) || dmg <= 0) return;

      if (msg.killed) {
        p.deaths++;
        if (by && by !== p) by.kills++;
        broadcast({
          t: MSG.KILL,
          by: by && by !== p ? by.id : null,
          byName: by && by !== p ? by.name : null,
          victim: p.id,
          victimName: p.name,
        });
      } else if (by && by !== p) {
        by.send({ t: MSG.HIT, by: by.id, victim: p.id, victimName: p.name, dmg });
      }
      return;
    }

    case MSG.BREAK: {
      if (!Number.isInteger(msg.i) || msg.i < 0) return;
      if (!validVec3(msg.p) || !validVec3(msg.d, 100)) return;
      const f = Number(msg.f);
      broadcast({
        t: MSG.BREAK, i: msg.i, p: msg.p, d: msg.d,
        f: Number.isFinite(f) ? f : 0,
      }, p.id);
      return;
    }

    case MSG.WORLD: {
      if (Number.isInteger(msg.weather)) world.weather = Math.max(0, Math.min(8, msg.weather));
      if (msg.night === 0 || msg.night === 1) world.night = msg.night;
      broadcast({ t: MSG.WORLD, ...world, by: p.name }, p.id);
      return;
    }
  }
}

function countJoined() {
  let n = 0;
  for (const p of players.values()) if (p.name) n++;
  return n;
}

// ── the tick ──────────────────────────────────────────────────
// One snapshot for everybody. Clients skip the row carrying their own id
// rather than the server building a filtered payload per socket.
setInterval(() => {
  const rows = [];
  for (const p of players.values()) if (p.name && p.state) rows.push(p.state);
  if (!rows.length) return;
  broadcast({ t: MSG.SNAPSHOT, s: rows });
}, 1000 / TICK_HZ);

// Drop sockets that stopped answering — a half-open TCP connection would
// otherwise sit in the roster as a boat frozen mid-river forever.
setInterval(() => {
  for (const p of players.values()) {
    if (!p.alive) { p.ws.terminate(); continue; }
    p.alive = false;
    if (p.ws.readyState === p.ws.OPEN) p.ws.ping();
  }
}, 30000);

// ── go ────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[drive-old-hickory] http + ws on :${PORT}`);
  console.log(`[drive-old-hickory] serving ${DIST}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[drive-old-hickory] ${sig} — closing`);
    for (const p of players.values()) p.ws.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
