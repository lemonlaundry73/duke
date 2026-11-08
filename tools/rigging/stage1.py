# Stage 1: orient, cape mask, landmarks
import bpy,sys,math,mathutils,numpy as np,bmesh,json
w=sys.argv[-1]
import os
CFG=json.load(open(f'{w}/character.json')) if os.path.exists(f'{w}/character.json') else {}
bpy.ops.wm.open_mainfile(filepath=f'{w}/prep.blend')
t=bpy.data.objects['trooper']; g=bpy.data.objects['blaster']
for o in bpy.context.scene.objects: o.select_set(False)
t.select_set(True); bpy.context.view_layer.objects.active=t
# prep bbox (before turning to face -Y) -> maps source-skeleton joints into prep space
_pv=[v.co.copy() for v in t.data.vertices]
PREP_MIN=[min(v[i] for v in _pv) for i in range(3)]; PREP_MAX=[max(v[i] for v in _pv) for i in range(3)]
t.data.transform(mathutils.Matrix.Rotation(-math.pi/2,4,'Z')); t.data.update()
me=t.data; n=len(me.vertices)
co=np.empty(n*3,np.float32); me.vertices.foreach_get('co',co); co=co.reshape(n,3)
print('feet y range (toes should be -Y):',co[co[:,2]<0.03][:,1].min(),co[co[:,2]<0.03][:,1].max())
if CFG.get('cape',True):
    img=[i for i in bpy.data.images if i.name.startswith(CFG.get('color_image','Color_28493'))][0]
    W,H=img.size; px=np.empty(W*H*4,np.float32); img.pixels.foreach_get(px); px=px.reshape(H,W,4)
    uvl=np.empty(len(me.loops)*2,np.float32); me.uv_layers.active.data.foreach_get('uv',uvl); uvl=uvl.reshape(-1,2)
    vi=np.empty(len(me.loops),np.int32); me.loops.foreach_get('vertex_index',vi)
    # sample colour per loop then average per vertex (more robust over seams)
    col=px[np.clip((uvl[:,1]*H).astype(int),0,H-1),np.clip((uvl[:,0]*W).astype(int),0,W-1),:3]
    vc=np.zeros((n,3)); cnt=np.zeros(n); np.add.at(vc,vi,col); np.add.at(cnt,vi,1); vc/=np.maximum(cnt,1)[:,None]
    mx=vc.max(1); mn=vc.min(1); sat=(mx-mn)/np.maximum(mx,1e-4)
    lab=((sat>0.25)&(vc[:,0]>vc[:,1])&(vc[:,1]>=vc[:,2]*0.95)&(mx>0.06)).astype(np.float64)
    ev=np.empty(len(me.edges)*2,np.int32); me.edges.foreach_get('vertices',ev); ev=ev.reshape(-1,2)
    deg=np.bincount(ev.ravel(),minlength=n).astype(np.float64)
    def smooth(f,it):
        for _ in range(it):
            s=np.zeros_like(f); np.add.at(s,ev[:,0],f[ev[:,1]]); np.add.at(s,ev[:,1],f[ev[:,0]])
            f=0.5*f+0.5*s/np.maximum(deg,1)
        return f
    L=smooth(lab,40)
    x,y,z=co[:,0],co[:,1],co[:,2]
    cape=L>0.45
    # geometric gate: cape lives behind the body, at the outer sides below the shoulders, or as the scarf around the neck
    back=y>0.06
    side=(np.abs(x)>0.33)&(z<1.35)
    scarf=(z>1.40)&(z<1.62)
    cape&=(back|side|scarf)
    # keep only the big connected cape component(s)
    adj=[[] for _ in range(n)]
    for a,b in ev:
        if cape[a] and cape[b]: adj[a].append(b); adj[b].append(a)
    comp=-np.ones(n,int); sizes=[]
    for s in np.where(cape)[0]:
        if comp[s]>=0: continue
        st=[s]; comp[s]=len(sizes); c=0
        while st:
            v=st.pop(); c+=1
            for u in adj[v]:
                if comp[u]<0: comp[u]=len(sizes); st.append(u)
        sizes.append(c)
    sizes=np.array(sizes); keep=np.where(sizes>300)[0]
    cape=np.isin(comp,keep)
    cape=smooth(cape.astype(float),6)>0.5
    print('cape comps',sorted(sizes)[-6:],'cape frac',cape.mean())

