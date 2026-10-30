// Terreno: malha levantada pelo perfil h(s) do CFD + relevo fino.
// Cores por vértice (grama, terra da face, areia, estrada) e detalhe procedural
// no fragment shader para não depender de texturas externas.

import * as THREE from 'three';
import { alturaTerreno, coordCorte, fbm, perfil, pesoEstrada } from './geometria.js';

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Mapeia u ∈ [-1, 1] em metros: espaçamento fino perto do centro, grosso longe. */
function eixo(u, perto, longeNeg, longePos) {
  const a = Math.abs(u);
  const longe = u < 0 ? longeNeg : longePos;
  return Math.sign(u) * (perto * a + (longe - perto) * Math.pow(a, 4));
}

export function criarTerreno(centro, { nx = 420, nz = 320 } = {}) {
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const cor = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = centro.x + eixo((i / nx) * 2 - 1, 70, 1500, 1100);
      const z = centro.z + eixo((j / nz) * 2 - 1, 55, 1100, 380);
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x;
      pos[k + 1] = alturaTerreno(x, z);
      pos[k + 2] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  // ---- cores por vértice
  const nrm = g.attributes.normal.array;
  const C = (h) => new THREE.Color(h).convertSRGBToLinear();
  const grama = C('#4f6a2a');
  const gramaSeca = C('#9a9450');
  const gramaEscura = C('#33491c');
  const terra = C('#7d6a52');
  const rocha = C('#8e8577');
  const areia = C('#d8c9a6');
  const areiaMolhada = C('#9c8c6e');
  const estrada = C('#b9b09e');
  const c = new THREE.Color();
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3];
    const y = pos[v * 3 + 1];
    const z = pos[v * 3 + 2];
    const ny = nrm[v * 3 + 1];
    const { s } = coordCorte(x, z);
    const n1 = fbm(x * 0.03, z * 0.03, 4);
    const n2 = fbm(x * 0.2 + 5, z * 0.2, 3);

    // grama com manchas secas e escuras
    c.copy(grama).lerp(gramaSeca, smooth(0.45, 0.7, n1) * 0.8).lerp(gramaEscura, smooth(0.55, 0.75, n2) * 0.5);
    // face íngreme: terra e rocha expostas
    const ingreme = smooth(0.82, 0.55, ny);
    c.lerp(n2 > 0.5 ? rocha : terra, ingreme * 0.9);
    // praia
    const praia = smooth(3.2, 1.8, y) * smooth(-8, -18, s);
    c.lerp(areia, praia);
    c.lerp(areiaMolhada, smooth(0.5, -0.2, y) * praia);
    // estrada
    const e = pesoEstrada(x, s) * smooth(-2, 3, s);
    c.lerp(estrada, e * (0.85 + 0.15 * n2));
    cor[v * 3] = c.r;
    cor[v * 3 + 1] = c.g;
    cor[v * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cor, 3));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  // detalhe procedural: variação de cor em várias escalas (substitui textura)
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPosMundo;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPosMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPosMundo;
        float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 q = vPosMundo.xz;
          float d = length(vPosMundo - cameraPosition);
          float det = vn(q * 3.0) * 0.5 + vn(q * 11.0) * 0.3 + vn(q * 37.0) * 0.2;
          float f = 1.0 - smoothstep(30.0, 160.0, d);
          diffuseColor.rgb *= mix(1.0, 0.72 + 0.56 * det, f);
        }`,
      );
  };
  const malha = new THREE.Mesh(g, mat);
  malha.receiveShadow = true;
  return malha;
}

export { perfil };
