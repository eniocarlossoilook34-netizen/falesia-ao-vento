"""
Geometria compartilhada entre o CFD e a cena 3D.

A falésia é descrita por um PERFIL h(s): altura do terreno (m) em função de s,
a distância horizontal (m) até a borda da falésia, medida na direção do vento.
    s < 0  -> lado do mar (face da falésia, praia, mar)
    s = 0  -> borda (crista) da falésia
    s > 0  -> planalto gramado (onde está a ciclista)

O solver usa h(s) para marcar as células sólidas; a cena 3D usa exatamente a
mesma tabela (public/dados/perfil.json) para levantar o terreno. Assim cada
ponto da cena sabe em que ponto do corte CFD ele está.
"""

import numpy as np

ALTURA_FALESIA = 30.0  # m, altura da borda acima do nível do mar
S_PRAIA = -52.0        # m, onde a areia encontra a água (h = 0)


def perfil(s):
    """Altura do terreno h(s) em metros (vetorizada)."""
    s = np.asarray(s, dtype=float)
    H = ALTURA_FALESIA

    # face da falésia: tangente hiperbólica centrada 14 m antes da borda.
    # inclinação máxima ~ H/(2*7) ≈ 2,1 -> cerca de 65°, típico de falésia de arenito com grama
    face = 0.5 + 0.5 * np.tanh((s + 14.0) / 7.0)

    # praia: rampa suave de areia entre o mar e o pé da falésia (declive ~ 1:12)
    praia = np.clip((s - S_PRAIA) / 12.0, 0.0, None) * (1.0 - face)
    praia = np.minimum(praia, 2.2)

    # planalto: sobe devagar terra adentro (2 %) com uma ondulação leve
    planalto = np.where(s > 0, 0.02 * s + 1.2 * np.sin(np.clip(s, 0, None) / 45.0) ** 2, 0.0)

    h = H * face + praia * (1.0 - face) + planalto * face
    # abaixo do nível do mar o fundo continua descendo (só importa para o CFD: o mar é parede)
    return np.where(s < S_PRAIA, (s - S_PRAIA) * 0.05, h)


def exportar_json(caminho, s0=-260.0, s1=360.0, ds=0.25):
    """Grava a tabela h(s) usada pela cena 3D."""
    import json

    s = np.arange(s0, s1 + ds / 2, ds)
    dados = {
        "descricao": "perfil da falesia h(s); s = distancia a borda (m), positivo terra adentro",
        "s0": s0,
        "ds": ds,
        "alturaFalesia": ALTURA_FALESIA,
        "sPraia": S_PRAIA,
        "h": [round(float(v), 3) for v in perfil(s)],
    }
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(dados, f)


if __name__ == "__main__":
    import sys

    destino = sys.argv[1] if len(sys.argv) > 1 else "../public/dados/perfil.json"
    exportar_json(destino)
    print("perfil exportado para", destino)
