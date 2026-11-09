# Unrigged T-pose source (e.g. a Tripo character with no skeleton) -> the same inputs a pre-rigged source gives:
#   raw.blend ('trooper' = the character mesh re-posed into the Duke A-pose, 'blaster' = the weapon) and
#   source_rig.json (joint positions with Tripo joint names, in raw space) so stage1/stage2 place the Duke skeleton.
# Steps: face the pipeline's source direction, scale to 1.83 m, detect joints from the mesh (bare skin marks the
# wrists, hands and fingers), then rotate each arm (shoulder, then elbow) down into the trooper's rest A-pose with
# smooth blend weights, so every clip, grip and ragdoll authored for the trooper fits unchanged.
# character.json: "source_pose": "T", "source_facing": "+X" | "-X" | "+Y" | "-Y" (where the face points in Blender).
import bpy, sys, json, math, os, numpy as np
from mathutils import Vector as V, Matrix as M
w = sys.argv[-1]
CFG = json.load(open(f'{w}/character.json'))
H = CFG.get('height', 1.83)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f'{w}/trooper_dq.glb')
me = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']: bpy.data.objects.remove(o)
mw = me.matrix_world.copy(); me.parent = None; me.data.transform(mw); me.matrix_world.identity(); me.name = 'trooper'
# canonical frame for detection: face -Y, left = +X, feet at z=0, height H
face = CFG.get('source_facing', '+Y')
yaw = {'+X': -math.pi / 2, '-X': math.pi / 2, '+Y': math.pi, '-Y': 0.0}[face]
me.data.transform(M.Rotation(yaw, 4, 'Z'))
n = len(me.data.vertices); co = np.empty(n * 3); me.data.vertices.foreach_get('co', co); co = co.reshape(n, 3)
s = H / (co[:, 2].max() - co[:, 2].min()); co[:, 2] -= co[:, 2].min(); co *= s
co[:, 0] -= (co[:, 0].max() + co[:, 0].min()) / 2
x, y, z = co[:, 0], co[:, 1], co[:, 2]
# skin mask from the base-colour texture (bare hands, face)
def base_color_image(o):
    for m in o.data.materials:
        bsdf = next((nd for nd in m.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED'), None) if m and m.node_tree else None
        if bsdf and bsdf.inputs['Base Color'].links:
            nd = bsdf.inputs['Base Color'].links[0].from_node
            while nd.type != 'TEX_IMAGE' and nd.inputs and any(i.links for i in nd.inputs):
                nd = next(i for i in nd.inputs if i.links).links[0].from_node
            if nd.type == 'TEX_IMAGE': return nd.image
    return next(i for i in bpy.data.images if i.size[0] > 0 and 'normal' not in i.name.lower())
img = base_color_image(me)
Wd, Hd = img.size; px = np.empty(Wd * Hd * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(Hd, Wd, 4)
md = me.data; uvl = np.empty(len(md.loops) * 2, np.float32); md.uv_layers.active.data.foreach_get('uv', uvl); uvl = uvl.reshape(-1, 2)
vi = np.empty(len(md.loops), np.int32); md.loops.foreach_get('vertex_index', vi)
col = px[np.clip((uvl[:, 1] * Hd).astype(int), 0, Hd - 1), np.clip((uvl[:, 0] * Wd).astype(int), 0, Wd - 1), :3]
vc = np.zeros((n, 3)); cnt = np.zeros(n); np.add.at(vc, vi, col); np.add.at(cnt, vi, 1); vc /= np.maximum(cnt, 1)[:, None]
r_, g_, b_ = vc[:, 0], vc[:, 1], vc[:, 2]
skin = (r_ > 0.12) & (r_ > g_ * 1.08) & (g_ > b_ * 1.0) & (r_ - b_ > 0.05)
J = {}
# ---- arms (horizontal along +-X) ----
torso_w = np.percentile(np.abs(x[(z > 1.18) & (z < 1.26) & (np.abs(x) < 0.30)]), 99)
def slab(xc, side, dz=(1.2, 1.7)):
    m = (np.abs(side * x - xc) < 0.008) & (side * x > 0) & (z > dz[0]) & (z < dz[1])
    q = co[m]; return (q.min(0) + q.max(0)) / 2 if len(q) else None
for sd, sg in (('L', 1), ('R', -1)):
    armv = (sg * x > torso_w + 0.03) & (z > 1.15)
    hand = armv & skin & (sg * x > 0.45)
    wx = np.percentile(sg * x[hand], 1.5)          # wrist: where the bare skin starts
    tip = np.percentile(sg * x[hand], 99.8)
    sx = torso_w - 0.035                            # shoulder joint just inside the deltoid
    c_sh = slab(torso_w + 0.06, sg); c_wr = slab(wx - 0.005, sg)
    zc = lambda xx: c_sh[2] + (c_wr[2] - c_sh[2]) * (xx - (torso_w + 0.06)) / ((wx - 0.005) - (torso_w + 0.06))
    yc = lambda xx: c_sh[1] + (c_wr[1] - c_sh[1]) * (xx - (torso_w + 0.06)) / ((wx - 0.005) - (torso_w + 0.06))
    sh = np.array([sg * sx, yc(sx), zc(sx)]); wr = np.array([sg * wx, c_wr[1], c_wr[2]])
    el = sh + (wr - sh) * 0.535; el[1] += 0.012   # elbow slightly behind the arm line
    hl = tip - wx; kn_x = wx + hl * 0.42           # knuckles
    J[f'{sd}_Clavicle'] = [sg * 0.035, sh[1], sh[2] + 0.04]; J[f'{sd}_Upperarm'] = sh.tolist(); J[f'{sd}_Forearm'] = el.tolist(); J[f'{sd}_Hand'] = wr.tolist()
    # fingers: four columns of skin across the hand (palm down: index toward -Y/front, pinky toward +Y/back)
    fm = hand & (sg * x > kn_x + 0.015) & (sg * x < kn_x + 0.04)
    yy = y[fm]; zz = z[fm]
    thumb_cut = np.percentile(yy, 8)
    main = yy > thumb_cut
    lo, hi = np.percentile(yy[main], 3), np.percentile(yy[main], 97)
    edges = np.linspace(lo, hi, 5)
    names = ['Index', 'Mid', 'Ring', 'Pinky']
    for i, nm in enumerate(names):
        mm = main & (yy >= edges[i]) & (yy <= edges[i + 1])
        fy = float(np.median(yy[mm])); fz = float(np.median(zz[mm]))
        L = (tip - kn_x) * (0.92 if nm in ('Mid', 'Ring') else 0.85 if nm == 'Index' else 0.72)
        b0 = np.array([sg * kn_x, fy, fz])
        J[f'{sd}_{nm}1'] = b0.tolist(); J[f'{sd}_{nm}2'] = (b0 + [sg * L * 0.40, 0, -0.003]).tolist(); J[f'{sd}_{nm}3'] = (b0 + [sg * L * 0.70, 0, -0.006]).tolist()
    # thumb: the skin that sticks out toward the front (-Y) between the wrist and the knuckles
    tm = hand & (sg * x < kn_x + 0.02) & (y < np.percentile(y[hand], 6))
    tt = co[tm][np.argmin(y[tm])] if tm.sum() else np.array([sg * (wx + 0.05), wr[1] - 0.06, wr[2] - 0.02])
    t1 = np.array([sg * (wx + 0.022), wr[1] - 0.022, wr[2] - 0.012])
    J[f'{sd}_Thumb1'] = t1.tolist(); J[f'{sd}_Thumb2'] = (t1 + (tt - t1) * 0.45).tolist(); J[f'{sd}_Thumb3'] = (t1 + (tt - t1) * 0.75).tolist()
    # legs
    def legc(zz_, side):
        m = (np.abs(z - zz_) < 0.01) & (side * x > 0.02) & (side * x < 0.30)
        q = co[m]
        # inner leg only: the column nearest the midline (skips a hanging robe panel outside it)
        return (q.min(0) + q.max(0)) / 2
    kn = legc(0.52, sg); an = legc(0.12, sg)
    hip = np.array([sg * 0.095, (kn[1] + 0.0) / 2, 0.925])
    fq = co[(z < 0.05) & (sg * x > 0.02)]
    toe = np.array([an[0], fq[:, 1].min() + 0.055, 0.03])
    J[f'{sd}_Thigh'] = hip.tolist(); J[f'{sd}_Calf'] = [kn[0], kn[1], 0.52]; J[f'{sd}_Foot'] = [an[0], an[1] + 0.01, 0.115]; J[f'{sd}_ToeBase'] = toe.tolist()
# ---- spine and head (trooper proportions, centred on the body; neck from the face skin) ----
face = skin & (np.abs(x) < 0.12) & (z > 1.40)
chin = np.percentile(z[face], 1.0) if face.sum() else 1.56
_t = y[(z > 1.15) & (z < 1.35) & (np.abs(x) < 0.12)]
_k = y[(np.abs(z - 0.52) < 0.01) & (np.abs(x) > 0.02) & (np.abs(x) < 0.3)]
ty = float(0.5 * (_t.min() + _t.max()) / 2 + 0.5 * (_k.min() + _k.max()) / 2)   # bbox centres (mesh density skews a median toward the detailed front)
J['Pelvis'] = [0, ty, 1.012]; J['Waist'] = [0, ty, 1.083]; J['Spine01'] = [0, ty + 0.005, 1.204]; J['Spine02'] = [0, ty + 0.02, 1.34]
J['NeckTwist01'] = [0, ty + 0.025, min(1.50, chin - 0.06)]; J['Head'] = [0, ty + 0.012, min(1.57, chin + 0.01)]
print('torso half width', round(torso_w, 3), 'chin', round(chin, 3), 'skin verts', int(skin.sum()))
# ---- re-pose the arms into the trooper A-pose ----
TRO = CFG.get('apose', {'upperarm': [0.100, 0.022, -0.250], 'lowerarm': [0.059, -0.090, -0.235]})
ev = np.empty(len(md.edges) * 2, np.int32); md.edges.foreach_get('vertices', ev); ev = ev.reshape(-1, 2)
deg = np.bincount(ev.ravel(), minlength=n).astype(float)
def smooth(f, it):
    for _ in range(it):
        acc = np.zeros_like(f); np.add.at(acc, ev[:, 0], f[ev[:, 1]]); np.add.at(acc, ev[:, 1], f[ev[:, 0]])
        f = 0.5 * f + 0.5 * acc / np.maximum(deg, 1)
    return f
def rot_between(a, b):
    a = V(a).normalized(); b = V(b).normalized(); return np.array(a.rotation_difference(b).to_matrix())
def ss(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)
newco = co.copy(); jnew = {k: np.array(v) for k, v in J.items()}
for sd, sg in (('L', 1), ('R', -1)):
    sh = np.array(J[f'{sd}_Upperarm']); el = np.array(J[f'{sd}_Forearm']); wr = np.array(J[f'{sd}_Hand'])
    ua = np.array(TRO['upperarm']) * [sg, 1, 1]; la = np.array(TRO['lowerarm']) * [sg, 1, 1]
    R1 = rot_between(el - sh, ua)
    side = sg * x
    # whole arm from the shoulder: ramp across the deltoid; torso below the armpit never moves
    armpit = sh[2] - 0.07
    # (below the armpit only next to the torso: a sleeve hanging under the arm further out goes with the arm)
    w1 = ss((side - (sg * sh[0] - 0.04)) / 0.09) * np.maximum(ss((z - (armpit - 0.03)) / 0.05), ss((side - (torso_w + 0.04)) / 0.05) * ss((z - 1.20) / 0.04))
    w1 = smooth(w1, 6) * (side > 0.05)
    # forearm from the elbow
    w2 = ss((side - (sg * el[0] - 0.03)) / 0.06) * (side > 0)
    w2 = smooth(w2, 4) * (side > 0.05)
    # apply: elbow rotation first (in T-pose space, about the elbow), then the shoulder rotation
    R2t = rot_between(wr - el, R1.T @ la)          # forearm direction wanted, expressed before R1
    p = newco - el; p2 = (R2t @ p.T).T + el; newco = newco + (p2 - newco) * w2[:, None]
    p = newco - sh; p1 = (R1 @ p.T).T + sh; newco = newco + (p1 - newco) * w1[:, None]
    for k in list(jnew):
        if not k.startswith(sd + '_') or k in (f'{sd}_Clavicle', f'{sd}_Upperarm') or 'Thigh' in k or 'Calf' in k or 'Foot' in k or 'Toe' in k: continue
        q = jnew[k]
        if k != f'{sd}_Forearm': q = R2t @ (q - el) + el
        jnew[k] = R1 @ (q - sh) + sh
# back to the pipeline's raw frame: a pre-rigged source faces +X with its left side at +Y (prep/stage1 turn it to face -Y)
back = np.array(M.Rotation(math.pi / 2, 3, 'Z'))
newco = newco @ back.T
md.vertices.foreach_set('co', newco.ravel()); md.update()
joints = {k: [list(back @ v), list(back @ v)] for k, v in jnew.items()}
vs = newco; bbox = [vs.min(0).tolist(), vs.max(0).tolist()]
json.dump({'joints': joints, 'raw_bbox': bbox, 'from': 'tpose_prep'}, open(f'{w}/source_rig.json', 'w'), indent=1)
# weapon
if os.path.exists(f'{w}/blaster_dq.glb'):
    bpy.ops.import_scene.gltf(filepath=f'{w}/blaster_dq.glb'); g = bpy.context.selected_objects[0]
    for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']: bpy.data.objects.remove(o)
    g = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name != 'trooper'); g.name = 'blaster'
print('joints', len(joints), 'arm L shoulder/elbow/wrist', [np.round(jnew[k], 3).tolist() for k in ('L_Upperarm', 'L_Forearm', 'L_Hand')])
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/raw.blend')
