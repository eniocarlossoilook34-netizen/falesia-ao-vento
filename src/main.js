// Falésia ao vento — cena principal.
// Liga o campo de vento do CFD (vento.js) à grama, ao mar (Projeto 24), ao céu e à bicicleta.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import GUI from 'lil-gui';

import { criarCeu, criarCompositorCeu, uniformsCeu } from './ceu.js';
import { criarCientifico, GRANDEZAS, X_PLANO } from './cientifico.js';
import { alturaTerreno, carregarPerfil, centroEstrada, coordCorte, zBorda } from './geometria.js';
import { criarGrama } from './grama.js';
import { criarOceano, definirOndas } from './oceano.js';
import { amplitudeMaxima, gerarOndas } from './ondas.js';
import { criarTerreno } from './terreno.js';
import { carregarVento, vento, ventoCorteCPU, ventoMundoCPU } from './vento.js';

const parametrosURL = new URLSearchParams(location.search);

// ------------------------------------------------------------------ parâmetros
const params = {
  modo: 'artístico',
  // 1,4 -> U_ref = 14 m/s. O CFD foi rodado com 10 m/s; com separação em quina viva o campo
  // adimensional u/U_ref independe de Re, então reescalar a velocidade é válido (ver README).
  fatorVento: 1.4,
  rajadas: true,
  lateral: 0.3,
  elevacaoSol: 52,
  azimuteSol: -35, // graus a partir de -z (à frente), negativo = à esquerda
  nuvens: 0.52,
  exposicao: 0.95,
  ondas: 0.9,
};

// ------------------------------------------------------------------ renderer, cena, câmera
const canvas = document.getElementById('cena');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = params.exposicao;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 40000);

await carregarPerfil();
await carregarVento();

// posição da ciclista: na estrada, em x = 0
const X_CICLISTA = 0;
const cc = coordCorte(X_CICLISTA, zBorda(X_CICLISTA));
const sCiclista = centroEstrada(X_CICLISTA);
const posCiclista = new THREE.Vector3(
  X_CICLISTA + cc.nx * sCiclista,
  0,
  zBorda(X_CICLISTA) + cc.nz * sCiclista,
);
posCiclista.y = alturaTerreno(posCiclista.x, posCiclista.z);
const paraOMar = new THREE.Vector3(-cc.nx, 0, -cc.nz);

// ------------------------------------------------------------------ céu, luz, neblina
const ceuVolumetrico = parametrosURL.get('nuvens') !== '2d';
const compositor = criarCompositorCeu(criarCeu({ volumetrico: ceuVolumetrico }), Number(parametrosURL.get('ceu') || 0.5));
scene.add(compositor.quad);
const luzSol = new THREE.DirectionalLight(0xfff1dc, 3.2);
luzSol.castShadow = true;
luzSol.shadow.mapSize.set(2048, 2048);
Object.assign(luzSol.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 80 });
luzSol.shadow.bias = -0.0004;
luzSol.shadow.normalBias = 0.02;
scene.add(luzSol, luzSol.target);
const luzCeu = new THREE.HemisphereLight(0x9cc3ee, 0x55643a, 1.1);
scene.add(luzCeu);
scene.fog = new THREE.FogExp2(0xb4d4ee, 0.00055);

// ------------------------------------------------------------------ mar (Projeto 24)
const { malha: oceano, uniforms: uo } = criarOceano();
scene.add(oceano);
const espectro = gerarOndas({ comprimento: 70, vento: 82, espalhamento: 0.5 });
definirOndas(uo, espectro);
Object.assign(uo.uAltura, { value: params.ondas });
uo.uInclinacao.value = 0.9;
uo.uChop.value = 1;
uo.uEspuma.value = 0.7;
uo.uNeblina.value = 0.00028;
uo.uFundo.value.set('#04294a');
uo.uDispersao.value.set('#0aa3a8');
uo.uAmpMax.value = amplitudeMaxima(espectro.ondas, 0.9, 0.9);

// ------------------------------------------------------------------ terreno e grama
const terreno = criarTerreno(posCiclista);
scene.add(terreno);
const qtdGrama = Number(parametrosURL.get('grama') || 90000);
const grama = criarGrama(posCiclista, vento.uniforms, uniformsCeu, { quantidade: qtdGrama });
scene.add(grama.malha);

