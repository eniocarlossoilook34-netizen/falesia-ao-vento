import * as THREE from 'three';
import { glslCeu, glslRuido, uniformsCeu } from './ceu.js';
import { NUM_DETALHES, NUM_ONDAS } from './ondas.js';
import { glslGeometria, perfil, uniformsGeometria } from './geometria.js';

// Oceano reaproveitado do Projeto 24 (Gerstner + espuma pelo jacobiano + reflexo do céu).
// Novidade aqui: a profundidade vem do perfil da falésia, então as ondas perdem
// amplitude no raso, a água fica turquesa sobre a areia e há arrebentação na praia.

const vertexShader = /* glsl */ `
#define NW ${NUM_ONDAS}
uniform float uTempoOnda;
uniform vec4 uOndas[NW];
uniform float uChop;
uniform float uAltura;
uniform float uInclinacao;
varying vec3 vMundo;
varying vec2 vXZ;
varying float vProf;
varying float vS;
${glslGeometria}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  float dist = length(p - cameraPosition.xz);
  vS = coordCorte(p).x;
  vProf = max(-alturaPerfil(vS), 0.0);
  // empolamento simplificado: no raso a amplitude cai (a energia vira arrebentação)
  float raso = 0.3 + 0.7 * smoothstep(0.2, 5.0, vProf);
  vec3 desl = vec3(0.0);
  for (int i = 0; i < NW; i++) {
    vec4 w = uOndas[i];
    float k = 6.2831853 / w.w;
    // ondas curtas somem com a distância, onde a malha não tem resolução para elas
    float a = w.z * uInclinacao / k * (1.0 - smoothstep(w.w * 8.0, w.w * 30.0, dist));
    float f = k * dot(w.xy, p) - sqrt(9.81 * k) * uTempoOnda + float(i) * 1.913;
    float c = cos(f);
    desl.xz += uChop * a * w.xy * c;
    desl.y += a * sin(f) * uAltura * raso;
  }
  desl.xz *= raso;
  wp.xyz += desl;
  vMundo = wp.xyz;
  vXZ = p;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
#define NW ${NUM_ONDAS}
#define ND ${NUM_DETALHES}
uniform float uTempoOnda;
uniform vec4 uOndas[NW];
uniform vec4 uDetalhes[ND];
uniform float uChop;
uniform float uAltura;
uniform float uInclinacao;
uniform float uAmpMax;
uniform float uEspuma;
uniform float uLuz;
uniform float uNeblina;
uniform vec3 uFundo;
uniform vec3 uDispersao;
uniform vec4 uRochas[4];
uniform vec3 uRaso;
uniform float uSPraia;
varying vec3 vMundo;
varying vec2 vXZ;
varying float vProf;
varying float vS;

${glslRuido}
${glslCeu}

void main() {
  vec2 p = vXZ;
  float dist = length(vMundo - cameraPosition);
  float dxz = length(p - cameraPosition.xz);

  // tangente (d/dx) e binormal (d/dz) analíticas da superfície de Gerstner
  vec3 T = vec3(1.0, 0.0, 0.0);
  vec3 B = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < NW; i++) {
    vec4 w = uOndas[i];
    float k = 6.2831853 / w.w;
    float s = w.z * uInclinacao;
    float f = k * dot(w.xy, p) - sqrt(9.81 * k) * uTempoOnda + float(i) * 1.913;
    float S = sin(f), C = cos(f);
    float ch = uChop * s * S;
    T.x -= ch * w.x * w.x;  T.z -= ch * w.x * w.y;  T.y += s * w.x * C * uAltura;
    B.x -= ch * w.x * w.y;  B.z -= ch * w.y * w.y;  B.y += s * w.y * C * uAltura;
  }
  // jacobiano horizontal: < 1 onde a água se comprime (crista quebrando)
  float J = T.x * B.z - T.z * B.x;

  for (int i = 0; i < ND; i++) {
    vec4 w = uDetalhes[i];
    float k = 6.2831853 / w.w;
    float fade = 1.0 - smoothstep(w.w * 12.0, w.w * 70.0, dist);
    float f = k * dot(w.xy, p) - sqrt(9.81 * k) * uTempoOnda * 0.8 + float(i) * 2.71;
    float C = cos(f) * w.z * fade;
    T.y += w.x * C;
    B.y += w.y * C;
  }
  vec3 N = normalize(cross(B, T));

  vec3 V = normalize(cameraPosition - vMundo);
  vec3 L = normalize(uSolDir);
  float NdV = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 reflexo = corCeu(R, true);

  // corpo da água: fundo escuro + luz atravessando as cristas (subsurface)
  float crista = smoothstep(-0.35, 0.75, vMundo.y / max(uAmpMax, 0.01));
  vec3 Lh = normalize(vec3(L.x, 0.0, L.z) + 1e-5);
  float contraLuz = pow(max(dot(V, -Lh), 0.0), 4.0);
  float sss = (0.12 + 1.4 * contraLuz) * crista * crista * (0.3 + 0.7 * max(dot(N, -L * vec3(1.0, 0.0, 1.0)), 0.0) + 0.3);
  vec3 agua = uFundo * (0.35 + 0.65 * uLuz);
  agua += uDispersao * uSolCor * sss * uLuz;
  agua += uDispersao * 0.12 * max(dot(N, L), 0.0) * uLuz;

  // água rasa: luz volta do fundo de areia (turquesa), some com a profundidade
  float fundoVisivel = exp(-vProf * 0.45);
  agua = mix(agua, uRaso * (0.55 + 0.45 * max(dot(N, L), 0.0)) * uLuz, fundoVisivel);

  vec3 col = mix(agua, reflexo, fresnel * (1.0 - 0.5 * fundoVisivel));

  // brilho especular do sol
  vec3 H = normalize(L + V);
  float NdH = max(dot(N, H), 0.0);
  float visSol = smoothstep(-0.02, 0.04, L.y);
  col += uSolCor * (pow(NdH, 900.0) * 6.0 + pow(NdH, 120.0) * 0.35) * visSol * uLuz;

  // espuma
  float n1 = fbm(p * 0.33 + vec2(uTempoOnda * 0.12, uTempoOnda * 0.05));
  float n2 = fbm(p * 1.6 - vec2(uTempoOnda * 0.25, -uTempoOnda * 0.1));
  float quebra = smoothstep(1.0, 0.5, J);
  float espuma = quebra * smoothstep(0.3, 0.62, n1 * 0.6 + n2 * 0.5 + quebra * 0.4);
  espuma += smoothstep(0.78, 1.0, crista) * smoothstep(0.45, 0.7, n2) * 0.6;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRochas[i];
    if (r.z <= 0.0) continue;
    float d = max(length(p - r.xy) - r.z, 0.0);
    float anel = exp(-d * r.w);
    float onda = 0.5 + 0.5 * sin(d * 1.3 - uTempoOnda * 2.2 + n1 * 4.0);
    espuma += anel * smoothstep(0.75, 0.45, n2 - anel * 0.35 + onda * 0.25);
  }
  // arrebentação: faixas de espuma que correm para a praia na zona de surfe
  float dPraia = uSPraia - vS; // metros mar adentro a partir da linha d'água
  float zonaSurfe = smoothstep(32.0, 6.0, dPraia) * step(0.0, dPraia + 1.5);
  float frente = fract(dPraia * 0.075 + uTempoOnda * 0.11 + n1 * 0.35);
  float linhas = smoothstep(0.78, 0.97, frente) * smoothstep(1.0, 0.97, frente);
  espuma += zonaSurfe * (linhas * 1.4 + smoothstep(0.55, 0.8, n2) * 0.5);
  espuma += smoothstep(2.5, 0.0, dPraia) * (0.6 + 0.4 * n2); // espraiamento na areia
  espuma = clamp(espuma * uEspuma, 0.0, 1.0) * (1.0 - smoothstep(400.0, 1800.0, dist));
  vec3 ambiente = mix(uHorizonte, uZenite, 0.5);
  vec3 corEspuma = ambiente * 0.55 + uSolCor * (0.25 + 0.75 * max(dot(N, L), 0.0)) * uLuz * 0.85;
  col = mix(col, corEspuma, espuma * 0.9);

  // neblina que encontra exatamente a cor do horizonte do céu
  vec3 vd = -V;
  vec3 horizonte = corCeu(normalize(vec3(vd.x, 0.002, vd.z)), false);
  float neb = 1.0 - exp(-dist * uNeblina);
  col = mix(col, horizonte, neb);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Malha radial-ish: grade quadrada com espaçamento que cresce a partir do centro,
 * densa perto da câmera e grossa no horizonte.
 */
function criarGeometria(segmentos = 640, raio = 9000) {
  const A = 210;
  const B = raio - A;
  const mapa = (t) => Math.sign(t) * (A * Math.abs(t) + B * Math.pow(Math.abs(t), 5));
  const n = segmentos + 1;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      pos[k] = mapa((i / segmentos) * 2 - 1);
      pos[k + 1] = 0;
      pos[k + 2] = mapa((j / segmentos) * 2 - 1);
    }
  }
  const idx = new Uint32Array(segmentos * segmentos * 6);
  let o = 0;
  for (let j = 0; j < segmentos; j++) {
    for (let i = 0; i < segmentos; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b;
      idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

export function criarOceano() {
  const uniforms = {
    ...uniformsCeu,
    uTempoOnda: { value: 0 },
    uOndas: { value: Array.from({ length: NUM_ONDAS }, () => new THREE.Vector4()) },
    uDetalhes: { value: Array.from({ length: NUM_DETALHES }, () => new THREE.Vector4()) },
    uChop: { value: 1 },
    uAltura: { value: 1 },
    uInclinacao: { value: 1 },
    uAmpMax: { value: 1 },
    uEspuma: { value: 1 },
    uLuz: { value: 1 },
    uNeblina: { value: 0.0004 },
    uFundo: { value: new THREE.Color() },
    uDispersao: { value: new THREE.Color() },
    uRochas: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uRaso: { value: new THREE.Color('#3fc2c0') },
    uSPraia: { value: perfil.sPraia },
    ...uniformsGeometria(),
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const malha = new THREE.Mesh(criarGeometria(), material);
  malha.frustumCulled = false;
  return { malha, uniforms };
}

export function definirOndas(uniforms, { ondas, detalhes }) {
  ondas.forEach((o, i) => uniforms.uOndas.value[i].set(...o));
  detalhes.forEach((o, i) => uniforms.uDetalhes.value[i].set(...o));
}
