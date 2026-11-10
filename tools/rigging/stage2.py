# Stage 2: skeleton + skin weights (trooper) + blaster bound to weapon_r
import bpy,sys,math,numpy as np,json
from mathutils import Vector as V, Matrix as M
w=sys.argv[-1]
bpy.ops.wm.open_mainfile(filepath=f'{w}/s1.blend')
t=bpy.data.objects['trooper']; g=bpy.data.objects['blaster']
import os
CFG=json.load(open(f'{w}/character.json')) if os.path.exists(f'{w}/character.json') else {}
cape=np.load(f'{w}/cape.npy'); LM=json.load(open(f'{w}/landmarks.json'))
TJ=LM.get('joints')
if TJ: pv=TJ['Pelvis'][0]; SH=V((-pv[0],-pv[1]+0.01,0))   # centre the pelvis over the root
else: SH=V((0.03,0.04,0))
t.data.transform(M.Translation(SH)); t.data.update()
n=len(t.data.vertices); co=np.empty(n*3,np.float32); t.data.vertices.foreach_get('co',co); co=co.reshape(n,3).astype(np.float64)
sh=np.array(SH)
def P(a): return np.array(a)+sh
# ---------- joints ----------
J={}
J['root']=((0,0,0),(0,0,0.18)); J['pelvis']=((0,0.01,0.95),(0,0.01,1.06))
J['spine_01']=((0,0.01,1.06),(0,0.015,1.18)); J['spine_02']=((0,0.015,1.18),(0,0.02,1.30))
J['spine_03']=((0,0.02,1.30),(0,0.0,1.46)); J['neck_01']=((0,0.0,1.46),(0,-0.005,1.57)); J['head']=((0,-0.005,1.57),(0,-0.005,1.83))
FING={'index':-0.104,'middle':-0.082,'ring':-0.060,'pinky':-0.040}
for s,sg in (('l',1),('r',-1)):
    A=LM[s]['arm']
    a130=P(A['1.3']); a114=P(A['1.14']); a122=P(A['1.22']); a095=P(A['0.95'])
    d=(a130-a114)/(a130[2]-a114[2])
    sho=np.array([sg*0.225,0.02,1.42])
    elb=a114+d*(1.16-1.14); elb[1]=min(elb[1],0.03)
    wri=a095.copy(); wri[2]=0.935
    hb=np.array(LM[s]['hand_bbox'])+sh; hx=(hb[0][0]+hb[1][0])/2
    kn=np.array([hx,-0.07,0.855])
    J[f'clavicle_{s}']=((sg*0.035,0.0,1.43),tuple(sho))
    J[f'upperarm_{s}']=(tuple(sho),tuple(elb)); J[f'lowerarm_{s}']=(tuple(elb),tuple(wri)); J[f'hand_{s}']=(tuple(wri),tuple(kn))
    curl=-0.012*sg  # fingertips curl toward body
    for f,fy in FING.items():
        b=np.array([hx+sg*0.004,fy,0.855]); m1=b+[curl*0.4,0.002,-0.035]; m2=m1+[curl*0.5,0.004,-0.03]; tip=m2+[curl*0.5,0.006,-0.026]
        if f=='pinky': m1=b+[curl*0.4,0.002,-0.028]; m2=m1+[curl*0.5,0.003,-0.024]; tip=m2+[curl*0.5,0.005,-0.02]
        J[f'{f}_01_{s}']=(tuple(b),tuple(m1)); J[f'{f}_02_{s}']=(tuple(m1),tuple(m2)); J[f'{f}_03_{s}']=(tuple(m2),tuple(tip))
    t0=np.array([wri[0]-sg*0.012,-0.075,0.905]); t1=np.array([hx-sg*0.022,-0.118,0.87]); t2=t1+[ -sg*0.004,-0.012,-0.03]; t3=t2+[-sg*0.003,-0.004,-0.025]
    J[f'thumb_01_{s}']=(tuple(t0),tuple(t1)); J[f'thumb_02_{s}']=(tuple(t1),tuple(t2)); J[f'thumb_03_{s}']=(tuple(t2),tuple(t3))
    L_=LM[s]['leg']; knee=P(L_['0.53']); ank=P(L_['0.18']); knee[2]=0.52; ank[2]=0.11
    fb=np.array(LM[s]['foot_bbox'])+sh; fx=(fb[0][0]+fb[1][0])/2
    hip=np.array([sg*0.095,0.0,0.90])
    J[f'thigh_{s}']=(tuple(hip),tuple(knee)); J[f'calf_{s}']=(tuple(knee),tuple(ank))
    J[f'foot_{s}']=(tuple(ank),(fx,-0.10,0.035)); J[f'ball_{s}']=((fx,-0.10,0.035),(fx,fb[0][1]+0.01,0.03))
