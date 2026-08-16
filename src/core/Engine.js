// ──────────────────────────────────────────────────────────────
// Renderer, scene, camera rig, sky dome, lighting and the
// day ⇄ synthwave-night blend.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { game } from '../game.js';
import { LAYER_HULL } from '../config.js';

// The sky dome used to be map-sized (radius 53 km), which forced the camera far
// plane out to 123 km for a scene that fog makes fully opaque past ~2 km. That
// spent the entire depth buffer on empty space. The dome follows the player, so
// it only has to out-range the fog — and a 9 km far plane is ~27x the depth
// resolution of the old one.
const SKY_RADIUS = 13000;
const STAR_RADIUS = 12400;
const CAM_FAR = 16000;
const CAM_NEAR = 0.3;
const CAM_NEAR_FP = 0.12;      // cockpit view sits inches from geometry

/** Chase distance presets, and the helm view. */
export const CAM_VIEW = { CHASE: 'chase', FIRST: 'first' };

export { LAYER_HULL };

const UP_AXIS = new THREE.Vector3(0, 1, 0);
// Hulls are modelled +Z forward; a camera looks down its own -Z. This turns one
// into the other.
const YAW_FLIP = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, Math.PI);

const DAY = {
  skyTop: new THREE.Color('#5fb8ff'),
  skyBottom: new THREE.Color('#ffe9c4'),
  fog: new THREE.Color('#cfe6f5'),
  sun: new THREE.Color('#fff3d6'),
  sunIntensity: 2.7,
  hemiSky: new THREE.Color('#bfe4ff'),
  hemiGround: new THREE.Color('#8d9a63'),
  // Trimmed from 1.05 / 0.32 — the environment map now supplies fill light with
  // actual directionality, and leaving these at full strength on top of it
  // washed the contrast back out.
  hemiIntensity: 0.80,
  ambient: 0.20,
  // Thinned from 0.00105, which put the horizon at roughly 2 km — close enough
  // that the far bank and the bridges downriver were a wall of haze. At
  // 0.00040 the view opens out to ~5 km, which is what actually makes a 56 km
  // map feel like one.
  fogDensity: 0.00040,
  bloom: 0.34,
};

