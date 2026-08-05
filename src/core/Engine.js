// ──────────────────────────────────────────────────────────────
// Renderer, scene, camera rig, sky dome, lighting and the
// day ⇄ synthwave-night blend.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { MAP_SIZE } from '../config.js';
import { game } from '../game.js';

const DAY = {
  skyTop: new THREE.Color('#5fb8ff'),
  skyBottom: new THREE.Color('#ffe9c4'),
  fog: new THREE.Color('#cfe6f5'),
  sun: new THREE.Color('#fff3d6'),
  sunIntensity: 2.7,
  hemiSky: new THREE.Color('#bfe4ff'),
  hemiGround: new THREE.Color('#8d9a63'),
  hemiIntensity: 1.05,
  ambient: 0.32,
  fogDensity: 0.00105,
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
  fogDensity: 0.0019,
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

    this.camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, MAP_SIZE * 2.2);
    this.camera.position.set(0, 40, -50);

    this.baseFov = 48;
    this.camDistance = 1;      // 0 close · 1 default · 2 wide
    this.camYaw = 0;
    this.camPos = new THREE.Vector3(0, 30, -40);
    this.camLook = new THREE.Vector3();
    this.shake = 0;

    this._buildSky();
    this._buildLights();
    this._buildStars();

    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
  }

  // ── scene furniture ─────────────────────────────────────────
  _buildSky() {
    const geo = new THREE.SphereGeometry(MAP_SIZE * 0.95, 32, 18);
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
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.6;

    const S = 150;                       // shadow frustum half-extent, follows the player
    const cam = this.sun.shadow.camera;
    cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S;
    cam.near = 1; cam.far = 620;
    cam.updateProjectionMatrix();

    this.sunOffset = new THREE.Vector3(120, 210, 90);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  _buildStars() {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.85 + 0.06;      // keep them above the horizon
      const r = MAP_SIZE * 0.88;
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
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        varying float vS;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize;
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
  }

  /**
   * Bruno-Simon-style chase cam: high, slightly isometric, heavily damped,
   * with the FOV blowing out under boost.
   */
  updateCamera(dt, target, heading, speed, boosting) {
    const dist = [22, 30, 42][Math.round(this.camDistance)] ?? 30;
    const height = [13, 18, 26][Math.round(this.camDistance)] ?? 18;

    // Smoothly chase the vessel's heading so tight turns don't whip the camera.
    let dy = heading - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * (1 - Math.exp(-3.4 * dt));

    const back = dist + Math.min(speed * 0.20, 14);
    const desired = new THREE.Vector3(
      target.x - Math.sin(this.camYaw) * back,
      target.y + height + Math.min(speed * 0.06, 7),
      target.z - Math.cos(this.camYaw) * back,
    );

    const k = 1 - Math.exp(-6.5 * dt);
    this.camPos.lerp(desired, k);

    // Never let the camera clip through the ground.
    this.camPos.y = Math.max(this.camPos.y, target.y + 3);

    this.camera.position.copy(this.camPos);

    if (this.shake > 0.001) {
      this.shake *= Math.exp(-6 * dt);
      const s = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }

    // Look slightly ahead of the vessel.
    this.camLook.lerp(
      new THREE.Vector3(
        target.x + Math.sin(this.camYaw) * (4 + speed * 0.18),
        target.y + 2.5,
        target.z + Math.cos(this.camYaw) * (4 + speed * 0.18),
      ),
      k,
    );
    this.camera.lookAt(this.camLook);

    const fovTarget = this.baseFov + (boosting ? 16 : 0) + Math.min(speed * 0.16, 12);
    this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-5 * dt));
    this.camera.updateProjectionMatrix();

    // Keep the sky and shadow frustum centred on the player.
    this.sky.position.set(target.x, 0, target.z);
    this.stars.position.set(target.x, 0, target.z);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).add(this.sunOffset);
  }

  addShake(amount) {
    this.shake = Math.min(this.shake + amount, 3.2);
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
    game.engine?.postfx?.setSize(w, h);
  }
}
