"""
Verificação e validação do escoamento sobre a falésia.

Entradas (geradas por lbm_falesia.py --sem-exportar --npz ...):
    verificacao/malha_2m.npz   (Δx = 2 m,   janela de média 3,2 passagens)
    verificacao/malha_1m.npz   (Δx = 1 m,   janela de média 3,2 passagens)
    verificacao/malha_05m.npz  (Δx = 0,5 m, janela de média 1,6 passagem)

Verificação
  V2. convergência de malha: métricas nas três grades + índice de convergência
      de malha (GCI, Roache 1994) com razão de refino r = 2
  V3. convergência estatística: métricas com a 1ª e a 2ª metade da janela de média
  V4. conservação de massa: vazão média Q(s) = ∫ u dz ao longo do domínio

Validação
  V5. comparação do fator de aceleração com o coeficiente orográfico do
      Eurocode 1 (EN 1991-1-4:2005, Anexo A.3, expressões A.3–A.10, falésias e escarpas)

    python verificacao_falesia.py
"""

import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from geometria import ALTURA_FALESIA, perfil

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))
VER = os.path.join(AQUI, "verificacao")
FIG = os.path.join(AQUI, "..", "docs", "figuras")
S_REF = -120.0  # perfil de referência "mar aberto" (4 H antes da borda)
ALTURAS = (5.0, 10.0, 20.0)


# ----------------------------------------------------------------- métricas
def carregar(nome):
    caminho = os.path.join(VER, nome)
    if not os.path.exists(caminho):
        return None
    r = np.load(caminho)
    return {k: r[k] for k in r.files}


def U_acima(r, u, w, s0, alt):
    """|U| médio a 'alt' metros acima do chão local, na coluna mais próxima de s0."""
    s, z = r["s"], r["z"]
    i = np.argmin(np.abs(s - s0))
    h = max(perfil(s[i]), 0.0)
    U = np.hypot(np.nan_to_num(u[:, i]), np.nan_to_num(w[:, i]))
    return np.interp(h + alt, z, U)


def metricas(r, u=None, w=None):
    u = r["u"] if u is None else u
    w = r["w"] if w is None else w
    s, z = r["s"], r["z"]
    m = {}
    m["U_mar_10m"] = U_acima(r, u, w, S_REF, 10.0)
    for alt in ALTURAS:
        U0 = U_acima(r, u, w, S_REF, alt)
        sel = s[(s > -5) & (s < 60)]
        dS = np.array([U_acima(r, u, w, si, alt) / U0 - 1 for si in sel])
        m[f"dS_{alt:g}m"] = dS.max()
        m[f"s_dS_{alt:g}m"] = sel[np.argmax(dS)]
    # bolha: u médio < 0 a 1 m do chão sobre o planalto (mesma altura física em todas as grades)
    neg = []
    for i, si in enumerate(s):
        if -2 < si < 150:
            h = perfil(si)
            neg.append((si, np.interp(h + 1.0, z, np.nan_to_num(u[:, i]))))
    neg = [si for si, ui in neg if ui < 0]
    m["bolha_ini"] = min(neg) if neg else np.nan
    m["bolha_fim"] = max(neg) if neg else np.nan
    m["bolha_L_H"] = (m["bolha_fim"] - m["bolha_ini"]) / ALTURA_FALESIA if neg else 0.0
    if "cp" in r and u is r["u"]:
        cps = []
        for i, si in enumerate(s):
            if -15 < si < 30:
                h = perfil(si)
                cps.append(np.nanmin(np.where((z > h + 2) & (z < h + 15), r["cp"][:, i], np.nan)))
        m["Cp_min_2a15m"] = np.nanmin(cps)
    return m


def vazao(r):
    """Q(s) = Σ u Δz nas células fluidas (média temporal), normalizada pela da entrada."""
    u = np.nan_to_num(r["u"])
    dx = float(r["dx"])
    Q = u.sum(axis=0) * dx
    return r["s"], Q / Q[3]


def gci(f1, f2, f3, r=2.0):
    """f1 = malha fina, f3 = grossa. Devolve ordem p, valor extrapolado e GCI da malha fina."""
    e21 = f2 - f1
    e32 = f3 - f2
    if e21 == 0 or e32 == 0 or np.sign(e21) != np.sign(e32):
        return np.nan, np.nan, 1.25 * abs(e21) / abs(f1) if f1 else np.nan  # convergência oscilatória
    p = np.log(abs(e32 / e21)) / np.log(r)
    ext = f1 + (f1 - f2) / (r ** p - 1)
    return p, ext, 1.25 * abs(e21 / f1) / (r ** p - 1)