if TJ:
    jt=lambda n,i=0: tuple(np.array(TJ[n][i])+np.array(SH))
    hd=lambda n: jt(n,0)
    zt=float(co[:,2].max())
    J['pelvis']=(hd('Pelvis'),hd('Waist')); J['spine_01']=(hd('Waist'),hd('Spine01')); J['spine_02']=(hd('Spine01'),hd('Spine02'))
    J['spine_03']=(hd('Spine02'),hd('NeckTwist01')); J['neck_01']=(hd('NeckTwist01'),hd('Head'))
    J['head']=(hd('Head'),(hd('Head')[0],hd('Head')[1],zt))
    for s_,T in (('l','L'),('r','R')):
        J[f'clavicle_{s_}']=(hd(f'{T}_Clavicle'),hd(f'{T}_Upperarm')); J[f'upperarm_{s_}']=(hd(f'{T}_Upperarm'),hd(f'{T}_Forearm'))
        J[f'lowerarm_{s_}']=(hd(f'{T}_Forearm'),hd(f'{T}_Hand')); J[f'hand_{s_}']=(hd(f'{T}_Hand'),hd(f'{T}_Mid1'))
        for ours,theirs in (('thumb','Thumb'),('index','Index'),('middle','Mid'),('ring','Ring'),('pinky','Pinky')):
            p1,p2,p3=np.array(hd(f'{T}_{theirs}1')),np.array(hd(f'{T}_{theirs}2')),np.array(hd(f'{T}_{theirs}3'))
            tip=p3+(p3-p2)*0.9
            J[f'{ours}_01_{s_}']=(tuple(p1),tuple(p2)); J[f'{ours}_02_{s_}']=(tuple(p2),tuple(p3)); J[f'{ours}_03_{s_}']=(tuple(p3),tuple(tip))
        J[f'thigh_{s_}']=(hd(f'{T}_Thigh'),hd(f'{T}_Calf')); J[f'calf_{s_}']=(hd(f'{T}_Calf'),hd(f'{T}_Foot'))
        b0=np.array(hd(f'{T}_ToeBase')); fwd=b0-np.array(hd(f'{T}_Foot')); fwd[2]=0; fwd/=np.linalg.norm(fwd)
        J[f'foot_{s_}']=(hd(f'{T}_Foot'),tuple(b0)); J[f'ball_{s_}']=(tuple(b0),tuple(b0+fwd*0.09))
    print('skeleton from source joints; shoulder L',np.round(J['upperarm_l'][0],3),'wrist L',np.round(J['hand_l'][0],3))
# cape chains from cape vertices
cc=co[cape]
for nm,(xl,xh) in (('c',(-0.12,0.12)),('l',(0.14,0.45)),('r',(-0.45,-0.14))):
    pts=[]
    for zz in (1.40,1.12,0.84,0.56,0.30):
        m=(cc[:,0]>xl)&(cc[:,0]<xh)&(np.abs(cc[:,2]-zz)<0.06)&(cc[:,1]>0.0)
        if m.sum()>10: q=cc[m]; p=q.mean(0); p[1]=np.percentile(q[:,1],60); p[2]=zz; pts.append(p)
    print('cape chain',nm,len(pts),[np.round(p,2).tolist() for p in pts])
    for i in range(len(pts)-1): J[f'cape_0{i+1}_{nm}']=(tuple(pts[i]),tuple(pts[i+1]))
PARENT={'pelvis':'root','spine_01':'pelvis','spine_02':'spine_01','spine_03':'spine_02','neck_01':'spine_03','head':'neck_01'}
for s in 'lr':
    PARENT.update({f'clavicle_{s}':'spine_03',f'upperarm_{s}':f'clavicle_{s}',f'lowerarm_{s}':f'upperarm_{s}',f'hand_{s}':f'lowerarm_{s}',
        f'thigh_{s}':'pelvis',f'calf_{s}':f'thigh_{s}',f'foot_{s}':f'calf_{s}',f'ball_{s}':f'foot_{s}'})
    for f in list(FING)+['thumb']:
        PARENT[f'{f}_01_{s}']=f'hand_{s}'; PARENT[f'{f}_02_{s}']=f'{f}_01_{s}'; PARENT[f'{f}_03_{s}']=f'{f}_02_{s}'
if CFG.get('twist_bones',False):
    for s in 'lr': PARENT[f'upperarm_twist_01_{s}']=f'upperarm_{s}'; PARENT[f'lowerarm_twist_01_{s}']=f'lowerarm_{s}'
for nm in 'clr':
    for i in range(1,5):
        k=f'cape_0{i}_{nm}'
        if k in J: PARENT[k]='spine_03' if i==1 else f'cape_0{i-1}_{nm}'
# ---------- armature ----------
arm=bpy.data.armatures.new('SK_Trooper_Skeleton'); ao=bpy.data.objects.new('Armature',arm); bpy.context.scene.collection.objects.link(ao)
for o in bpy.context.scene.objects: o.select_set(False)
bpy.context.view_layer.objects.active=ao; ao.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
eb=arm.edit_bones
order=['root','pelvis','spine_01','spine_02','spine_03','neck_01','head']+[k for k in J if k not in('root','pelvis','spine_01','spine_02','spine_03','neck_01','head')]
for k in order:
    b=eb.new(k); b.head=V(J[k][0]); b.tail=V(J[k][1])
