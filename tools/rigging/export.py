# Export: Unreal FBX (skeletal mesh + one FBX per animation), SM_Blaster static mesh, web GLB with all clips
import bpy,sys,os,json,math
from mathutils import Matrix as M, Vector as V
w=sys.argv[-2]; out=sys.argv[-1]; os.makedirs(out+'/Unreal/Animations',exist_ok=True); os.makedirs(out+'/Web',exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=f'{w}/anim.blend')
sc=bpy.context.scene; ao=bpy.data.objects['Armature']; t=bpy.data.objects['SK_Trooper']; g=bpy.data.objects['SK_Trooper_Blaster']
for m,nm in ((t,'MI_Trooper'),(g,'MI_Blaster')):
    for s in m.material_slots: s.material.name=nm
for img in bpy.data.images:
    if img.name.startswith(('Color_','ORM_','NormalGL_')):
        kind=img.name.split('_')[0]; owner='Trooper' if '28493' in img.name else 'Blaster'
        img.name=f'T_{owner}_{ {"Color":"BaseColor","ORM":"ORM","NormalGL":"Normal_OpenGL"}[kind]}'
os.makedirs(out+'/Unreal/Textures',exist_ok=True); TEX={}
for img in bpy.data.images:
    if img.name.startswith('T_') and img.packed_file:
        data=img.packed_file.data; ext='.png' if data[:4]==b'\x89PNG' else '.jpg'
        fp=f'{out}/Unreal/Textures/{img.name}{ext}'; open(fp,'wb').write(data); TEX[img.name]=os.path.basename(fp)
json.dump(TEX,open(f'{out}/Unreal/Textures/textures.json','w'),indent=1); print('textures',TEX)
def sel(objs):
    for o in sc.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
ao.animation_data.action=None
for pb in ao.pose.bones: pb.location=(0,0,0); pb.rotation_quaternion=(1,0,0,0)
# mute constraints for the bind pose export so the mesh exports in its true rest pose
cons=[c for pb in ao.pose.bones for c in pb.constraints]
for c in cons: c.mute=True
sc.frame_set(0)
common=dict(use_selection=True,apply_scale_options='FBX_SCALE_ALL',axis_forward='-Z',axis_up='Y',add_leaf_bones=False,use_armature_deform_only=True,
            primary_bone_axis='Y',secondary_bone_axis='X',armature_nodetype='NULL')
sel([ao,t,g])
bpy.ops.export_scene.fbx(filepath=f'{out}/Unreal/SK_Trooper.fbx',object_types={'ARMATURE','MESH'},mesh_smooth_type='FACE',use_tspace=True,
    path_mode='STRIP',embed_textures=False,bake_anim=False,**common)
for c in cons: c.mute=False
stats=json.load(open(f'{w}/anim_stats.json'))
for act in bpy.data.actions:
    ao.animation_data.action=act; f0,f1=act.frame_range; sc.frame_start=int(f0); sc.frame_end=int(f1)
    sel([ao])
    bpy.ops.export_scene.fbx(filepath=f'{out}/Unreal/Animations/A_Trooper_{act.name}.fbx',object_types={'ARMATURE'},bake_anim=True,bake_anim_use_all_actions=False,
        bake_anim_use_nla_strips=False,bake_anim_force_startend_keying=True,bake_anim_simplify_factor=0.0,bake_anim_step=1.0,**common)
ao.animation_data.action=None
# static blaster: grip at origin, muzzle along +X, up +Z (Unreal weapon convention after FBX conversion)
G=json.load(open(f'{w}/gun.json')); gun=M(G['gun_world'])
gs=g.copy(); gs.data=g.data.copy(); gs.name='SM_Blaster'; sc.collection.objects.link(gs); gs.parent=None; gs.modifiers.clear(); gs.vertex_groups.clear()
grip=V(G['grip_src'])
# world -> gun frame (X lateral, Y barrel, Z up, origin at grip) -> X barrel
to_gun=(gun@M.Translation(grip)).inverted()
swap=M(((0,1,0,0),(-1,0,0,0),(0,0,1,0),(0,0,0,1)))   # gun Y(barrel)->X, gun X->-Y
gs.data.transform(swap@to_gun); gs.matrix_world=M.Identity(4)
sel([gs])
bpy.ops.export_scene.fbx(filepath=f'{out}/Unreal/SM_Blaster.fbx',object_types={'MESH'},mesh_smooth_type='FACE',path_mode='STRIP',embed_textures=False,bake_anim=False,
    use_selection=True,apply_scale_options='FBX_SCALE_ALL',axis_forward='-Z',axis_up='Y')
bb=[v.co for v in gs.data.vertices]; print('SM_Blaster extents',[ (round(min(c[i] for c in bb),3),round(max(c[i] for c in bb),3)) for i in range(3)])
bpy.data.objects.remove(gs)
# ---- web GLB: 2K textures, all clips ----
for img in bpy.data.images:
    if img.name.startswith('T_') and img.size[0]>2048:
        img.scale(2048 if 'BaseColor' in img.name or ('Normal' in img.name and 'Trooper' in img.name) else 1024, 2048 if 'BaseColor' in img.name or ('Normal' in img.name and 'Trooper' in img.name) else 1024)
# NLA-free: export each action as a glTF animation
for act in bpy.data.actions: act.use_fake_user=True
sel([ao,t,g])
bpy.ops.export_scene.gltf(filepath=f'{out}/Web/trooper.glb',export_format='GLB',use_selection=True,export_def_bones=True,export_animations=True,
    export_animation_mode='ACTIONS',export_force_sampling=True,export_frame_step=1,export_image_format='JPEG',export_jpeg_quality=82,export_apply=False,
    export_skins=True,export_yup=True,export_optimize_animation_size=True)
print('done')
