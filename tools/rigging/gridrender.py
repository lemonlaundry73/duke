# usage: blend obj view(front|right|left|back|top) cx cz half out [res] [samples] [focusY]
import bpy,sys,math,mathutils,numpy as np
a=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
blend,obj,view=a[0],a[1],a[2]; cx,cz,half=map(float,a[3:6]); out=a[6]; res=int(a[7]) if len(a)>7 else 768
bpy.ops.wm.open_mainfile(filepath=blend)
sc=bpy.context.scene
objs=obj.split(',')
for o in sc.objects:
    if o.type=='MESH': o.hide_render = o.name not in objs and not (o.parent and o.parent.name in objs and False)
sc.render.engine='CYCLES'; sc.cycles.samples=int(a[8]) if len(a)>8 else 12; sc.cycles.device='CPU'
sc.render.resolution_x=sc.render.resolution_y=res; sc.render.film_transparent=False
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.35,0.35,0.38,1)
cam=bpy.data.cameras.new('c'); cam.type='ORTHO'; cam.ortho_scale=2*half; cam.clip_end=100
co=bpy.data.objects.new('cam',cam); sc.collection.objects.link(co); sc.camera=co
l=bpy.data.lights.new('s','SUN'); l.energy=3; lo=bpy.data.objects.new('s',l); sc.collection.objects.link(lo); lo.rotation_euler=(0.7,0.3,0.6)
D={'front':((0,-10,0),(math.pi/2,0,0)),'back':((0,10,0),(math.pi/2,0,math.pi)),'right':((10,0,0),(math.pi/2,0,math.pi/2)),'left':((-10,0,0),(math.pi/2,0,-math.pi/2)),'top':((0,0,10),(0,0,0))}
p,r=D[view]
if view=='top': co.location=(cx,cz,10)
elif view in('front','back'): co.location=(cx,p[1],cz)
else: co.location=(p[0],cx,cz)
co.rotation_euler=r
sc.render.filepath=out; bpy.ops.render.render(write_still=True)
img=bpy.data.images.load(out); px=np.array(img.pixels[:]).reshape(res,res,4)
# grid every 0.05 (light) and 0.1 (strong) in world units. horizontal coordinate h, vertical z
def toPix(val,c): return (val-(c-half))/(2*half)*res
step=0.05 if half<1 else 0.1
for k in np.arange(math.floor((cx-half)/step)*step, cx+half, step):
    i=int(round(toPix(k,cx)))
    if 0<=i<res: px[:,i,:3]=px[:,i,:3]*0.5+ (np.array([0,0.6,1]) if abs(round(k/ (step*2))-k/(step*2))<1e-6 else np.array([0,0.3,0.5]))*0.5
for k in np.arange(math.floor((cz-half)/step)*step, cz+half, step):
    j=int(round(toPix(k,cz)))
    if 0<=j<res: px[j,:,:3]=px[j,:,:3]*0.5+(np.array([1,0.6,0]) if abs(round(k/(step*2))-k/(step*2))<1e-6 else np.array([0.5,0.3,0]))*0.5
img.pixels=px.ravel(); img.save()
print('grid step',step,'h from',cx-half,'v from',cz-half)