else:
    print('no cape on this character')
    ev=np.empty(len(me.edges)*2,np.int32); me.edges.foreach_get('vertices',ev); ev=ev.reshape(-1,2)
    cape=np.zeros(n,bool); lab=np.zeros(n)
    def smooth(f,it): return f
    x,y,z=co[:,0],co[:,1],co[:,2]
np.save(f'{w}/cape.npy',cape); np.save(f'{w}/brown.npy',smooth(lab,4)); np.save(f'{w}/co2.npy',co)
body=~cape
def cen(mask):
    p=co[mask]; return p.mean(0) if len(p) else None, len(p)
LM={}
for side_,sg in (('l',1),('r',-1)):
    def sl(z0,xlo,xhi,ylo=-0.2,yhi=0.14,dz=0.012):
        m=body&(z>z0-dz)&(z<z0+dz)&(sg*x>xlo)&(sg*x<xhi)&(y>ylo)&(y<yhi)
        p,c=cen(m); 
        # use bbox centre in x/y (centroid biased by detail)
        q=co[m]; return ((q.min(0)+q.max(0))/2 if c else None),c
    arm={zz:sl(zz,0.22,0.42) for zz in (1.30,1.22,1.14,1.06,1.00,0.95)}
    leg={zz:sl(zz,0.0,0.26,-0.25,0.12) for zz in (0.80,0.70,0.53,0.35,0.18,0.10)}
    for k,v in list(arm.items())+list(leg.items()): print(side_,k,None if v[0] is None else v[0].round(3),v[1])
    LM[side_]={'arm':{str(k):(v[0].tolist() if v[0] is not None else None) for k,v in arm.items()},'leg':{str(k):(v[0].tolist() if v[0] is not None else None) for k,v in leg.items()}}
    # hand: verts below wrist
    m=body&(z<0.93)&(z>0.74)&(sg*x>0.22)&(sg*x<0.42)
    q=co[m]; LM[side_]['hand_bbox']=[q.min(0).tolist(),q.max(0).tolist()]; print(side_,'hand bbox',q.min(0).round(3),q.max(0).round(3))
    m=body&(z<0.06)&(sg*x>0.0)
    q=co[m]; LM[side_]['foot_bbox']=[q.min(0).tolist(),q.max(0).tolist()]; print(side_,'foot bbox',q.min(0).round(3),q.max(0).round(3))
for zz in (1.75,1.62,1.55,1.48,1.40,1.30,1.15,1.0,0.92):
    m=body&(z>zz-0.012)&(z<zz+0.012)&(np.abs(x)<0.2)&(y<0.15)
    q=co[m]; print('torso',zz,q.min(0).round(3),q.max(0).round(3)); LM.setdefault('torso',{})[str(zz)]=[q.min(0).tolist(),q.max(0).tolist()]
if CFG.get('joints'):
    SR=json.load(open(f'{w}/source_rig.json')); SJ=SR['joints']; rmin,rmax=SR['raw_bbox']
    sc=(PREP_MAX[2]-PREP_MIN[2])/(rmax[2]-rmin[2])
    rot=mathutils.Matrix.Rotation(-math.pi/2,3,'Z')
    def tj(p):
        q=mathutils.Vector([(p[k]-(rmin[k]+rmax[k])/2)*sc+(PREP_MIN[k]+PREP_MAX[k])/2 if k<2 else (p[k]-rmin[k])*sc+PREP_MIN[k] for k in range(3)])
        return list(rot@q)
    LM['joints']={k:[tj(v[0]),tj(v[1])] for k,v in SJ.items()}
    LM['joint_scale']=sc
json.dump(LM,open(f'{w}/landmarks.json','w'),indent=1)
# cape viz colour
a=me.color_attributes.new('cls','FLOAT_COLOR','POINT'); cc=np.ones((n,4),np.float32)*0.8; cc[:,3]=1; cc[cape,:3]=[1,0,0]; a.data.foreach_set('color',cc.ravel())
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/s1.blend')
