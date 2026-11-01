import bpy,numpy as np,sys,json
bpy.ops.wm.open_mainfile(filepath=sys.argv[-1])
ao=bpy.data.objects['Armature']; t=bpy.data.objects['SK_Trooper']; me=t.data
n=len(me.vertices)
ev=np.empty(len(me.edges)*2,np.int32); me.edges.foreach_get('vertices',ev); ev=ev.reshape(-1,2)
gn={g.index:g.name for g in t.vertex_groups}
def posed(act,f):
    ao.animation_data.action=bpy.data.actions[act]; bpy.context.scene.frame_set(f)
    em=t.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh(); p=np.empty(n*3); em.vertices.foreach_get('co',p); return p.reshape(n,3)
ref=posed('idle',0); l0=np.linalg.norm(ref[ev[:,0]]-ref[ev[:,1]],axis=1)
out={}
for act in [a.name for a in bpy.data.actions]:
    a=bpy.data.actions[act]; worst=0;cnt=0
    for f in range(0,int(a.frame_range[1])+1,3):
        p=posed(act,f); l1=np.linalg.norm(p[ev[:,0]]-p[ev[:,1]],axis=1); bad=(l1>np.maximum(l0*3,0.025)); cnt=max(cnt,int(bad.sum())); worst=max(worst,float((l1-l0).max()))
    out[act]=dict(stretched_edges=cnt,worst_extra_cm=round(worst*100,1))
    print(act,out[act])
json.dump(out,open(sys.argv[-1].replace('anim.blend','stretch.json'),'w'),indent=1)
