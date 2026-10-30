// Campo de vento calculado pelo CFD (cfd/lbm_falesia.py), em unidades físicas (m/s).
//
// Dois conjuntos de dados:
//   campo_medio.bin -> média temporal no domínio todo (u, w, Cp, k)    -> textura 2D
//   rajadas.bin     -> 128 instantâneos perto da borda (u, w)           -> textura 3D (s, z, tempo)
// A textura 3D é amostrada com interpolação linear também no tempo: entre dois
// instantâneos do CFD a GPU interpola sozinha.
//
// Do corte 2D para o mundo 3D:
//   - (s, z) vem de geometria.js: s = distância à borda, z = h(s) + altura acima do chão
//   - a componente u do corte aponta "terra adentro" (normal à borda)
//   - abaixo da primeira célula da grade usa-se a lei logarítmica de parede
//       u(z) = u(z_ref) · ln(z/z0) / ln(z_ref/z0),  z0 = 3 cm (grama)
//   - componente paralela à costa: princípio da independência para cristas longas
//     (o escoamento ao longo de uma crista infinita não altera o corte transversal)

import * as THREE from 'three';
import { alturaPerfil, coordCorte } from './geometria.js';

export const vento = {
  meta: null,
  medio: null, // Float32Array (nz, nx, 4)
  rajadas: null, // Float32Array (nt, nz, nx, 2)
  uniforms: null,
};

const Z0_GRAMA = 0.03;

export async function carregarVento(base = './dados/') {
  const meta = await (await fetch(base + 'vento.json')).json();
  const [bm, br] = await Promise.all(
    ['campo_medio.bin', 'rajadas.bin'].map((n) => fetch(base + n).then((r) => r.arrayBuffer())),
  );
  const medio = new Float32Array(bm);
  const rajHalf = new Uint16Array(br);
  const rajadas = new Float32Array(rajHalf.length);
  for (let i = 0; i < rajHalf.length; i++) rajadas[i] = THREE.DataUtils.fromHalfFloat(rajHalf[i]);

  const M = meta.medio;
  const R = meta.rajadas;
  const dx = meta.dx;

  // textura 2D do campo médio (meia precisão: filtragem linear garantida em WebGL2)
  const medioHalf = new Uint16Array(medio.length);
  for (let i = 0; i < medio.length; i++) medioHalf[i] = THREE.DataUtils.toHalfFloat(medio[i]);
  const tMedio = new THREE.DataTexture(medioHalf, M.nx, M.nz, THREE.RGBAFormat, THREE.HalfFloatType);
  tMedio.minFilter = tMedio.magFilter = THREE.LinearFilter;
  tMedio.needsUpdate = true;

  const tRaj = new THREE.Data3DTexture(rajHalf, R.nx, R.nz, R.nt);
  tRaj.format = THREE.RGFormat;
  tRaj.type = THREE.HalfFloatType;
  tRaj.minFilter = tRaj.magFilter = THREE.LinearFilter;
  tRaj.wrapR = THREE.RepeatWrapping; // o tempo dá a volta
  tRaj.unpackAlignment = 1;
  tRaj.needsUpdate = true;

  vento.meta = meta;
  vento.medio = medio;
  vento.rajadas = rajadas;
  vento.duracao = R.nt * R.dtQuadro;
  vento.uniforms = {
    uVentoMedio: { value: tMedio },
    uMedioInfo: { value: new THREE.Vector4(M.s0, M.z0, M.nx * dx, M.nz * dx) },
    uRajadas: { value: tRaj },
    uRajInfo: { value: new THREE.Vector4(R.s0, R.z0, R.nx * dx, R.nz * dx) },
    uRajT: { value: 0 }, // tempo normalizado [0, 1)
    uDuracao: { value: vento.duracao },
    uFatorVento: { value: 1 },
    uRajada: { value: 1 }, // 0 = só o campo médio, 1 = escoamento instantâneo
    uVentoLateral: { value: 0.3 },
    uZRef: { value: 1.5 * dx },
  };
  return vento;
}

