// Céu diurno: gradiente de espalhamento (zênite azul intenso -> horizonte claro),
// sol, e cúmulos. As nuvens são "2,5D": um campo de densidade numa camada a ~1500 m,
// com sombreamento estimado amostrando a densidade na direção do sol (base cinza,
// topo iluminado). A deriva usa o vento do CFD extrapolado até a altura da camada.
// O mesmo código é usado no reflexo do mar (função corCeu).

import * as THREE from 'three';

export const uniformsCeu = {
  uTempo: { value: 0 },
  uSolDir: { value: new THREE.Vector3(0, 1, 0) },
  uZenite: { value: new THREE.Color('#1b4fb8') },
  uHorizonte: { value: new THREE.Color('#a9cbe8') },
  uSolCor: { value: new THREE.Color('#fff4e2') },
  uNuvemCor: { value: new THREE.Color('#ffffff') },
  uNuvens: { value: 0.5 },
  uDeriva: { value: new THREE.Vector2(0, 0) }, // deslocamento acumulado das nuvens (m)
  uAlturaNuvem: { value: 1500 },
  uBaseNuvem: { value: 900 },
  uTopoNuvem: { value: 2700 },
};

export const glslRuido = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float ruido(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * ruido(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}
`;

export const glslCeu = /* glsl */ `
uniform float uTempo;
uniform vec3 uSolDir;
uniform vec3 uZenite;
uniform vec3 uHorizonte;
uniform vec3 uSolCor;
uniform vec3 uNuvemCor;
uniform float uNuvens;
uniform vec2 uDeriva;
uniform float uAlturaNuvem;

// densidade das nuvens na camada (coordenadas em km)
float densNuvem(vec2 q) {
  // forma grande dos cúmulos: blobs com contorno "couve-flor"
  float base = fbm(q * 0.55);
  float detalhe = fbm(q * 2.3 + base * 1.8);
  float d = base * 0.78 + detalhe * 0.34;
  return smoothstep(1.0 - uNuvens, 1.0 - uNuvens + 0.22, d);
}

vec3 corCeu(vec3 dir, bool comNuvens) {
  float y = max(dir.y, 0.0);
  // gradiente com "linha de horizonte" brilhante (espalhamento de Mie perto do horizonte)
  vec3 col = mix(uHorizonte, uZenite, pow(y, 0.5));
  col = mix(col, uHorizonte * 1.08, exp(-y * 18.0) * 0.6);
  float sd = max(dot(dir, uSolDir), 0.0);
  col += uSolCor * (pow(sd, 6.0) * 0.12 + pow(sd, 200.0) * 0.6);
  col += uSolCor * smoothstep(0.99985, 0.9999, sd) * 30.0;

  if (comNuvens && dir.y > 0.01) {
    // interseção com a camada de nuvens (plana) a uAlturaNuvem metros
    vec2 p = dir.xz / dir.y * uAlturaNuvem;
    vec2 q = (p - uDeriva) * 0.001; // km
    float c = densNuvem(q);
    if (c > 0.001) {
      // luz: quanto de nuvem existe entre o ponto e o sol (amostras na direção do sol)
      vec2 passo = normalize(uSolDir.xz + 1e-4) * 0.12;
      float oc = 0.0;
      for (int i = 1; i <= 4; i++) oc += densNuvem(q + passo * float(i));
      float luz = exp(-oc * 0.55);
      // espessura -> base mais escura; bordas finas deixam passar luz (prateado)
      float esp = smoothstep(0.0, 1.0, c);
      vec3 ambiente = mix(uZenite, uHorizonte, 0.6) * 0.55 + vec3(0.25);
      vec3 nuvem = uNuvemCor * (ambiente * (0.55 + 0.25 * (1.0 - esp)) + uSolCor * luz * 0.95);
      nuvem += uSolCor * pow(sd, 8.0) * (1.0 - esp) * 0.8;
      // nuvens distantes somem na névoa do horizonte
      float longe = smoothstep(0.0, 0.12, dir.y);
      col = mix(col, nuvem, c * mix(0.35, 0.97, longe));
    }
  }
  return col;
}
`;

// ------------------------------------------------------------------ cúmulos volumétricos
// Raymarching numa camada [base, topo]. A densidade combina:
//   cobertura 2D (onde há nuvem e quão alta ela cresce) — cúmulos têm base plana
//   e topo arredondado, mais alto onde a "célula convectiva" é mais forte;
//   erosão por ruído 3D (bordas em couve-flor).
// Luz: Beer–Lambert na direção do sol (4 amostras) + "powder" + função de fase
// de Henyey–Greenstein (borda prateada perto do sol).
export const glslNuvens3D = /* glsl */ `
uniform float uBaseNuvem;
uniform float uTopoNuvem;
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float ruido3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
float fbm3o(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * ruido(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(1.7, 9.2); a *= 0.5; }
  return s / 0.875;
}
float densidade3D(vec3 p, bool detalhe) {
  vec2 q = (p.xz - uDeriva) * 0.00042;
  float cob = fbm3o(q);
  float c = smoothstep(1.0 - uNuvens, 1.0 - uNuvens + 0.3, cob);
  if (c <= 0.0) return 0.0;
  float h = (p.y - uBaseNuvem) / (uTopoNuvem - uBaseNuvem);
  float forma = smoothstep(0.0, 0.05, h) * (1.0 - smoothstep(c * 0.55, c * 0.95, h));
  float d = forma * c;
  if (d <= 0.0 || !detalhe) return d;
  vec3 pp = (p - vec3(uDeriva.x, 0.0, uDeriva.y)) * 0.0026;
  float n = ruido3(pp) * 0.62 + ruido3(pp * 2.9 + 3.1) * 0.38;
  return clamp(d * 1.6 - (1.0 - n) * (0.55 + 0.35 * h), 0.0, 1.0);
}
float faseHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

// devolve (cor das nuvens já atenuada, transmitância)
vec4 nuvens3D(vec3 ro, vec3 rd, float jitter) {
  if (rd.y < 0.015) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = (uBaseNuvem - ro.y) / rd.y;
  float t1 = min((uTopoNuvem - ro.y) / rd.y, t0 + 14000.0);
  const int N = 36;
  float dt = (t1 - t0) / float(N);
  vec3 L = normalize(uSolDir);
  float cosT = dot(rd, L);
  float fase = mix(faseHG(cosT, 0.62), faseHG(cosT, -0.2), 0.35) * 12.566;
  vec3 col = vec3(0.0);
  float T = 1.0;
  float t = t0 + dt * jitter;
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * t;
    float d = densidade3D(p, true);
    if (d > 0.002) {
      // luz do sol: profundidade óptica até o sol
      float od = 0.0;
      float passo = 70.0;
      vec3 lp = p;
      for (int j = 0; j < 4; j++) { lp += L * passo; od += densidade3D(lp, j < 2) * passo; passo *= 1.9; }
      float beer = exp(-od * 0.0065);
      float powder = 1.0 - exp(-d * 6.0);
      float h = clamp((p.y - uBaseNuvem) / (uTopoNuvem - uBaseNuvem), 0.0, 1.0);
      vec3 amb = mix(uHorizonte * 0.55 + vec3(0.05, 0.06, 0.09), uZenite * 0.35 + vec3(0.62), h);
      vec3 S = uSolCor * beer * mix(1.0, powder, 0.55) * fase * 1.25 + amb * 0.62;
      float sigma = d * 0.016;
      float a = 1.0 - exp(-sigma * dt);
      col += T * a * S;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
    t += dt;
  }
  // perspectiva aérea: nuvens distantes somem no azul do horizonte
  float neb = 1.0 - exp(-t0 * 0.00006);
  vec3 ceu = mix(uHorizonte, uZenite, pow(max(rd.y, 0.0), 0.5));
  col = mix(col, ceu * (1.0 - T), neb);
  return vec4(col, T);
}
`;

export function criarCeu({ volumetrico = true } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: uniformsCeu,
    defines: volumetrico ? { VOLUMETRICO: 1 } : {},
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vMundo;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vMundo = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_Position.z = gl_Position.w; // sempre no fundo
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vMundo;
      ${glslRuido}
      ${glslCeu}
      ${glslNuvens3D}
      void main() {
        vec3 dir = normalize(vMundo - cameraPosition);
        #ifdef VOLUMETRICO
          vec3 col = corCeu(dir, false);
          vec4 nv = nuvens3D(cameraPosition, dir, hash12(gl_FragCoord.xy));
          col = col * nv.a + nv.rgb;
        #else
          vec3 col = corCeu(dir, true);
        #endif
        if (dir.y < 0.0) col = uHorizonte * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ceu = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  ceu.scale.setScalar(15000);
  ceu.frustumCulled = false;
  ceu.renderOrder = -1;
  return ceu;
}

/**
 * O céu volumétrico é caro: ele é desenhado num render target de meia resolução
 * (cena separada) e composto como fundo da cena principal por um quad de tela cheia.
 */
export function criarCompositorCeu(ceu, escala = 0.5) {
  const cenaCeu = new THREE.Scene();
  cenaCeu.add(ceu);
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { uCeuTex: { value: rt.texture } },
      depthWrite: false,
      depthTest: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCeuTex;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(uCeuTex, vUv).rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  quad.frustumCulled = false;
  quad.renderOrder = -10;
  return {
    quad,
    redimensionar(w, h) { rt.setSize(Math.max(1, Math.round(w * escala)), Math.max(1, Math.round(h * escala))); },
    renderizar(renderer, camera) {
      renderer.setRenderTarget(rt);
      renderer.render(cenaCeu, camera);
      renderer.setRenderTarget(null);
    },
  };
}
