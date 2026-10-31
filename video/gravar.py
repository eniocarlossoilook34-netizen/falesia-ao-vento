"""
Grava o vídeo de divulgação quadro a quadro.

1. Abre a cena (npm run dev) no Microsoft Edge via Playwright, em modo ?gravar
2. Pede cada quadro com __gravacao.quadro(i) e salva em video/quadros/
3. Monta o MP4 (H.264) no editor de vídeo do Blender, que já traz o ffmpeg

    npm run dev                      # em outro terminal
    python video/gravar.py           # 1080 x 1350 (4:5, formato do feed do LinkedIn)
    python video/gravar.py --largura 1920 --altura 1080
"""

import argparse
import base64
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
BLENDER = r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5174/?gravar&ceu=0.75")
    ap.add_argument("--largura", type=int, default=1080)
    ap.add_argument("--altura", type=int, default=1350)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--so-montar", action="store_true", help="pula a renderização e só monta o MP4")
    ap.add_argument("--teste", type=int, nargs="*", help="só renderiza estes quadros (prévia), sem montar")
    a = ap.parse_args()
    pasta = os.path.join(AQUI, "quadros")
    os.makedirs(pasta, exist_ok=True)

    if not a.so_montar:
        with sync_playwright() as p:
            nav = p.chromium.launch(channel="msedge", headless=True,
                                    args=["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"])
            pag = nav.new_page(viewport={"width": a.largura, "height": a.altura}, device_scale_factor=1)
            pag.on("console", lambda m: m.type == "error" and print("console:", m.text))
            pag.goto(a.url)
            pag.wait_for_function("window.__gravacao !== undefined", timeout=120000)
            print("GPU:", pag.evaluate("""() => { const gl = document.createElement('canvas').getContext('webgl2');
                const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }"""))
            pag.evaluate(f"window.__gravacao.preparar({a.fps})")
            n = int(pag.evaluate("window.__gravacao.duracao") * a.fps)
            t0 = time.time()
            if a.teste:
                # avança até cada quadro pedido (o tempo da simulação precisa passar)
                for i in range(max(a.teste) + 1):
                    url = pag.evaluate(f"window.__gravacao.quadro({i}, {a.fps})")
                    if i in a.teste:
                        with open(os.path.join(AQUI, f"previa_{i:04d}.jpg"), "wb") as f:
                            f.write(base64.b64decode(url.split(",", 1)[1]))
                print(f"prévia pronta em {time.time() - t0:.0f} s")
                nav.close()
                return
            for i in range(n):
                url = pag.evaluate(f"window.__gravacao.quadro({i}, {a.fps})")
                with open(os.path.join(pasta, f"q{i:04d}.jpg"), "wb") as f:
                    f.write(base64.b64decode(url.split(",", 1)[1]))
                if i % 30 == 0:
                    el = time.time() - t0
                    print(f"  quadro {i}/{n}  ({el:.0f} s, faltam ~{el / max(i, 1) * (n - i):.0f} s)", flush=True)
            nav.close()

    saida = os.path.join(AQUI, "falesia_ao_vento.mp4")
    subprocess.run([BLENDER, "-b", "--python", os.path.join(AQUI, "montar_blender.py"), "--",
                    pasta, saida, str(a.fps), str(a.largura), str(a.altura)], check=True,
                   stdout=subprocess.DEVNULL)
    print("vídeo:", saida)


if __name__ == "__main__":
    main()
