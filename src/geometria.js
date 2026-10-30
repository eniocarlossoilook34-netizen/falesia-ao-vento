// Geometria da cena: liga cada ponto do mundo 3D a um ponto do corte CFD.
//
// O corte 2D do CFD usa s = distância à borda da falésia (positivo terra adentro).
// No 3D a borda é uma curva z = zBorda(x) (uma baía suave); s é a distância
// assinada até essa curva, e o terreno é levantado com o MESMO perfil h(s) do solver.
//
// Eixos do mundo (Three.js): y para cima, o mar fica em -z, a câmera olha para -z.

import * as THREE from 'three';

// borda da falésia: reta perto da ciclista (onde o corte 2D vale bem) e,
// à esquerda de x = xc, curvando mar adentro até virar um promontório distante
export const BORDA = { z0: -22, xc: -45, c: 0.0085 };

export function zBorda(x) {
  const e = Math.min(x - BORDA.xc, 0);
  return BORDA.z0 - BORDA.c * e * e;
}

/** Distância assinada aproximada até a borda e normal (direção terra adentro). */
export function coordCorte(x, z) {
  const d = -2 * BORDA.c * Math.min(x - BORDA.xc, 0); // dz/dx da borda
  const n = Math.hypot(1, d);
  return { s: (z - zBorda(x)) / n, nx: -d / n, nz: 1 / n };
}

// ------------------------------------------------------------------ perfil h(s)
export const perfil = { s0: 0, ds: 1, h: new Float32Array(1), sPraia: -52, H: 30, textura: null };

export async function carregarPerfil(url = './dados/perfil.json') {
  const j = await (await fetch(url)).json();
  perfil.s0 = j.s0;
  perfil.ds = j.ds;
  perfil.h = Float32Array.from(j.h);
  perfil.sPraia = j.sPraia;
  perfil.H = j.alturaFalesia;
  // textura 1D (N x 1) para os shaders
  const t = new THREE.DataTexture(perfil.h, perfil.h.length, 1, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; // interpolação linear feita no shader
  t.needsUpdate = true;
  perfil.textura = t;
  return perfil;
}

export function alturaPerfil(s) {
  const f = (s - perfil.s0) / perfil.ds;
  const n = perfil.h.length;
  if (f <= 0) return perfil.h[0];
  if (f >= n - 1) return perfil.h[n - 1] + (s - (perfil.s0 + (n - 1) * perfil.ds)) * 0.02;
  const i = Math.floor(f);
  const t = f - i;
  return perfil.h[i] * (1 - t) + perfil.h[i + 1] * t;
}

// ------------------------------------------------------------------ ruído (CPU e GLSL iguais)
function hash(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function ruido(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm(x, y, oit = 5) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < oit; i++) {
    s += a * ruido(x, y);
    const nx = 1.6 * x + 1.2 * y + 1.7;
    y = -1.2 * x + 1.6 * y + 9.2;
    x = nx;
    a *= 0.5;
  }
  return s;
}

// ------------------------------------------------------------------ estrada
// estrada de terra paralela à borda (centro em s ≈ 5–8 m), com leve sinuosidade
export function centroEstrada(x) {
  return 6.4 + 1.4 * Math.sin(x * 0.021 - 0.6) + 0.8 * Math.sin(x * 0.053);
}
export const LARGURA_ESTRADA = 3.4;

/** 0 fora da estrada, 1 no meio dela. */
export function pesoEstrada(x, s) {
  const d = Math.abs(s - centroEstrada(x)) / (LARGURA_ESTRADA * 0.5);
  return 1 - smooth(0.75, 1.15, d);
}

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Altura do terreno no mundo: perfil do CFD + relevo fino (não altera o escoamento). */
export function alturaTerreno(x, z) {
  const { s } = coordCorte(x, z);
  let h = alturaPerfil(s);
  // irregularidades: pequenas no planalto, maiores na face (blocos de rocha)
  const naFace = smooth(-40, -28, s) * (1 - smooth(-4, 1, s));
  const noPlanalto = smooth(-1, 6, s);
  h += (fbm(x * 0.05, z * 0.05) - 0.5) * (0.9 * noPlanalto + 3.5 * naFace);
  // colinas suaves terra adentro (longe do corte simulado)
  h += Math.max(0, s - 90) * 0.06 * fbm(x * 0.004 + 3.1, z * 0.004);
  // a estrada é aplainada e levemente rebaixada
  const e = pesoEstrada(x, s);
  if (e > 0) h = h * (1 - e) + (alturaPerfil(s) - 0.12) * e;
  return h;
}

// mesmas funções em GLSL (para grama, oceano e modo científico)
export const glslGeometria = /* glsl */ `
uniform sampler2D uPerfil;
uniform vec3 uPerfilInfo; // (s0, ds, N)
const vec3 BORDA = vec3(${BORDA.z0.toFixed(4)}, ${BORDA.xc.toFixed(4)}, ${BORDA.c.toFixed(6)});

float zBorda(float x) { float e = min(x - BORDA.y, 0.0); return BORDA.x - BORDA.z * e * e; }

// (s, direção terra adentro no plano xz)
vec3 coordCorte(vec2 p) {
  float d = -2.0 * BORDA.z * min(p.x - BORDA.y, 0.0);
  float n = length(vec2(1.0, d));
  return vec3((p.y - zBorda(p.x)) / n, -d / n, 1.0 / n);
}

float alturaPerfil(float s) {
  float f = clamp((s - uPerfilInfo.x) / uPerfilInfo.y, 0.0, uPerfilInfo.z - 1.001);
  float i = floor(f);
  float a = texture2D(uPerfil, vec2((i + 0.5) / uPerfilInfo.z, 0.5)).r;
  float b = texture2D(uPerfil, vec2((i + 1.5) / uPerfilInfo.z, 0.5)).r;
  return mix(a, b, f - i);
}
`;

export function uniformsGeometria() {
  return {
    uPerfil: { value: perfil.textura },
    uPerfilInfo: { value: new THREE.Vector3(perfil.s0, perfil.ds, perfil.h.length) },
  };
}
