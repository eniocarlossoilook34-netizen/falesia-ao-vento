"""
Verificação 1: escoamento de Poiseuille entre placas planas (solução analítica).

Usa O MESMO kernel do solver da falésia (lbm_falesia.passo), com:
  - Smagorinsky desligado (C_s = 0) e regime laminar (Re ≈ 11)
  - paredes inferior e superior sólidas (bounce-back; o modelo de parede é
    desativado fazendo ln(z1/z0) → 0, o que dá u_w = 0, isto é, não-deslizamento)
  - entrada com velocidade uniforme e saída com pressão fixa (as mesmas do solver)

Solução exata do escoamento desenvolvido, canal de altura h:
    u(y) = 6 Ū (y/h)(1 − y/h)          dp/dx = −12 μ Ū / h²

Verifica: viscosidade (relação ν = c_s²(τ − ½)), posição das paredes do
bounce-back, conservação de massa e as condições de entrada/saída.

    python verificacao_poiseuille.py
"""

import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from lbm_falesia import CX, CZ, ESPELHO_Z, OPOSTO, W, passo

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))


def rodar(h=22, nx=400, U=0.05, tau=0.8, passos=40000):
    nz = h + 2  # uma linha sólida em cima e outra embaixo
    solido = np.zeros((nz, nx), dtype=np.bool_)
    solido[0, :] = True
    solido[-1, :] = True
    nu = (tau - 0.5) / 3.0
    u_in = np.where(solido[:, 0], 0.0, U)
    tau0 = np.full(nx, tau)
    ln_z = np.full(nx, 1e-9)  # desliga o modelo de parede -> não-deslizamento

    f = np.zeros((9, nz, nx))
    for i in range(9):
        cu = 3.0 * CX[i] * u_in[:, None]
        f[i] = W[i] * (1.0 + cu + 0.5 * cu ** 2 - 1.5 * u_in[:, None] ** 2) * np.ones((1, nx))
    g = f.copy()
    rho = np.ones((nz, nx))
    ux = np.zeros((nz, nx))
    uz = np.zeros((nz, nx))
    for n in range(passos):
        passo(f, g, solido, tau0, 0.0, u_in, ln_z, CX, CZ, W, OPOSTO, ESPELHO_Z, rho, ux, uz)
        f, g = g, f
    return solido, rho, ux, uz, nu, h


def main():
    solido, rho, ux, uz, nu, h = rodar()
    nz, nx = rho.shape
    x0 = int(nx * 0.75)
    # paredes do bounce-back ficam a meio caminho: y = 0 em z = 1,0 e y = h em z = h + 1,0
    zc = np.arange(nz) + 0.5
    y = zc - 1.0
    fl = ~solido[:, x0]
    u = ux[fl, x0]
    yy = y[fl]
    Umed = u.mean()
    exato = 6 * Umed * (yy / h) * (1 - yy / h)
    erro_perfil = np.sqrt(np.mean((u - exato) ** 2)) / exato.max()

    # gradiente de pressão na região desenvolvida (p = ρ c_s²)
    xs = np.arange(int(nx * 0.4), int(nx * 0.9))
    p_med = np.array([rho[fl, x].mean() / 3.0 for x in xs])
    dpdx = np.polyfit(xs, p_med, 1)[0]
    dpdx_exato = -12 * nu * Umed / h ** 2  # ρ ≈ 1

    # conservação de massa: vazão em várias seções
    Q = np.array([(rho[fl, x] * ux[fl, x]).sum() for x in range(5, nx - 5, 20)])
    var_Q = (Q.max() - Q.min()) / Q.mean()

    print("== Poiseuille (kernel do solver da falésia) ==")
    print(f"  Re = Ū h / ν = {Umed * h / nu:.1f}")
    print(f"  u_max simulado / exato = {u.max() / exato.max():.4f}")
    print(f"  erro RMS do perfil      = {erro_perfil:.2%} de u_max")
    print(f"  dp/dx simulado / exato  = {dpdx / dpdx_exato:.4f}")
    print(f"  variação da vazão ao longo do canal = {var_Q:.2e}")

    fig, ax = plt.subplots(figsize=(4.6, 3.6), dpi=130)
    yf = np.linspace(0, h, 200)
    ax.plot(6 * Umed * (yf / h) * (1 - yf / h) / Umed, yf / h, "k-", lw=1.2, label="exata")
    ax.plot(u / Umed, yy / h, "o", ms=4, color="C0", label="LBM (kernel da falésia)")
    ax.set_xlabel("u / Ū")
    ax.set_ylabel("y / h")
    ax.set_title(f"Poiseuille: erro RMS {erro_perfil:.2%}")
    ax.legend(fontsize=8)
    fig.tight_layout()
    destino = os.path.join(AQUI, "..", "docs", "figuras", "6_poiseuille.png")
    fig.savefig(destino)
    print("figura:", os.path.abspath(destino))
    with open(os.path.join(AQUI, "verificacao", "poiseuille.txt"), "w", encoding="utf-8") as fo:
        fo.write(f"Re={Umed * h / nu:.2f}\numax_ratio={u.max() / exato.max():.5f}\nerro_rms={erro_perfil:.5f}\n"
                 f"dpdx_ratio={dpdx / dpdx_exato:.5f}\nvar_Q={var_Q:.3e}\n")


def convergencia():
    """Erro em dp/dx para h = 11, 22, 44 células (mesmo Re): estima a ordem do método."""
    linhas = []
    erros = []
    hs = [11, 22, 44]
    for h in hs:
        k = h / 22
        solido, rho, ux, uz, nu, _ = rodar(h=h, nx=int(400 * k), U=0.05 / k, passos=int(40000 * k * k))
        nz, nx = rho.shape
        fl = ~solido[:, 0]
        xs = np.arange(int(nx * 0.4), int(nx * 0.9))
        dpdx = np.polyfit(xs, [rho[fl, x].mean() / 3.0 for x in xs], 1)[0]
        Umed = ux[fl, int(nx * 0.75)].mean()
        e = abs(dpdx / (-12 * nu * Umed / h ** 2) - 1)
        erros.append(e)
        linhas.append(f"h={h}: erro dp/dx = {e:.3%}")
        print(linhas[-1], flush=True)
    ordem = np.polyfit(np.log(hs), np.log(erros), 1)[0]
    linhas.append(f"ordem observada = {-ordem:.2f}")
    print(linhas[-1])
    with open(os.path.join(AQUI, "verificacao", "poiseuille_convergencia.txt"), "w", encoding="utf-8") as fo:
        fo.write("\n".join(linhas) + "\n")


if __name__ == "__main__":
    if "--convergencia" in sys.argv:
        convergencia()
    else:
        main()
