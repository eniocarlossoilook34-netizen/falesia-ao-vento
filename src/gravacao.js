// Modo de gravação de vídeo (index.html?gravar).
//
// A cena não roda em tempo real: um script externo (video/gravar.py) pede cada
// quadro com __gravacao.quadro(i). O tempo avança exatamente 1/fps por quadro,
// então o vídeo sai liso mesmo numa GPU fraca. A câmera segue um roteiro de
// três planos, e legendas e o gráfico de perfis são compostos num canvas 2D.

const DURACAO = 22; // s
const T_CIENT = 7.5; // início do plano científico
const T_FINAL = 16; // volta ao artístico + cartela final

const suave = (x) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};
const janela = (T, a, b, rampa = 0.5) => suave((T - a) / rampa) * (1 - suave((T - (b - rampa)) / rampa));

export function criarGravacao(api) {
  const { THREE, camera, controls, cient, posCiclista, paraOMar, X_PLANO, centroEstrada, X_CICLISTA, alturaTerreno, definirModo, passo, canvas } = api;
  controls.enableDamping = false;
  const cima = new THREE.Vector3(0, 1, 0);
  const lado = new THREE.Vector3(-paraOMar.z, 0, paraOMar.x); // à direita de quem olha o mar
  const zBorda = posCiclista.z - centroEstrada(X_CICLISTA);

  const saida = document.createElement('canvas');
  const ctx = saida.getContext('2d');
  let modo = 'artístico';

  function cameraEm(T) {
    const pos = new THREE.Vector3();
    const alvo = new THREE.Vector3();
    if (T < T_CIENT) {
      // plano 1: atrás da bicicleta, aproximando e subindo devagar
      const u = suave(T / T_CIENT);
      pos.copy(posCiclista).addScaledVector(paraOMar, -(7.5 - 3.2 * u)).addScaledVector(lado, -1.8 + 1.1 * u);
      pos.y = alturaTerreno(pos.x, pos.z) + 0.9 + 0.8 * u;
      alvo.copy(posCiclista).addScaledVector(paraOMar, 30).addScaledVector(cima, 6.5 - 2.5 * u);
    } else if (T < T_FINAL) {
      // plano 2: vista lateral do corte, aproximando da borda
      const v = suave((T - T_CIENT) / (T_FINAL - T_CIENT));
      // alvo abaixo do chão: o corte (0–95 m) ocupa a metade de cima do quadro vertical
      pos.set(X_PLANO - 235 + 55 * v, 2, zBorda + 22 - 6 * v);
      alvo.set(X_PLANO, 2, zBorda + 22 - 6 * v);
    } else {
      // plano 3: grua subindo ao lado da bicicleta, olhando a costa
      const w = suave((T - T_FINAL) / (DURACAO - T_FINAL));
      pos.copy(posCiclista).addScaledVector(paraOMar, -3.5 + 2.0 * w).addScaledVector(lado, 2.2);
      pos.y = alturaTerreno(pos.x, pos.z) + 1.6 + 5.5 * w;
      alvo.copy(posCiclista).addScaledVector(paraOMar, 60).addScaledVector(lado, -22 - 10 * w).addScaledVector(cima, 6 - 8 * w);
    }
    return { pos, alvo };
  }

  function texto(str, x, y, tam, { peso = 600, alfa = 1, alinhar = 'center', cor = '255,255,255' } = {}) {
    if (alfa <= 0.001) return;
    ctx.font = `${peso} ${tam}px Inter, system-ui, sans-serif`;
    ctx.textAlign = alinhar;
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = `rgba(0, 20, 50, ${0.55 * alfa})`;
    ctx.shadowBlur = tam * 0.45;
    ctx.fillStyle = `rgba(${cor}, ${alfa})`;
    ctx.fillText(str, x, y);
    ctx.shadowBlur = 0;
  }

  function barraCor(x, y, w, h, alfa) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#f66b19', '#ca2a04', '#7a0403'].forEach((c, i, a) =>
      g.addColorStop(i / (a.length - 1), c),
    );
    ctx.globalAlpha = alfa;
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    const [a, b] = cient.faixa();
    texto(String(a), x - 14, y + h, 26, { peso: 500, alfa, alinhar: 'right' });
    texto(`${b.toLocaleString('pt-BR')} m/s`, x + w + 14, y + h, 26, { peso: 500, alfa, alinhar: 'left' });
    texto('velocidade do vento |U| (instantânea)', x + w / 2, y - 14, 26, { peso: 500, alfa });
  }

  function compor(T) {
    const W = canvas.width;
    const H = canvas.height;
    if (saida.width !== W) {
      saida.width = W;
      saida.height = H;
    }
    const k = W / 1080; // escala das legendas
    ctx.drawImage(canvas, 0, 0);

    // escurece o topo e a base para as legendas
    const gTop = ctx.createLinearGradient(0, 0, 0, H * 0.3);
    gTop.addColorStop(0, 'rgba(5, 20, 45, 0.35)');
    gTop.addColorStop(1, 'rgba(5, 20, 45, 0)');
    ctx.fillStyle = gTop;
    ctx.fillRect(0, 0, W, H * 0.3);

    // plano 1
    texto('O vento desta cena não é animação.', W / 2, 150 * k, 50 * k, { alfa: janela(T, 0.6, T_CIENT - 0.3, 0.6) });
    texto('Ele é calculado por CFD:', W / 2, 225 * k, 40 * k, { peso: 500, alfa: janela(T, 2.8, T_CIENT - 0.3, 0.6) });
    texto('Lattice Boltzmann + LES', W / 2, 280 * k, 40 * k, { peso: 500, alfa: janela(T, 2.8, T_CIENT - 0.3, 0.6) });

    // plano 2
    const aC = janela(T, T_CIENT + 0.4, T_FINAL - 0.2, 0.6);
    if (aC > 0) {
      texto('Corte vertical da falésia', W / 2, 140 * k, 52 * k, { alfa: aC });
      texto('linhas de corrente · partículas · vetores', W / 2, 200 * k, 32 * k, { peso: 500, alfa: aC });
      const a2 = janela(T, T_CIENT + 3.2, T_FINAL - 0.2, 0.6);
      texto('aceleração no topo  →  separação  →  recirculação', W / 2, 252 * k, 30 * k, { peso: 500, alfa: a2, cor: '255,226,140' });
      // gráfico de perfis do painel científico, na faixa de baixo (sobre o mar)
      const pc = document.querySelector('#painel-cientifico canvas');
      if (pc && pc.width > 0) {
        const bw = W * 0.74;
        const bh = bw * (pc.height / pc.width);
        const bx = (W - bw) / 2;
        const by = H - bh - 60 * k;
        barraCor(W * 0.27, by - 150 * k, W * 0.46, 16 * k, aC);
        ctx.globalAlpha = aC;
        ctx.fillStyle = 'rgba(8, 18, 32, 0.72)';
        ctx.beginPath();
        ctx.roundRect(bx - 20 * k, by - 62 * k, bw + 40 * k, bh + 82 * k, 22 * k);
        ctx.fill();
        ctx.drawImage(pc, bx, by, bw, bh);
        ctx.globalAlpha = 1;
        // legenda colorida das estações (mesmas cores do gráfico)
        const est = [['mar', '127,184,255'], ['borda', '255,211,77'], ['atrás da borda', '255,122,89'], ['planalto', '155,227,122']];
        ctx.font = `500 ${27 * k}px Inter, system-ui, sans-serif`;
        const sep = 26 * k;
        const larg = est.reduce((s, [n]) => s + ctx.measureText(n).width, 0) + sep * (est.length - 1);
        let lx = (W - larg) / 2;
        for (const [n, cor] of est) {
          texto(n, lx, by - 22 * k, 27 * k, { peso: 500, alfa: aC, alinhar: 'left', cor });
          ctx.font = `500 ${27 * k}px Inter, system-ui, sans-serif`;
          lx += ctx.measureText(n).width + sep;
        }
        texto('perfis de vento u(z), linha cheia: média · tracejada: instante', W / 2, by + bh + 40 * k, 22 * k, { peso: 500, alfa: aC * 0.85 });
      }
    }

    // plano 3 + cartela final
    texto('Verificado e validado:', W / 2, 150 * k, 44 * k, { alfa: janela(T, T_FINAL + 0.5, DURACAO + 1, 0.6) });
    texto('aceleração no topo a 6 % do Eurocode 1', W / 2, 212 * k, 36 * k, { peso: 500, alfa: janela(T, T_FINAL + 0.9, DURACAO + 1, 0.6) });
    const aF = suave((T - (DURACAO - 3.2)) / 0.8);
    if (aF > 0) {
      const gF = ctx.createLinearGradient(0, H * 0.55, 0, H);
      gF.addColorStop(0, 'rgba(5, 18, 38, 0)');
      gF.addColorStop(0.3, `rgba(5, 18, 38, ${0.5 * aF})`);
      gF.addColorStop(1, `rgba(5, 18, 38, ${0.6 * aF})`);
      ctx.fillStyle = gF;
      ctx.fillRect(0, H * 0.55, W, H * 0.45);
      texto('Falésia ao vento', W / 2, H * 0.74, 78 * k, { peso: 600, alfa: aF });
      texto('arte + CFD  ·  Python · Three.js · Blender', W / 2, H * 0.74 + 70 * k, 32 * k, { peso: 500, alfa: aF });
      texto('github.com/eniocarlossoilook34-netizen/falesia-ao-vento', W / 2, H * 0.74 + 130 * k, 27 * k, { peso: 500, alfa: aF, cor: '200,225,255' });
    }

    // transições por branco
    const fade = Math.max(1 - Math.abs(T - T_CIENT) / 0.45, 1 - Math.abs(T - T_FINAL) / 0.45, 1 - T / 0.4, 0);
    if (fade > 0) {
      ctx.fillStyle = `rgba(245, 249, 255, ${fade})`;
      ctx.fillRect(0, 0, W, H);
    }
    return saida.toDataURL('image/jpeg', 0.95);
  }

  function aplicarCamera(T) {
    const quer = T >= T_CIENT && T < T_FINAL ? 'científico' : 'artístico';
    if (quer !== modo) {
      definirModo(quer, { voar: false });
      modo = quer;
    }
    const { pos, alvo } = cameraEm(T);
    camera.position.copy(pos);
    controls.target.copy(alvo);
  }

  return {
    duracao: DURACAO,
    async preparar(fps = 30) {
      document.body.classList.add('sem-ui');
      await document.fonts.ready;
      aplicarCamera(0);
      for (let i = 0; i < fps; i++) passo(1 / fps); // aquece o céu e a simulação
    },
    quadro(i, fps = 30) {
      const T = i / fps;
      aplicarCamera(T);
      passo(1 / fps);
      return compor(T);
    },
  };
}
