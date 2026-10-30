// Parâmetros das ondas de Gerstner e avaliação na CPU (usada pela boia e pela câmera).
// Cada onda é um vec4: (direção.x, direção.z, inclinação, comprimento de onda).

export const NUM_ONDAS = 10; // ondas que deslocam a malha (vertex shader)
export const NUM_DETALHES = 14; // ondulações finas, só no normal (fragment shader)
const G = 9.81;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gera o espectro: ondas longas na direção do vento, ondas curtas mais espalhadas. */
export function gerarOndas({ comprimento, vento, espalhamento, semente = 4 }) {
  const rnd = mulberry32(semente);
  const base = (vento * Math.PI) / 180;
  const ondas = [];
  let soma = 0;
  for (let i = 0; i < NUM_ONDAS; i++) {
    const L = comprimento * Math.pow(0.7, i) * (0.85 + 0.3 * rnd());
    const ang = base + (rnd() * 2 - 1) * espalhamento * (0.35 + i / NUM_ONDAS);
    const s = (1.0 - 0.45 * (i / NUM_ONDAS)) * (0.6 + 0.4 * rnd());
    soma += s;
    ondas.push([Math.cos(ang), Math.sin(ang), s, L]);
  }
  // soma das inclinações normalizada: evita que as cristas "deem laço"
  for (const o of ondas) o[2] *= 0.72 / soma;

  const detalhes = [];
  for (let i = 0; i < NUM_DETALHES; i++) {
    const L = 7.0 * Math.pow(0.8, i) * (0.85 + 0.3 * rnd());
    const ang = base + (rnd() * 2 - 1) * Math.PI * 0.55;
    detalhes.push([Math.cos(ang), Math.sin(ang), 0.05 + 0.05 * rnd(), L]);
  }
  return { ondas, detalhes };
}

export function amplitudeMaxima(ondas, altura, inclinacao) {
  return ondas.reduce((a, o) => a + (o[2] * inclinacao * o[3]) / (2 * Math.PI), 0) * altura;
}

/**
 * Altura e normal da superfície no ponto (x, z) do mundo.
 * Gerstner desloca os pontos horizontalmente, então inverte-se o mapa com algumas iterações.
 */
export function amostrarSuperficie(ondas, u, t, x, z) {
  const { altura, inclinacao, chop } = u;
  let px = x;
  let pz = z;
  for (let it = 0; it < 4; it++) {
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < ondas.length; i++) {
      const [ox, oz, s0, L] = ondas[i];
      const k = (2 * Math.PI) / L;
      const a = (s0 * inclinacao) / k;
      const f = k * (ox * px + oz * pz) - Math.sqrt(G * k) * t + i * 1.913;
      dx += chop * a * ox * Math.cos(f);
      dz += chop * a * oz * Math.cos(f);
    }
    px = x - dx;
    pz = z - dz;
  }
  let y = 0;
  let sx = 0;
  let sz = 0;
  for (let i = 0; i < ondas.length; i++) {
    const [ox, oz, s0, L] = ondas[i];
    const k = (2 * Math.PI) / L;
    const s = s0 * inclinacao;
    const f = k * (ox * px + oz * pz) - Math.sqrt(G * k) * t + i * 1.913;
    y += (s / k) * Math.sin(f) * altura;
    sx += s * ox * Math.cos(f) * altura;
    sz += s * oz * Math.cos(f) * altura;
  }
  const n = [-sx, 1, -sz];
  const len = Math.hypot(n[0], n[1], n[2]);
  return { y, normal: [n[0] / len, n[1] / len, n[2] / len] };
}
