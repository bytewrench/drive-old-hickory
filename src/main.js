// ──────────────────────────────────────────────────────────────
// DRIVE OLD HICKORY — boot, garage screen and the main loop.
// ──────────────────────────────────────────────────────────────

import './ui/style.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { FIXED_DT, MAX_SUBSTEPS, HEIGHT_TEX_RES, WATER_LEVEL, WATER_BASE, WEATHER, setWaterLevel } from './config.js';
import { game, addScore } from './game.js';

import { Engine, CAM_VIEW } from './core/Engine.js';
import { PostFX } from './core/PostFX.js';
import { Physics } from './core/Physics.js';
import { Input } from './core/Input.js';
import { MobileControls } from './core/MobileControls.js';
import { AudioKit } from './core/Audio.js';

import { Terrain } from './world/Terrain.js';
import { Water } from './world/Water.js';
import { Structures } from './world/Structures.js';
import { PropSystem } from './world/Props.js';
import * as HF from './world/heightfield.js';
import { sampleHeight, HUNTERS_POINT, loadTerrainData, CHANNEL_LENGTH } from './world/heightfield.js';

import { ParticleFX } from './fx/Particles.js';
import { Destruction } from './gameplay/Destruction.js';
import { Weapons } from './gameplay/Weapons.js';

import { Vessel } from './vehicles/Vessel.js';
import { VESSELS } from './vehicles/vesselConfigs.js';
import { Hud } from './ui/Hud.js';
import { NetHud } from './ui/NetHud.js';
import { Multiplayer } from './net/Multiplayer.js';
import { cleanName } from '../shared/protocol.js';

const loader = document.getElementById('loader');
const loadbar = document.getElementById('loadbar');
const loadmsg = document.getElementById('loadmsg');

function progress(pct, msg) {
  loadbar.style.width = `${pct}%`;
  if (msg) loadmsg.textContent = msg;
  // setTimeout rather than rAF: rAF is throttled to zero in a background tab,
  // which would stall the whole boot sequence if you tab away while it loads.
  return new Promise((r) => setTimeout(r, 16));
}

let currentIndex = 0;

// ── weather / pool level ────────────────────────────────────────
// Each weather sets a target pool height; the frame loop lerps the live
// WATER_LEVEL toward it so the shoreline visibly rises and falls.
let weatherIndex = 0;
let waterTarget = WATER_BASE;

function setWeather(index, announce = true, fromNet = false) {
  weatherIndex = ((index % WEATHER.length) + WEATHER.length) % WEATHER.length;
  const w = WEATHER[weatherIndex];
  waterTarget = WATER_BASE + w.depth;
  game.water.setWeather(w);
  game._weatherFog = w.fog;                       // frame loop scales fog by this
  const overlay = document.getElementById('weather-overlay');
  if (overlay) overlay.className = `w-${w.id}`;
  const btn = document.querySelector('#mobile-actions [data-act="weather"]');
  if (btn) btn.textContent = w.icon;
  if (announce) game.hud.toast(`${w.icon} ${w.name.toUpperCase()}`, true);
  // One sky for the whole room: whoever turns the weather turns it for
  // everybody. Changes arriving from the net don't bounce back out.
  if (!fromNet) game.mp?.reportWorld(weatherIndex, game.nightTarget);
}

function cycleWeather() {
  setWeather(weatherIndex + 1);
  game.audio?.whoosh();
}

/** Night is the other half of the shared sky. */
function setNight(on, fromNet = false) {
  game.nightTarget = on ? 1 : 0;
  if (!fromNet) game.mp?.reportWorld(weatherIndex, game.nightTarget);
}

/** Applied when the server tells us what the room's sky looks like. */
game.applyNetWorld = (weather, night) => {
  if (Number.isInteger(weather) && weather !== weatherIndex) setWeather(weather, true, true);
  const n = night ? 1 : 0;
  if (n !== game.nightTarget) {
    setNight(n, true);
    game.hud?.toast(n ? 'SYNTHWAVE NIGHT' : 'SUNNY MORNING', true);
  }
};

