"""
Vento sobre a falésia: simulação LES 2D com o método de Lattice Boltzmann.

Modelo
------
- Lattice Boltzmann D2Q9 com colisão BGK REGULARIZADA (Latt & Chopard, 2006): a
  parte de não-equilíbrio é projetada no tensor Π antes de relaxar, o que remove
  os "modos fantasmas" e o ruído em xadrez da pressão perto de τ = 0,5.
  No limite de baixo Mach ele recupera as equações de Navier–Stokes incompressíveis:
      ∂u/∂t + (u·∇)u = -∇p/ρ + ∇·[(ν + ν_t)(∇u + ∇uᵀ)],   ∇·u = 0
- Turbulência: LES com modelo de Smagorinsky, ν_t = (C_s Δ)² |S̄|. O tensor de
  deformação S̄ é obtido localmente da parte de não-equilíbrio das populações,
  sem diferenças finitas.

Domínio (corte vertical na direção do vento)
--------------------------------------------
    x = s ∈ [-250, 350] m (mar -> falésia -> planalto),  z ∈ [0, 240] m
    (topo alto: bloqueio de 30/240 = 12,5 %; com 150 m o bloqueio de 20 %
    acelerava artificialmente todo o escoamento a jusante)
    terreno: geometria.perfil(s); abaixo dele e abaixo do nível do mar = sólido

Condições de contorno
---------------------
- Entrada (s = -250 m): camada-limite atmosférica marinha, lei de potência
      u(z) = U_ref (z / z_ref)^α,   U_ref = 10 m/s,  z_ref = 10 m,  α = 0,11
  mais flutuações sintéticas de baixa frequência (rajadas que vêm do mar)
- Saída (s = 350 m): pressão fixa (ρ = 1) com a velocidade da coluna vizinha
  + camada esponja (viscosidade crescente) para que vórtices e ondas acústicas
  saiam sem refletir
- Topo (z = 150 m): deslizamento livre (reflexão especular)
- Mar e terreno: modelo de parede (lei logarítmica). Com Δx = 0,5–1 m a subcamada
  viscosa (milímetros) não é resolvida; em vez de não-deslizamento, a parede
  impõe a tensão de cisalhamento da lei log:
      τ_w = ρ u*²,   u* = κ U₁ / ln(z₁ / z₀)
  (U₁ = velocidade na primeira célula, z₁ = Δx/2, κ = 0,41, z₀ = rugosidade:
  mar 0,2 mm, areia 1 mm, face rochosa 5 cm, grama 3 cm). Isso é feito com um
  bounce-back de "parede móvel" cuja velocidade de deslizamento u_w dá exatamente τ_w.
  Paredes laterais (degraus da face) usam bounce-back simples (não-deslizamento).

Uso
---
    python lbm_falesia.py            # grade de 1 m (rápido, ~2 min)
    python lbm_falesia.py --fino     # grade de 0,5 m (melhor perto do chão)
"""

import argparse
import json
import os
import sys
import time

import numpy as np
from numba import njit, prange

from geometria import ALTURA_FALESIA, perfil

# ----------------------------------------------------------------- D2Q9
CX = np.array([0, 1, 0, -1, 0, 1, -1, -1, 1], dtype=np.int64)
CZ = np.array([0, 0, 1, 0, -1, 1, 1, -1, -1], dtype=np.int64)
W = np.array([4 / 9] + [1 / 9] * 4 + [1 / 36] * 4)
OPOSTO = np.array([0, 3, 4, 1, 2, 7, 8, 5, 6], dtype=np.int64)
# reflexão especular no topo: inverte só a componente z
ESPELHO_Z = np.array([0, 1, 4, 3, 2, 8, 7, 6, 5], dtype=np.int64)

# ----------------------------------------------------------------- parâmetros físicos
U_REF = 10.0      # m/s a 10 m sobre o mar (brisa fresca, Beaufort 5)
Z_REF = 10.0
ALFA = 0.11       # expoente da lei de potência sobre o mar aberto
NU_AR = 1.5e-5    # m²/s
RHO_AR = 1.2      # kg/m³
S0, S1 = -250.0, 350.0
ALTURA_DOMINIO = 240.0


def perfil_entrada(z):
    return U_REF * (np.maximum(z, 0.5) / Z_REF) ** ALFA


@njit(inline="always")
def equilibrio(i, rho, ux, uz, cx, cz, w):
    cu = 3.0 * (cx[i] * ux + cz[i] * uz)
    return w[i] * rho * (1.0 + cu + 0.5 * cu * cu - 1.5 * (ux * ux + uz * uz))