# ----------------------------------------------------------------- Eurocode (EN 1991-1-4, A.3)
def s_eurocode(X, z, Lu, Le):
    """Fator de localização orográfica s para falésias e escarpas (Figura A.2)."""
    zl = np.clip(z / Le, 0.1, None)  # z/Le < 0,1 -> usa 0,1
    if z / Le > 2.0:
        return 0.0
    if X < 0:  # barlavento, expressões A.4–A.6
        if X / Lu < -1.5:
            return 0.0
        A = 0.1552 * zl ** 4 - 0.8575 * zl ** 3 + 1.8133 * zl ** 2 - 1.9115 * zl + 1.0124
        B = 0.3542 * zl ** 2 - 1.0577 * zl + 2.6456
        return A * np.exp(B * X / Lu)
    if X / Le > 3.5:
        return 0.0
    L = np.log10(zl)
    A = -1.3420 * L ** 3 - 0.8222 * L ** 2 + 0.4609 * L - 0.0791  # (A.8)
    B = -1.0196 * L ** 3 - 0.8910 * L ** 2 + 0.5343 * L - 0.1156  # (A.9)
    C = 0.8030 * L ** 3 + 0.4236 * L ** 2 - 0.5738 * L + 0.1606  # (A.10)
    if X / Le < 0.1:  # interpola entre X = 0 (s = A da expressão A.5) e X/Le = 0,1
        A5 = 0.1552 * zl ** 4 - 0.8575 * zl ** 3 + 1.8133 * zl ** 2 - 1.9115 * zl + 1.0124
        s01 = A * 1.0 + B * (-1.0) + C
        return A5 + (s01 - A5) * (X / Le) / 0.1
    lx = np.log10(X / Le)
    return max(A * lx ** 2 + B * lx + C, 0.0)  # (A.7)


def parametros_eurocode():
    """H, Lu, Φ e Le a partir do perfil: Lu = extensão horizontal da face entre 5 % e 95 % de H."""
    s = np.linspace(-80, 0, 8001)
    h = perfil(s)
    H = ALTURA_FALESIA
    s5 = s[np.argmax(h > 0.05 * H)]
    s95 = s[np.argmax(h > 0.95 * H)]
    Lu = s95 - s5
    phi = H / Lu
    Le = Lu if phi < 0.3 else H / 0.3
    return H, Lu, phi, Le, s95


