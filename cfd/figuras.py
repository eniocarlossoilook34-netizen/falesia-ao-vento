"""
Figuras de engenharia a partir de cfd/resultado.npz (gerado por lbm_falesia.py).

    python figuras.py          -> docs/figuras/*.png e um resumo numérico no terminal

1. velocidade média |U| com linhas de corrente
2. coeficiente de pressão Cp
3. energia cinética turbulenta k (resolvida)
4. perfis verticais u(z) acima do chão em várias estações
5. fator de aceleração (speed-up) ΔS = (U(z) − U0(z)) / U0(z) sobre a borda
"""

import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from geometria import perfil

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "..", "docs", "figuras")


def main():
    os.makedirs(SAIDA, exist_ok=True)
    r = np.load(os.path.join(AQUI, "resultado.npz"))
    s, z, u, w, cp, k = r["s"], r["z"], r["u"], r["w"], r["cp"], r["k"]
    dx = float(r["dx"])
    U = np.hypot(u, w)
    h = np.maximum(perfil(s), 0)

    plt.rcParams.update({"font.size": 10, "figure.dpi": 130})
    jan = (s > -150) & (s < 250)
    sj, Uj = s[jan], U[:, jan]
    zmax = 90

    def terreno(ax):
        ax.fill_between(s, 0, h, color="#5b4a3a", zorder=3)
        ax.fill_between(s, -2, 0, where=s < -52, color="#1d5f8a", zorder=3)
        ax.set_xlim(-150, 250)
        ax.set_ylim(0, zmax)
        ax.set_aspect("equal")
        ax.set_xlabel("s, distância à borda (m)")
        ax.set_ylabel("z (m)")

    # 1. |U| + linhas de corrente
    fig, ax = plt.subplots(figsize=(11, 3.6))
    im = ax.pcolormesh(sj, z, Uj, cmap="turbo", vmin=0, vmax=15, shading="auto")
    uu = np.nan_to_num(u[:, jan])
    ww = np.nan_to_num(w[:, jan])
    alturas = np.concatenate([np.linspace(2, 30, 10), np.linspace(34, 85, 8)])
    sementes = np.column_stack([np.full_like(alturas, -145.0), alturas])
    ax.streamplot(sj, z, uu, ww, color="white", linewidth=0.6, density=3, start_points=sementes,
                  arrowsize=0.6, integration_direction="forward", broken_streamlines=False)
    # sementes extras dentro da bolha de recirculação
    ax.streamplot(sj, z, uu, ww, color="#ffd34d", linewidth=0.7, density=3,
                  start_points=np.array([[5, 31.5], [10, 31.5], [15, 32.0], [3, 32.5]]),
                  arrowsize=0.6, broken_streamlines=False)
    terreno(ax)
    fig.colorbar(im, ax=ax, label="|U| (m/s)", shrink=0.9)
    ax.set_title("Velocidade média e linhas de corrente (LBM-LES 2D, U_ref = 10 m/s a 10 m)")
    fig.tight_layout()
    fig.savefig(os.path.join(SAIDA, "1_velocidade.png"))
    plt.close(fig)

    # 2. Cp
    fig, ax = plt.subplots(figsize=(11, 3.6))
    im = ax.pcolormesh(sj, z, cp[:, jan], cmap="RdBu_r", vmin=-1, vmax=1, shading="auto")
    terreno(ax)
    fig.colorbar(im, ax=ax, label="Cp", shrink=0.9)
    ax.set_title("Coeficiente de pressão Cp = (p − p∞) / (½ ρ U_ref²)")
    fig.tight_layout()
    fig.savefig(os.path.join(SAIDA, "2_pressao.png"))
    plt.close(fig)

    # 3. k
    fig, ax = plt.subplots(figsize=(11, 3.6))
    im = ax.pcolormesh(sj, z, k[:, jan], cmap="magma", vmin=0, vmax=np.nanpercentile(k[:, jan], 99.5), shading="auto")
    terreno(ax)
    fig.colorbar(im, ax=ax, label="k (m²/s²)", shrink=0.9)
    ax.set_title("Energia cinética turbulenta resolvida k = ½(u'² + w'²)")
    fig.tight_layout()
    fig.savefig(os.path.join(SAIDA, "3_turbulencia.png"))
    plt.close(fig)

    # 4. perfis acima do chão local
    estacoes = [-120, -20, 0, 10, 25, 60, 150]
    fig, axs = plt.subplots(1, len(estacoes), figsize=(12, 4), sharey=True)
    ref = None
    for ax, st in zip(axs, estacoes):
        i = np.argmin(np.abs(s - st))
        acima = z - h[i]
        ok = (acima > 0) & (acima < 50)
        ax.plot(u[ok, i], acima[ok], color="C0", label="u")
        ax.plot(w[ok, i], acima[ok], color="C3", lw=0.9, label="w")
        if ref is None:
            ref = (acima[ok], u[ok, i])
        else:
            ax.plot(ref[1], ref[0], "k--", lw=0.7, label="mar aberto")
        ax.axvline(0, color="0.7", lw=0.6)
        ax.set_title(f"s = {st} m")
        ax.set_xlim(-4, 16)
        ax.set_xlabel("m/s")
    axs[0].set_ylabel("altura acima do chão (m)")
    axs[1].legend(fontsize=8, loc="upper left")
    fig.suptitle("Perfis verticais de velocidade (corte vertical da falésia)")
    fig.tight_layout()
    fig.savefig(os.path.join(SAIDA, "4_perfis.png"))
    plt.close(fig)

    # 5. speed-up e bolha
    i0 = np.argmin(np.abs(s + 120))
    resumo = []
    fig, ax = plt.subplots(figsize=(8, 3.4))
    for alt in (2, 5, 10, 20):
        U0 = np.interp(alt, z - h[i0], U[:, i0])
        perf = []
        for i in range(len(s)):
            col = U[:, i]
            perf.append(np.interp(h[i] + alt, z, np.nan_to_num(col)))
        dS = (np.array(perf) - U0) / U0
        ax.plot(s, dS, label=f"{alt} m acima do chão")
        sel = (s > -5) & (s < 60)
        resumo.append((alt, U0, dS[sel].max(), s[sel][np.argmax(dS[sel])]))
    ax.axhline(0, color="0.6", lw=0.6)
    ax.axvline(0, color="0.6", lw=0.6, ls=":")
    ax.set_xlim(-100, 200)
    ax.set_xlabel("s (m)")
    ax.set_ylabel("ΔS")
    ax.legend(fontsize=8)
    ax.set_title("Fator de aceleração ΔS = (U − U_mar)/U_mar à mesma altura acima do chão")
    fig.tight_layout()
    fig.savefig(os.path.join(SAIDA, "5_speedup.png"))
    plt.close(fig)

    # bolha de recirculação: u < 0 na primeira célula fluida sobre o planalto
    prim = []
    for i in range(len(s)):
        j = np.searchsorted(z, h[i])
        prim.append(u[min(j, len(z) - 1), i])
    prim = np.array(prim)
    rec = (s > -2) & (s < 120) & (prim < 0)
    print("== resumo ==")
    print(f"grade dx = {dx} m")
    for alt, U0, m, sm in resumo:
        print(f"  {alt:3d} m acima do chão: U_mar = {U0:5.2f} m/s, ΔS máx = {m:+.2f} em s = {sm:.0f} m")
    if rec.any():
        print(f"  recirculação junto ao chão: s = {s[rec].min():.0f} m a {s[rec].max():.0f} m "
              f"(comprimento ≈ {s[rec].max() - s[rec].min():.0f} m ≈ {(s[rec].max() - s[rec].min()) / 30:.1f} H)")
    else:
        print("  sem recirculação média junto ao chão")
    print(f"  Cp mín (sucção na borda) = {np.nanmin(cp[:, (s > -10) & (s < 30)]):.2f}")
    print(f"  k máx = {np.nanmax(k):.2f} m²/s²  (intensidade ≈ {np.sqrt(2 / 3 * np.nanmax(k)) / 10:.0%} de U_ref)")
    print("figuras em", os.path.abspath(SAIDA))


if __name__ == "__main__":
    main()
