// Modo científico: visualização de engenharia do campo calculado pelo CFD.
//
//  - plano vertical de corte (perpendicular à costa) com mapa de cor de |U|, u, w, Cp ou k
//    e isolinhas; o terreno é recortado no plano para mostrar o perfil da falésia
//  - linhas de corrente do campo MÉDIO (integração RK2 sobre a grade do CFD)
//  - vetores e partículas traçadoras no campo INSTANTÂNEO (mostram rajadas e a bolha)
//  - painel com perfis verticais u(z) em estações ao longo do corte

import * as THREE from 'three';
import { alturaPerfil, glslGeometria, uniformsGeometria, zBorda } from './geometria.js';
import { glslVento, vento, ventoCorteCPU } from './vento.js';

export const GRANDEZAS = { '|U| (m/s)': 0, 'u (m/s)': 1, 'w (m/s)': 2, 'Cp': 3, 'k (m²/s²)': 4 };
const FAIXAS = [[0, 16], [-4, 16], [-5, 5], [-1, 1], [0, 4]];

// x do plano de corte: um pouco à esquerda da ciclista, num trecho reto da borda
export const X_PLANO = -7;
const S_MIN = -150;
const S_MAX = 220;
const Z_MAX = 95;

const sParaZ = (s) => zBorda(X_PLANO) + s; // no trecho reto a normal é +z

// mapa de cor turbo (igual ao da grama) e divergente para grandezas com sinal
const glslCores = /* glsl */ `
vec3 turbo(float x) {
  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;
  return vec3(
    dot(v4, vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234)) + dot(v2, vec2(-152.94239396, 59.28637943)),
    dot(v4, vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333)) + dot(v2, vec2(4.27729857, 2.82956604)),
    dot(v4, vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771)) + dot(v2, vec2(-89.90310912, 27.34824973)));
}
vec3 divergente(float x) { // azul - branco - vermelho
  x = clamp(x, 0.0, 1.0);
  vec3 a = vec3(0.13, 0.32, 0.68), b = vec3(0.97, 0.96, 0.94), c = vec3(0.75, 0.13, 0.15);
  return x < 0.5 ? mix(a, b, x * 2.0) : mix(b, c, x * 2.0 - 1.0);
}
`;