for k in order:
    if k in PARENT: eb[k].parent=eb[PARENT[k]]; eb[k].use_connect=False
for k in order:
    b=eb[k]
    if k.startswith(('thumb',)): b.align_roll(V((0,-1,0)) if False else V((-1 if k.endswith('_l') else 1,0,0)))
    else: b.align_roll(V((0,-1,0)))
# weapon bones: gun frame. Grip relation defined in the right hand's rest frame (see notes).
hr=eb['hand_r']; wr=V(J['hand_r'][0]); kr=V(J['hand_r'][1])
fdir=(kr-wr).normalized()           # finger direction
B=fdir.copy()                        # barrel ~ along forearm/fingers in rest
Uup=V((0,-1,0)); Uup=(Uup-Uup.dot(B)*B).normalized()   # scope side toward the thumb/front
BL=json.load(open(f'{w}/blaster.json')) if os.path.exists(f'{w}/blaster.json') else {}
rake=math.radians(BL.get('grip_rake_deg',16))
# grip axis G = -U cos r - B sin r must run along the palm width; rotate about lateral axis to achieve rake
lat=B.cross(Uup).normalized()
R=M.Rotation(-rake,3,lat)
B=(R@B).normalized(); Uup=(R@Uup).normalized()
GS=BL.get('scale',0.62)  # blaster scale (0.62 -> ~0.60 m carbine, fits the trooper's reach)
grip_src=V(BL.get('grip',(0,-0.238,-0.11)))*GS; fore_src=V(BL.get('fore',(0,0.11,-0.095)))*GS; muzzle_src=V(BL.get('muzzle',(0,0.49,0.067)))*GS; hold_src=V(BL.get('hold',(0,-0.02,-0.04)))*GS
palm=(wr+kr)/2+V((0.022,0,0))      # inside of right palm (palm faces +X / the body)
Rg=M((lat,B,Uup)).transposed()     # columns: X=lat, Y=barrel, Z=up
gun_world=M.Translation(palm)@Rg.to_4x4()@M.Translation(-grip_src)
def gw(p): return gun_world@p
wb=eb.new('weapon_r'); wb.head=gw(grip_src); wb.tail=gw(grip_src+V((0,0.12,0))); wb.align_roll(Rg@V((0,0,1))); wb.parent=hr
mb=eb.new('muzzle'); mb.head=gw(muzzle_src); mb.tail=gw(muzzle_src+V((0,0.06,0))); mb.align_roll(Rg@V((0,0,1))); mb.parent=wb
if BL.get('kind')=='saber':
    # blade bone: from the emitter along the hilt axis (+Z of the weapon frame). Ignition = scale along the bone (0 -> 1).
    BLADE_LEN=BL.get('blade_len',0.95)
    bb=eb.new('blade'); bb.head=gw(muzzle_src); bb.tail=gw(muzzle_src+V((0,0,BLADE_LEN))); bb.align_roll(Rg@V((0,1,0))); bb.parent=wb
# UE mannequin-style IK helper bones
for k,h,tl,p in (('ik_foot_root',(0,0,0),(0,0,0.1),'root'),('ik_foot_l',J['foot_l'][0],None,'ik_foot_root'),('ik_foot_r',J['foot_r'][0],None,'ik_foot_root'),
                 ('ik_hand_root',(0,0,0),(0,0,0.1),'root'),('ik_hand_gun',J['hand_r'][0],None,'ik_hand_root'),('ik_hand_r',J['hand_r'][0],None,'ik_hand_gun'),('ik_hand_l',J['hand_l'][0],None,'ik_hand_gun')):
    b=eb.new(k); b.head=V(h); b.tail=V(tl) if tl else V(h)+V((0,0,0.08)); b.parent=eb[p]
TWIST=bool(CFG.get('twist_bones',False))
if TWIST:
    # UE-mannequin twist bones: the forearm twist carries half the wrist roll, the upper-arm twist cancels half the
    # shoulder roll, so saber wrist rolls spread along the arm instead of wringing the skin at one joint
    for s_ in 'lr':
        for nm,par,a0,a1 in ((f'upperarm_twist_01_{s_}',f'upperarm_{s_}',0.20,0.60),(f'lowerarm_twist_01_{s_}',f'lowerarm_{s_}',0.55,1.0)):
            pb_=eb[par]; h0=pb_.head+(pb_.tail-pb_.head)*a0; t0=pb_.head+(pb_.tail-pb_.head)*a1
            b=eb.new(nm); b.head=h0; b.tail=t0; b.roll=pb_.roll; b.parent=pb_
