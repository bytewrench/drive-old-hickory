// ──────────────────────────────────────────────────────────────
// Post stack: bloom (drives the synthwave night) + a two-pass
// tilt-shift that fakes the miniature-diorama look, plus vignette
// and a touch of saturation on the final pass.
// ──────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDir: { value: new THREE.Vector2(1, 0) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.52 },     // screen-space y of the sharp band
    uRange: { value: 0.14 },     // half-height of the sharp band
    uAmount: { value: 3.2 },     // max blur radius in pixels
    uVignette: { value: 0.0 },
    uSaturation: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uDir;
    uniform vec2 uResolution;
    uniform float uFocus;
    uniform float uRange;
    uniform float uAmount;
    uniform float uVignette;
    uniform float uSaturation;
    varying vec2 vUv;

    void main() {
      float d = abs(vUv.y - uFocus);
      float blur = smoothstep(uRange, uRange + 0.34, d);
      vec2 texel = uDir / uResolution * uAmount * blur;

      vec4 c = vec4(0.0);
      c += texture2D(tDiffuse, vUv - texel * 4.0) * 0.051;
      c += texture2D(tDiffuse, vUv - texel * 3.0) * 0.0918;
      c += texture2D(tDiffuse, vUv - texel * 2.0) * 0.12245;
      c += texture2D(tDiffuse, vUv - texel * 1.0) * 0.1531;
      c += texture2D(tDiffuse, vUv)               * 0.1633;
      c += texture2D(tDiffuse, vUv + texel * 1.0) * 0.1531;
      c += texture2D(tDiffuse, vUv + texel * 2.0) * 0.12245;
      c += texture2D(tDiffuse, vUv + texel * 3.0) * 0.0918;
      c += texture2D(tDiffuse, vUv + texel * 4.0) * 0.051;

      // Only the final (vertical) pass sets these, so the first pass is a no-op here.
      if (uVignette > 0.0) {
        vec2 p = vUv - 0.5;
        float v = 1.0 - dot(p, p) * uVignette;
        c.rgb *= clamp(v, 0.0, 1.0);
        float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(vec3(l), c.rgb, uSaturation);
      }

      gl_FragColor = c;
    }
  `,
};

/** Phones get no MSAA and a cheaper tilt-shift; desktops get 4x. */
const IS_MOBILE = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());

    // EffectComposer's default target is built WITHOUT `samples`, which silently
    // defeats the renderer's `antialias: true` — that flag only ever applied to
    // the default framebuffer, and every pixel goes through the composer instead.
    // Supplying our own multisampled target is what actually turns AA on.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: IS_MOBILE ? 0 : 4,
    });
    this.composer = new EffectComposer(renderer, target);

    this.composer.addPass(new RenderPass(scene, camera));

    // Threshold is measured against LINEAR HDR luminance, before ACES compresses
    // it in OutputPass. Sunlit diffuse routinely exceeds 0.72 under a 2.7-intensity
    // sun, so the old value bloomed ordinary surfaces into mush; 0.85 keeps the
    // glow on genuinely hot pixels (emissives, speculars, the night neon).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.34, 0.85, 0.85);
    this.composer.addPass(this.bloom);

    this.tiltH = new ShaderPass(TiltShiftShader);
    this.tiltH.uniforms.uDir.value.set(1, 0);
    this.composer.addPass(this.tiltH);

    this.tiltV = new ShaderPass(TiltShiftShader);
    this.tiltV.uniforms.uDir.value.set(0, 1);
    this.tiltV.uniforms.uVignette.value = 0.62;
    this.tiltV.uniforms.uSaturation.value = 1.18;
    this.composer.addPass(this.tiltV);

    this.composer.addPass(new OutputPass());

    this.setSize(innerWidth, innerHeight);
  }

  setSize(w, h) {
    // composer.setSize already multiplies by pixel ratio and forwards the
    // device-pixel size to every pass, bloom included. Calling bloom.setSize(w, h)
    // afterwards with CSS pixels re-sized the whole bloom mip chain back down to
    // half resolution on a DPR-2 display, which is why day glow looked chunky.
    this.composer.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    this.tiltH.uniforms.uResolution.value.set(w * dpr, h * dpr);
    this.tiltV.uniforms.uResolution.value.set(w * dpr, h * dpr);
  }

  /** Boost pulls focus wide so the whole frame sharpens up as you accelerate. */
  update(bloomStrength, speedFactor) {
    this.bloom.strength = bloomStrength;
    const range = 0.13 + speedFactor * 0.22;
    this.tiltH.uniforms.uRange.value = range;
    this.tiltV.uniforms.uRange.value = range;
  }

  render() {
    this.composer.render();
  }
}
