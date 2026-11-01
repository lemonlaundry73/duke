import bpy,sys,math,mathutils,time
w=sys.argv[1]
bpy.ops.wm.open_mainfile(filepath=f'{w}/raw.blend')
def fit(o,height,rotz):
    o.rotation_euler=(0,0,rotz); bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    vs=[v.co for v in o.data.vertices]
    mn=mathutils.Vector([min(v[i] for v in vs) for i in range(3)]); mx=mathutils.Vector([max(v[i] for v in vs) for i in range(3)])
    s=height/(mx.z-mn.z) if height else 1
    o.scale=(s,s,s); o.location=(-(mn.x+mx.x)/2*s,-(mn.y+mx.y)/2*s,-mn.z*s)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
t=bpy.data.objects['trooper']; fit(t,1.83,-math.pi/2)
for o in [t]:
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=0.0002); bpy.ops.object.mode_set(mode='OBJECT')
    print('after merge',len(o.data.polygons))
    m=o.modifiers.new('dec','DECIMATE'); m.ratio=85000/len(o.data.polygons); m.use_collapse_triangulate=True
    t0=time.time(); bpy.ops.object.modifier_apply(modifier='dec'); print('decimated',len(o.data.polygons),time.time()-t0)
    bpy.ops.object.shade_smooth()
b=bpy.data.objects['blaster']
print('blaster bbox', [ (min(v.co[i] for v in b.data.vertices), max(v.co[i] for v in b.data.vertices)) for i in range(3)])
for img in bpy.data.images: print(img.name,img.size[:])
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/prep.blend')