// ------------------------------------------------------------------ GLSL
export const glslVento = /* glsl */ `
uniform sampler2D uVentoMedio;
uniform vec4 uMedioInfo;
uniform highp sampler3D uRajadas;
uniform vec4 uRajInfo;
uniform float uRajT;
uniform float uDuracao;
uniform float uFatorVento;
uniform float uRajada;
uniform float uVentoLateral;
uniform float uZRef;

// defasagem lateral das rajadas (hipótese de Taylor: turbulência "congelada"
// em faixas descorrelacionadas ao longo da costa). Em segundos.
float defasagem(float x) {
  return 2.2 * sin(x * 0.031 + 0.4) + 1.3 * sin(x * 0.083 + 2.1) + 0.7 * sin(x * 0.19);
}

// velocidade (u, w) no corte 2D, em m/s
vec2 ventoCorte(float s, float zc, float x) {
  vec2 uvM = vec2((s - uMedioInfo.x) / uMedioInfo.z, (zc - uMedioInfo.y) / uMedioInfo.w);
  vec2 m = texture(uVentoMedio, uvM).rg;
  vec2 uvR = vec2((s - uRajInfo.x) / uRajInfo.z, (zc - uRajInfo.y) / uRajInfo.w);
  float dentro = smoothstep(0.0, 0.06, uvR.x) * smoothstep(1.0, 0.94, uvR.x) * smoothstep(1.0, 0.9, uvR.y);
  float t = uRajT + defasagem(x) / uDuracao;
  vec2 r = texture(uRajadas, vec3(uvR, t)).rg;
  return mix(m, r, dentro * uRajada);
}

// vento no mundo (m/s) num ponto (x, z) a uma altura "acima" do chão
vec3 ventoMundo(vec2 xz, float acima) {
  vec3 c = coordCorte(xz);
  float hz = max(acima, 0.02);
  float zs = max(hz, uZRef);
  vec2 v = ventoCorte(c.x, alturaPerfil(c.x) + zs, xz.x);
  // camada logarítmica abaixo da primeira célula resolvida
  float lei = hz < uZRef ? log(hz / ${Z0_GRAMA.toFixed(3)}) / log(uZRef / ${Z0_GRAMA.toFixed(3)}) : 1.0;
  v *= clamp(lei, 0.0, 1.0) * uFatorVento;
  vec2 normal = c.yz;              // terra adentro
  vec2 tangente = vec2(c.z, -c.y); // ao longo da costa
  vec2 h = normal * v.x + tangente * v.x * uVentoLateral;
  return vec3(h.x, v.y, h.y);
}
`;

// ------------------------------------------------------------------ CPU (partículas, painel científico)
function bilinear(arr, nx, nz, canais, canal, fx, fz, desloc = 0) {
  fx = Math.min(Math.max(fx, 0), nx - 1.001);
  fz = Math.min(Math.max(fz, 0), nz - 1.001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const i00 = desloc + ((iz * nx + ix) * canais + canal);
  const i10 = i00 + canais;
  const i01 = i00 + nx * canais;
  const i11 = i01 + canais;
  return (arr[i00] * (1 - tx) + arr[i10] * tx) * (1 - tz) + (arr[i01] * (1 - tx) + arr[i11] * tx) * tz;
}

/** u, w do corte (m/s) no ponto (s, zc) e tempo t (s). */
export function ventoCorteCPU(s, zc, t, x = 0) {
  const { meta, medio, rajadas } = vento;
  const dx = meta.dx;
  const M = meta.medio;
  const R = meta.rajadas;
  const fxR = (s - R.s0) / dx - 0.5;
  const fzR = (zc - R.z0) / dx - 0.5;
  if (fxR >= 0 && fxR < R.nx - 1 && fzR >= 0 && fzR < R.nz - 1) {
    const u = uniformsAtuais();
    const tt = ((t + defasagemCPU(x)) / R.dtQuadro) % R.nt;
    const q = (Math.floor(tt) + R.nt) % R.nt;
    const q2 = (q + 1) % R.nt;
    const a = tt - Math.floor(tt);
    const tam = R.nx * R.nz * 2;
    const r = [0, 1].map(
      (c) => bilinear(rajadas, R.nx, R.nz, 2, c, fxR, fzR, q * tam) * (1 - a) + bilinear(rajadas, R.nx, R.nz, 2, c, fxR, fzR, q2 * tam) * a,
    );
    if (u.uRajada.value >= 0.999) return r;
    const m = [0, 1].map((c) => bilinear(medio, M.nx, M.nz, 4, c, (s - M.s0) / dx - 0.5, zc / dx - 0.5));
    const k = u.uRajada.value;
    return [m[0] * (1 - k) + r[0] * k, m[1] * (1 - k) + r[1] * k];
  }
  return [0, 1].map((c) => bilinear(medio, M.nx, M.nz, 4, c, (s - M.s0) / dx - 0.5, zc / dx - 0.5));
}

function defasagemCPU(x) {
  return 2.2 * Math.sin(x * 0.031 + 0.4) + 1.3 * Math.sin(x * 0.083 + 2.1) + 0.7 * Math.sin(x * 0.19);
}
const uniformsAtuais = () => vento.uniforms;

/** Vento no mundo (m/s) em (x, y, z), dada a altura do chão naquele ponto. */
export function ventoMundoCPU(x, y, z, yChao, t, saida = new THREE.Vector3()) {
  const c = coordCorte(x, z);
  const u = vento.uniforms;
  const zRef = u.uZRef.value;
  const hz = Math.max(y - yChao, 0.02);
  const [vu, vw] = ventoCorteCPU(c.s, alturaPerfil(c.s) + Math.max(hz, zRef), t, x);
  const lei = hz < zRef ? Math.min(Math.max(Math.log(hz / Z0_GRAMA) / Math.log(zRef / Z0_GRAMA), 0), 1) : 1;
  const f = lei * u.uFatorVento.value;
  const h = vu * f;
  const lat = h * u.uVentoLateral.value;
  return saida.set(c.nx * h + c.nz * lat, vw * f, c.nz * h - c.nx * lat);
}
