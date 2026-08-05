// ──────────────────────────────────────────────────────────────
// Stylised water. One big plane covering the map; the fragment
// shader discards wherever the baked terrain height is above the
// water line, so the river, its backwaters and the lakes all fall
// out of the terrain field for free.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { MAP_SIZE, WATER_LEVEL, HEIGHT_TEX_RES, WAVE } from '../config.js';
import { bakeHeightData } from './heightfield.js';

// Duplicated in JS as `waveHeight()` — keep the two in sync.
const WAVE_GLSL = /* glsl */ `
  float waveAt(vec2 p, float t) {
    return ${WAVE.a1.toFixed(3)} * sin(p.x * ${WAVE.f1.toFixed(3)} + t * ${WAVE.s1.toFixed(3)})
         + ${WAVE.a2.toFixed(3)} * sin(p.y * ${WAVE.f2.toFixed(3)} - t * ${WAVE.s2.toFixed(3)})
         + ${WAVE.a3.toFixed(3)} * sin((p.x + p.y) * ${WAVE.f3.toFixed(3)} + t * ${WAVE.s3.toFixed(3)});
  }
`;

const VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  ${WAVE_GLSL}
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.y += waveAt(wp.xz, uTime);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uHeight;
  uniform float uMapSize;
  uniform float uWaterLevel;
  uniform float uTime;
  uniform float uNight;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uFoam;
  uniform vec3 uSkyTint;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  varying vec3 vWorld;
  ${WAVE_GLSL}

  void main() {
    vec2 uv = vWorld.xz / uMapSize + 0.5;
    if (uv.x < 0.002 || uv.x > 0.998 || uv.y < 0.002 || uv.y > 0.998) discard;

    float ground = texture2D(uHeight, uv).r;
    float depth = uWaterLevel - ground;
    if (depth < 0.25) discard;                     // dry land — no water here

    // Analytic normal from the same wave function used by the buoyancy solver.
    float e = 0.75;
    float hx = waveAt(vWorld.xz + vec2(e, 0.0), uTime) - waveAt(vWorld.xz - vec2(e, 0.0), uTime);
    float hz = waveAt(vWorld.xz + vec2(0.0, e), uTime) - waveAt(vWorld.xz - vec2(0.0, e), uTime);
    vec3 n = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));

    vec3 col = mix(uShallow, uDeep, clamp(depth / 9.0, 0.0, 1.0));

    // Animated foam ring hugging the shoreline. Kept tight — a wide band
    // reads as haze rather than surf.
    float shore = smoothstep(1.1, 0.12, depth);
    float ripple = 0.55 + 0.45 * sin(vWorld.x * 0.55 + vWorld.z * 0.42 + uTime * 2.2);
    col = mix(col, uFoam, clamp(shore * ripple, 0.0, 1.0) * 0.75);

    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col = mix(col, uSkyTint, fres * 0.5);

    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(n, H), 0.0), 110.0);
    col += uSunColor * spec * (1.4 + uNight * 3.0);

    // Neon caustic shimmer at night.
    float shimmer = sin(vWorld.x * 0.22 + uTime * 1.6) * sin(vWorld.z * 0.19 - uTime * 1.1);
    col += uNight * max(shimmer, 0.0) * vec3(0.35, 0.05, 0.6) * 0.28;

    float dist = length(cameraPosition - vWorld);
    float fogF = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

    float alpha = clamp(0.62 + depth * 0.05 + shore * 0.3, 0.0, 0.97);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

const DAY_COLORS = {
  shallow: new THREE.Color('#5fd6d0'),
  deep: new THREE.Color('#14607f'),
  foam: new THREE.Color('#f2fbff'),
  sky: new THREE.Color('#bfe6ff'),
  sun: new THREE.Color('#fff2cc'),
};

const NIGHT_COLORS = {
  shallow: new THREE.Color('#6a2fa8'),
  deep: new THREE.Color('#100a3a'),
  foam: new THREE.Color('#ff8fe0'),
  sky: new THREE.Color('#3b0f6b'),
  sun: new THREE.Color('#ff54c8'),
};

export class Water {
  constructor(scene) {
    this.heightData = bakeHeightData(HEIGHT_TEX_RES);

    this.heightTex = new THREE.DataTexture(
      this.heightData, HEIGHT_TEX_RES, HEIGHT_TEX_RES,
      THREE.RedFormat, THREE.FloatType,
    );
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.wrapS = THREE.ClampToEdgeWrapping;
    this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTex.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 220, 220);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uHeight: { value: this.heightTex },
        uMapSize: { value: MAP_SIZE },
        uWaterLevel: { value: WATER_LEVEL },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uShallow: { value: DAY_COLORS.shallow.clone() },
        uDeep: { value: DAY_COLORS.deep.clone() },
        uFoam: { value: DAY_COLORS.foam.clone() },
        uSkyTint: { value: DAY_COLORS.sky.clone() },
        uSunDir: { value: new THREE.Vector3(0.45, 0.78, 0.34).normalize() },
        uSunColor: { value: DAY_COLORS.sun.clone() },
        uFogColor: { value: new THREE.Color('#cfe6f5') },
        uFogDensity: { value: 0.00105 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(time, night, fogColor, fogDensity) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uNight.value = night;
    u.uShallow.value.copy(DAY_COLORS.shallow).lerp(NIGHT_COLORS.shallow, night);
    u.uDeep.value.copy(DAY_COLORS.deep).lerp(NIGHT_COLORS.deep, night);
    u.uFoam.value.copy(DAY_COLORS.foam).lerp(NIGHT_COLORS.foam, night);
    u.uSkyTint.value.copy(DAY_COLORS.sky).lerp(NIGHT_COLORS.sky, night);
    u.uSunColor.value.copy(DAY_COLORS.sun).lerp(NIGHT_COLORS.sun, night);
    if (fogColor) u.uFogColor.value.copy(fogColor);
    if (fogDensity !== undefined) u.uFogDensity.value = fogDensity;
  }
}