bpy.ops.object.mode_set(mode='OBJECT')
if TWIST:
    for s_ in 'lr':
        for nm,src,inv in ((f'lowerarm_twist_01_{s_}',f'hand_{s_}',False),(f'upperarm_twist_01_{s_}',f'upperarm_{s_}',True)):
            c=ao.pose.bones[nm].constraints.new('COPY_ROTATION'); c.name='twist'; c.target=ao; c.subtarget=src
            c.use_x=False; c.use_z=False; c.use_y=True; c.invert_y=inv; c.owner_space='LOCAL'; c.target_space='LOCAL'; c.mix_mode='REPLACE'; c.influence=0.5
json.dump({'gun_world':[list(r) for r in gun_world],'GS':GS,'grip_src':list(grip_src),'fore_src':list(fore_src),'muzzle_src':list(muzzle_src),'hold_src':list(hold_src),'lat':list(lat)},open(f'{w}/gun.json','w'))
# ---------- weights ----------
deform=[k for k in order]
segs={k:(np.array(J[k][0]),np.array(J[k][1])) for k in deform}
RAD={'root':9,'pelvis':0.15,'spine_01':0.16,'spine_02':0.17,'spine_03':0.17,'neck_01':0.07,'head':0.12,'clavicle':0.08,'upperarm':0.065,'lowerarm':0.055,'hand':0.042,
     'thumb':0.014,'index':0.012,'middle':0.012,'ring':0.012,'pinky':0.011,'thigh':0.09,'calf':0.065,'foot':0.055,'ball':0.04,'cape':0.12}
def rad(k): return RAD.get(k) or RAD[k.split('_')[0]]
def segdist(p,a,b):
    ab=b-a; tt=np.clip(((p-a)@ab)/(ab@ab),0,1); return np.linalg.norm(p-(a+tt[:,None]*ab),axis=1),tt
names=[k for k in deform if k!='root']
D=np.zeros((n,len(names))); TT=np.zeros((n,len(names)))
for i,k in enumerate(names):
    d,tt=segdist(co,*segs[k]); D[:,i]=d/rad(k); TT[:,i]=tt
idx={k:i for i,k in enumerate(names)}
x,y,z=co[:,0],co[:,1],co[:,2]
L=np.load(f'{w}/capeL.npy') if False else None
def near(prefixes,f):
    m=np.zeros(n,bool)
    for i,k in enumerate(names):
        if k.split('_')[0] in prefixes: m|=D[:,i]<f
    return m
nearArm=near(('upperarm','lowerarm'),1.25)|near(('hand','thumb','index','middle','ring','pinky'),1.4)
nearLeg=near(('thigh','calf','foot','ball'),1.2)
torsoCore=(np.abs(x)<0.2)&(y<0.06)&(z>0.85)&(z<1.42)
farBody=~(near(('upperarm','lowerarm','hand','thigh','calf','foot','ball'),1.6))&~torsoCore&(z<1.42)&(z>0.2)
brown=np.load(f'{w}/brown.npy')>0.5
tightArm=near(('upperarm','lowerarm'),0.95)|near(('hand','thumb','index','middle','ring','pinky'),1.0)
cape=(cape|farBody|(brown&(z<1.42)&~tightArm&~torsoCore))&~(nearArm&~brown)&~tightArm&~nearLeg&~torsoCore
if CFG.get('cape',True) is False: cape[:]=False
print('cape frac refined',cape.mean())
ARMX=min(0.205,abs(J['upperarm_l'][0][0])-0.03)
armchain=lambda k: k.split('_')[0] in('upperarm','lowerarm','hand','thumb','index','middle','ring','pinky')
legchain=lambda k: k.split('_')[0] in('thigh','calf','foot','ball')
iscape=lambda k: k.startswith('cape')
big=1e9
for i,k in enumerate(names):
    if iscape(k): D[~cape,i]=big
    if armchain(k):
        D[np.abs(x)<ARMX,i]=big; D[cape,i]=big
        sgn=1 if k.endswith('_l') else -1; D[sgn*x<0,i]=big
    if legchain(k):
        sgn=1 if k.endswith('_l') else -1; D[sgn*x<-0.03,i]=big; D[z>1.02,i]=big; D[cape,i]=big
        D[(np.abs(x)>0.23)&(z>0.72),i]=big   # hands hang beside the thighs
    if k.split('_')[0] in('thumb','index','middle','ring','pinky'):   # finger skin only below this character's own wrist
        D[z>J[f"hand_{k[-1]}"][0][2]-0.02,i]=big
    if k in ('hand_l','hand_r','lowerarm_l','lowerarm_r') and CFG.get('finger_skin_below_knuckles',False):
        # the palm bone ends at the knuckles, so it can win the nearest-bone test for the skin between the fingers;
        # below the knuckle line the skin belongs to the fingers (bare hands with fused or webbed fingers)
        kz=np.mean([J[f'{f}_01_{k[-1]}'][0][2] for f in FING])
        D[(z<kz-0.008)&(np.abs(x)>abs(J[f'hand_{k[-1]}'][0][0])-0.01),i]=big
    if k in('head',): D[z<1.50,i]=big
    if k in ('head','neck_01') and CFG.get('collar_follows_chest',False):
        # a cloth collar around the neck rides on the chest: only the neck/head skin inside it follows the head
        nh=np.array(J['neck_01'][0]); hh=np.array(J['head'][0]); radial=np.hypot(x-nh[0],y-nh[1])
        if k=='head': D[(radial>0.085)&(z<hh[2]+0.03),i]=big
        else: D[radial>0.10,i]=big
    if k.split('_')[0] in ('spine','pelvis','neck','head','clavicle') and False: pass