// ──────────────────────────────────────────────────────────────
async function boot() {
  await progress(4, 'initialising rapier…');
  await RAPIER.init();

  await progress(10, 'loading cumberland river survey…');
  await loadTerrainData();
  console.info(
    `[world] Cumberland channel in map: ${(CHANNEL_LENGTH / 1000).toFixed(2)} km navigable`,
  );

  await progress(16, 'building renderer…');
  const canvas = document.getElementById('app');
  const engine = new Engine(canvas);
  game.engine = engine;

  const physics = new Physics();
  game.physics = physics;

  await progress(30, 'carving the cumberland…');
  game.terrain = new Terrain(physics, engine.scene);

  await progress(48, 'flooding the channel…');
  game.water = new Water(engine.scene);

  await progress(58, 'pouring concrete…');
  game.structures = new Structures(physics, engine.scene);

  await progress(72, 'planting the banks…');
  game.props = new PropSystem(physics, engine.scene);

  await progress(84, 'loading ordnance…');
  game.fx = new ParticleFX(engine.scene);
  game.destruction = new Destruction(physics, engine.scene);
  game.weapons = new Weapons(physics, engine.scene);

  game.input = new Input(canvas);
  game.mobile = new MobileControls(canvas, game.input, engine);
  game.audio = new AudioKit();
  game.hud = new Hud(game.water.heightData, HEIGHT_TEX_RES);

  // The room. Built now so remote boats have somewhere to land, but the
  // socket doesn't open until LAUNCH, when we know the player's call sign.
  game.mp = new Multiplayer(physics, engine.scene);
  game.netHud = new NetHud(game.mp);

  await progress(93, 'warming shaders…');
  engine.postfx = new PostFX(engine.renderer, engine.scene, engine.camera);
  engine.applyDayNight(0);

  spawnVessel(0);
  installCollisionRules();
  buildGarage();
  buildMobileHud();
  setWeather(0, false);          // Fair, sitting at the baked +6 ft pool

  await progress(100, 'ready');
  loader.classList.add('fade');
  setTimeout(() => loader.classList.add('hidden'), 520);
  document.getElementById('garage').classList.remove('hidden');

  requestAnimationFrame(frame);
}

// ──────────────────────────────────────────────────────────────
function spawnVessel(index, keepTransform = true) {
  const prev = game.vessel;
  let spawn = null;

  if (prev && keepTransform) {
    spawn = {
      x: prev.position.x,
      y: Math.max(prev.position.y, sampleHeight(prev.position.x, prev.position.z), WATER_LEVEL) + 2.5,
      z: prev.position.z,
    };
  }
  if (!spawn) {
    spawn = { x: HUNTERS_POINT.dockX, y: 3.5, z: HUNTERS_POINT.dockZ };
  }

  // Swapping hulls mid-river carries your damage across, so hopping to a
  // fresh boat isn't a free repair while somebody is shooting at you.
  // Picking a boat in the garage (keepTransform false) starts clean.
  const carried = prev && keepTransform ? prev.health / prev.maxHealth : 1;

  prev?.dispose();

  currentIndex = index;
  const v = new Vessel(game.physics, game.engine.scene, VESSELS[index], spawn);
  v.health = Math.max(1, Math.round(v.maxHealth * carried));
  v.setNight(game.night);
  // Move this hull onto the first-person cull layer. Must happen on every
  // spawn, since swapping vessels builds a brand-new model.
  v.model?.setLocal?.(true);
  game.vessel = v;
  game.hud.setVessel(index);
  game.engine.camYaw = v.heading;
  // The turret vessel gets a prominent fire button; others a smaller one.
  document.body.classList.toggle('no-turret', VESSELS[index].weapon.type !== 'turret');
  return v;
}