function criarPlano(uniformsVento) {
  const uniforms = {
    ...uniformsVento,
    ...uniformsGeometria(),
    uGrandeza: { value: 0 },
    uFaixa: { value: new THREE.Vector2(0, 16) },
    uZBorda: { value: zBorda(X_PLANO) },
    uOpacidade: { value: 0.88 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vMundo;
      void main() {
        vMundo = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vMundo, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform int uGrandeza;
      uniform vec2 uFaixa;
      uniform float uZBorda;
      uniform float uOpacidade;
      varying vec3 vMundo;
      ${glslGeometria}
      ${glslVento}
      ${glslCores}
      void main() {
        float s = vMundo.z - uZBorda;
        float zc = vMundo.y;
        float chao = alturaPerfil(s);
        if (zc < 0.0) discard;
        if (zc < chao) {
          // "tampa" do corte: o solo da falésia em seção, com estratos
          float estr = 0.5 + 0.5 * sin(zc * 2.1 + sin(s * 0.15) * 1.5);
          vec3 solo = mix(vec3(0.33, 0.25, 0.18), vec3(0.45, 0.36, 0.26), estr);
          solo = mix(vec3(0.22, 0.36, 0.12), solo, smoothstep(0.0, 0.6, chao - zc)); // grama no topo
          gl_FragColor = vec4(solo, 1.0);
          #include <colorspace_fragment>
          return;
        }
        vec2 uvM = vec2((s - uMedioInfo.x) / uMedioInfo.z, (zc - uMedioInfo.y) / uMedioInfo.w);
        vec4 m = texture(uVentoMedio, uvM);
        vec2 v = ventoCorte(s, zc, vMundo.x) * uFatorVento;
        float q;
        if (uGrandeza == 0) q = length(v);
        else if (uGrandeza == 1) q = v.x;
        else if (uGrandeza == 2) q = v.y;
        else if (uGrandeza == 3) q = m.b;
        else q = m.a * uFatorVento * uFatorVento;
        float t = (q - uFaixa.x) / (uFaixa.y - uFaixa.x);
        vec3 col = (uGrandeza == 2 || uGrandeza == 3) ? divergente(t) : turbo(t);
        // isolinhas: 12 níveis na faixa
        float nivel = t * 12.0;
        float iso = abs(fract(nivel - 0.5) - 0.5) / max(fwidth(nivel), 1e-4);
        col = mix(col * 0.55, col, smoothstep(0.0, 1.2, iso));
        // contorno do terreno
        col = mix(vec3(1.0), col, smoothstep(0.0, 0.6, zc - chao));
        gl_FragColor = vec4(col, uOpacidade);
        #include <colorspace_fragment>
      }`,
  });
  mat.toneMapped = false;
  const g = new THREE.PlaneGeometry(S_MAX - S_MIN, Z_MAX, 1, 1);
  g.rotateY(Math.PI / 2); // plano yz
  const malha = new THREE.Mesh(g, mat);
  malha.position.set(X_PLANO, Z_MAX / 2, sParaZ((S_MIN + S_MAX) / 2));
  malha.renderOrder = 2;
  return { malha, uniforms };
}

/** Linhas de corrente do campo médio, integradas com Runge–Kutta de 2ª ordem. */
function linhasDeCorrente() {
  const sementes = [];
  for (let z = 1.5; z < 30; z += 2.6) sementes.push([S_MIN + 2, z]);
  for (let z = 33; z < Z_MAX - 5; z += 5) sementes.push([S_MIN + 2, z]);
  // sementes dentro da bolha de recirculação (atrás da borda)
  for (const s of [3, 8, 14, 20]) sementes.push([s, alturaPerfil(s) + 0.8]);

  const medio = (s, z) => {
    const [u, w] = ventoCorteCPU(s, z, 0);
    return [u, w];
  };
  const verts = [];
  const h = 0.6;
  for (const [s0, z0] of sementes) {
    let s = s0;
    let z = z0;
    const pts = [[s, z]];
    for (let k = 0; k < 1400; k++) {
      const [u1, w1] = medio(s, z);
      const n1 = Math.hypot(u1, w1) + 1e-6;
      const sm = s + (0.5 * h * u1) / n1;
      const zm = z + (0.5 * h * w1) / n1;
      const [u2, w2] = medio(sm, zm);
      const n2 = Math.hypot(u2, w2) + 1e-6;
      if (n2 < 0.05) break;
      s += (h * u2) / n2;
      z += (h * w2) / n2;
      if (s < S_MIN || s > S_MAX || z > Z_MAX || z < Math.max(alturaPerfil(s), 0)) break;
      pts.push([s, z]);
      // laço fechado (bolha): para depois de uma volta
      if (k > 60 && Math.hypot(s - s0, z - z0) < 0.5) break;
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      verts.push(X_PLANO + 0.08, pts[i][1], sParaZ(pts[i][0]), X_PLANO + 0.08, pts[i + 1][1], sParaZ(pts[i + 1][0]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, toneMapped: false }));
  l.renderOrder = 3;
  return l;
}

/** Vetores (setas) atualizados com o campo instantâneo. */
function criarVetores() {
  const pontos = [];
  for (let s = S_MIN + 6; s < S_MAX; s += 7) {
    for (let z = 2; z < Z_MAX; z += 5) if (z > alturaPerfil(s) + 1) pontos.push([s, z]);
  }
  const pos = new Float32Array(pontos.length * 6 * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0b1626, transparent: true, opacity: 0.55, toneMapped: false }));
  l.renderOrder = 4;
  l.frustumCulled = false;
  const escala = 0.4; // m de seta por m/s
  function atualizar(t, fator) {
    let k = 0;
    for (const [s, z] of pontos) {
      const [u, w] = ventoCorteCPU(s, z, t, X_PLANO);
      const du = u * escala * fator;
      const dw = w * escala * fator;
      const x = X_PLANO + 0.15;
      const z0 = sParaZ(s);
      const ps = s + du;
      const pz = z + dw;
      // haste
      pos.set([x, z, z0, x, pz, sParaZ(ps)], k);
      k += 6;
      // cabeça: duas pontas a ±25°
      const ang = Math.atan2(dw, du);
      const L = Math.min(Math.hypot(du, dw) * 0.35, 1.6);
      for (const d of [2.7, -2.7]) {
        const a = ang + d;
        pos.set([x, pz, sParaZ(ps), x, pz + Math.sin(a) * L, sParaZ(ps + Math.cos(a) * L)], k);
        k += 6;
      }
    }
    g.attributes.position.needsUpdate = true;
  }
  return { objeto: l, atualizar };
}

/** Partículas traçadoras advectadas no campo instantâneo (Euler explícito, CPU). */
function criarParticulas(n = 1500) {
  const p = new Float32Array(n * 2); // (s, z)
  const idade = new Float32Array(n);
  const pos = new Float32Array(n * 3);
  const semear = (i) => {
    p[i * 2] = S_MIN + Math.random() * (S_MAX - S_MIN) * (Math.random() < 0.5 ? 0.05 : 1);
    const chao = Math.max(alturaPerfil(p[i * 2]), 0);
    p[i * 2 + 1] = chao + 0.3 + Math.pow(Math.random(), 1.8) * (Z_MAX - chao - 1);
    idade[i] = Math.random() * 12;
  };
  for (let i = 0; i < n; i++) semear(i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.9, toneMapped: false }));
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  function atualizar(t, dt, fator) {
    for (let i = 0; i < n; i++) {
      const [u, w] = ventoCorteCPU(p[i * 2], p[i * 2 + 1], t, X_PLANO);
      p[i * 2] += u * fator * dt;
      p[i * 2 + 1] += w * fator * dt;
      idade[i] -= dt;
      const s = p[i * 2];
      const z = p[i * 2 + 1];
      if (idade[i] < 0 || s > S_MAX || s < S_MIN || z > Z_MAX || z < Math.max(alturaPerfil(s), 0)) semear(i);
      pos[i * 3] = X_PLANO + 0.25;
      pos[i * 3 + 1] = p[i * 2 + 1];
      pos[i * 3 + 2] = sParaZ(p[i * 2]);
    }
    g.attributes.position.needsUpdate = true;
  }
  return { objeto: pts, atualizar };
}

// ------------------------------------------------------------------ painel de perfis
const ESTACOES = [
  { s: -110, nome: 'mar', cor: '#7fb8ff' },
  { s: 0, nome: 'borda', cor: '#ffd34d' },
  { s: 20, nome: 'bolha', cor: '#ff7a59' },
  { s: 80, nome: 'planalto', cor: '#9be37a' },
];

function desenharPerfis(canvas, t, fator) {
  const c = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const dpr = W / canvas.clientWidth;
  c.clearRect(0, 0, W, H);
  const m = { l: 46 * dpr, r: 12 * dpr, t: 8 * dpr, b: 30 * dpr };
  const uMin = -4;
  const uMax = Math.ceil((16 * fator) / 4) * 4;
  const zMax = 40;
  const X = (u) => m.l + ((u - uMin) / (uMax - uMin)) * (W - m.l - m.r);
  const Y = (z) => H - m.b - (z / zMax) * (H - m.t - m.b);
  c.font = `${11 * dpr}px Inter, sans-serif`;
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.strokeStyle = 'rgba(255,255,255,0.18)';
  c.lineWidth = dpr;
  for (let u = 0; u <= uMax; u += 4) {
    c.beginPath(); c.moveTo(X(u), Y(0)); c.lineTo(X(u), Y(zMax)); c.stroke();
    c.fillText(String(u), X(u) - 4 * dpr, H - 12 * dpr);
  }
  for (let z = 0; z <= zMax; z += 10) {
    c.beginPath(); c.moveTo(X(uMin), Y(z)); c.lineTo(X(uMax), Y(z)); c.stroke();
    c.textAlign = 'right'; c.fillText(String(z), m.l - 6 * dpr, Y(z) + 4 * dpr); c.textAlign = 'left';
  }
  c.textAlign = 'right';
  c.fillText('u (m/s)', W - m.r, H - 2 * dpr);
  c.textAlign = 'left';
  c.save(); c.translate(11 * dpr, H - m.b - 2 * dpr); c.rotate(-Math.PI / 2); c.fillText('z acima do chão (m)', 0, 0); c.restore();
  for (const e of ESTACOES) {
    const chao = Math.max(alturaPerfil(e.s), 0);
    for (const [inst, traco] of [[false, []], [true, [4 * dpr, 3 * dpr]]]) {
      c.setLineDash(traco);
      c.strokeStyle = e.cor;
      c.lineWidth = (inst ? 1.2 : 2) * dpr;
      c.beginPath();
      for (let z = 0.25; z <= zMax; z += 0.5) {
        const [u] = inst ? ventoCorteCPU(e.s, chao + z, t, X_PLANO) : mediaCPU(e.s, chao + z);
        const x = X(u * fator);
        if (z === 0.25) c.moveTo(x, Y(z)); else c.lineTo(x, Y(z));
      }
      c.stroke();
    }
  }
  c.setLineDash([]);
}

function mediaCPU(s, z) {
  const { medio, meta } = vento;
  const M = meta.medio;
  const dx = meta.dx;
  const fx = Math.min(Math.max((s - M.s0) / dx - 0.5, 0), M.nx - 1.001);
  const fz = Math.min(Math.max(z / dx - 0.5, 0), M.nz - 1.001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const at = (i, k, c) => medio[((k * M.nx) + i) * 4 + c];
  return [0, 1, 2, 3].map(
    (c) => (at(ix, iz, c) * (1 - tx) + at(ix + 1, iz, c) * tx) * (1 - tz) + (at(ix, iz + 1, c) * (1 - tx) + at(ix + 1, iz + 1, c) * tx) * tz,
  );
}

/** Números-chave do escoamento médio para o painel. */
function indicadores() {
  const zRefAcima = 10;
  const uMar = mediaCPU(-110, Math.max(alturaPerfil(-110), 0) + zRefAcima)[0];
  let maxU = 0;
  let sMax = 0;
  for (let s = -5; s < 60; s += 0.5) {
    const u = Math.hypot(...mediaCPU(s, alturaPerfil(s) + zRefAcima).slice(0, 2));
    if (u > maxU) { maxU = u; sMax = s; }
  }
  let ini = null;
  let fim = null;
  for (let s = -2; s < 150; s += 0.5) {
    const u = mediaCPU(s, alturaPerfil(s) + vento.meta.dx * 0.6)[0];
    if (u < 0) { if (ini === null) ini = s; fim = s; }
  }
  let cpMin = 0;
  // entre 2 e 15 m acima do chão: exclui o pico pontual da quina em degrau (ver README, seção 7)
  for (let s = -15; s < 30; s += 0.5) for (let z = 2; z < 15; z += 0.5) cpMin = Math.min(cpMin, mediaCPU(s, alturaPerfil(s) + z)[2]);
  return { uMar, maxU, sMax, ini, fim, cpMin };
}

// ------------------------------------------------------------------ montagem
export function criarCientifico(scene, uniformsVento) {
  const grupo = new THREE.Group();
  grupo.visible = false;
  scene.add(grupo);
  const plano = criarPlano(uniformsVento);
  const linhas = linhasDeCorrente();
  const vetores = criarVetores();
  const particulas = criarParticulas();
  grupo.add(plano.malha, linhas, vetores.objeto, particulas.objeto);

  // painel HTML
  const painel = document.getElementById('painel-cientifico');
  const canvas = painel.querySelector('canvas');
  painel.querySelector('.estacoes').innerHTML = ESTACOES.map((e) => `<span style="color:${e.cor}">● ${e.nome} (s = ${e.s} m)</span>`).join('');
  const ind = indicadores();
  const H = vento.meta.alturaFalesia;
  painel.querySelector('.numeros').innerHTML = `
    <div><b>${ind.uMar.toFixed(1)} m/s</b><span>vento sobre o mar a 10 m</span></div>
    <div><b>${ind.maxU.toFixed(1)} m/s</b><span>máximo a 10 m do chão (s = ${ind.sMax.toFixed(0)} m)</span></div>
    <div><b>${(ind.maxU / ind.uMar).toFixed(2)}×</b><span>fator de aceleração no topo</span></div>
    <div><b>${ind.ini === null ? '—' : `${(ind.fim - ind.ini).toFixed(0)} m`}</b><span>bolha de recirculação${ind.ini === null ? '' : ` (${((ind.fim - ind.ini) / H).toFixed(1)} H; tamanho incerto, varia com a malha)`}</span></div>
    <div><b>${ind.cpMin.toFixed(2)}</b><span>Cp mínimo a 2–15 m do chão (sucção na borda)</span></div>`;

  const params = { grandeza: '|U| (m/s)', linhas: true, vetores: true, particulas: true, opacidade: 0.88 };
  let fatorAtual = 1;
  // a escala de cor acompanha a escala de vento (velocidades ∝ fator, k ∝ fator², Cp não muda)
  const faixa = (g) => FAIXAS[g].map((v) => Math.round(v * (g <= 2 ? fatorAtual : g === 4 ? fatorAtual ** 2 : 1) * 10) / 10);
  function aplicar() {
    const g = GRANDEZAS[params.grandeza];
    plano.uniforms.uGrandeza.value = g;
    plano.uniforms.uFaixa.value.set(...faixa(g));
    plano.uniforms.uOpacidade.value = params.opacidade;
    linhas.visible = params.linhas;
    vetores.objeto.visible = params.vetores;
    particulas.objeto.visible = params.particulas;
    const [a, b] = faixa(g);
    painel.querySelector('.escala').innerHTML = `<span>${a}</span><i class="${g === 2 || g === 3 ? 'div' : 'turbo'}"></i><span>${b}</span><em>${params.grandeza}</em>`;
  }
  aplicar();

  let quadro = 0;
  return {
    grupo,
    params,
    aplicar,
    faixa: () => faixa(GRANDEZAS[params.grandeza]),
    atualizar(t, dt, fator) {
      if (fator !== fatorAtual) {
        fatorAtual = fator;
        aplicar();
      }
      if (!grupo.visible) return;
      vetores.atualizar(t, fator);
      particulas.atualizar(t, dt, fator);
      if (quadro++ % 3 === 0) {
        const r = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio, 2);
        if (canvas.width !== Math.round(r.width * dpr)) {
          canvas.width = Math.round(r.width * dpr);
          canvas.height = Math.round(r.height * dpr);
        }
        desenharPerfis(canvas, t, fator);
      }
    },
  };
}