# cape verts: only cape chains + upper torso
for i,k in enumerate(names):
    if not(iscape(k) or k in('spine_03','spine_02','neck_01','clavicle_l','clavicle_r','head')): D[cape,i]=big
    if k=='head': D[cape,i]=big
prim=D.argmin(1)
if CFG.get('finger_skin_below_knuckles',False):
    # hand skin reachable from the hand over the mesh surface never belongs to the torso or legs: a thumb or fingertip
    # that hangs past its detected bone otherwise loses to the wide torso bones and stays behind when the hand moves
    _ev=np.empty(len(t.data.edges)*2,np.int32); t.data.edges.foreach_get('vertices',_ev); _ev=_ev.reshape(-1,2)
    _body=[idx[k] for k in names if armchain(k) is False and not iscape(k)]
    for s_ in ('l','r'):
        a_=np.array(J[f'hand_{s_}'][0]); b_=np.array(J[f'hand_{s_}'][1]); ab_=b_-a_
        tt_=np.clip(((np.stack([x,y,z],1)-a_)@ab_)/(ab_@ab_),0,1)
        near_=np.linalg.norm(np.stack([x,y,z],1)-(a_+tt_[:,None]*ab_),axis=1)<0.11
        zone_=near_&(z<a_[2]+0.005)
        handb_=[idx[k] for k in names if k.endswith('_'+s_) and k.split('_')[0] in ('hand','thumb','index','middle','ring','pinky')]
        reach_=np.isin(prim,handb_)&zone_
        for _ in range(10):
            nb_=np.zeros(n,bool); nb_[_ev[:,1][reach_[_ev[:,0]]]]=True; nb_[_ev[:,0][reach_[_ev[:,1]]]]=True
            new_=nb_&zone_&~reach_
            if not new_.any(): break
            reach_|=new_
        fix_=reach_&np.isin(prim,_body)
        if fix_.any():
            D[np.ix_(fix_,_body)]=big; prim[fix_]=D[fix_].argmin(1)
        print('hand skin reclaimed',s_,int(fix_.sum()))
children={k:[c for c,p in PARENT.items() if p==k and c in idx] for k in names}
allowed=np.zeros((n,len(names)),bool)
for i,k in enumerate(names):
    m=prim==i; allowed[m,i]=True
    for c in children[k]+([PARENT[k]] if PARENT.get(k) in idx else []):
        allowed[m,idx[c]]=True
    if k.startswith(('index','middle','ring','pinky')):   # neighbouring fingers share a little (glove)
        s=k[-1]; lvl=k.split('_')[1]
        for f in FING:
            allowed[m,idx[f'{f}_{lvl}_{s}']]=True
TORSO=['pelvis','spine_01','spine_02','spine_03','neck_01']
for i,k in enumerate(names):
    m=prim==i
    if k in TORSO:
        j=TORSO.index(k)
        for kk in TORSO[max(0,j-2):j+3]: allowed[m,idx[kk]]=True
    if k.startswith('cape'):
        lvl=int(k[5:7])
        for kk in names:
            if kk.startswith('cape') and abs(int(kk[5:7])-lvl)<=1: allowed[m,idx[kk]]=True
        allowed[m,idx['spine_03']]=True
D2=np.where(allowed&(D<big/2),D,np.inf)
D2[cape]=np.where(np.isfinite(D2[cape]),np.minimum(D2[cape],np.where(allowed[cape],D[cape],np.inf)),D2[cape])
Wt=np.where(np.isfinite(D2),1.0/np.maximum(D2,0.05)**6,0)
# smoothing along the surface, respecting each vertex's allowed bones
ev=np.empty(len(t.data.edges)*2,np.int32); t.data.edges.foreach_get('vertices',ev); ev=ev.reshape(-1,2)
deg=np.bincount(ev.ravel(),minlength=n)[:,None].astype(float)
Wt/=np.maximum(Wt.sum(1,keepdims=True),1e-12)
soft=cape|np.isin(prim,[idx[k] for k in TORSO])
for it in range(16):
    s_=np.zeros_like(Wt); np.add.at(s_,ev[:,0],Wt[ev[:,1]]); np.add.at(s_,ev[:,1],Wt[ev[:,0]])
    nw=0.5*Wt+0.5*s_/np.maximum(deg,1); nw*=allowed; nw/=np.maximum(nw.sum(1,keepdims=True),1e-12)
    Wt=np.where(soft[:,None]|(it<4),nw,Wt)
