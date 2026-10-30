"""
Gera os modelos da cena por script (Blender 4.5, modo background) e exporta .glb.

    blender -b --python blender/gerar_modelos.py -- public/models

Modelos:
- bicicleta.glb : bicicleta urbana (quadro de aço pintado, aros cromados,
                  32 raios por roda, selim e manoplas de couro, bagageiro com bolsa)

Convenções: metros, a bicicleta aponta para +X e o chão é z = 0.
(o exportador glTF converte para o sistema do Three.js: +Y para cima.)
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

# ----------------------------------------------------------------- utilidades


def limpar_cena():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for col in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for item in list(col):
            col.remove(item)


def material(nome, cor, metal=0.0, rugosidade=0.5, clearcoat=0.0):
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*cor, 1.0)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rugosidade
    if clearcoat:
        p.inputs["Coat Weight"].default_value = clearcoat
    return m


def finalizar(obj, mat, suave=True):
    obj.data.materials.append(mat)
    if suave:
        for pol in obj.data.polygons:
            pol.use_smooth = True
    return obj


def tubo(p1, p2, raio, mat, nome="tubo", lados=14):
    """Cilindro ligando dois pontos."""
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(vertices=lados, radius=raio, depth=d.length, location=(p1 + p2) / 2)
    o = bpy.context.object
    o.name = nome
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return finalizar(o, mat)


def esfera(c, raio, mat, nome="esfera", escala=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=raio, location=c)
    o = bpy.context.object
    o.name = nome
    o.scale = escala
    return finalizar(o, mat)


def toro(c, R, r, mat, nome="toro", eixo="Y", seg=64, seg_menor=12):
    rot = (math.pi / 2, 0, 0) if eixo == "Y" else (0, 0, 0)
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg,
                                     minor_segments=seg_menor, location=c, rotation=rot)
    o = bpy.context.object
    o.name = nome
    return finalizar(o, mat)


def caixa(c, tam, mat, nome="caixa", bisel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.object
    o.name = nome
    o.scale = tam
    bpy.ops.object.transform_apply(scale=True)
    if bisel:
        mod = o.modifiers.new("bisel", "BEVEL")
        mod.width = bisel
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finalizar(o, mat)


# ----------------------------------------------------------------- bicicleta


def roda(centro, nome, m):
    cx, cy, cz = centro
    partes = [
        toro(centro, 0.333, 0.019, m["pneu"], nome + "_pneu", seg=72, seg_menor=14),
        toro(centro, 0.312, 0.009, m["cromo"], nome + "_aro", seg=72, seg_menor=8),
    ]
    partes.append(tubo((cx, cy - 0.045, cz), (cx, cy + 0.045, cz), 0.022, m["cromo"], nome + "_cubo"))
    # 32 raios cruzados, alternando os flanges do cubo
    for i in range(32):
        a = 2 * math.pi * i / 32
        lado = 0.032 if i % 2 == 0 else -0.032
        a_cubo = a + (0.35 if i % 4 < 2 else -0.35)
        p_cubo = (cx + 0.024 * math.cos(a_cubo), cy + lado, cz + 0.024 * math.sin(a_cubo))
        p_aro = (cx + 0.305 * math.cos(a), cy, cz + 0.305 * math.sin(a))
        partes.append(tubo(p_cubo, p_aro, 0.0011, m["raio"], nome + "_raio", lados=4))
    return partes


def bicicleta():
    m = {
        "quadro": material("tinta_quadro", (0.30, 0.52, 0.56), metal=0.3, rugosidade=0.32, clearcoat=0.6),
        "cromo": material("cromo", (0.82, 0.83, 0.85), metal=1.0, rugosidade=0.18),
        "raio": material("aco_raio", (0.75, 0.76, 0.78), metal=1.0, rugosidade=0.3),
        "pneu": material("borracha", (0.035, 0.033, 0.03), rugosidade=0.85),
        "couro": material("couro", (0.30, 0.16, 0.08), rugosidade=0.55),
        "lona": material("lona", (0.36, 0.27, 0.18), rugosidade=0.9),
        "preto": material("preto_fosco", (0.04, 0.04, 0.045), metal=0.4, rugosidade=0.5),
    }
    R = 0.352  # raio da roda com pneu (aro 700c)
    traseira = (-0.53, 0.0, R)
    dianteira = (0.53, 0.0, R)
    mov = (0.0, 0.0, 0.29)           # movimento central
    selim_t = (-0.13, 0.0, 0.80)     # topo do tubo do selim
    caixa_dir_alto = (0.40, 0.0, 0.84)
    caixa_dir_baixo = (0.44, 0.0, 0.68)

    p = []
    p += roda(traseira, "roda_tras", m)
    p += roda(dianteira, "roda_frente", m)

    q = m["quadro"]
    p.append(tubo(mov, selim_t, 0.016, q, "tubo_selim"))
    p.append(tubo(selim_t, caixa_dir_alto, 0.014, q, "tubo_superior"))
    p.append(tubo(mov, caixa_dir_baixo, 0.018, q, "tubo_inferior"))
    p.append(tubo(caixa_dir_baixo, caixa_dir_alto, 0.019, q, "caixa_direcao"))
    for y in (-0.055, 0.055):
        p.append(tubo(mov, (traseira[0], y, traseira[2]), 0.009, q, "chainstay"))
        p.append(tubo((selim_t[0] + 0.01, 0, selim_t[2] - 0.03), (traseira[0], y, traseira[2]), 0.008, q, "seatstay"))
        # garfo levemente curvado: dois segmentos
        meio = (0.50, y * 0.9, 0.50)
        p.append(tubo((caixa_dir_baixo[0], y * 0.6, caixa_dir_baixo[2]), meio, 0.011, q, "garfo"))
        p.append(tubo(meio, (dianteira[0], y, dianteira[2]), 0.009, q, "garfo"))

    # guidão tipo "swept back" com manoplas de couro
    topo_mesa = (0.385, 0.0, 0.97)
    p.append(tubo(caixa_dir_alto, topo_mesa, 0.012, m["cromo"], "mesa"))
    for s in (-1, 1):
        a = (topo_mesa[0] + 0.02, 0.0, topo_mesa[2])
        b = (topo_mesa[0] + 0.03, s * 0.20, topo_mesa[2] + 0.01)
        c = (topo_mesa[0] - 0.12, s * 0.29, topo_mesa[2] + 0.02)
        p.append(tubo(a, b, 0.011, m["cromo"], "guidao"))
        p.append(tubo(b, c, 0.011, m["cromo"], "guidao"))
        d = (c[0] - 0.11, s * 0.30, c[2] - 0.005)
        p.append(tubo(c, d, 0.017, m["couro"], "manopla"))

    # canote e selim de couro (forma de gota achatada)
    topo_canote = (-0.155, 0.0, 0.90)
    p.append(tubo(selim_t, topo_canote, 0.012, m["cromo"], "canote"))
    p.append(esfera((-0.13, 0.0, 0.925), 0.13, m["couro"], "selim", escala=(1.0, 0.55, 0.22)))
    p.append(esfera((-0.02, 0.0, 0.925), 0.07, m["couro"], "selim_bico", escala=(1.2, 0.45, 0.3)))

    # transmissão
    p.append(toro((0.0, 0.07, 0.29), 0.095, 0.006, m["cromo"], "coroa", seg=48, seg_menor=6))
    for s, ang in ((1, 0.6), (-1, 0.6 + math.pi)):
        pe = (0.17 * math.cos(ang), s * 0.085, 0.29 + 0.17 * math.sin(ang))
        p.append(tubo((0, s * 0.075, 0.29), pe, 0.009, m["cromo"], "pedivela"))
        p.append(caixa((pe[0], s * 0.13, pe[2]), (0.09, 0.08, 0.022), m["preto"], "pedal", bisel=0.005))
    p.append(tubo((0.0, 0.07, 0.29 + 0.095), (traseira[0], 0.07, traseira[2] + 0.04), 0.004, m["preto"], "corrente"))
    p.append(tubo((0.0, 0.07, 0.29 - 0.095), (traseira[0], 0.07, traseira[2] - 0.04), 0.004, m["preto"], "corrente"))

    # paralamas: arco de toro achatado (perfil em "C"), recortado no ângulo certo
    for cen, a0, a1, nome in ((traseira, 0.1, 2.5, "paralama_t"), (dianteira, 0.55, 2.95, "paralama_f")):
        o = toro(cen, 0.378, 0.026, q, nome, seg=96, seg_menor=10)
        o.scale = (1.0, 1.0, 1.0)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        fora = []
        for v in bm.verts:
            a = math.atan2(v.co.y, v.co.x)  # toro deitado: o anel está no plano xy local
            a = a % (2 * math.pi)
            if not (a0 <= a <= a1):
                fora.append(v)
            else:
                # achata o perfil: o paralama é largo e fino
                v.co.z *= 1.6
                rr = math.hypot(v.co.x, v.co.y)
                k = 0.378 + (rr - 0.378) * 0.35
                v.co.x *= k / rr
                v.co.y *= k / rr
        bmesh.ops.delete(bm, geom=fora, context="VERTS")
        bm.to_mesh(o.data)
        bm.free()
        p.append(o)

    # bagageiro + bolsa de lona
    alt = 0.74
    for y in (-0.07, 0.07):
        p.append(tubo((-0.30, y, alt), (-0.78, y, alt), 0.006, m["preto"], "bagageiro"))
        p.append(tubo((-0.70, y, alt), (traseira[0], y * 1.1, traseira[2]), 0.006, m["preto"], "bagageiro"))
        p.append(tubo((-0.30, y, alt), (selim_t[0] + 0.02, 0.0, selim_t[2] - 0.06), 0.005, m["preto"], "bagageiro"))
    p.append(caixa((-0.55, 0.0, alt + 0.075), (0.34, 0.24, 0.14), m["lona"], "bolsa", bisel=0.03))
    p.append(tubo((-0.55, -0.125, alt + 0.15), (-0.55, 0.125, alt + 0.15), 0.008, m["couro"], "alca"))

    # descanso lateral (lado esquerdo, +Y): a bicicleta fica estacionada inclinada
    p.append(tubo((-0.06, 0.05, 0.27), (-0.20, 0.17, 0.02), 0.009, m["preto"], "descanso"))
    p.append(esfera((-0.20, 0.17, 0.015), 0.018, m["preto"], "pe_descanso", escala=(1.6, 1.0, 0.5)))

    bpy.ops.object.select_all(action="DESELECT")
    for o in p:
        o.select_set(True)
    bpy.context.view_layer.objects.active = p[0]
    bpy.ops.object.join()
    bike = bpy.context.object
    bike.name = "bicicleta"
    return bike


def exportar(caminho, obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    for filho in obj.children:
        filho.select_set(True)
    bpy.ops.export_scene.gltf(filepath=caminho, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
    print("exportado:", caminho)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    destino = os.path.abspath(argv[0] if argv else "public/models")
    os.makedirs(destino, exist_ok=True)
    limpar_cena()
    exportar(os.path.join(destino, "bicicleta.glb"), bicicleta())


if __name__ == "__main__":
    main()
