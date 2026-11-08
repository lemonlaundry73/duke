# Export: Unreal FBX (skeletal mesh + one FBX per animation), SM_Blaster static mesh, web GLB with all clips
import bpy,sys,os,json,math
from mathutils import Matrix as M, Vector as V
w=sys.argv[-2]; out=sys.argv[-1]; os.makedirs(out+'/Unreal/Animations',exist_ok=True); os.makedirs(out+'/Web',exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=f'{w}/anim.blend')
sc=bpy.context.scene; ao=bpy.data.objects['Armature']; t=bpy.data.objects['SK_Trooper']; g=bpy.data.objects['SK_Trooper_Blaster']
for m,nm in ((t,'MI_Trooper'),(g,'MI_Blaster')):
    for s in m.material_slots: s.material.name=nm
def mat_images(o):
    out=[]
    for sl in o.material_slots:
        if sl.material and sl.material.use_nodes:
            for nd in sl.material.node_tree.nodes:
                if nd.type=='TEX_IMAGE' and nd.image: out.append(nd.image)
    return out
def kind_of(img):
    n=img.name.lower()
    if 'normal' in n: return 'Normal_OpenGL'
    if 'orm' in n or 'metal' in n or 'rough' in n: return 'ORM'
    return 'BaseColor'
for o,owner in ((t,'Trooper'),(g,'Blaster')):
    for img in mat_images(o): img.name=f'T_{owner}_{kind_of(img)}'
os.makedirs(out+'/Unreal/Textures',exist_ok=True); TEX={}
# texture policy: cap at 4K (hero weapon/character); larger sources are downscaled once here
for img in list(bpy.data.images):
    if img.name.startswith('T_') and img.size[0]>4096:
        old=img.size[:]; isn='Normal' in img.name
        img.scale(4096,4096); fp=f"{out}/Unreal/Textures/{img.name}{'.png' if isn else '.jpg'}"
        img.filepath_raw=fp; img.file_format='PNG' if isn else 'JPEG'; img.save(); img.pack(); TEX[img.name]=os.path.basename(fp)
        print('downscaled',img.name,old,'-> 4096')
for img in bpy.data.images:
    if img.name.startswith('T_') and img.packed_file and img.name not in TEX:
        data=img.packed_file.data; ext='.png' if data[:4]==b'\x89PNG' else '.jpg'
        fp=f'{out}/Unreal/Textures/{img.name}{ext}'; open(fp,'wb').write(data); TEX[img.name]=os.path.basename(fp)
# a source without an ORM map gets a flat one from its own roughness/metallic factors (R=AO 1, G=roughness, B=metallic)
for owner,o in (('Trooper',t),('Blaster',g)):
    if f'T_{owner}_ORM' not in TEX:
        bsdf=next(n for n in o.material_slots[0].material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        r=bsdf.inputs['Roughness'].default_value; m=bsdf.inputs['Metallic'].default_value
        im=bpy.data.images.new(f'T_{owner}_ORM',64,64,alpha=False); im.pixels=[1.0,r,m,1.0]*(64*64)
        im.filepath_raw=f'{out}/Unreal/Textures/T_{owner}_ORM.png'; im.file_format='PNG'; im.save(); TEX[im.name]=f'T_{owner}_ORM.png'
        print('generated flat ORM for',owner,'roughness',round(r,2),'metallic',round(m,2))
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
# ---- dismemberment variants: one skeletal mesh per ending (same skeleton), swapped in at the cut ----
CV=json.load(open(f'{w}/cut_variants.json')) if os.path.exists(f'{w}/cut_variants.json') else []
if CV:
    os.makedirs(out+'/Unreal/Cuts',exist_ok=True)
    for c in cons: c.mute=True
    ao.animation_data.action=None
    for pb in ao.pose.bones: pb.location=(0,0,0); pb.rotation_quaternion=(1,0,0,0)
    sc.frame_set(0)
    for c in CV:
        objs=[bpy.data.objects[c['remainder']]]+[bpy.data.objects[n] for n in c['pieces']]
        for o in objs: o.hide_viewport=False; o.hide_set(False)
        sel([ao]+objs+[g])
        bpy.ops.export_scene.fbx(filepath=f"{out}/Unreal/Cuts/SK_Trooper_Cut_{c['clip']}.fbx",object_types={'ARMATURE','MESH'},mesh_smooth_type='FACE',
            use_tspace=True,path_mode='STRIP',embed_textures=False,bake_anim=False,**common)
    for c in cons: c.mute=False
    json.dump(CV,open(f'{out}/Unreal/Cuts/cut_variants.json','w'),indent=1)
    print('cut variants exported',len(CV))
# ---- web GLB: 2K textures, all clips ----
for img in bpy.data.images:
    if img.name.startswith('T_') and img.size[0]>2048:
        img.scale(2048 if 'BaseColor' in img.name or ('Normal' in img.name and 'Trooper' in img.name) else 1024, 2048 if 'BaseColor' in img.name or ('Normal' in img.name and 'Trooper' in img.name) else 1024)
# NLA-free: export each action as a glTF animation
for act in bpy.data.actions: act.use_fake_user=True
web=[ao,t,g]
# variants for the web preview are decimated copies (the Unreal FBXs above stay full resolution)
for c in CV:
    for n in [c['remainder']]+c['pieces']:
        o=bpy.data.objects[n]; o.hide_viewport=False; o.hide_set(False)
        dm=o.modifiers.new('webdec','DECIMATE'); dm.ratio=0.3 if n==c['remainder'] else 0.5
        bpy.context.view_layer.objects.active=o
        while o.modifiers[0].name!='webdec': bpy.ops.object.modifier_move_up(modifier='webdec')
        bpy.ops.object.modifier_apply(modifier='webdec')
        web.append(o)
sel(web)
bpy.ops.export_scene.gltf(filepath=f'{out}/Web/trooper.glb',export_format='GLB',use_selection=True,export_def_bones=True,export_animations=True,
    export_animation_mode='ACTIONS',export_force_sampling=True,export_frame_step=1,export_image_format='JPEG',export_jpeg_quality=82,export_apply=False,
    export_skins=True,export_yup=True,export_optimize_animation_size=True)
print('done')
