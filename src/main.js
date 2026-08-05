// ──────────────────────────────────────────────────────────────
// DRIVE OLD HICKORY — boot, garage screen and the main loop.
// ──────────────────────────────────────────────────────────────

import './ui/style.css';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { FIXED_DT, MAX_SUBSTEPS, HEIGHT_TEX_RES, WATER_LEVEL } from './config.js';
import { game, addScore } from './game.js';

import { Engine } from './core/Engine.js';
import { PostFX } from './core/PostFX.js';
import { Physics } from './core/Physics.js';
import { Input } from './core/Input.js';
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
  game.audio = new AudioKit();
  game.hud = new Hud(game.water.heightData, HEIGHT_TEX_RES);

  await progress(93, 'warming shaders…');
  engine.postfx = new PostFX(engine.renderer, engine.scene, engine.camera);
  engine.applyDayNight(0);

  spawnVessel(0);
  installCollisionRules();
  buildGarage();

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

  prev?.dispose();

  currentIndex = index;
  const v = new Vessel(game.physics, game.engine.scene, VESSELS[index], spawn);
  v.setNight(game.night);
  game.vessel = v;
  game.hud.setVessel(index);
  game.engine.camYaw = v.heading;
  return v;
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
    if (!other || other.kind !== 'prop' || !other.alive) return;

    const v = game.vessel;
    if (!v) return;

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

  document.getElementById('launch').addEventListener('click', () => {
    document.getElementById('garage').classList.add('hidden');
    game.hud.show();
    game.input.enabled = true;
    game.running = true;
    game.audio.start();
    game.hud.toast('LEAVING HUNTERS POINT BOAT DOCK', true);
  });
}

// ──────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let accumulator = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const input = game.input;

  // Hotkeys can swap the vessel, which destroys the old rigid body. Read
  // game.vessel only AFTER that, or the rest of the frame would drive a body
  // that no longer exists in the physics world — which panics the Rapier WASM
  // module and freezes every subsequent frame.
  if (game.running) handleHotkeys(input);
  const v = game.vessel;

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

  // ── day / night blend ──
  if (game.night !== game.nightTarget) {
    const d = game.nightTarget - game.night;
    game.night += Math.sign(d) * Math.min(Math.abs(d), dt * 1.4);
    game.engine.applyDayNight(game.night);
    game.water.update(game.time, game.night, game.engine.fogColor, game.engine.scene.fog.density);
    game.props.setNight(game.night);
    game.structures.setNight(game.night);
    game.weapons.setNight(game.night);
    v?.setNight(game.night);
  }

  // ── visuals ──
  if (v) {
    v.readTransform();
    v.updateVisual(dt, input, game.engine.camera, game.time);
    if (game.running) game.weapons.tryFire(v, input.consumeFire());
    game.engine.updateCamera(dt, v.position, v.heading, v.speed, v.boosting);
    game.audio.updateEngine(
      Math.min(v.speed / 45, 1.4),
      Math.abs(input.throttle),
      v.boosting,
      v.mode === 'water',
    );
  }

  game.props.update(dt, game.time);
  game.destruction.update(dt);
  game.weapons.update(dt);
  game.water.update(game.time, game.night, game.engine.fogColor, game.engine.scene.fog.density);
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

// ──────────────────────────────────────────────────────────────
function handleHotkeys(input) {
  for (let i = 0; i < 4; i++) {
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
    game.nightTarget = game.nightTarget > 0.5 ? 0 : 1;
    game.hud.toast(game.nightTarget > 0.5 ? 'SYNTHWAVE NIGHT' : 'SUNNY MORNING', true);
  }

  if (input.consume('KeyC')) {
    game.engine.camDistance = (game.engine.camDistance + 1) % 3;
  }

  if (input.consume('KeyM')) {
    game.audio.muted = !game.audio.muted;
    if (game.audio.muted) game.audio.updateEngine(0, 0, false, true);
    game.hud.toast(game.audio.muted ? 'MUTED' : 'UNMUTED');
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