# helmet: a rigid shell. On fused meshes the faceplate/cheeks/chin sit in the body island below the head-bone
# cut-off and would follow the chest, tearing the helmet along the visor when the head turns. Everything outside the
# neck above the helmet rim (tilted: low at the chin, high at the nape) goes 100% to head; the neck seal between the
# collar and the rim blends spine_03 -> neck_01 -> head by height so the neck bends instead of the helmet.
if 'head' in idx and 'neck_01' in idx and 'spine_03' in idx and CFG.get('rigid_helmet',True):
    hj=np.array(J['head'][0]); nj=np.array(J['neck_01'][0])
    r=np.hypot(x-hj[0],y-hj[1]); dyn=y-hj[1]
    zr=hj[2]+0.004+0.196*dyn                    # rim plane: ~2.5 cm below the head joint at the chin, ~3 cm above at the nape
    NECKR=0.095
    helm=(z>zr)&(r>NECKR)&(np.abs(x-hj[0])<0.14)&(dyn>-0.19)&(dyn<0.16)&~cape
    seal=(r<=NECKR)&(z>nj[2]-0.06)&~cape&~helm
    ssv=lambda v: np.clip(v,0,1)**2*(3-2*np.clip(v,0,1))
    Wt[helm]=0; Wt[helm,idx['head']]=1.0
    hd=ssv((z[seal]-zr[seal]+0.01)/0.04); sp=1-ssv((z[seal]-(nj[2]-0.06))/0.06)
    Wt[seal]=0; Wt[seal,idx['spine_03']]=sp; Wt[seal,idx['neck_01']]=(1-sp)*(1-hd); Wt[seal,idx['head']]=(1-sp)*hd
    print('rigid helmet verts',int(helm.sum()),'neck seal verts',int(seal.sum()))
# soft sides (cloth characters): tunic vertices beside the upper arm share its motion, so the side panel gives way
# when the arm comes in instead of the sleeve sinking into it (the armpit blend of a hand-made skin)
SS=CFG.get('soft_sides')
if SS:
    reach=SS.get('reach',0.07); share=SS.get('share',0.55)
    torso_ids=[idx[k] for k in ('spine_01','spine_02','spine_03','clavicle_l','clavicle_r') if k in idx]
    dom=np.argmax(Wt,1); tmask=np.isin(dom,torso_ids)&~cape
    for sd in 'lr':
        ui=idx[f'upperarm_{sd}']; d,tt=segdist(co,*segs[f'upperarm_{sd}'])
        sg=1 if sd=='l' else -1
        near=tmask&(sg*x>SS.get('x0',0.06))&(z<segs[f'upperarm_{sd}'][0][2]+SS.get('above',0.06))
        k=np.clip(1-(d-rad('upperarm'))/reach,0,1); k=k*k*(3-2*k)*share*np.clip(tt*3,0,1)*near
        Wt=Wt*(1-k[:,None]); Wt[:,ui]+=k
    print('soft sides: torso verts sharing upper-arm motion',int((Wt[:,idx['upperarm_l']]+Wt[:,idx['upperarm_r']]>0.05).sum()))
# slim sleeves (cloth characters with loose bell sleeves): take in the fabric beyond the forearm's core toward the
# forearm axis so the sleeves do not plough through the tunic when the arms come in (hands and skin untouched)
SL=CFG.get('slim_sleeves')
if SL:
    core=SL.get('core',0.045); keep=SL.get('keep',0.5); moved=0
    for sd in 'lr':
        A_=np.array(J[f'lowerarm_{sd}'][0]); B_=np.array(J[f'hand_{sd}'][0]); ab=B_-A_
        fi=[idx[f'lowerarm_{sd}']]
        m=(np.isin(np.argmax(Wt,1),fi))&~cape
        q=co[m]; ta_=np.clip(((q-A_)@ab)/(ab@ab),0,1); axp=A_+ta_[:,None]*ab; dv=q-axp; d=np.linalg.norm(dv,axis=1)
        k=np.clip((ta_-0.05)/0.15,0,1)*np.clip((0.97-ta_)/0.1,0,1)          # fade in past the elbow, out before the wrist
        nd=np.where(d>core,core+(d-core)*(keep+(1-keep)*(1-k)),d)
        q2=axp+dv*(nd/np.maximum(d,1e-9))[:,None]; moved+=int((np.abs(nd-d)>0.002).sum())
        co[m]=q2
    t.data.vertices.foreach_set('co',co.astype(np.float32).ravel()); t.data.update()
    print('slim sleeves: vertices taken in',moved)
