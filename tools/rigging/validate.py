import bpy,sys,json,glob,os
o=sys.argv[-1]; R={}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=f'{o}/Unreal/SK_Trooper.fbx')
arm=[x for x in bpy.data.objects if x.type=='ARMATURE'][0]; meshes=[x for x in bpy.data.objects if x.type=='MESH']
R['fbx_bones']=len(arm.data.bones); R['fbx_bone_names_sample']=[b.name for b in arm.data.bones][:12]
R['fbx_meshes']={m.name:dict(tris=sum(len(p.vertices)-2 for p in m.data.polygons),groups=len(m.vertex_groups),mats=[s.material.name for s in m.material_slots]) for m in meshes}
import mathutils
bb=[m.matrix_world@mathutils.Vector(c) for m in meshes for c in m.bound_box]; R['fbx_height_m']=round(max(v.z for v in bb)-min(v.z for v in bb),3)
R['fbx_images']=[(i.name,i.size[:]) for i in bpy.data.images]
R['has_muzzle_socket_bone']='muzzle' in arm.data.bones and 'weapon_r' in arm.data.bones
anims={}
for f in sorted(glob.glob(f'{o}/Unreal/Animations/*.fbx')):
    n0=set(bpy.data.actions.keys()); bpy.ops.import_scene.fbx(filepath=f)
    new=[a for a in bpy.data.actions if a.name not in n0]
    anims[os.path.basename(f)]=dict(actions=len(new),frames=[tuple(map(int,a.frame_range)) for a in new][:1],curves=len(new[0].fcurves) if new else 0)
    for x in [x for x in bpy.data.objects if x.select_get()]: bpy.data.objects.remove(x)
R['fbx_anims']=anims
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=f'{o}/Web/trooper.glb')
R['glb_actions']=sorted(a.name for a in bpy.data.actions); R['glb_objects']=[(x.name,x.type) for x in bpy.data.objects]
json.dump(R,open(f'{o}/validation.json','w'),indent=1)
print(json.dumps({k:v for k,v in R.items() if k!='fbx_anims'},indent=0)[:2500]); print('anims ok',sum(1 for v in anims.values() if v['actions']==1 and v['curves']>100),'/',len(anims))
