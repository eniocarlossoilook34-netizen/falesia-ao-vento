// Grama e flores silvestres instanciadas, dobradas pelo vento do CFD.
//
// Cada folha é uma haste curva de comprimento H. Sob vento ela se curva como um
// arco de raio constante cujo ângulo θ cresce com o arrasto (∝ U²):
//     θ = θmax · (1 − exp(−c · U²))
//     ponto ao longo da folha (t ∈ [0,1]):  horizontal = H(1 − cos θt)/θ,  vertical = H sin(θt)/θ
// O comprimento da folha se conserva, então ela "deita" de forma crível.
// A vibração rápida (flutter) tem amplitude proporcional à velocidade local.

import * as THREE from 'three';
import { alturaTerreno, coordCorte, fbm, glslGeometria, pesoEstrada, uniformsGeometria } from './geometria.js';
import { glslVento } from './vento.js';

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Folha: tira afinada com 4 segmentos (9 vértices). */
function geometriaFolha() {
  const seg = 4;
  const pos = [];
  const uv = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = 0.5 * (1 - Math.pow(t, 1.4));
    if (i < seg) {
      pos.push(-w, t, 0, w, t, 0);
      uv.push(0, t, 1, t);
    } else {
      pos.push(0, 1, 0);
      uv.push(0.5, 1);
    }
  }
  const idx = [];
  for (let i = 0; i < seg - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const a = (seg - 1) * 2;
  idx.push(a, a + 1, a + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const vertexShader = /* glsl */ `
attribute vec3 aBase;
attribute vec4 aParam;   // altura, largura, rotação, variação de cor
attribute float aTipo;   // 0 = grama, 1..3 = flor (amarela, branca, lilás)
uniform float uTempo;
uniform float uTamanhoFlor;
uniform float uCorteX; // modo científico: some com a grama antes do plano de corte
varying vec2 vUv;
varying float vVar;
varying float vTipo;
varying vec3 vNormal2;
varying vec3 vMundo;
varying float vVel;
${glslGeometria}
${glslVento}

void main() {
  float H = aParam.x;
  float t = uv.y;
  // vento a ~60 % da altura da folha (onde o arrasto se concentra)
  vec3 v = ventoMundo(aBase.xz, 0.6 * H);
  vec2 vh = v.xz;
  float U = length(vh) + 1e-4;
  vec2 dir = vh / U;
  vVel = length(v);

  // flutter: oscilação rápida, fase aleatória por folha
  float fase = aParam.w * 40.0 + aBase.x * 1.7 + aBase.z * 1.3;
  float flutter = sin(uTempo * (7.0 + aParam.w * 6.0) + fase) * 0.06 * clamp(U / 8.0, 0.0, 1.5);
  float theta = 1.35 * (1.0 - exp(-0.012 * U * U)) + flutter + 0.08 * aParam.w;
  theta = max(theta, 1e-3);

  // arco de comprimento H
  float horiz = H * (1.0 - cos(theta * t)) / theta;
  float vert = H * sin(theta * t) / theta;

  // a folha é uma tira; a largura fica perpendicular à sua orientação própria
  float r = aParam.z;
  vec2 lado = vec2(cos(r), sin(r));
  float larg = position.x * aParam.y;
  if (aTipo > 0.5) larg *= mix(1.0, 3.2 * uTamanhoFlor, smoothstep(0.82, 0.92, t)); // pétalas no topo
  vec3 p = aBase + vec3(lado.x * larg + dir.x * horiz, vert, lado.y * larg + dir.y * horiz);

  // normal: perpendicular à tira, inclinada para cima (folha arredondada)
  vec3 tang = normalize(vec3(dir.x * sin(theta * t), cos(theta * t), dir.y * sin(theta * t)));
  vec3 n = normalize(cross(vec3(lado.x, 0.0, lado.y), tang));
  vNormal2 = normalize(n + vec3(0.0, 0.6, 0.0));

  vUv = uv;
  vVar = aParam.w;
  vTipo = aTipo;
  vMundo = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (aBase.x < uCorteX) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uSolDir;
uniform vec3 uSolCor;
uniform vec3 uCeuCor;
uniform vec3 uChaoCor;
uniform vec3 uNeblinaCor;
uniform float uNeblina;
uniform float uCientifico;
uniform float uVelMax;
varying vec2 vUv;
varying float vVar;
varying float vTipo;
varying vec3 vNormal2;
varying vec3 vMundo;
varying float vVel;

// mapa de cor "turbo" (aproximação polinomial de Mikhailov, 2019)
vec3 turbo(float x) {
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(
    dot(v4, vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2(-152.94239396, 59.28637943)),
    dot(v4, vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2(4.27729857, 2.82956604)),
    dot(v4, vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2(-89.90310912, 27.34824973)));
}

void main() {
  vec3 N = normalize(gl_FrontFacing ? vNormal2 : vec3(-vNormal2.x, vNormal2.y, -vNormal2.z));
  vec3 L = normalize(uSolDir);
  vec3 V = normalize(cameraPosition - vMundo);
  float t = vUv.y;

  // cor da folha: base escura e úmida, ponta mais clara e seca
  vec3 verde = mix(vec3(0.07, 0.13, 0.025), vec3(0.22, 0.27, 0.06), vVar);
  vec3 seco = vec3(0.48, 0.42, 0.17);
  vec3 alb = mix(verde, seco, smoothstep(0.55, 1.0, vVar) * 0.7);
  alb = mix(alb * 0.45, alb * 1.15, t);
  if (vTipo > 0.5 && t > 0.82) {
    alb = vTipo < 1.5 ? vec3(0.85, 0.62, 0.05) : vTipo < 2.5 ? vec3(0.85, 0.85, 0.8) : vec3(0.42, 0.3, 0.7);
  }

  float difusa = max(dot(N, L), 0.0);
  // translucidez: luz do sol atravessando a folha quando vista contra o sol
  float trans = pow(max(dot(V, -L), 0.0), 2.0) * 1.1 + 0.25;
  float ao = mix(0.35, 1.0, t);
  vec3 amb = mix(uChaoCor, uCeuCor, 0.5 + 0.5 * N.y);
  vec3 col = alb * (amb * 0.9 * ao + uSolCor * (difusa * 0.9 + trans * 0.7) * ao);

  if (uCientifico > 0.5) col = turbo(vVel / uVelMax) * (0.55 + 0.45 * t);

  float d = length(vMundo - cameraPosition);
  col = mix(col, uNeblinaCor, 1.0 - exp(-d * uNeblina));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Espalha folhas num retângulo em volta do centro, mais densas perto da câmera.
 * Evita a estrada (com tufos nas bordas) e a face íngreme da falésia.
 */
export function criarGrama(centro, uniformsVento, uniformsCeu, { quantidade = 90000, raio = 55 } = {}) {
  const r = rng(11);
  const base = new Float32Array(quantidade * 3);
  const param = new Float32Array(quantidade * 4);
  const tipo = new Float32Array(quantidade);
  let n = 0;
  let tentativas = 0;
  while (n < quantidade && tentativas < quantidade * 8) {
    tentativas++;
    // distribuição radial concentrada no centro
    const ang = r() * Math.PI * 2;
    const dist = raio * Math.pow(r(), 0.8);
    const x = centro.x + Math.cos(ang) * dist * 1.3;
    const z = centro.z + Math.sin(ang) * dist;
    const { s } = coordCorte(x, z);
    if (s < -7) continue; // face da falésia: só a beirada tem grama
    const e = pesoEstrada(x, s);
    if (e > 0.6 || (e > 0.05 && r() < e * 1.4)) continue;
    const y = alturaTerreno(x, z);
    const bordaTufo = e > 0.05 ? 0.6 : 1.0;
    base.set([x, y - 0.03, z], n * 3);
    const v = r();
    // alturas: maioria 20–45 cm, alguns tufos altos (capim) até ~80 cm
    const tufo = fbm(x * 0.15, z * 0.15, 3);
    const alto = (0.18 + 0.3 * r() + 0.35 * r() * r() * r() + 0.25 * Math.max(tufo - 0.5, 0)) * bordaTufo * (s < 0 ? 0.75 : 1.0);
    param.set([alto, 0.012 + 0.012 * r(), r() * Math.PI, v], n * 4);
    const flor = r();
    tipo[n] = flor < 0.025 ? 1 : flor < 0.04 ? 2 : flor < 0.05 ? 3 : 0;
    if (tipo[n] > 0) param[n * 4] *= 1.2;
    n++;
  }

  const g = geometriaFolha();
  g.setAttribute('aBase', new THREE.InstancedBufferAttribute(base.subarray(0, n * 3), 3));
  g.setAttribute('aParam', new THREE.InstancedBufferAttribute(param.subarray(0, n * 4), 4));
  g.setAttribute('aTipo', new THREE.InstancedBufferAttribute(tipo.subarray(0, n), 1));
  g.instanceCount = n;

  const uniforms = {
    ...uniformsVento,
    ...uniformsGeometria(),
    uTempo: { value: 0 },
    uTamanhoFlor: { value: 1 },
    uCorteX: { value: -1e9 },
    uSolDir: uniformsCeu.uSolDir,
    uSolCor: { value: new THREE.Color() },
    uCeuCor: { value: new THREE.Color() },
    uChaoCor: { value: new THREE.Color() },
    uNeblinaCor: { value: new THREE.Color() },
    uNeblina: { value: 0.0007 },
    uCientifico: { value: 0 },
    uVelMax: { value: 14 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
  });
  const malha = new THREE.Mesh(g, mat);
  malha.frustumCulled = false;
  return { malha, uniforms, quantidade: n };
}
