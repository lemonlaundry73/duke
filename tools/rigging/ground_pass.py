# Ground pass for living clips: the skinned mesh (and the blaster) never goes below the floor.
# Per frame: if the lowest point belongs to a foot, that foot's IK target is raised; otherwise the pelvis is raised
# (the IK feet stay planted, so a kneeling knee or a rolling back lifts off the floor instead of sinking into it).
# Root motion clips are measured in world space (root included). Deaths are handled by ragdoll.py.
import bpy, sys, json, numpy as np
from mathutils import Matrix as M
w = sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=f'{w}/anim.blend')
sc = bpy.context.scene; ao = bpy.data.objects['Armature']; P = ao.pose.bones; T = bpy.data.objects['SK_Trooper']; G = bpy.data.objects['SK_Trooper_Blaster']
RD = {r['clip'] for r in json.load(open(f'{w}/ragdoll_report.json'))} if __import__('os').path.exists(f'{w}/ragdoll_report.json') else set()
gidx = {g.index: g.name for g in T.vertex_groups}
owner = np.array([gidx[max(v.groups, key=lambda g: g.weight).group] if v.groups else '' for v in T.data.vertices])
FOOT = {'l': np.isin(owner, ['foot_l', 'ball_l']), 'r': np.isin(owner, ['foot_r', 'ball_r'])}
def lowest():
    dg = bpy.context.evaluated_depsgraph_get(); res = []
    for o in (T, G):
        em = o.evaluated_get(dg).to_mesh(); n = len(em.vertices); c = np.empty(n * 3); em.vertices.foreach_get('co', c); c = c.reshape(n, 3)
        z = (np.array(o.matrix_world) @ np.c_[c, np.ones(n)].T)[2]; o.evaluated_get(dg).to_mesh_clear(); res.append(z)
    return res
REPORT = {}
for act in bpy.data.actions:
    if act.name in RD: continue
    ao.animation_data.action = act; N = int(act.frame_range[1]); worst = 0.0
    for f in range(0, N + 1):
        for it in range(8):
            sc.frame_set(f); bpy.context.view_layer.update()
            zt, zg = lowest(); low = min(zt.min(), zg.min())
            if low >= -0.002: break
            dz = 0.002 - low; worst = max(worst, dz)
            i = int(np.argmin(zt)); side = next((s for s in 'lr' if FOOT[s][i]), None) if zt.min() <= zg.min() else None
            if side:
                # lift that foot target only (and only as far as that foot needs)
                need = 0.002 - zt[FOOT[side]].min()
                P[f'ctrl_foot_{side}'].matrix = M.Translation((0, 0, need)) @ P[f'ctrl_foot_{side}'].matrix
                b = f'ctrl_foot_{side}'
            else:
                P['pelvis'].matrix = M.Translation((0, 0, dz)) @ P['pelvis'].matrix; b = 'pelvis'
            bpy.context.view_layer.update()
            P[b].keyframe_insert('location', frame=f, group=b); P[b].keyframe_insert('rotation_quaternion', frame=f, group=b)
    REPORT[act.name] = round(worst * 100, 2)
    if worst > 0: print(act.name, 'max correction cm', round(worst * 100, 1))
ao.animation_data.action = None
json.dump(REPORT, open(f'{w}/ground_pass.json', 'w'), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/anim.blend')
print('GROUND', len(REPORT))