# boots: rigid toe box and heel, flexing only at the crease across the ball of the foot (a wide distance-based blend
# makes the whole boot curl like a banana when the toes bend)
BT=CFG.get('boot_toes',{'band':0.015})
if BT:
    band=BT.get('band',0.015); fixed=0
    for sd in 'lr':
        fi,bi=idx[f'foot_{sd}'],idx[f'ball_{sd}']
        bh=np.array(J[f'ball_{sd}'][0]); fw=np.array(J[f'ball_{sd}'][1])-bh; fw[2]=0; fw/=np.linalg.norm(fw)
        share=Wt[:,fi]+Wt[:,bi]; m=(share>0.05)&~cape
        sproj=(co[m]-bh)@fw
        k=np.clip((sproj+band)/(2*band),0,1); k=k*k*(3-2*k)
        Wt[m,bi]=share[m]*k; Wt[m,fi]=share[m]*(1-k); fixed+=int(m.sum())
    print('boot toes: foot/ball weights split at the ball crease (+-%.1f cm) for %d verts'%(band*100,fixed))
if TWIST:
    add=[]
    for s_ in 'lr':
        for nm,par,lo,hi,near_head in ((f'upperarm_twist_01_{s_}',f'upperarm_{s_}',0.10,0.60,True),(f'lowerarm_twist_01_{s_}',f'lowerarm_{s_}',0.25,0.85,False)):
            t_=TT[:,idx[par]]; k_=np.clip((t_-lo)/(hi-lo),0,1); k_=k_*k_*(3-2*k_)
            share=(1-k_)*0.8 if near_head else k_
            col=Wt[:,idx[par]]*share; Wt[:,idx[par]]-=col; add.append((nm,col))
    Wt=np.concatenate([Wt,np.stack([c for _,c in add],1)],1)
    for nm,_ in add: idx[nm]=len(names); names.append(nm)
    print('twist bones',[nm for nm,_ in add],'verts',[int((c>0.05).sum()) for _,c in add])
# keep top 4
o4=np.argsort(-Wt,1)[:,4:]; np.put_along_axis(Wt,o4,0,1); Wt[Wt<0.01]=0; Wt/=np.maximum(Wt.sum(1,keepdims=True),1e-12)
print('unweighted verts',(Wt.sum(1)<0.5).sum())
for k in names:
    vg=t.vertex_groups.new(name=k); col=Wt[:,idx[k]]; nz=np.nonzero(col)[0]
    for v in nz: vg.add([int(v)],float(col[v]),'REPLACE')
for k in ['root','weapon_r','muzzle','ik_foot_root','ik_foot_l','ik_foot_r','ik_hand_root','ik_hand_gun','ik_hand_r','ik_hand_l']:
    if k not in t.vertex_groups: t.vertex_groups.new(name=k)
np.save(f'{w}/prim.npy',prim); json.dump(names,open(f'{w}/names.json','w'))
import bmesh
grp=np.zeros(len(names),object)
for i,k in enumerate(names):
    b=k.split('_')[0]; sd=k[-1]
    grp[i]=('arm_'+sd) if b in('upperarm','lowerarm','hand','thumb','index','middle','ring','pinky') else ('leg_'+sd) if b in('thigh','calf','foot','ball') else 'cape' if b=='cape' else 'torso'
vg_=np.array([grp[i] for i in Wt.argmax(1)]); prim_=Wt.argmax(1)
ok={frozenset(['arm_l','torso']),frozenset(['arm_r','torso']),frozenset(['leg_l','torso']),frozenset(['leg_r','torso']),frozenset(['cape','torso'])}
bm=bmesh.new(); bm.from_mesh(t.data); bm.verts.ensure_lookup_table()
kill=[]
BRIDGE=CFG.get('bridge_cuts',True)   # armour: cut faces that bridge separate plates; continuous cloth/skin (Jedi): keep the surface whole
for f in (bm.faces if BRIDGE else []):
    gs=set(vg_[v.index] for v in f.verts)
    pb_=set(names[prim_[v.index]] for v in f.verts)
    if 'head' in pb_ and pb_-{'head','neck_01'}: kill.append(f); continue
    if len(gs)<2: continue
    if len(gs)>2: kill.append(f); continue
    fs=frozenset(gs)
    if fs not in ok: kill.append(f); continue
    if any(g_.startswith('arm') for g_ in gs) and min(v.co.z for v in f.verts)<1.28: kill.append(f); continue
    if 'cape' in gs and min(v.co.z for v in f.verts)<1.30: kill.append(f); continue
    pb_=set(names[prim_[v.index]] for v in f.verts)
    if 'head' in pb_ and pb_-{'head','neck_01'}: kill.append(f)
