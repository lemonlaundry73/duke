# QA for deaths: per clip, over every frame after the limp moment
#   floor: lowest vertex of the evaluated (skinned) mesh, cut variant included -> must not be below the floor
#   self:  deepest overlap between non-adjacent limb capsules (bone segments with radii measured from the mesh)
#   prop:  at the last frame, height of the pelvis and chest (a body propped on nothing would be high)
import bpy, sys, json, math, numpy as np
w = sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=f'{w}/anim.blend')
sc = bpy.context.scene; ao = bpy.data.objects['Armature']; P = ao.pose.bones; T = bpy.data.objects['SK_Trooper']
CV = {c['clip']: c for c in json.load(open(f'{w}/cut_variants.json'))}
RD = {r['clip']: r for r in json.load(open(f'{w}/ragdoll_report.json'))}
import os
if os.environ.get('QA_ALL'):   # living clips too: from frame 0, floor = lowest vertex (incl. root motion), limb overlaps
    for act_ in bpy.data.actions:
        if act_.name not in RD and not act_.get('library') and not act_.name.endswith('__proc'): RD[act_.name] = dict(clip=act_.name, limp_frame=-1, frames=int(act_.frame_range[1]), settled_speed=None)
if os.environ.get('QA_CLIPS'):   # quick check of a few clips
    _keep = set(os.environ['QA_CLIPS'].split(',')); RD = {k: v for k, v in RD.items() if k in _keep}
LIMBS = {'upperarm_l': .055, 'lowerarm_l': .045, 'upperarm_r': .055, 'lowerarm_r': .045, 'thigh_l': .075, 'calf_l': .055, 'thigh_r': .075, 'calf_r': .055,
         'spine_02': .12, 'head': .11}
ADJ = {frozenset(p) for p in [('upperarm_l', 'lowerarm_l'), ('upperarm_r', 'lowerarm_r'), ('thigh_l', 'calf_l'), ('thigh_r', 'calf_r'), ('thigh_l', 'thigh_r'),
       ('spine_02', 'upperarm_l'), ('spine_02', 'upperarm_r'), ('spine_02', 'thigh_l'), ('spine_02', 'thigh_r'), ('spine_02', 'head')]}
me_ = T.data; gidx = {g.name: g.index for g in T.vertex_groups}
hv = [v.co for v in me_.vertices if v.groups and max(v.groups, key=lambda g: g.weight).group == gidx['head']]
HEAD_C = sum(hv, type(hv[0])()) / len(hv)          # helmet centre (rest), carried by the head bone
HEAD_R = sorted((v - HEAD_C).length for v in hv)[int(len(hv) * 0.8)]
HEAD_LOCAL = ao.data.bones['head'].matrix_local.inverted() @ HEAD_C
LIMBS['head'] = HEAD_R
def seg_of(b):
    if b == 'head':
        c = np.array(P['head'].matrix @ HEAD_LOCAL); return c, c
    return np.array(P[b].head), np.array(P[b].tail)
def segd(a0, a1, b0, b1):
    best = 1e9
    for t in np.linspace(0, 1, 9):
        p = a0 + (a1 - a0) * t; ab = b1 - b0; u = np.clip(np.dot(p - b0, ab) / max(np.dot(ab, ab), 1e-9), 0, 1)
        best = min(best, np.linalg.norm(p - (b0 + ab * u)))
    return best
from mathutils.bvhtree import BVHTree
REGS = {'torso': {'pelvis', 'spine_01', 'spine_02', 'spine_03'}, 'head': {'head', 'neck_01'},
        'uarm_l': {'upperarm_l'}, 'uarm_r': {'upperarm_r'}, 'farm_l': {'lowerarm_l', 'hand_l'}, 'farm_r': {'lowerarm_r', 'hand_r'},
        'thigh_l': {'thigh_l'}, 'thigh_r': {'thigh_r'}, 'calf_l': {'calf_l', 'foot_l', 'ball_l'}, 'calf_r': {'calf_r', 'foot_r', 'ball_r'}}
NONADJ = [('torso', 'farm_l'), ('torso', 'farm_r'), ('head', 'farm_l'), ('head', 'farm_r'), ('head', 'uarm_l'), ('head', 'uarm_r'),
          ('farm_l', 'farm_r'), ('farm_l', 'thigh_l'), ('farm_l', 'thigh_r'), ('farm_r', 'thigh_l'), ('farm_r', 'thigh_r'),
          ('farm_l', 'calf_l'), ('farm_l', 'calf_r'), ('farm_r', 'calf_l'), ('farm_r', 'calf_r'),
          ('calf_l', 'calf_r'), ('thigh_l', 'calf_r'), ('thigh_r', 'calf_l'), ('torso', 'calf_l'), ('torso', 'calf_r'), ('uarm_l', 'uarm_r')]
