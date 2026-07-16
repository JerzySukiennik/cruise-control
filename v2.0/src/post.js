// Retro-pixel post-processing: render the scene to a low-res target, then one
// fullscreen pass does colour grading + ordered (Bayer) dithering + scanlines +
// vignette + a cheap bloom-lite glow. Keeps the chunky pixel look but far richer.
// One extra pass on a ~400px buffer — cheap enough for the Intel/iPhone targets.
import * as THREE from 'three';

// 8x8 Bayer ordered-dither matrix as a DataTexture (values 0..1, nearest/repeat).
function makeBayerTexture() {
  const N = 8;
  // classic recursive Bayer generation
  const base = [[0, 2], [3, 1]];
  let m = base;
  while (m.length < N) {
    const s = m.length, n = s * 2, out = [];
    for (let y = 0; y < n; y++) out.push(new Array(n));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const v = m[y][x] * 4;
      out[y][x] = v + 0;
      out[y][x + s] = v + 2;
      out[y + s][x] = v + 3;
      out[y + s][x + s] = v + 1;
    }
    m = out;
  }
  const data = new Uint8Array(N * N);
  const denom = N * N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    data[y * N + x] = Math.round((m[y][x] / denom) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D tBayer;
  uniform vec2  uRes;         // low-res buffer size (px)
  uniform float uContrast;
  uniform float uLift;        // raise shadows so darks don't crush to black
  uniform float uBright;
  uniform float uSat;
  uniform vec3  uTint;
  uniform float uLevels;      // colour quantization steps per channel
  uniform float uDither;
  uniform float uScan;        // scanline depth
  uniform float uVignette;
  uniform float uGlow;        // bloom-lite amount
  uniform float uAberration;  // edge chromatic split

  vec3 sampleGlow(vec2 uv) {
    // cheap 4-tap bright-pass blur for a soft glow around hot pixels
    vec2 px = 1.5 / uRes;
    vec3 s = texture2D(tDiffuse, uv + vec2( px.x,  px.y)).rgb;
    s += texture2D(tDiffuse, uv + vec2(-px.x,  px.y)).rgb;
    s += texture2D(tDiffuse, uv + vec2( px.x, -px.y)).rgb;
    s += texture2D(tDiffuse, uv + vec2(-px.x, -px.y)).rgb;
    s *= 0.25;
    float b = max(max(s.r, s.g), s.b);
    return s * smoothstep(0.62, 1.0, b);   // only bright areas bloom
  }

  void main() {
    vec2 uv = vUv;
    // subtle chromatic aberration toward the edges
    vec2 dir = uv - 0.5;
    float ab = uAberration * dot(dir, dir);
    vec3 col;
    col.r = texture2D(tDiffuse, uv + dir * ab).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - dir * ab).b;

    // bloom-lite — skip the 4-tap sample entirely on LOW mode (uGlow ~0)
    if (uGlow > 0.001) col += sampleGlow(uv) * uGlow;

    // the render target holds LINEAR light (no canvas sRGB encode happened) —
    // gamma-encode here or everything reads crushed/dark
    col = pow(max(col, 0.0), vec3(0.4545));

    // colour grade: lift shadows (keep sky/darks readable), mild contrast,
    // saturation boost, warm tint + slight brightness
    col += uLift * (1.0 - col);
    col = (col - 0.5) * uContrast + 0.5;
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(l), col, uSat);
    col *= uTint * uBright;

    // ordered dithering + quantization -> clean retro banding
    float d = texture2D(tBayer, gl_FragCoord.xy / 8.0).r - 0.5;
    col += d * uDither / uLevels;
    col = floor(col * uLevels + 0.5) / uLevels;

    // scanlines (every buffer row)
    float scan = 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159265));
    col *= scan;

    // vignette
    col *= 1.0 - uVignette * dot(dir, dir) * 1.6;

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    const size = renderer.getSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false
    });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      tDiffuse: { value: this.rt.texture },
      tBayer: { value: makeBayerTexture() },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
      uContrast: { value: 1.045 },
      uLift: { value: 0.05 },
      uBright: { value: 1.06 },
      uSat: { value: 1.18 },
      uTint: { value: new THREE.Color(1.0, 0.99, 0.96) },
      uLevels: { value: 32.0 },
      uDither: { value: 1.0 },
      uScan: { value: 0.05 },
      uVignette: { value: 0.18 },
      uGlow: { value: 0.5 },
      uAberration: { value: 0.05 }
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      depthTest: false, depthWrite: false
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setSize(w, h) {
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    this.rt.setSize(w, h);
    this.uniforms.uRes.value.set(w, h);
  }

  // Tuning hook (debug console / future settings menu).
  set(params) {
    for (const k in params) {
      const u = this.uniforms['u' + k[0].toUpperCase() + k.slice(1)];
      if (u) { if (u.value.setHex && typeof params[k] === 'number') u.value.setHex(params[k]); else u.value = params[k]; }
    }
  }

  render(scene, camera) {
    const r = this.renderer;
    if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