// ──────────────────────────────────────────────────────────────
// Wire the on-screen touch buttons and make the vessel pills tappable.
// ──────────────────────────────────────────────────────────────
function buildMobileHud() {
  // Hold-to-fire and hold-to-boost.
  const holdButton = (id, set) => {
    const el = document.getElementById(id);
    const on = (e) => { e.preventDefault(); e.stopPropagation(); set(true); game.audio?.start(); };
    const off = () => set(false);
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  };
  let firing = false, boosting = false;
  holdButton('mobile-fire', (v) => { firing = v; });
  holdButton('mobile-boost', (v) => { boosting = v; });
  game._holdFire = () => firing;
  game._holdBoost = () => boosting;

  document.querySelectorAll('#mobile-actions .mbtn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const act = btn.dataset.act;
      if (act === 'reset') { game.vessel?.reset(); game.hud.toast('BACK AT HUNTERS POINT'); }
      else if (act === 'night') { setNight(game.nightTarget <= 0.5); }
      else if (act === 'cam') {
        // The mobile 🎥 button walks the chase distances only — the view pill
        // beside SOUND owns chase⇄helm now, so this no longer has to carry
        // both jobs on one control.
        game.engine.camDistance = (game.engine.camDistance + 1) % 3;
        game.hud.toast(['CLOSE', 'DEFAULT', 'WIDE'][game.engine.camDistance]);
      }
      else if (act === 'weather') { cycleWeather(); }
      game.audio?.whoosh();
    });
  });

  // Sound on/off — always visible, works on desktop and mobile.
  const sound = document.getElementById('sound-toggle');
  const syncSound = () => {
    const muted = game.audio.muted;
    sound.classList.toggle('muted', muted);
    sound.firstChild.textContent = muted ? '🔇' : '🔊';
  };
  sound.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    game.audio.start();                 // first tap also unlocks the audio context
    const muted = game.audio.toggleMute();
    syncSound();
    game.hud.toast(muted ? 'SOUND OFF' : 'SOUND ON');
  });

  // Chase ⇄ helm — always visible. Shares one code path with the V key so the
  // button label, the toast and the camera can never disagree.
  const viewBtn = document.getElementById('view-toggle');
  viewBtn?.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    toggleView();
  });

  // Tapping a vessel pill swaps to it (mobile equivalent of keys 1–4).
  document.querySelectorAll('#vessel-strip .vpill').forEach((pill, i) => {
    pill.style.pointerEvents = 'auto';
    pill.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (i !== currentIndex) { spawnVessel(i, true); game.hud.toast(`${VESSELS[i].name.toUpperCase()} DEPLOYED`); }
    });
  });
}

// ──────────────────────────────────────────────────────────────
// Plow force: hitting scenery at speed launches it and costs you
// almost nothing, rather than stopping the boat dead.
// ──────────────────────────────────────────────────────────────
function installCollisionRules() {
  game.physics.onCollision((a, b, started) => {
    if (!started) return;
    const va = a?.kind === 'vessel' ? a : null;
    const vb = b?.kind === 'vessel' ? b : null;
    if (!va && !vb) return;

    const other = va ? b : a;
    const v = game.vessel;
    if (!v) return;

    // ── boat on boat ──
    // Both hulls take damage from the closing speed, each computed on its
    // own client. They see slightly different numbers — nobody sees a
    // collision that didn't happen, which is the part that matters.
    if (other?.kind === 'remote') {
      // The registry hands back the collider's entity wrapper, not the ghost.
      const ghost = other.remote;
      if (!ghost) return;
      const closing = v.vel.distanceTo(ghost.velocity);
      if (closing < 9) return;
      const dmg = (closing - 8) * 1.6 * Math.sqrt(v.mass / 1300);
      v.applyDamage(dmg, ghost.id);
      game.engine.addShake(Math.min(closing * 0.03, 1.2));
      game.fx.sparks(ghost.position.x, ghost.position.y + 1, ghost.position.z, 16, 1, 0.8, 0.35);
      game.audio?.crash();
      return;
    }

    if (!other || other.kind !== 'prop' || !other.alive) return;

    const speed = v.speed;
    if (speed < 5) return;

    const t = other.body.translation();
    const dx = t.x - v.position.x, dy = t.y - v.position.y, dz = t.z - v.position.z;
    const inv = 1 / Math.max(Math.hypot(dx, dy, dz), 0.001);
    const dir = { x: dx * inv, y: dy * inv, z: dz * inv };

    const propMass = other.body.mass();

    // Damage scales with the vessel's kinetic punch — the barge erases things
    // the speedboat only nudges. The launch impulse is expressed per unit of
    // prop mass so a tree and a boulder both fly, regardless of what hit them.
    const dmg = (speed - 4) * Math.sqrt(v.mass / 1300) * 5;
    const launch = propMass * Math.min(speed * 1.5, 45);
    const broke = game.destruction.damage(other, dmg, t, dir, launch);

    // Give back most of the momentum the collision stole.
    const recover = Math.min(propMass * speed * 0.85, v.mass * 12);
    v.body.applyImpulse({
      x: v.fwd.x * recover * Math.sign(v.vel.dot(v.fwd) || 1),
      y: recover * 0.05,
      z: v.fwd.z * recover * Math.sign(v.vel.dot(v.fwd) || 1),
    }, true);

    game.engine.addShake(Math.min(speed * 0.03, 1.1));
    if (!broke) game.audio?.crash();
    if (speed > 24) game.fx.sparks(t.x, t.y, t.z, 10, 1, 0.75, 0.3);
  });
}