// ------------------------------------------------------------------ modo científico
const cient = criarCientifico(scene, vento.uniforms);
const planoCorte = new THREE.Plane(new THREE.Vector3(1, 0, 0), -X_PLANO); // mantém x > X_PLANO

// ------------------------------------------------------------------ bicicleta (Blender)
const bike = new THREE.Group();
scene.add(bike);
const loader = new GLTFLoader();
const sombras = (o) => {
  if (o.isMesh) {
    o.castShadow = true;
    o.receiveShadow = true;
  }
};
loader.load('./models/bicicleta.glb', (g) => {
  g.scene.traverse(sombras);
  bike.add(g.scene);
});

// aponta para o mar, girada ~25° para a direita (vista em 3/4 como na composição)
const dirBike = paraOMar.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-25));
bike.position.copy(posCiclista);
// estacionada no descanso: inclinada ~7° para a esquerda (lado do descanso)
bike.rotation.order = 'YXZ';
bike.rotation.y = Math.atan2(-dirBike.z, dirBike.x);
bike.rotation.x = THREE.MathUtils.degToRad(-7);

// ------------------------------------------------------------------ câmera
const controls = new OrbitControls(camera, canvas);
function enquadrar() {
  const lado = new THREE.Vector3(-paraOMar.z, 0, paraOMar.x); // à direita de quem olha o mar
  const p = posCiclista.clone().addScaledVector(paraOMar, -4.6).addScaledVector(lado, -0.9);
  p.y = alturaTerreno(p.x, p.z) + 1.45;
  camera.position.copy(p);
  controls.target.copy(posCiclista).addScaledVector(paraOMar, 30).add(new THREE.Vector3(0, 4.5, 0));
  controls.update();
}
enquadrar();
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.45;
controls.maxDistance = 400;

// ------------------------------------------------------------------ sol e cores
const cor = new THREE.Color();
function atualizarSol() {
  const el = THREE.MathUtils.degToRad(params.elevacaoSol);
  const az = THREE.MathUtils.degToRad(params.azimuteSol);
  const d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  uniformsCeu.uSolDir.value.copy(d);
  luzSol.position.copy(posCiclista).addScaledVector(d, 40);
  luzSol.target.position.copy(posCiclista);
  uniformsCeu.uNuvens.value = params.nuvens;
  renderer.toneMappingExposure = params.exposicao;

  // a grama usa iluminação própria; convertida para a mesma escala do MeshStandardMaterial (÷π)
  const u = grama.uniforms;
  u.uSolCor.value.copy(luzSol.color).multiplyScalar(luzSol.intensity / Math.PI);
  u.uCeuCor.value.copy(luzCeu.color).multiplyScalar(luzCeu.intensity / Math.PI);
  u.uChaoCor.value.copy(luzCeu.groundColor).multiplyScalar(luzCeu.intensity / Math.PI);
  u.uNeblinaCor.value.copy(scene.fog.color);
  u.uNeblina.value = scene.fog.density;
}
atualizarSol();

// ------------------------------------------------------------------ interface
const gui = new GUI({ title: 'ajustes' });
const fV = gui.addFolder('vento (CFD)');
fV.add(params, 'fatorVento', 0, 2, 0.01).name('escala da velocidade');
fV.add(params, 'rajadas').name('rajadas (instantâneo)');
fV.add(params, 'lateral', -1, 1, 0.01).name('componente ao longo da costa');
const fL = gui.addFolder('luz');
fL.add(params, 'elevacaoSol', 5, 85, 0.5).name('elevação do sol').onChange(atualizarSol);
fL.add(params, 'azimuteSol', -180, 180, 1).name('azimute do sol').onChange(atualizarSol);
fL.add(params, 'nuvens', 0, 1, 0.01).name('cobertura de nuvens').onChange(atualizarSol);
fL.add(params, 'exposicao', 0.4, 2, 0.01).name('exposição').onChange(atualizarSol);
const fC = gui.addFolder('modo científico');
fC.add(cient.params, 'grandeza', Object.keys(GRANDEZAS)).name('mapa de cor').onChange(cient.aplicar);
fC.add(cient.params, 'linhas').name('linhas de corrente (média)').onChange(cient.aplicar);
fC.add(cient.params, 'vetores').name('vetores (instantâneo)').onChange(cient.aplicar);
fC.add(cient.params, 'particulas').name('partículas traçadoras').onChange(cient.aplicar);
fC.add(cient.params, 'opacidade', 0.2, 1, 0.01).name('opacidade do corte').onChange(cient.aplicar);
gui.add({ enquadrar: () => voarPara(params.modo === 'científico' ? vistaCorte() : vistaArtistica()) }, 'enquadrar').name('voltar ao enquadramento');
gui.close();

