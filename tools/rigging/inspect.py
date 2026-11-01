import bpy,sys,math,mathutils
w=sys.argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
for n in ['trooper','blaster']:
    bpy.ops.import_scene.gltf(filepath=f'{w}/{n}_dq.glb')
    o=bpy.context.selected_objects[0]; o.name=n
    bb=[o.matrix_world@mathutils.Vector(c) for c in o.bound_box]
    print(n,len(o.data.vertices),len(o.data.polygons),[round(min(v[i] for v in bb),3) for i in range(3)],[round(max(v[i] for v in bb),3) for i in range(3)], o.rotation_euler[:], o.scale[:])
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/raw.blend')