def main():
    malhas = {"2 m": carregar("malha_2m.npz"), "1 m": carregar("malha_1m.npz"), "0,5 m": carregar("malha_05m.npz")}
    malhas = {k: v for k, v in malhas.items() if v is not None}
    relatorio = {}

    # ---- V2 convergência de malha
    print("== V2. Convergência de malha ==")
    tab = {k: metricas(r) for k, r in malhas.items()}
    chaves = ["U_mar_10m", "dS_5m", "dS_10m", "dS_20m", "bolha_L_H", "Cp_min_2a15m"]
    print(f"{'métrica':16s}" + "".join(f"{k:>10s}" for k in tab) + "     p    GCI_fina")
    relatorio["malha"] = {}
    for c in chaves:
        vals = [tab[k].get(c, np.nan) for k in tab]
        linha = f"{c:16s}" + "".join(f"{v:10.3f}" for v in vals)
        res = {"valores": dict(zip(tab, map(float, vals)))}
        if len(vals) == 3:
            p, ext, g = gci(vals[2], vals[1], vals[0])
            linha += f"  {p:5.2f}  {g:7.1%}"
            res.update(p=float(p), extrapolado=float(ext), gci=float(g))
        print(linha)
        relatorio["malha"][c] = res

    # ---- V3 convergência estatística (malha de 1 m, janela longa)
    if "1 m" in malhas and "u_metade1" in malhas["1 m"]:
        r = malhas["1 m"]
        m1 = metricas(r, r["u_metade1"], r["w_metade1"])
        m2 = metricas(r, r["u_metade2"], r["w_metade2"])
        print(f"== V3. Convergência estatística (1 m, duas metades de {float(r['t_media']) / 2:.0f} s) ==")
        relatorio["estatistica"] = {}
        for c in chaves[:-1]:
            dif = abs(m1[c] - m2[c]) / max(abs(0.5 * (m1[c] + m2[c])), 1e-9)
            print(f"  {c:14s} metade 1 = {m1[c]:7.3f}   metade 2 = {m2[c]:7.3f}   diferença = {dif:.1%}")
            relatorio["estatistica"][c] = {"metade1": float(m1[c]), "metade2": float(m2[c]), "dif_rel": float(dif)}

    # ---- V4 massa
    print("== V4. Conservação de massa (vazão média normalizada pela entrada) ==")
    fig, ax = plt.subplots(figsize=(7, 2.8), dpi=130)
    relatorio["massa"] = {}
    for k, r in malhas.items():
        s, Q = vazao(r)
        sel = (s > -240) & (s < 260)  # fora da esponja de saída
        dev = np.max(np.abs(Q[sel] - 1))
        print(f"  {k}: desvio máximo de Q(s) = {dev:.2%}")
        relatorio["massa"][k] = float(dev)
        ax.plot(s, (Q - 1) * 100, label=f"Δx = {k}")
    ax.axvspan(270, 350, color="0.9", label="camada esponja")
    ax.set_xlabel("s (m)")
    ax.set_ylabel("(Q − Q_entrada)/Q_entrada (%)")
    ax.set_title("Conservação de massa: vazão média ao longo do domínio")
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, "7_massa.png"))
    plt.close(fig)

    # ---- figura de convergência de malha: perfis
    estacoes = [-120, 0, 20, 80]
    fig, axs = plt.subplots(1, len(estacoes), figsize=(11, 3.8), dpi=130, sharey=True)
    for ax, st in zip(axs, estacoes):
        for k, r in malhas.items():
            i = np.argmin(np.abs(r["s"] - st))
            h = max(perfil(r["s"][i]), 0)
            ok = (r["z"] > h) & (r["z"] < h + 40)
            ax.plot(r["u"][ok, i], r["z"][ok] - h, label=f"Δx = {k}")
        ax.set_title(f"s = {st} m")
        ax.set_xlabel("u (m/s)")
        ax.axvline(0, color="0.8", lw=0.6)
    axs[0].set_ylabel("altura acima do chão (m)")
    axs[0].legend(fontsize=7)
    fig.suptitle("Convergência de malha: perfis médios u(z)")
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, "8_malha.png"))
    plt.close(fig)

    # ---- V5 Eurocode
    H, Lu, phi, Le, s_crista = parametros_eurocode()
    print(f"== V5. Eurocode EN 1991-1-4 A.3: H = {H:.0f} m, Lu = {Lu:.1f} m, Φ = {phi:.2f} (> 0,3: c_o = 1 + 0,6 s), Le = {Le:.0f} m ==")
    fig, axs = plt.subplots(1, len(ALTURAS), figsize=(12, 3.6), dpi=130, sharey=True)
    relatorio["eurocode"] = {"H": H, "Lu": float(Lu), "phi": float(phi), "Le": float(Le), "alturas": {}}
    for ax, alt in zip(axs, ALTURAS):
        X = np.linspace(-1.5 * Lu, 3.5 * Le, 400)
        co = np.array([1 + 0.6 * s_eurocode(x, alt, Lu, Le) for x in X])
        ax.plot(X, co, "k-", lw=2, label="Eurocode (c_o)")
        for k, r in malhas.items():
            U0 = U_acima(r, r["u"], r["w"], S_REF, alt)
            ss = r["s"][(r["s"] > X[0] + s_crista) & (r["s"] < X[-1] + s_crista)]
            cfd = [U_acima(r, r["u"], r["w"], si, alt) / U0 for si in ss]
            ax.plot(ss - s_crista, cfd, lw=1, label=f"CFD Δx = {k}")
            if k == list(malhas)[-1]:
                co_max = co.max()
                cfd_max = max(cfd)
                x_cfd = (ss - s_crista)[int(np.argmax(cfd))]
                relatorio["eurocode"]["alturas"][f"{alt:g}"] = {
                    "co_max": float(co_max), "x_co_max": float(X[np.argmax(co)]),
                    "cfd_max": float(cfd_max), "x_cfd_max": float(x_cfd),
                    "dif_pico": float((cfd_max - co_max) / co_max)}
                print(f"  z = {alt:4.0f} m: c_o máx = {co_max:.3f} (X = {X[np.argmax(co)]:5.1f} m)   "
                      f"CFD máx = {cfd_max:.3f} (X = {x_cfd:5.1f} m)   diferença = {(cfd_max - co_max) / co_max:+.1%}")
        ax.axhline(1, color="0.8", lw=0.6)
        ax.axvline(0, color="0.8", lw=0.6, ls=":")
        ax.set_title(f"{alt:g} m acima do chão")
        ax.set_xlabel("X, distância à crista (m)")
    axs[0].set_ylabel("U / U_mar  ou  c_o")
    axs[0].legend(fontsize=7)
    fig.suptitle("Validação: fator de aceleração do CFD × coeficiente orográfico do Eurocode 1 (EN 1991-1-4, A.3)")
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, "9_eurocode.png"))
    plt.close(fig)

    with open(os.path.join(VER, "relatorio.json"), "w", encoding="utf-8") as fo:
        json.dump(relatorio, fo, indent=1, ensure_ascii=False)
    print("relatório:", os.path.join(VER, "relatorio.json"))


if __name__ == "__main__":
    main()