const NIGHT = {
  skyTop: new THREE.Color('#12042e'),
  skyBottom: new THREE.Color('#ff2fb9'),
  fog: new THREE.Color('#2a0a4a'),
  sun: new THREE.Color('#7b5bff'),
  sunIntensity: 0.85,
  hemiSky: new THREE.Color('#4b1e8a'),
  hemiGround: new THREE.Color('#1b0736'),
  hemiIntensity: 0.55,
  ambient: 0.18,
  fogDensity: 0.00075,
  bloom: 1.45,
};

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform float uNight;
  uniform float uTime;
  varying vec3 vDir;

  void main() {
    float t = smoothstep(-0.15, 0.65, vDir.y);
    vec3 col = mix(uBottom, uTop, t);

    // Retro sun-grid bands on the night horizon.
    float band = smoothstep(0.0, 0.02, vDir.y) * (1.0 - smoothstep(0.02, 0.30, vDir.y));
    float stripes = step(0.5, fract(vDir.y * 90.0 - uTime * 0.25));
    col += uNight * band * stripes * vec3(1.0, 0.18, 0.72) * 0.55;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Linear filtering of the float height texture used by the water shader.
    const gl = this.renderer.getContext();
    gl.getExtension('OES_texture_float_linear');

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(DAY.fog.getHex(), DAY.fogDensity);

    this.camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, CAM_NEAR, CAM_FAR);
    this.camera.position.set(0, 40, -50);
    // Chase view shows the hull; first-person masks the layer off.
    this.camera.layers.enable(LAYER_HULL);

    // A longer lens is the single biggest "designed diorama" cue — it flattens
    // perspective so the world reads as a built model rather than a wide-angle
    // game demo. Distances below are scaled by tan(24°)/tan(17°) ≈ 1.46 so the
    // subject framing matches what the old 48° FOV gave.
    this.baseFov = 34;
    this.camDistance = 1;      // 0 close · 1 default · 2 wide
    this.camView = CAM_VIEW.CHASE;
    this.camYaw = 0;
    this.camPos = new THREE.Vector3(0, 30, -40);
    this.camLook = new THREE.Vector3();
    this.shake = 0;
    // Impact roll spring — a damped oscillator kicked on collisions.
    this.roll = { value: 0, speed: 0 };
    this._eye = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qTmp = new THREE.Quaternion();

    this._buildSky();
    this._buildLights();
    this._buildStars();
    this._buildEnvironment();

    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
  }

  // ── scene furniture ─────────────────────────────────────────
  _buildSky() {
    const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 18);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: DAY.skyTop.clone() },
        uBottom: { value: DAY.skyBottom.clone() },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiIntensity);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, DAY.ambient);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    // The old normalBias of 0.6 was ~4 shadow texels of offset, which detached
    // every contact shadow from its object (0.28 m fence posts floated entirely).
    // It was a symptom of the oversized frustum below, not a bias problem.
    this.sun.shadow.normalBias = 0.045;

    // Tightened from 150 to 55. At 2048² that moves resolution from 0.146 m per
    // texel to 0.054 m — a 2.7x sharpening — which is what makes the small bias
    // above viable. The frustum tracks the player, so 110 m of covered ground is
    // well beyond anything on screen at these camera distances.
    this.shadowExtent = 55;
    const cam = this.sun.shadow.camera;
    const S = this.shadowExtent;
    cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S;
    cam.near = 1; cam.far = 620;
    cam.updateProjectionMatrix();

    // Local hull meshes sit on LAYER_HULL so the main camera can mask them in
    // first-person; the shadow camera must still see them or the boat's own
    // shadow vanishes when you switch view.
    this.sun.shadow.camera.layers.enable(LAYER_HULL);

    this.sunOffset = new THREE.Vector3(120, 210, 90);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  /**
   * scene.environment was never set, so every `metalness > 0` surface in the
   * game — gate ironwork, shell casings, the vessel's hardware — had nothing to
   * reflect and resolved to flat grey. MeshStandardMaterial is a PBR model; its
   * specular lobe is meaningless without an environment to sample.
   *
   * Rather than ship an HDRI, we PMREM a miniature stand-in scene that mirrors
   * the sky gradient and ground tone, so reflections always agree with the sky
   * the player can actually see.
   */
  _buildEnvironment() {
    this._pmrem = new THREE.PMREMGenerator(this.renderer);

    this._envScene = new THREE.Scene();
    this._envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: DAY.skyTop.clone() },
        uBottom: { value: DAY.skyBottom.clone() },
        uGround: { value: DAY.hemiGround.clone() },
        uSun: { value: DAY.sun.clone() },
        uSunPow: { value: 1 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uBottom, uGround, uSun;
        uniform float uSunPow;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = mix(uBottom, uTop, smoothstep(-0.05, 0.6, d.y));
          col = mix(uGround, col, smoothstep(-0.3, 0.03, d.y));
          // A soft sun lobe so glossy surfaces get a highlight to catch.
          float s = max(dot(d, normalize(vec3(0.42, 0.74, 0.32))), 0.0);
          col += uSun * pow(s, 42.0) * 2.4 * uSunPow;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this._envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), this._envMat));

    this._envRT = null;
    this._envNight = -1;
    this.scene.environmentIntensity = 0.55;
    this._refreshEnvironment(0);
  }

  /** Re-bake the IBL. Throttled by the caller — this is not a per-frame op. */
  _refreshEnvironment(n) {
    const u = this._envMat.uniforms;
    u.uTop.value.copy(DAY.skyTop).lerp(NIGHT.skyTop, n);
    u.uBottom.value.copy(DAY.skyBottom).lerp(NIGHT.skyBottom, n);
    u.uGround.value.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, n);
    u.uSun.value.copy(DAY.sun).lerp(NIGHT.sun, n);
    u.uSunPow.value = 1 - n * 0.8;

    const prev = this._envRT;
    this._envRT = this._pmrem.fromScene(this._envScene);
    this.scene.environment = this._envRT.texture;
    prev?.dispose();
    this._envNight = n;
  }

  _buildStars() {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.85 + 0.06;      // keep them above the horizon
      const r = STAR_RADIUS;
      pos[i * 3] = Math.cos(u) * Math.sin(v * Math.PI * 0.5) * r;
      pos[i * 3 + 1] = Math.cos(v * Math.PI * 0.5) * r * 0.9 + 40;
      pos[i * 3 + 2] = Math.sin(u) * Math.sin(v * Math.PI * 0.5) * r;
      size[i] = 1.4 + Math.random() * 3.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));

    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      // gl_PointSize is in device pixels, so a retina display was drawing the
      // stars at half their intended size until uDpr was folded in.
      uniforms: { uOpacity: { value: 0 }, uDpr: { value: this.renderer.getPixelRatio() } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        uniform float uDpr;
        varying float vS;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uDpr;
          gl_Position = projectionMatrix * mv;
          vS = aSize;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vS;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.05, length(d));
          gl_FragColor = vec4(vec3(1.0, 0.94, 1.0), a * uOpacity);
        }
      `,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  // ── per-frame ───────────────────────────────────────────────
  /** Blend every palette value between the day and night presets. */
  applyDayNight(n) {
    const mix = (a, b) => a + (b - a) * n;
    this.skyMat.uniforms.uTop.value.copy(DAY.skyTop).lerp(NIGHT.skyTop, n);
    this.skyMat.uniforms.uBottom.value.copy(DAY.skyBottom).lerp(NIGHT.skyBottom, n);
    this.skyMat.uniforms.uNight.value = n;

    this.fogColor = DAY.fog.clone().lerp(NIGHT.fog, n);
    this.scene.fog.color.copy(this.fogColor);
    this.scene.fog.density = mix(DAY.fogDensity, NIGHT.fogDensity);

    this.sun.color.copy(DAY.sun).lerp(NIGHT.sun, n);
    this.sun.intensity = mix(DAY.sunIntensity, NIGHT.sunIntensity);
    this.hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, n);
    this.hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, n);
    this.hemi.intensity = mix(DAY.hemiIntensity, NIGHT.hemiIntensity);
    this.ambient.intensity = mix(DAY.ambient, NIGHT.ambient);

    this.starMat.uniforms.uOpacity.value = Math.max(0, n * 1.15 - 0.15);
    this.bloomStrength = mix(DAY.bloom, NIGHT.bloom);

    // Re-baking the IBL is far too costly to do on every frame of a transition,
    // and the eye cannot resolve the difference — 8 steps across the blend is
    // indistinguishable from continuous.
    if (Math.abs(n - this._envNight) > 0.12 || (n === 0 || n === 1) && n !== this._envNight) {
      this._refreshEnvironment(n);
    }
  }

  /** Switch between the chase rig and the helm view. */
  setView(view) {
    if (view === this.camView) return;
    this.camView = view;
    const fp = view === CAM_VIEW.FIRST;
    // Mask the local hull off the main camera in first-person. The shadow
    // camera keeps LAYER_HULL enabled, so the boat still casts a shadow.
    this.camera.layers.toggle(LAYER_HULL);
    this.camera.near = fp ? CAM_NEAR_FP : CAM_NEAR;
    this.camera.updateProjectionMatrix();
    return this.camView;
  }

  toggleFirstPerson() {
    return this.setView(this.camView === CAM_VIEW.FIRST ? CAM_VIEW.CHASE : CAM_VIEW.FIRST);
  }

  /**
   * Long-lens chase cam, or the helm view. Takes the whole vessel because a
   * cockpit needs pitch and roll, and the old signature only carried a scalar
   * yaw.
   */
  updateCamera(dt, vessel) {
    const target = vessel.position;
    const speed = vessel.speed;

    // Impact roll spring — a damped harmonic oscillator, kicked by kickRoll().
    // This reads far better than positional shake for collisions because the
    // horizon tilts, which is what a real impact does to your view.
    this.roll.speed += -this.roll.value * 100 * dt;
    this.roll.value += this.roll.speed * dt;
    this.roll.speed *= Math.max(0, 1 - 4 * dt);

    if (this.camView === CAM_VIEW.FIRST) this._updateHelm(dt, vessel);
    else this._updateChase(dt, vessel);

    if (this.shake > 0.001) {
      this.shake *= Math.exp(-6 * dt);
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }

    if (Math.abs(this.roll.value) > 0.0001) this.camera.rotateZ(this.roll.value);

    // Keep the sky, stars and shadow frustum centred on the player.
    this.sky.position.set(target.x, 0, target.z);
    this.stars.position.set(target.x, 0, target.z);
    this._updateShadow(target, speed);
  }

  _updateChase(dt, vessel) {
    const target = vessel.position;
    const { heading, speed, boosting } = vessel;

    const dist = [34, 48, 66][Math.round(this.camDistance)] ?? 48;
    // Flattened from [18, 25, 35]. Those put the eye ~30° above the horizontal,
    // so most of the frame was the water immediately around the boat and the
    // horizon was squeezed into a strip at the top. At ~19° you look down the
    // river rather than down at it, which is what actually opens the view up.
    const height = [12, 16, 23][Math.round(this.camDistance)] ?? 16;

    // Smoothly chase the vessel's heading so tight turns don't whip the camera.
    let dy = heading - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    // Slowed from 3.4. A 34° lens shows ~1.46x more apparent motion per degree
    // of yaw than the old 48° one, so the same camera follow rate reads as
    // considerably twitchier through the narrower lens. Letting the camera lag
    // further behind the hull is most of what makes a turn feel unhurried.
    this.camYaw += dy * (1 - Math.exp(-2.3 * dt));

    // Speed reads as the camera DOLLYING BACK, not the lens widening. Punching
    // FOV to 76 under boost distorted the whole frame and undid the long-lens
    // look; pulling back conveys the same acceleration without the warp.
    const pull = THREE.MathUtils.smoothstep(speed, 4, 42);
    const back = dist + pull * 16 + (boosting ? 7 : 0);
    const up = height + pull * 6;

    const desired = new THREE.Vector3(
      target.x - Math.sin(this.camYaw) * back,
      target.y + up,
      target.z - Math.cos(this.camYaw) * back,
    );

    const k = 1 - Math.exp(-6.5 * dt);
    this.camPos.lerp(desired, k);
    this.camPos.y = Math.max(this.camPos.y, target.y + 3);   // never clip the ground
    this.camera.position.copy(this.camPos);

    this.camLook.lerp(
      new THREE.Vector3(
        target.x + Math.sin(this.camYaw) * (4 + speed * 0.18),
        target.y + 4.0,
        target.z + Math.cos(this.camYaw) * (4 + speed * 0.18),
      ),
      k,
    );
    this.camera.lookAt(this.camLook);

    // A small residual FOV kick on boost only — nitro is a headline mechanic
    // here and deserves a punch, but 5° instead of the old 28° of total swing.
    const fovTarget = this.baseFov + (boosting ? 5 : 0);
    this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-5 * dt));
    this.camera.updateProjectionMatrix();
  }

  /**
   * Helm view. The eye anchor is an Object3D parented inside the vessel rig, so
   * it inherits the catalog→physics rescale automatically — reading raw catalog
   * coordinates would be wrong by the wrap scale factor.
   */
  _updateHelm(dt, vessel) {
    const eye = vessel.model?.eye;
    if (eye) eye.getWorldPosition(this._eye);
    else this._eye.copy(vessel.position).setY(vessel.position.y + 1.4);
    this.camera.position.copy(this._eye);

    // Full hull attitude is nauseating on a wave train, and a yaw-only lock
    // feels detached from the boat. Blending 55% of the real pitch/roll keeps
    // the sense of the hull working under you without the motion sickness.
    this._q.setFromAxisAngle(UP_AXIS, vessel.heading + Math.PI);
    this._qTmp.copy(vessel.quat).multiply(YAW_FLIP);
    this._q.slerp(this._qTmp, 0.55);

    this.camera.quaternion.slerp(this._q, 1 - Math.exp(-16 * dt));

    const fovTarget = 60 + (vessel.boosting ? 6 : 0);
    this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-5 * dt));
    this.camera.updateProjectionMatrix();
  }

  /**
   * Fit the shadow frustum to roughly what the camera can see, and bias it
   * forward of the boat. A fixed extent either wastes resolution when close or
   * pops shadows in at the edge when pulled wide.
   */
  _updateShadow(target, speed) {
    const want = this.camView === CAM_VIEW.FIRST
      ? 46
      : 34 + ([34, 48, 66][Math.round(this.camDistance)] ?? 48) * 0.55;

    if (Math.abs(want - this.shadowExtent) > 0.5) {
      this.shadowExtent += (want - this.shadowExtent) * 0.1;
      const cam = this.sun.shadow.camera;
      const S = this.shadowExtent;
      cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S;
      cam.updateProjectionMatrix();
    }

    // Push the covered area toward where you are looking rather than centring
    // it on the hull — half the budget was being spent behind the player.
    const lead = Math.min(speed * 0.35, this.shadowExtent * 0.4);
    const fx = target.x + Math.sin(this.camYaw) * lead;
    const fz = target.z + Math.cos(this.camYaw) * lead;
    this.sun.target.position.set(fx, target.y, fz);
    this.sun.position.set(fx, target.y, fz).add(this.sunOffset);
  }

  addShake(amount) {
    this.shake = Math.min(this.shake + amount, 3.2);
  }

  /** Kick the roll spring. Sign is randomised so repeated hits don't resonate. */
  kickRoll(amount) {
    this.roll.speed += amount * (Math.random() < 0.5 ? -1 : 1);
  }

  tickUniforms(t) {
    this.skyMat.uniforms.uTime.value = t;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.starMat.uniforms.uDpr.value = this.renderer.getPixelRatio();
    game.engine?.postfx?.setSize(w, h);
  }
}