// transição suave da câmera entre os enquadramentos
let voo = null;
function vistaArtistica() {
  const cam = camera.position.clone();
  const alvo = controls.target.clone();
  enquadrar();
  const v = { pos: camera.position.clone(), alvo: controls.target.clone() };
  camera.position.copy(cam);
  controls.target.copy(alvo);
  return v;
}
function vistaCorte() {
  const zb = posCiclista.z - centroEstrada(X_CICLISTA);
  return { pos: new THREE.Vector3(X_PLANO - 175, 40, zb + 38), alvo: new THREE.Vector3(X_PLANO, 30, zb + 38) };
}
function voarPara(v) {
  voo = { de: { pos: camera.position.clone(), alvo: controls.target.clone() }, para: v, t: 0 };
}

function definirModo(modo) {
  params.modo = modo;
  const ehCient = modo === 'científico';
  grama.uniforms.uCientifico.value = ehCient ? 1 : 0;
  grama.uniforms.uCorteX.value = ehCient ? X_PLANO : -1e9;
  terreno.material.clippingPlanes = ehCient ? [planoCorte] : [];
  terreno.material.needsUpdate = true;
  cient.grupo.visible = ehCient;
  voarPara(ehCient ? vistaCorte() : vistaArtistica());
  document.body.classList.toggle('cientifico', ehCient);
  document.querySelectorAll('#modos button').forEach((b) => b.classList.toggle('ativo', b.dataset.modo === modo));
}
document.querySelectorAll('#modos button').forEach((b) => b.addEventListener('click', () => definirModo(b.dataset.modo)));

window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') definirModo(params.modo === 'artístico' ? 'científico' : 'artístico');
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('sem-ui');
  if (e.key === 'p' || e.key === 'P') salvarFoto();
});
function salvarFoto() {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `falesia-${Date.now()}.png`;
  a.click();
}

// ResizeObserver: também cobre o caso de a página abrir com tamanho zero (aba oculta)
function redimensionar() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  const dpr = renderer.getPixelRatio();
  compositor.redimensionar(w * dpr, h * dpr);
}
new ResizeObserver(redimensionar).observe(document.body);
redimensionar();

// ------------------------------------------------------------------ laço
// deriva das nuvens: vento do perfil de entrada extrapolado até a camada (lei de potência)
const m = vento.meta;
const uNuvem = m.uRef * Math.pow(uniformsCeu.uAlturaNuvem.value / m.zRef, m.alfa);
const relogio = new THREE.Clock();
let t = 0;
document.getElementById('carregando').classList.add('oculto');

renderer.setAnimationLoop(() => {
  const dt = Math.min(relogio.getDelta(), 0.1);
  t += dt;
  const uv = vento.uniforms;
  uv.uFatorVento.value = params.fatorVento;
  uv.uRajada.value = params.rajadas ? 1 : 0;
  uv.uVentoLateral.value = params.lateral;
  uv.uRajT.value = (t / vento.duracao) % 1;
  grama.uniforms.uTempo.value = t;
  uo.uTempoOnda.value = t;
  uniformsCeu.uTempo.value = t;
  // nuvens vêm do mar (direção terra adentro em x = 0), com a mesma escala de vento
  uniformsCeu.uDeriva.value.x += -paraOMar.x * uNuvem * params.fatorVento * dt;
  uniformsCeu.uDeriva.value.y += -paraOMar.z * uNuvem * params.fatorVento * dt;
  cient.atualizar(t, dt, params.fatorVento);
  if (voo) {
    voo.t = Math.min(voo.t + dt / 2.2, 1);
    const k = voo.t * voo.t * (3 - 2 * voo.t);
    camera.position.lerpVectors(voo.de.pos, voo.para.pos, k);
    controls.target.lerpVectors(voo.de.alvo, voo.para.alvo, k);
    if (voo.t >= 1) voo = null;
  }
  controls.update();
  compositor.renderizar(renderer, camera);
  renderer.render(scene, camera);
});

// para depuração no console
Object.assign(window, { THREE, scene, camera, controls, params, vento, posCiclista, ventoCorteCPU, ventoMundoCPU, coordCorte });