print('bridge faces removed',len(kill))
bmesh.ops.delete(bm,geom=kill,context='FACES_ONLY')
bnd=[e for e in bm.edges if e.is_boundary] if BRIDGE else []
res=bmesh.ops.holes_fill(bm,edges=bnd,sides=200)
tri=bmesh.ops.triangulate(bm,faces=res['faces'])['faces']
def fill_ok(f):
    bs=set(names[prim_[v.index]] for v in f.verts)
    if len(set(vg_[v.index] for v in f.verts))>1: return False
    bl=list(bs)
    for i_ in range(len(bl)):
        for j_ in range(i_+1,len(bl)):
            a_,b_=bl[i_],bl[j_]
            if PARENT.get(a_)!=b_ and PARENT.get(b_)!=a_: return False
    return True
badf=[f for f in tri if not fill_ok(f)]
bmesh.ops.delete(bm,geom=badf,context='FACES_ONLY')
print('holes filled',len(tri)-len(badf),'cross-part fills dropped',len(badf))
wire=[e for e in bm.edges if not e.link_faces]; bmesh.ops.delete(bm,geom=wire,context='EDGES')
loose=[v for v in bm.verts if not v.link_faces]; bmesh.ops.delete(bm,geom=loose,context='VERTS')
bm.to_mesh(t.data); bm.free()
t.parent=ao; md=t.modifiers.new('Armature','ARMATURE'); md.object=ao
t.name='SK_Trooper'
# ---------- blaster: scale/orient into the right hand, bind 100% to weapon_r ----------
g.data.transform(M.Scale(GS,4)); g.data.update()
for o in bpy.context.scene.objects: o.select_set(False)
bpy.context.view_layer.objects.active=g; g.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=0.0001); bpy.ops.object.mode_set(mode='OBJECT')
dm=g.modifiers.new('dec','DECIMATE'); dm.ratio=20000/len(g.data.polygons); dm.use_collapse_triangulate=True; bpy.ops.object.modifier_apply(modifier='dec'); bpy.ops.object.shade_smooth()
print('blaster tris',len(g.data.polygons))
# source frame: X lateral, Y barrel(+Y muzzle), Z up  -> world via Rg about the grip
g.data.transform(M.Translation(palm)@Rg.to_4x4()@M.Translation(-grip_src)); g.data.update()
g.parent=ao; gm=g.modifiers.new('Armature','ARMATURE'); gm.object=ao
vg=g.vertex_groups.new(name='weapon_r'); vg.add(list(range(len(g.data.vertices))),1.0,'REPLACE')
g.name='SK_Trooper_Blaster'
if BL.get('kind')=='saber':
    # blade mesh: bright core + softer glow shell, bound 100% to the blade bone; emissive saber colour
    import bmesh as _bm
    BLADE_LEN=BL.get('blade_len',0.95); col=BL.get('blade_color',[0.1,0.45,1.0])
    bm_=_bm.new()
    for r_,seg in ((0.0065,16),(0.0245,20)):   # thin hot core, wide soft glow
        _bm.ops.create_cone(bm_,cap_ends=True,cap_tris=False,segments=seg,radius1=r_,radius2=r_*0.92,depth=BLADE_LEN,matrix=M.Translation((0,0,BLADE_LEN/2)))
    bd=bpy.data.meshes.new('blade'); bm_.to_mesh(bd); bm_.free()
    bo=bpy.data.objects.new('blade',bd); bpy.context.scene.collection.objects.link(bo)
    bd.transform(M.Translation(palm)@Rg.to_4x4()@M.Translation(-grip_src)@M.Translation(muzzle_src)); bd.update()
    nb=len(bd.vertices); core=[i for i,v in enumerate(bd.vertices) if i<nb//2]
    m1=bpy.data.materials.new('M_SaberBlade_Core'); m1.use_nodes=True; p1=m1.node_tree.nodes['Principled BSDF']
    p1.inputs['Base Color'].default_value=(0.55,0.75,1.0,1); p1.inputs['Emission Color'].default_value=(0.45,0.7,1.0,1); p1.inputs['Emission Strength'].default_value=4.0
    m2=bpy.data.materials.new('M_SaberBlade_Glow'); m2.use_nodes=True; p2=m2.node_tree.nodes['Principled BSDF']
    p2.inputs['Base Color'].default_value=(*col,1); p2.inputs['Emission Color'].default_value=(*col,1); p2.inputs['Emission Strength'].default_value=3.5
    p2.inputs['Alpha'].default_value=0.78; m2.blend_method='BLEND' if hasattr(m2,'blend_method') else None
    bd.materials.append(m1); bd.materials.append(m2)
    for pl in bd.polygons: pl.material_index=0 if all(v<nb//2 for v in pl.vertices) else 1
    vgb=bo.vertex_groups.new(name='blade'); vgb.add(list(range(nb)),1.0,'REPLACE')
    for o_ in bpy.context.scene.objects: o_.select_set(False)
    bo.select_set(True); g.select_set(True); bpy.context.view_layer.objects.active=g
    for mm in g.modifiers: pass
    bpy.ops.object.join()
    print('saber blade bound to blade bone, length',BLADE_LEN)
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/s2.blend')
print('bones',len(arm.bones))