def region_polys(obj):
    gi = {g.index: g.name for g in obj.vertex_groups}
    own = [gi[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in obj.data.vertices]
    out = {}
    for rn, bones in REGS.items():
        out[rn] = [p.vertices[:] for p in obj.data.polygons if all(own[i] in bones for i in p.vertices)]
    return out
RPC = {}
def self_hits(obj, gone):
    if obj.name not in RPC: RPC[obj.name] = region_polys(obj)
    rp = RPC[obj.name]; dg = bpy.context.evaluated_depsgraph_get()
    em = obj.evaluated_get(dg).to_mesh(); co = [v.co.copy() for v in em.vertices]; obj.evaluated_get(dg).to_mesh_clear()
    trees = {}
    res = {}
    for a, b in NONADJ:
        if a in gone or b in gone or not rp[a] or not rp[b]: continue
        for k in (a, b):
            if k not in trees: trees[k] = BVHTree.FromPolygons(co, rp[k])
        res[(a, b)] = len(trees[a].overlap(trees[b]))
    return res
ao.animation_data.action = bpy.data.actions['idle']; sc.frame_set(0)
BASE = self_hits(T, set())     # contacts already present in the sculpt (e.g. hands resting on the armour)
out = {}
for clip, r in RD.items():
    act = bpy.data.actions[clip]; ao.animation_data.action = act; N = int(act.frame_range[1])
    cv = CV.get(clip); sev = set()
    if cv:
        for pn in cv['pieces']:
            pass
    G_ = bpy.data.objects['SK_Trooper_Blaster']
    meshes_before = [T, G_]; meshes_after = ([bpy.data.objects[n] for n in ([cv['remainder']] + cv['pieces'])] + [G_]) if cv else [T, G_]
    floor = 1e9; selfpen = 0.0; worst = None
    for f in range(0, N + 1):   # every frame in order (as the FBX bake evaluates it): hit reaction and ragdoll
        sc.frame_set(f); dg = bpy.context.evaluated_depsgraph_get()
        ms = meshes_after if (cv and f >= cv['frame']) else meshes_before
        for o in ms:
            em = o.evaluated_get(dg).to_mesh(); n = len(em.vertices); c = np.empty(n * 3); em.vertices.foreach_get('co', c)
            z = (np.array(o.matrix_world) @ np.c_[c.reshape(n, 3), np.ones(n)].T)[2]
            floor = min(floor, float(np.percentile(z, 0.05))); o.evaluated_get(dg).to_mesh_clear()
        if f % 2: continue
        gone = set()
        if cv and f >= cv['frame']:
            if clip in ('saber_death_arm', 'death_explosion_armleg'): gone |= {'uarm_r', 'farm_r'}
            if clip == 'death_explosion_arm': gone |= {'uarm_l', 'farm_l'}
            if clip in ('saber_death_leg', 'death_explosion_armleg'): gone |= {'thigh_l', 'calf_l'}
            if clip == 'death_explosion_leg': gone |= {'thigh_r', 'calf_r'}
            if clip == 'saber_death_head': gone |= {'head'}
            if clip == 'saber_death_half': gone |= {'thigh_l', 'calf_l', 'thigh_r', 'calf_r'}
            if clip == 'saber_death_diagonal': gone |= {'head', 'uarm_l', 'uarm_r', 'farm_l', 'farm_r'}
        body = bpy.data.objects[cv['remainder']] if (cv and f >= cv['frame']) else T
        for pair, n_ in self_hits(body, gone).items():
            ex = n_ - BASE.get(pair, 0)
            if ex > selfpen: selfpen = ex; worst = (pair, f)
    sc.frame_set(N)
    pel = P['pelvis'].head.z; chest = ((P['spine_03'].head + P['spine_03'].tail) / 2).z
    out[clip] = dict(lowest_vertex_cm=round(floor * 100, 1), intersecting_tris_over_idle=int(selfpen), worst_pair=worst,
                     final_pelvis_cm=round(pel * 100, 1), final_chest_cm=round(chest * 100, 1), settled_speed=r['settled_speed'])
    print(clip, out[clip])
json.dump(out, open(f'{w}/' + ('body_qa.json' if os.environ.get('QA_ALL') else 'death_qa.json'), 'w'), indent=1)