// ──────────────────────────────────────────────────────────────
function buildGarage() {
  const wrap = document.getElementById('garage-cards');
  const cards = VESSELS.map((v, i) => {
    const el = document.createElement('div');
    el.className = 'vcard' + (i === 0 ? ' active' : '');
    const bar = (label, value, color) => `
      <div class="stat"><span>${label}</span><i><b style="width:${value * 100}%;background:${color}"></b></i></div>`;
    el.innerHTML = `
      <div class="num">${i + 1}</div>
      <div class="vn" style="color:${v.color}">${v.name}</div>
      <div class="vd">${v.blurb}</div>
      ${bar('SPEED', v.stats.speed, '#ff5d73')}
      ${bar('MASS', v.stats.mass, '#ffd166')}
      ${bar('GUNS', v.stats.guns, '#b388ff')}
      ${bar('GRIP', v.stats.grip, '#4ecdc4')}
    `;
    el.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('active'));
      el.classList.add('active');
      spawnVessel(i, false);
    });
    wrap.appendChild(el);
    return el;
  });

  // Remember the call sign between visits.
  const nameInput = document.getElementById('player-name');
  nameInput.value = localStorage.getItem('doh.name') || '';

  document.getElementById('launch').addEventListener('click', () => {
    document.getElementById('garage').classList.add('hidden');
    game.hud.show();
    game.netHud.show();
    game.input.enabled = true;
    game.running = true;
    game.audio.start();
    game.hud.toast('LEAVING HUNTERS POINT BOAT DOCK', true);

    const name = cleanName(nameInput.value);
    localStorage.setItem('doh.name', name);
    game.mp.selfName = name;
    game.mp.connect(name, currentIndex);
  });
}

// ──────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let accumulator = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const input = game.input;

  // Paused (route-planning map open): freeze the sim, keep the scene on screen
  // behind the map overlay, and let ESC/click close it.
  if (game.paused) {
    if (input.consume('Escape')) game.hud.closeMap();
    game.engine.postfx.render();
    input.endFrame();
    return;
  }

  // Hotkeys can swap the vessel, which destroys the old rigid body. Read
  // game.vessel only AFTER that, or the rest of the frame would drive a body
  // that no longer exists in the physics world — which panics the Rapier WASM
  // module and freezes every subsequent frame.
  if (game.running) handleHotkeys(input);
  const v = game.vessel;

  // ── touch controls: write virtual axes + turret aim before physics ──
  if (game.running && game.mobile.enabled) game.mobile.update();

  // ── fixed-step physics ──
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
    game.time += FIXED_DT;
    if (v) v.fixedUpdate(FIXED_DT, game.running ? input : IDLE_INPUT, game.time);
    game.props.fixedUpdate(FIXED_DT, game.time);
    game.structures.update(FIXED_DT);
    game.physics.step();
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) accumulator = 0;   // don't spiral on a slow frame

  // ── weather: ease the pool toward the selected level ──
  if (Math.abs(WATER_LEVEL - waterTarget) > 0.0005) {
    setWaterLevel(WATER_LEVEL + (waterTarget - WATER_LEVEL) * Math.min(1, dt * 1.2));
  }

  // ── day / night blend ──
  if (game.night !== game.nightTarget) {
    const d = game.nightTarget - game.night;
    game.night += Math.sign(d) * Math.min(Math.abs(d), dt * 1.4);
    game.engine.applyDayNight(game.night);
    game.water.update(game.time, game.night, game.engine.fogColor, game.engine.scene.fog.density);
    game.props.setNight(game.night);
    game.structures.setNight(game.night);
    game.weapons.setNight(game.night);
    game.mp.setNight(game.night);
    v?.setNight(game.night);
  }

  // ── visuals ──
  if (v) {
    v.readTransform();
    v.updateVisual(dt, input, game.engine.camera, game.time);
    if (game.running) game.weapons.tryFire(v, input.consumeFire());
    game.engine.updateCamera(dt, v);
    game.audio.updateEngine(
      Math.min(v.speed / 45, 1.4),
      Math.abs(input.throttle),
      v.boosting,
      v.mode === 'water',
    );
  }

  // Broadcast our boat and replay everyone else's. After the local vessel's
  // readTransform above, so what goes out is this frame's pose, not last's.
  game.mp.update(dt);
  game.netHud.update(dt, game.engine.camera);

  game.props.update(dt, game.time);
  game.destruction.update(dt);
  game.weapons.update(dt);
  game.water.update(
    game.time, game.night, game.engine.fogColor,
    game.engine.scene.fog.density * (game._weatherFog || 1),
  );
  game.fx.update(game.time, innerHeight * game.engine.renderer.getPixelRatio());
  game.engine.tickUniforms(game.time);
  game.hud.update(dt, v);

  const speedFactor = v ? Math.min(v.speed / 60, 1) : 0;
  game.engine.postfx.update(game.engine.bloomStrength ?? 0.34, speedFactor);
  game.engine.postfx.render();

  input.endFrame();
}