@njit(parallel=True, fastmath=True)
def passo(f, g, solido, tau0, cs2, u_in, ln_z, cx, cz, w, oposto, espelho, rho_o, ux_o, uz_o):
    """
    Um passo de tempo: colisão (BGK + Smagorinsky) e propagação ("push").
    f -> g. Também devolve ρ, u (antes da colisão) para estatística.
    """
    _, nz, nx = f.shape
    for x in prange(nx):
        fl = np.empty(9)
        feq = np.empty(9)
        for zc in range(nz):
            if solido[zc, x]:
                continue
            rho = 0.0
            mx = 0.0
            mz = 0.0
            for i in range(9):
                v = f[i, zc, x]
                fl[i] = v
                rho += v
                mx += v * cx[i]
                mz += v * cz[i]
            ux = mx / rho
            uz = mz / rho
            if x == 0:
                # entrada: impõe a velocidade, mantém a densidade local
                ux = u_in[zc]
                uz = 0.0
            rho_o[zc, x] = rho
            ux_o[zc, x] = ux
            uz_o[zc, x] = uz

            # tensor de momento de não-equilíbrio Π = Σ c c (f - feq)
            pxx = 0.0
            pzz = 0.0
            pxz = 0.0
            for i in range(9):
                feq[i] = equilibrio(i, rho, ux, uz, cx, cz, w)
                d = fl[i] - feq[i]
                pxx += cx[i] * cx[i] * d
                pzz += cz[i] * cz[i] * d
                pxz += cx[i] * cz[i] * d
            Q = np.sqrt(2.0 * (pxx * pxx + pzz * pzz + 2.0 * pxz * pxz))
            t0 = tau0[x]
            # τ_ef = τ0 + 3 ν_t, resolvido de forma fechada (Hou et al., 1996)
            tau = 0.5 * (t0 + np.sqrt(t0 * t0 + 18.0 * cs2 * Q / rho))
            om = 1.0 / tau
            if x == 0:
                om = 1.0  # coluna de entrada fica exatamente no equilíbrio

            # modelo de parede: velocidade de deslizamento que reproduz τ_w da lei log
            chao = zc == 0 or solido[zc - 1, x]
            uw = 0.0
            if chao:
                ustar = 0.41 * abs(ux) / ln_z[x]
                nu_ef = (tau - 0.5) / 3.0
                corr = ustar * ustar * 0.5 / nu_ef  # τ_w = ρ ν (U₁ − u_w)/(Δx/2)
                uw = max(abs(ux) - corr, 0.0) * (1.0 if ux >= 0 else -1.0)

            for i in range(9):
                # não-equilíbrio regularizado: w_i (9/2) Q_i : Π,  Q_i = c_i c_i − c_s² I
                qxx = cx[i] * cx[i] - 1.0 / 3.0
                qzz = cz[i] * cz[i] - 1.0 / 3.0
                fneq = w[i] * 4.5 * (qxx * pxx + qzz * pzz + 2.0 * cx[i] * cz[i] * pxz)
                post = feq[i] + (1.0 - om) * fneq
                xd = x + cx[i]
                zd = zc + cz[i]
                if zd >= nz:
                    # topo: deslizamento livre
                    xe = min(max(xd, 0), nx - 1)
                    g[espelho[i], zc, xe] = post
                elif zd < 0 or (solido[zd, xd] if 0 <= xd < nx else False):
                    if chao and cz[i] == -1:
                        # bounce-back com parede móvel (velocidade uw, horizontal)
                        g[oposto[i], zc, x] = post - 6.0 * w[i] * rho * cx[i] * uw
                    else:
                        g[oposto[i], zc, x] = post
                elif xd < 0 or xd >= nx:
                    pass  # sai pela entrada/saída; tratadas abaixo
                else:
                    g[i, zd, xd] = post

    # saída: populações que entram pela direita vêm do equilíbrio com ρ = 1
    # (pressão de referência) e a velocidade da coluna vizinha
    for zc in range(nz):
        if solido[zc, nx - 1]:
            continue
        uo = ux_o[zc, nx - 2]
        wo = uz_o[zc, nx - 2]
        for i in (3, 6, 7):
            g[i, zc, nx - 1] = equilibrio(i, 1.0, uo, wo, cx, cz, w)
    # entrada: populações que entram pela esquerda vêm do equilíbrio
    for zc in range(nz):
        if not solido[zc, 0]:
            for i in (1, 5, 8):
                g[i, zc, 0] = equilibrio(i, 1.0, u_in[zc], 0.0, cx, cz, w)


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # console do Windows
    ap = argparse.ArgumentParser()
    ap.add_argument("--fino", action="store_true", help="grade de 0,5 m")
    ap.add_argument("--dx", type=float, default=None, help="espaçamento da grade em m (sobrepõe --fino)")
    ap.add_argument("--saida", default=os.path.join(os.path.dirname(__file__), "..", "public", "dados"))
    ap.add_argument("--quadros", type=int, default=128, help="instantâneos para a animação")
    ap.add_argument("--npz", default=os.path.join(os.path.dirname(__file__), "resultado.npz"),
                    help="arquivo com os campos médios (para figuras e verificação)")
    ap.add_argument("--media", type=float, default=1.6, help="janela de média, em passagens do escoamento")
    ap.add_argument("--sem-exportar", action="store_true", help="não grava os dados da cena (rodadas de verificação)")
    a = ap.parse_args()

    dx = 0.5 if a.fino else 1.0
    if a.dx:
        dx = a.dx
    nx = int(round((S1 - S0) / dx))
    nz = int(round(ALTURA_DOMINIO / dx))
    s = S0 + (np.arange(nx) + 0.5) * dx
    z = (np.arange(nz) + 0.5) * dx

    # escalas: velocidade máxima de entrada vira 0,09 em unidades de rede (Mach ≈ 0,16)
    u_topo = perfil_entrada(ALTURA_DOMINIO)
    cu = u_topo / 0.09            # (m/s) por unidade de rede
    dt = dx / cu                  # s por passo
    u_in = (perfil_entrada(z) / cu).astype(np.float64)

    # viscosidade: a molecular do ar daria τ - 0,5 ~ 1e-9 (impossível de resolver);
    # usamos um ν de base pequeno e deixamos o Smagorinsky dissipar as escalas não resolvidas.
    re_alvo = 2.0e4
    nu0 = (U_REF / cu) * (ALTURA_FALESIA / dx) / re_alvo
    tau_base = 0.5 + 3.0 * nu0
    tau0 = np.full(nx, tau_base)
    esponja = np.clip((s - (S1 - 80.0)) / 80.0, 0.0, 1.0)
    tau0 += 0.6 * esponja ** 2
    cs = 0.17

    H = np.maximum(perfil(s), 0.0)
    solido = z[:, None] < H[None, :]
    # rugosidade aerodinâmica z0 por coluna (m)
    z0 = np.select([s < -52, s < -32, s < -2], [2e-4, 1e-3, 5e-2], 3e-2)
    ln_z = np.log(0.5 * dx / z0)
    # a coluna de entrada nunca é sólida acima do mar
    print(f"grade {nx} x {nz} (dx = {dx} m), dt = {dt * 1e3:.2f} ms, τ0 = {tau_base:.5f}, "
          f"Re_rede = {re_alvo:.0f}, células fluidas = {(~solido).sum()}")

    # condição inicial: perfil de entrada em todo o domínio
    f = np.zeros((9, nz, nx))
    ux0 = np.where(solido, 0.0, u_in[:, None] * np.ones((1, nx)))
    for i in range(9):
        cu_ = 3.0 * CX[i] * ux0
        f[i] = W[i] * (1.0 + cu_ + 0.5 * cu_ ** 2 - 1.5 * ux0 ** 2)
    g = f.copy()
    rho = np.ones((nz, nx))
    ux = np.zeros((nz, nx))
    uz = np.zeros((nz, nx))

    # rajadas na entrada: soma de modos com fases aleatórias (amplitude RMS ≈ 4 %)
    rng = np.random.default_rng(7)
    periodos = np.array([4.0, 7.0, 11.0, 17.0, 26.0])  # s
    fases = rng.uniform(0, 2 * np.pi, len(periodos))
    amps = np.array([0.025, 0.03, 0.03, 0.025, 0.02])

    t_passagem = (S1 - S0) / U_REF                  # s, uma passagem do escoamento
    n_aquec = int(1.6 * t_passagem / dt)
    n_media = int(a.media * t_passagem / dt)
    dt_quadro = 0.15                                # s entre instantâneos
    k_quadro = max(1, int(round(dt_quadro / dt)))
    n_anim = a.quadros * k_quadro

    # janela da cena (perto da borda) para os instantâneos
    jan_s = (-45.0, 165.0)
    jan_z = (0.0, 75.0)
    ix0, ix1 = np.searchsorted(s, jan_s)
    iz1 = np.searchsorted(z, jan_z[1])

    soma = {k: np.zeros((nz, nx)) for k in ("u", "w", "p", "uu", "ww", "uw")}
    # médias de cada metade da janela, para checar a convergência estatística
    metade = {k: np.zeros((nz, nx)) for k in ("u1", "w1", "u2", "w2")}
    quadros = []
    n_total = n_aquec + n_media
    t_ini = time.time()
    print(f"aquecimento {n_aquec} passos, média {n_media} passos, quadros a cada {k_quadro} passos")

    passo_atual = 0
    for n in range(n_total):
        t = n * dt
        rajada = 1.0 + np.sum(amps * np.sin(2 * np.pi * t / periodos + fases))
        passo(f, g, solido, tau0, cs * cs, u_in * rajada, ln_z, CX, CZ, W, OPOSTO, ESPELHO_Z, rho, ux, uz)
        f, g = g, f
        passo_atual += 1

        if n >= n_aquec:
            U = ux * cu
            Wz = uz * cu
            soma["u"] += U
            soma["w"] += Wz
            soma["p"] += (rho - 1.0) / 3.0 * RHO_AR * cu * cu  # p' = ρ_ar c_s² (ρ_rede − 1)·c²
            soma["uu"] += U * U
            soma["ww"] += Wz * Wz
            soma["uw"] += U * Wz
            sufixo = "1" if n - n_aquec < n_media // 2 else "2"
            metade["u" + sufixo] += U
            metade["w" + sufixo] += Wz
            if n - n_aquec < n_anim and (n - n_aquec) % k_quadro == 0:
                quadros.append(np.stack([U[:iz1, ix0:ix1], Wz[:iz1, ix0:ix1]], axis=-1).astype(np.float16))

        if n % 2000 == 0:
            el = time.time() - t_ini
            vmax = np.abs(ux).max() * cu
            print(f"  passo {n:6d}/{n_total}  t = {t:6.1f} s  |u|max = {vmax:5.1f} m/s  "
                  f"({el:5.0f} s, {el / max(n, 1) * 1e3:.1f} ms/passo)", flush=True)
            if not np.isfinite(vmax):
                raise RuntimeError("simulação divergiu")

    m = {k: v / n_media for k, v in soma.items()}
    # energia cinética turbulenta resolvida (só as componentes do plano): k = ½(u'² + w'²)
    m["k"] = 0.5 * (m["uu"] - m["u"] ** 2 + m["ww"] - m["w"] ** 2)
    m["uw"] = m["uw"] - m["u"] * m["w"]  # covariância u'w' (tensão de Reynolds / ρ, com sinal trocado)
    q_ref = 0.5 * RHO_AR * U_REF ** 2
    # pressão de referência: média na entrada a 10 m (Cp = 0 no escoamento livre)
    iz_ref = np.searchsorted(z, Z_REF)
    m["cp"] = (m["p"] - m["p"][iz_ref, 2]) / q_ref
    for k in ("u", "w", "cp", "k", "uw"):
        m[k] = np.where(solido, np.nan, m[k])

    n1 = n_media // 2
    for k in ("u", "w"):
        m[k + "_metade1"] = np.where(solido, np.nan, metade[k + "1"] / n1)
        m[k + "_metade2"] = np.where(solido, np.nan, metade[k + "2"] / (n_media - n1))
    np.savez_compressed(a.npz, s=s, z=z, solido=solido, **m, quadros=np.array(quadros), dx=dx,
                        t_media=n_media * dt)
    if a.sem_exportar:
        print(f"pronto em {time.time() - t_ini:.0f} s; campos em {a.npz}")
        return
    os.makedirs(a.saida, exist_ok=True)

    # ---- exportação para a cena
    def bin_(nome, arr):
        arr.tofile(os.path.join(a.saida, nome))

    # campo médio completo: (nz, nx, 4) float32 -> u, w, Cp, k
    medio = np.stack([m["u"], m["w"], m["cp"], m["k"]], axis=-1)
    medio = np.nan_to_num(medio, nan=0.0).astype(np.float32)
    bin_("campo_medio.bin", medio)
    # instantâneos: (quadros, nzj, nxj, 2) float16 -> u, w
    q = np.nan_to_num(np.array(quadros), nan=0.0).astype(np.float16)
    bin_("rajadas.bin", q)

    meta = {
        "descricao": "vento 2D LBM-LES sobre a falesia; ver README",
        "dx": dx,
        "medio": {"nx": nx, "nz": nz, "s0": S0, "z0": 0.0, "canais": ["u", "w", "Cp", "k"]},
        "rajadas": {"nx": int(ix1 - ix0), "nz": int(iz1), "nt": len(quadros),
                    "s0": float(s[ix0] - dx / 2), "z0": 0.0, "dtQuadro": k_quadro * dt, "canais": ["u", "w"]},
        "uRef": U_REF, "zRef": Z_REF, "alfa": ALFA, "alturaFalesia": ALTURA_FALESIA,
        "dt": dt, "passos": n_total, "tempoSimulado": n_total * dt,
        "cs": cs, "reRede": re_alvo,
    }
    with open(os.path.join(a.saida, "vento.json"), "w", encoding="utf-8") as fjs:
        json.dump(meta, fjs, indent=1)
    print(f"pronto em {time.time() - t_ini:.0f} s; exportado para {os.path.abspath(a.saida)}")


if __name__ == "__main__":
    main()
