"""
Monta uma sequência de imagens num MP4 (H.264) usando o editor de vídeo do Blender.

    blender -b --python video/montar_blender.py -- <pasta_quadros> <saida.mp4> <fps> <largura> <altura>
"""

import os
import sys

import bpy

pasta, saida, fps, largura, altura = sys.argv[sys.argv.index("--") + 1:]
fps, largura, altura = int(fps), int(largura), int(altura)
arquivos = sorted(f for f in os.listdir(pasta) if f.lower().endswith((".jpg", ".png")))

cena = bpy.context.scene
cena.sequence_editor_create()
faixa = cena.sequence_editor.strips.new_image("quadros", os.path.join(pasta, arquivos[0]), 1, 1)
for nome in arquivos[1:]:
    faixa.elements.append(nome)

cena.frame_start = 1
cena.frame_end = len(arquivos)
r = cena.render
r.fps = fps
r.resolution_x = largura
r.resolution_y = altura
r.resolution_percentage = 100
# sem transformação de cor: o vídeo sai igual aos quadros
cena.view_settings.view_transform = "Standard"
cena.view_settings.look = "None"
r.image_settings.file_format = "FFMPEG"
r.ffmpeg.format = "MPEG4"
r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "HIGH"
r.ffmpeg.ffmpeg_preset = "GOOD"
r.ffmpeg.gopsize = fps
r.ffmpeg.audio_codec = "NONE"
r.filepath = saida
bpy.ops.render.render(animation=True)
print("salvo:", saida)