const IDLE_INPUT = {
  throttle: 0, steer: 0, boost: false, handbrake: false,
  ndc: { x: 0, y: 0 },
};

/**
 * The single entry point for changing view — the V key, the always-visible
 * pill and the mobile 🎥 button all come through here, so the button label and
 * the camera state cannot drift apart.
 */
function toggleView() {
  const view = game.engine.toggleFirstPerson();
  const first = view === CAM_VIEW.FIRST;
  const btn = document.getElementById('view-toggle');
  if (btn) {
    btn.classList.toggle('first', first);
    btn.firstChild.textContent = first ? '👁' : '🎥';
    btn.querySelector('span').textContent = first ? 'HELM' : 'CHASE';
  }
  game.hud.toast(first ? 'HELM VIEW' : 'CHASE VIEW');
  return view;
}

// ──────────────────────────────────────────────────────────────
function handleHotkeys(input) {
  for (let i = 0; i < Math.min(VESSELS.length, 9); i++) {
    if (input.consume(`Digit${i + 1}`) || input.consume(`Numpad${i + 1}`)) {
      if (i !== currentIndex) {
        const v = spawnVessel(i, true);
        game.hud.toast(`${v.cfg.name.toUpperCase()} DEPLOYED`);
        game.fx.splash(v.position.x, WATER_LEVEL, v.position.z, 1.2);
        game.audio?.whoosh();
      }
    }
  }

  if (input.consume('KeyR')) {
    game.vessel?.reset();
    game.hud.toast('BACK AT HUNTERS POINT');
    game.audio?.whoosh();
  }

  if (input.consume('KeyT')) {
    setNight(game.nightTarget <= 0.5);
    game.hud.toast(game.nightTarget > 0.5 ? 'SYNTHWAVE NIGHT' : 'SUNNY MORNING', true);
  }

  if (input.consume('KeyC')) {
    game.engine.camDistance = (game.engine.camDistance + 1) % 3;
  }

  if (input.consume('KeyV')) toggleView();

  if (input.consume('KeyG')) cycleWeather();

  if (input.consume('KeyM')) {
    const muted = game.audio.toggleMute();
    document.getElementById('sound-toggle')?.classList.toggle('muted', muted);
    const st = document.getElementById('sound-toggle');
    if (st) st.firstChild.textContent = muted ? '🔇' : '🔊';
    game.hud.toast(muted ? 'SOUND OFF' : 'SOUND ON');
  }
}

// ──────────────────────────────────────────────────────────────
boot().catch((err) => {
  console.error(err);
  loadmsg.textContent = `failed: ${err.message}`;
  loadmsg.style.color = '#ff5d73';
});

// Handy for poking at things from the console.
window.__game = game;
window.__addScore = addScore;
window.__frame = frame;
// The *live* terrain module. Re-importing it from a console gives a fresh,
// unloaded instance under Vite's cache-busting query params.
window.__hf = HF;
window.__vessels = VESSELS;
window.__spawnVessel = spawnVessel;
