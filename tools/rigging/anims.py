# Authors the trooper animation set on the control rig, measures quality, saves anim.blend
import bpy,sys,math,json
sys.path.insert(0,sys.argv[-2]); import rigkit as K
from mathutils import Vector as V, Matrix as M, Quaternion as Q, Euler as E
w=sys.argv[-1]; R=math.radians
ao=K.load(w); K.build_controls(ao,w); P=ao.pose.bones
FPS=30; bpy.context.scene.render.fps=FPS
REST={pb.name:pb.bone.matrix_local.copy() for pb in P}
def ss(x): x=max(0,min(1,x)); return x*x*(3-2*x)
def lerp(a,b,t): return a+(b-a)*t
def mix(a,b,t): return tuple(lerp(x,y,t) for x,y in zip(a,b))
def env(t,keys):
    """piecewise smooth interpolation of dict params over keys [(time, dict)]"""
    if t<=keys[0][0]: return dict(keys[0][1])
    for (t0,a),(t1,b) in zip(keys,keys[1:]):
        if t<=t1:
            u=ss((t-t0)/(t1-t0) if t1>t0 else 1); out={}
            for k in set(a)|set(b):
                va=a.get(k,b.get(k)); vb=b.get(k,a.get(k))
                if isinstance(va,(int,float)) and isinstance(vb,(int,float)): out[k]=lerp(va,vb,u)
                elif isinstance(va,tuple) and isinstance(vb,tuple): out[k]=mix(va,vb,u)
                else: out[k]=va if u<0.5 else vb
            return out
    return dict(keys[-1][1])
# ---------------- stances ----------------
# gun placements (pos of pistol grip, yaw/pitch/roll of a forward gun), in the torso-at-rest frame
GUN={
 'aim':   dict(gpos=(-0.06,-0.30,1.30),gyaw=0,gpitch=0,groll=0),
 'ready': dict(gpos=(-0.06,-0.22,1.19),gyaw=12,gpitch=-28,groll=-8),     # low ready: muzzle down-forward
 'patrol':dict(gpos=(-0.07,-0.21,1.15),gyaw=22,gpitch=-38,groll=-12),
 'port':  dict(gpos=(-0.05,-0.24,1.22),gyaw=40,gpitch=22,groll=-25),     # run: across the chest, muzzle up-left
 'sprint':dict(gpos=(-0.03,-0.20,1.20),gyaw=62,gpitch=30,groll=-35),
}
BASE=dict(px=0,py=0,pz=0,pp=0,pyw=0,pr=0, s1p=0,s1y=0,s1r=0, s2p=0,s2y=0,s2r=0, s3p=0,s3y=0,s3r=0, np_=0,ny=0,nr=0, hp=0,hy=0,hr=0,
          gdx=0,gdy=0,gdz=0,gdp=0,gdyaw=0,gdr=0, curlR=0.9,idxR=0.1,curlL=0.85, capeP=0,capeS=0, lhand=1.0, lpos=None)
def stance(name,**kw):
    d=dict(BASE); d.update(GUN[name])
    if name=='aim': d.update(pz=-0.03,pyw=10,s1y=-3,s2y=-4,s3y=-5,s1p=3,s2p=3,s3p=2,np_=6,nr=-4,hp=6,hr=-7,idxR=0.35)
    if name in('ready','patrol'): d.update(pz=-0.01,s2p=2,s3p=1,hp=4)
    d.update(kw); return d
FOOT0={s:REST[f'ctrl_foot_{s}'].copy() for s in 'lr'}
ANK0={s:REST[f'foot_{s}'].translation.copy() for s in 'lr'}
BALL0={s:REST[f'ball_{s}'].translation.copy() for s in 'lr'}
TOE0={s:(REST[f'ball_{s}']@V((0,P[f'ball_{s}'].bone.length,0))) for s in 'lr'}
def foot_mat(s,off=(0,0,0),pitch=0,yaw=0,pivot='ankle'):
    """foot target: rest foot translated by off, pitched (+ toe down) about ankle/ball/heel, yawed"""
    base=FOOT0[s].copy()
    piv={'ankle':ANK0[s],'ball':BALL0[s].copy(),'heel':V((ANK0[s].x,ANK0[s].y+0.06,0.02))}[pivot]
    piv=V(piv)
    ank=V(ANK0[s])
    m=M.Translation(ank)@M.Rotation(R(yaw),4,'Z')@M.Translation(-ank)@M.Translation(piv)@M.Rotation(R(pitch),4,'X')@M.Translation(-piv)@base
    m.translation+=V(off); return m
def foot_mat_blend(s,off,pitch,yaw,pivA,pivB,k):
    # same foot rotation, pivot moving smoothly from pivA to pivB (keeps the ankle path continuous)
    mA=foot_mat(s,off,pitch,yaw,pivA); mB=foot_mat(s,off,pitch,yaw,pivB)
    m=mA.copy(); m.translation=mA.translation.lerp(mB.translation,k); return m
def apply(d,feet=None,ball=None,frame=None):
    K.reset(ao)
    K.loc_world(P['pelvis'],(d['px'],d['py'],d['pz'])); K.rot(P['pelvis'],d['pp'],d['pyw'],d['pr'])
    for i in (1,2,3): K.rot(P[f'spine_0{i}'],d[f's{i}p'],d[f's{i}y'],d[f's{i}r'])
    K.rot(P['neck_01'],d['np_'],d['ny'],d['nr']); K.rot(P['head'],d['hp'],d['hy'],d['hr'])
    g=d['gpos']; G=K.gun_matrix((g[0]+d['gdx'],g[1]+d['gdy'],g[2]+d['gdz']),d['gyaw']+d['gdyaw'],d['gpitch']+d['gdp'],d['groll']+d['gdr'])
    K.set_rest_space(P['ctrl_gun'],G)
    K.curl(ao,'r',d['curlR'],index=d['idxR']); K.curl(ao,'l',d['curlL'])
    for s in 'lr':
        fm=(feet or {}).get(s); K.set_rest_space(P[f'ctrl_foot_{s}'],fm if fm is not None else FOOT0[s])
        if ball and s in ball: K.rot(P[f'ball_{s}'],ball[s],0,0)
    for i in (1,2,3,4):
        for c,sg in (('c',0),('l',1),('r',-1)):
            k=f'cape_0{i}_{c}'
            if k in P: K.rot(P[k],d['capeP']*(0.6+0.25*i),0,d['capeS']*sg*0.5+d.get('capeR',0)*(0.5+0.2*i))
    # left hand: on the gun (lhand=1) or free at lpos (armature space matrix)
    c=[c for c in P['lowerarm_l'].constraints if c.type=='IK'][0]
    if d.get('lpos') is not None:
        bpy.context.view_layer.update()
        P['ctrl_hand_l'].matrix=d['lpos']
def key(frame):
    K.key_all(ao,frame)
STATS={}
def finish(name,nframes,loop=True,speed=0.0,notes=''):
    act=ao.animation_data.action; act.name=name; act.use_fake_user=True
    act.frame_range=(0,nframes); act.use_frame_range=True; act['loop']=loop; act['speed_cm_s']=speed*100; act['notes']=notes
    # QA: sample every frame -> IK hand gap, foot gap, planted-foot slip
    bpy.context.scene.frame_start=0; bpy.context.scene.frame_end=nframes
    hgap=fgap=0; slip=0; prev=None; prev_t={'l':False,'r':False}
    for f in range(0,nframes+1):
        bpy.context.scene.frame_set(f)
        a,b=K.hand_error(ao) if True else (0,0)
        locked=lambda bn: all(c.influence>0.999 for c in P[bn].constraints)
        hl=(P['hand_l'].head-P['ctrl_hand_l'].head).length if (act.get('lhand_on',1) and locked('lowerarm_l')) else 0
        hr=(P['hand_r'].head-P['ctrl_hand_r'].head).length if locked('lowerarm_r') else 0
        fg=max(((P[f'foot_{sd}'].head-P[f'ctrl_foot_{sd}'].head).length if locked(f'calf_{sd}') else 0) for sd in 'lr')
        hgap=max(hgap,hr,hl); fgap=max(fgap,fg)
        # foot slip: world speed of a planted foot (z of sole near ground) given the character moves at `speed` along its travel dir
        cur={s:P[f'foot_{s}'].head.copy() for s in 'lr'}
        if prev is not None and speed>0:
            for s in 'lr':
                if P[f'ctrl_foot_{s}'].head.z<ANK0[s].z+0.002 and abs(P[f'ctrl_foot_{s}'].head.z-ANK0[s].z)<0.002 and prev_t[s]:
                    dv=(cur[s]-prev[s])*FPS; tv=act['dir']; wv=V((dv.x+tv[0]*speed,dv.y+tv[1]*speed,0)).length
                    slip=max(slip,wv)
        prev=cur; prev_t={s:abs(P[f'ctrl_foot_{s}'].head.z-ANK0[s].z)<0.002 for s in 'lr'}
    STATS[name]=dict(frames=nframes,seconds=round(nframes/FPS,3),loop=loop,speed_m_s=speed,max_hand_gap_cm=round(hgap*100,2),max_foot_gap_cm=round(fgap*100,2),planted_foot_slip_cm_s=round(slip*100,2),notes=notes)
    print(name,STATS[name])
    ao.animation_data.action=None
def new(name,direction=(0,-1),lhand_on=1):
    ao.animation_data_create(); a=bpy.data.actions.new(name); ao.animation_data.action=a; a['dir']=direction; a['lhand_on']=lhand_on; return a
# ---------------- locomotion ----------------
def gait(name,T,v,s,stride_dir,lift,bob,sway,yawamp,stanceKw,stanceName,lean=0,width=0.0,crouch=0.0,pz=0.0,flight=False,cape=0.0,notes=''):
    new(name,direction=stride_dir)   # character travels along stride_dir; planted feet move opposite in root space
    N=round(T*FPS); L=v*T*s
    d0=stance(stanceName,**stanceKw)
    LEG={sd:(P[f'thigh_{sd}'].bone.length+P[f'calf_{sd}'].bone.length) for sd in 'lr'}
    def frame(f,drop):
        p=f/N; feet={}; balls={}
        for side,ph in (('l',0.0),('r',0.5)):
            q=(p+ph)%1.0
            if q<s:
                u=q/s; off=L*(0.5-u)-0.03*(1 if stride_dir[1]<0 else 0); lz=0
                pitch=0; piv='ankle'; ball=0
                if u<0.12: pitch=-14*(1-u/0.12) if not flight else -6*(1-u/0.12); piv='heel'
                if u>0.72: pitch=(u-0.72)/0.28*(24 if not flight else 32); piv='ball'; ball=-pitch*0.9
            else:
                u=(q-s)/(1-s); off=-L/2-0.03*(1 if stride_dir[1]<0 else 0)+L*ss(u); lz=lift*math.sin(math.pi*u)**0.9
                pitch=(24 if not flight else 32)*(1-ss(u*2.2))-14*ss((u-0.7)/0.3); piv='ankle'; ball=-max(0,pitch)*0.5
            dx,dy=stride_dir
            sidesgn=1 if side=='l' else -1
            feet[side]=foot_mat(side,(dx*off+sidesgn*width,dy*off,lz),pitch=pitch,yaw=0,pivot=piv); balls[side]=ball
        d=dict(d0)
        fwd=(1 if stride_dir[1]<0 else -1 if stride_dir[1]>0 else 0)
        d['pz']=(pz-bob*math.cos(4*math.pi*(p-s/2))) if flight else (pz-bob*math.cos(4*math.pi*p))
        d['pz']+=d0['pz']-drop
        d['px']=sway*math.sin(2*math.pi*p)
        d['pyw']=d0['pyw']-yawamp*math.cos(2*math.pi*p)*fwd
        d['s2y']=d0['s2y']+yawamp*0.6*math.cos(2*math.pi*p)*fwd
        d['s1p']=d0['s1p']+lean*0.4; d['s2p']=d0['s2p']+lean*0.35; d['s3p']=d0['s3p']+lean*0.25; d['hp']=d0['hp']-lean*0.5
        d['pr']=-sway*60*math.sin(2*math.pi*p)
        d['gdz']=bob*0.25*math.cos(4*math.pi*p); d['gdx']=sway*0.15*math.sin(2*math.pi*p)
        d['capeP']=cape+3*math.sin(4*math.pi*p-1.0); d['capeS']=4*math.sin(2*math.pi*p-0.8)
        if crouch: d['pz']-=crouch
        apply(d,feet,balls); return feet
    # pass 1: how far must the pelvis drop so both legs reach their targets (98% extension)?
    need=[]
    for f in range(N):
        feet=frame(f,0.0); bpy.context.view_layer.update(); dr=0
        for sd in 'lr':
            hip=P[f'thigh_{sd}'].head; A=feet[sd].translation; hz=(V((A.x-hip.x,A.y-hip.y,0))).length
            maxv=math.sqrt(max(0.0,(0.98*LEG[sd])**2-hz*hz)); dr=max(dr,(hip.z-A.z)-maxv)
        need.append(max(0.0,dr))
    # cyclic smoothing (keep the max so legs never over-extend)
    sm=[max(need[(i+k)%N] for k in (-2,-1,0,1,2)) for i in range(N)]
    sm=[sum(sm[(i+k)%N] for k in (-2,-1,0,1,2))/5 for i in range(N)]
    sm=[max(a,b) for a,b in zip(sm,need)]
    for f in range(N+1):
        frame(f,sm[f%N]+0.004); key(f)
    print(name,'pelvis drop cm min/max',round(min(sm)*100,1),round(max(sm)*100,1))
    finish(name,N,True,v,notes)
# ---------------- human walk (reference-based, overlapping action) ----------------
def walkcycle(name,T,v,travel,stanceName,stanceKw=None,s=0.60,lift=0.11,bob=0.018,roll='fwd',cycles=1,crouch=0.0,
              lean=3.0,scan=0.0,gun=1.0,width=0.0,cape=0.0,notes=''):
    """Walk built from gait reference: heel strike -> foot flat -> heel rise -> toe-off; swing foot peaks early
    and reaches before contact; pelvis bob/list/rotation/sway/surge; spine, head, gun and cape trail the pelvis
    (phase lags) so the motion follows through instead of moving in lockstep. Pelvis height is a constant
    soft-knee level (no reach pumping)."""
    new(name,direction=travel)
    N=round(T*cycles*FPS); L=v*T*s
    d0=stance(stanceName,**(stanceKw or {}))
    LEG={sd:(P[f'thigh_{sd}'].bone.length+P[f'calf_{sd}'].bone.length) for sd in 'lr'}
    dx,dy=travel
    fwd=1.0 if roll=='fwd' else -1.0 if roll=='bwd' else 0.0
    yawk=abs(fwd)+(0.35 if roll=='side' else 0)
    C=lambda ph: math.cos(2*math.pi*ph); Sn=lambda ph: math.sin(2*math.pi*ph)
    def foot(side,q):
        asym=1.0 if side=='l' else 0.93
        if q<s:
            u=q/s; off=L*(0.5-u); lz=0.0; pitch=0.0; piv='ankle'; ball=0.0
            if roll=='fwd':
                if u<0.14: e=1-(1-u/0.14)**2; pitch=-16*(1-e); piv='heel'
                elif u>0.55: k=(u-0.55)/0.45; pitch=28*k**1.6; piv='ball'; ball=-pitch*0.95
            elif roll=='bwd':
                if u<0.14: e=1-(1-u/0.14)**2; pitch=12*(1-e); piv='ball'; ball=-pitch*0.9
                elif u>0.6: k=(u-0.6)/0.4; pitch=-14*k**1.5; piv='heel'
        else:
            w=(q-s)/(1-s)
            prog=ss(min(1.0,w/0.92))*1.015-0.015*ss((w-0.92)/0.08)
            off=-L/2+L*prog
            lz=lift*asym*(math.sin(math.pi*w**0.7))**1.3
            if roll=='fwd': pitch=28*(1-ss(w/0.45))-16*ss((w-0.6)/0.4)
            elif roll=='bwd': pitch=-14*(1-ss(w/0.45))+12*ss((w-0.6)/0.4)
            else: pitch=6*math.sin(math.pi*w)
            ball=-max(0.0,pitch)*0.4*(1-ss(w/0.5))
            sg=1 if side=='l' else -1; toe=sg*(6 if roll!='side' else 3)
            pa,pb={'fwd':('ball','heel'),'bwd':('heel','ball')}.get(roll,('ankle','ankle'))
            return foot_mat_blend(side,(dx*off+sg*width,dy*off,lz),pitch,toe,pa,pb,ss(w)),ball
        sg=1 if side=='l' else -1
        toe=sg*(6 if roll!='side' else 3)
        return foot_mat(side,(dx*off+sg*width,dy*off,lz),pitch=pitch,yaw=toe,pivot=piv),ball
    def frame(f,drop):
        g=f/N*cycles; p=g%1.0; feet={}; balls={}
        for side,ph in (('l',0.0),('r',0.5)):
            feet[side],balls[side]=foot(side,(p+ph)%1.0)
        d=dict(d0)
        surge=-0.010*Sn(2*p)                              # decelerate after contact, push off
        d['px']=d0['px']+0.022*Sn(p-0.08)+dx*surge
        d['py']=d0['py']+dy*surge
        d['pz']=d0['pz']-bob*C(2*(p-0.06))-drop-crouch
        d['pr']=d0['pr']-3.5*Sn(p-0.08)                   # pelvic list: swing hip drops
        d['pyw']=d0['pyw']-5.0*C(p)*yawk*(1 if fwd>=0 else -1)
        d['pp']=d0['pp']+1.0*C(2*(p-0.1))
        # spine counter-rotates and counter-lists, each level a little later than the one below
        y1=2.0*C(p-0.04)*yawk; y2=2.4*C(p-0.06)*yawk; y3=1.2*C(p-0.08)*yawk
        r1=2.0*Sn(p-0.12); r2=1.0*Sn(p-0.16); r3=0.6*Sn(p-0.2)
        d['s1y']=d0['s1y']+y1; d['s2y']=d0['s2y']+y2; d['s3y']=d0['s3y']+y3
        d['s1r']=d0['s1r']+r1; d['s2r']=d0['s2r']+r2; d['s3r']=d0['s3r']+r3
        d['s1p']=d0['s1p']+lean*0.4; d['s2p']=d0['s2p']+lean*0.35+0.8*C(2*(p-0.16)); d['s3p']=d0['s3p']+lean*0.25
        # head keeps the eyes level and forward (stabilisation), plus an optional slow scan over the loop
        yawsum=d['pyw']-d0['pyw']+y1+y2+y3; rollsum=d['pr']-d0['pr']+r1+r2+r3
        look=scan*Sn(f/N)
        d['ny']=d0['ny']-0.45*yawsum+0.4*look; d['hy']=d0['hy']-0.4*yawsum+0.6*look
        d['nr']=d0['nr']-0.4*rollsum; d['hr']=d0['hr']-0.45*rollsum
        d['hp']=d0['hp']-lean*0.5-0.9*C(2*(p-0.2))
        # weapon trails the chest: figure-eight bob and sway
        d['gdz']=gun*0.010*C(2*(p-0.14)); d['gdx']=gun*0.012*Sn(p-0.16); d['gdy']=gun*0.006*C(2*(p-0.2))
        d['gdyaw']=gun*2.2*Sn(p-0.14); d['gdr']=gun*1.8*Sn(p-0.18); d['gdp']=gun*1.2*C(2*(p-0.18))
        d['capeP']=cape+4*C(2*(p-0.3)); d['capeS']=5*Sn(p-0.3)
        apply(d,feet,balls); return feet
    need=[]
    for f in range(N):
        feet=frame(f,0.0); bpy.context.view_layer.update(); dr=0
        for sd in 'lr':
            hip=P[f'thigh_{sd}'].head; A=feet[sd].translation; hz=(V((A.x-hip.x,A.y-hip.y,0))).length
            maxv=math.sqrt(max(0.0,(0.985*LEG[sd])**2-hz*hz)); dr=max(dr,(hip.z-A.z)-maxv)
        need.append(max(0.0,dr))
    drop=max(need)+0.004   # one constant soft-knee height: the designed bob is the only vertical motion
    for f in range(N+1):
        frame(f,drop); key(f)
    print(name,'soft-knee pelvis drop cm',round(drop*100,1))
    finish(name,N,True,v,notes)
# ---------------- human run (reference-based) ----------------
def runcycle(name,T,v,s,stanceName,stanceKw=None,bias=0.1,heel=0.30,bob=0.035,lean=8.0,strike='mid',yawamp=8.0,listamp=4.0,gun=1.0,cape=8.0,notes=''):
    """Running from gait reference: flight phase; pelvis lowest at mid-stance (compression), highest mid-flight;
    landing under the body (midfoot for a jog, forefoot for a sprint); heel recovery (heel kicks up behind),
    knee drive, then the foot paws back before contact. Chest counter-rotates; head, rifle and cape trail."""
    new(name,direction=(0,-1))
    N=round(T*FPS); L=v*T*s
    d0=stance(stanceName,**(stanceKw or {}))
    LEG={sd:(P[f'thigh_{sd}'].bone.length+P[f'calf_{sd}'].bone.length) for sd in 'lr'}
    C=lambda ph: math.cos(2*math.pi*ph); Sn=lambda ph: math.sin(2*math.pi*ph)
    fwdbias=-bias*L       # contact a little ahead of the hip, toe-off further behind
    def foot(side,q):
        sg=1 if side=='l' else -1
        if q<s:
            u=q/s; off=L*(0.5-u)+fwdbias+L*0.5*0.0; lz=0.0; ball=0.0
            if strike=='fore':
                if u<0.25: e=ss(u/0.25); pitch=14*(1-e); piv='ball'; ball=-pitch*0.8
                else: pitch=0.0; piv='ankle'
            else:
                pitch=0.0; piv='ankle'
            if u>0.45: k=(u-0.45)/0.55; pitch=40*k**1.5; piv='ball'; ball=-pitch*0.9
        else:
            w=(q-s)/(1-s)
            # first the foot keeps travelling back and up (heel recovery), then the knee drives it forward,
            # it reaches slightly past the landing point and paws back into contact
            back=0.10*L*math.sin(math.pi*min(1.0,w/0.35))
            prog=ss(max(0.0,(w-0.12)/0.78))*1.04-0.04*ss((w-0.9)/0.1)
            off=-L/2+fwdbias-back+L*prog
            lz=heel*(math.sin(math.pi*w**0.75))**1.1+0.012*math.sin(math.pi*w)
            land=14 if strike=='fore' else 0
            pitch=40*(1-ss(w/0.35))+30*math.sin(math.pi*min(1.0,w/0.6))*(1-ss(w/0.6))+land*ss((w-0.6)/0.4)
            ball=-max(0.0,pitch)*0.3*(1-ss(w/0.5))
            return foot_mat_blend(side,(0.0,-off,lz),pitch,sg*5,'ball','ball' if strike=='fore' else 'ankle',ss(w)),ball
        return foot_mat(side,(0.0,-off,lz),pitch=pitch,yaw=sg*5,pivot=piv),ball
    def frame(f,drop):
        p=f/N; feet={}; balls={}
        for side,ph in (('l',0.0),('r',0.5)):
            feet[side],balls[side]=foot(side,(p+ph)%1.0)
        d=dict(d0)
        d['pz']=d0['pz']-bob*math.cos(4*math.pi*(p-s/2))-drop        # lowest at mid-stance, highest in flight
        d['py']=d0['py']-0.012*Sn(2*(p-s/2))                           # brake at contact, drive at toe-off
        d['px']=d0['px']+0.016*Sn(p-s/2)
        d['pr']=d0['pr']-listamp*Sn(p-s/2)
        d['pyw']=d0['pyw']-yawamp*C(p)
        d['pp']=d0['pp']+lean*0.3+1.5*C(2*(p-s/2))
        y1=yawamp*0.45*C(p-0.03); y2=yawamp*0.55*C(p-0.06); y3=yawamp*0.35*C(p-0.09)
        r1=listamp*0.5*Sn(p-s/2-0.06); r2=listamp*0.25*Sn(p-s/2-0.1)
        d['s1y']=d0['s1y']+y1; d['s2y']=d0['s2y']+y2; d['s3y']=d0['s3y']+y3
        d['s1r']=d0['s1r']+r1; d['s2r']=d0['s2r']+r2
        d['s1p']=d0['s1p']+lean*0.35; d['s2p']=d0['s2p']+lean*0.3+1.5*C(2*(p-s/2-0.08)); d['s3p']=d0['s3p']+lean*0.2
        yawsum=d['pyw']-d0['pyw']+y1+y2+y3; rollsum=d['pr']-d0['pr']+r1+r2
        d['ny']=d0['ny']-0.5*yawsum; d['hy']=d0['hy']-0.45*yawsum; d['nr']=d0['nr']-0.4*rollsum; d['hr']=d0['hr']-0.45*rollsum
        d['hp']=d0['hp']-lean*0.6-2.0*C(2*(p-s/2-0.12))
        d['gdz']=gun*0.020*C(2*(p-s/2-0.1)); d['gdx']=gun*0.018*Sn(p-0.14); d['gdy']=gun*0.010*C(2*(p-0.16))
        d['gdyaw']=gun*4.0*Sn(p-0.12); d['gdr']=gun*3.0*Sn(p-0.16); d['gdp']=gun*3.0*C(2*(p-s/2-0.14))
        d['capeP']=cape+6*C(2*(p-0.3)); d['capeS']=7*Sn(p-0.3)
        apply(d,feet,balls); return feet
    need=[]
    for f in range(N):
        feet=frame(f,0.0); bpy.context.view_layer.update(); dr=0
        for sd in 'lr':
            hip=P[f'thigh_{sd}'].head; A=feet[sd].translation; hz=(V((A.x-hip.x,A.y-hip.y,0))).length
            maxv=math.sqrt(max(0.0,(0.985*LEG[sd])**2-hz*hz)); dr=max(dr,(hip.z-A.z)-maxv)
        need.append(max(0.0,dr))
    drop=max(need)+0.004
    for f in range(N+1):
        frame(f,drop); key(f)
    print(name,'run pelvis drop cm',round(drop*100,1),'worst frame',need.index(max(need)),'of',N,[round(x*100) for x in need])
    finish(name,N,True,v,notes)
# ---------------- clips ----------------
def hold(name,secs,keys,loop=True,feetfn=None,notes='',lhand_on=1):
    new(name,lhand_on=lhand_on); N=round(secs*FPS)
    for f in range(N+1):
        t=f/FPS; d=env(t,keys)
        feet=feetfn(t) if feetfn else None
        apply(d,feet); key(f)
    finish(name,N,loop,0,notes)
def breathe(st,secs,amp=1.0,**extra):
    ks=[]
    for i in range(0,int(secs*10)+1):
        t=i/10; ph=2*math.pi*t/secs*round(secs/4.0 if secs>=4 else 1)
        d=dict(st); d['s2p']+=1.2*amp*math.sin(ph); d['s3p']+=1.0*amp*math.sin(ph); d['gdz']=0.004*amp*math.sin(ph); d['capeP']=1.5*math.sin(ph+1)
        d.update({k:v(t) for k,v in extra.items()}); ks.append((t,d))
    return ks
FE_AIM={'l':foot_mat('l',(0.02,-0.12,0),yaw=8),'r':foot_mat('r',(-0.04,0.12,0),yaw=-25)}
FE_RDY={'l':foot_mat('l',(0.0,-0.05,0),yaw=4),'r':foot_mat('r',(-0.02,0.06,0),yaw=-12)}
aim=stance('aim'); ready=stance('ready'); patrol=stance('patrol')
# idle (relaxed low ready, breathing)
hold('idle',4.0,breathe(ready,4.0),feetfn=lambda t:FE_RDY,notes='Relaxed low-ready idle with breathing. Loop.')
# patrol look-around
look=[(0,ready),(1.0,dict(ready,s2y=12,s3y=10,ny=14,hy=16,gdyaw=6)),(2.2,dict(ready,s2y=12,s3y=10,ny=14,hy=16,gdyaw=6)),
      (3.4,dict(ready,s2y=-12,s3y=-10,ny=-14,hy=-18,gdyaw=-6)),(4.6,dict(ready,s2y=-12,s3y=-10,ny=-14,hy=-18,gdyaw=-6)),(6.0,ready)]
hold('patrol_look',6.0,look,feetfn=lambda t:FE_RDY,notes='Patrol idle: scans left and right. Loop.')
# aim idle
hold('aim',3.0,breathe(aim,3.0,0.5),feetfn=lambda t:FE_AIM,notes='Shouldered aim idle (weight on back foot). Loop.')
# aim offsets (single poses, for an aim offset / pitch blend)
for nm,kw in (('aim_up',dict(s1p=-8,s2p=-12,s3p=-14,np_=-4,hp=-6,gdz=0.06,gdp=40,gdy=0.05)),('aim_down',dict(s1p=12,s2p=14,s3p=12,np_=8,hp=10,gdz=-0.05,gdp=-38,gdy=0.04)),
              ('aim_left',dict(s1y=14,s2y=16,s3y=16,ny=4,gdyaw=10,gdx=0.04)),('aim_right',dict(s1y=-16,s2y=-18,s3y=-16,ny=-4,gdyaw=-8,gdx=0.0,gdy=0.02))):
    d=dict(aim); [d.__setitem__(k,d.get(k,0)+v) for k,v in kw.items()]
    hold(nm,1/FPS,[(0,d)],loop=False,feetfn=lambda t:FE_AIM,notes='Aim offset pose.')
# shoot: single bolt with recoil (loopable at 200 rpm; scale play rate for faster blasters)
def recoil_keys(base,shots,interval,kick=1.0):
    ks=[(0,base)]
    for i in range(shots):
        t0=i*interval
        ks+= [(t0+0.001,dict(base,idxR=0.65)),(t0+0.04,dict(base,gdy=0.035*kick,gdz=0.012*kick,gdp=7*kick,s3p=base['s3p']-2.5*kick,hp=base['hp']-1.5*kick,idxR=0.65,pz=base['pz']+0.004)),
              (t0+min(interval,0.3)*0.9,dict(base,idxR=0.45))]
    ks.append((shots*interval,base)); return ks
hold('shoot',0.3,recoil_keys(aim,1,0.3),loop=True,feetfn=lambda t:FE_AIM,notes='One blaster bolt: trigger squeeze, kick, settle. Muzzle bone = bolt spawn. Loop for sustained fire.')
hold('shoot_burst',0.6,recoil_keys(aim,3,0.2,0.85),loop=False,feetfn=lambda t:FE_AIM,notes='Three-bolt burst.')
hold('shoot_hip',0.3,recoil_keys(stance('ready',gpitch=-6,gpos=(-0.07,-0.28,1.16),idxR=0.35),1,0.3,1.2),loop=True,feetfn=lambda t:FE_RDY,notes='Hip-fire bolt.')
# reload (swap the power cell): left hand off the gun to the belt and back
def lh_mat(pos,yaw=0,pitch=0,roll=0):
    r=REST['hand_l'].to_3x3(); m=(E((R(pitch),R(roll),R(yaw))).to_matrix()@r).to_4x4(); m.translation=V(pos); return m
gun_tilt=dict(aim,gdr=35,gdp=12,gdy=0.06,gdz=-0.06,gdyaw=-10,hp=14,np_=8,s3y=0)
belt=lh_mat((0.15,-0.16,1.02),pitch=-60,yaw=20); mag=None
def reload_keys():
    ks=[(0,aim),(0.25,gun_tilt)]
    ks+=[(0.45,dict(gun_tilt,lpos='mag')),(0.65,dict(gun_tilt,lpos='magdown',gdr=40)),(0.95,dict(gun_tilt,lpos=belt,gdr=38)),(1.15,dict(gun_tilt,lpos=belt,curlL=1.0)),
         (1.45,dict(gun_tilt,lpos='magdown')),(1.65,dict(gun_tilt,lpos='mag',gdz=-0.05)),(1.75,dict(gun_tilt,lpos='magpush',gdz=-0.055,gdp=10)),(1.9,dict(gun_tilt)),(2.2,aim)]
    return ks
def reload_clip():
    new('reload',lhand_on=0); N=round(2.2*FPS); ks=reload_keys()
    for f in range(N+1):
        t=f/FPS
        # find bracket to blend lpos manually
        prevk=max([k for k in ks if k[0]<=t],key=lambda k:k[0]); nxt=min([k for k in ks if k[0]>=t] or [ks[-1]],key=lambda k:k[0])
        dA=dict(prevk[1]); dB=dict(nxt[1]); la=dA.pop('lpos',None); lb=dB.pop('lpos',None)
        u=ss((t-prevk[0])/(nxt[0]-prevk[0])) if nxt[0]>prevk[0] else 1
        d=env(t,[(k[0],{kk:vv for kk,vv in k[1].items() if kk!='lpos'}) for k in ks])
        apply(d,FE_AIM); bpy.context.view_layer.update()
        ongun=P['ctrl_hand_l'].matrix.copy()
        def resolve(x):
            if x is None: return ongun
            if isinstance(x,str):
                m=ongun.copy(); gz=(P['ctrl_gun'].matrix.to_3x3()@V((0,0,1)))
                if x=='mag': m.translation+= -gz*0.03
                if x=='magdown': m.translation+= -gz*0.12
                if x=='magpush': m.translation+= -gz*0.015
                return m
            return x
        A=resolve(la); B=resolve(lb)
        mm=A.lerp(B,u) if hasattr(A,'lerp') else A
        loc=A.translation.lerp(B.translation,u); rq=A.to_quaternion().slerp(B.to_quaternion(),u)
        P['ctrl_hand_l'].matrix=M.Translation(loc)@rq.to_matrix().to_4x4()
        key(f)
    finish('reload',N,False,0,'Power-cell swap: tilt, pull cell, stow on belt, seat new cell, back to aim.')
reload_clip()
# hit reactions
hold('hit_front',0.7,[(0,aim),(0.08,dict(aim,pp=-6,py=0.03,s2p=-10,s3p=-12,np_=-8,hp=-10,gdz=0.06,gdp=18,gdy=0.05,s3y=6,curlL=0.6)),(0.3,dict(aim,pp=-2,s2p=-3,s3p=-4,hp=-3,gdp=6)),(0.7,aim)],loop=False,feetfn=lambda t:FE_AIM,notes='Blaster hit from the front.')
hold('hit_back',0.7,[(0,aim),(0.08,dict(aim,pp=8,py=-0.03,s2p=12,s3p=12,hp=10,gdz=-0.05,gdp=-12)),(0.3,dict(aim,s2p=4,s3p=4,gdp=-4)),(0.7,aim)],loop=False,feetfn=lambda t:FE_AIM,notes='Hit from behind.')
# death: shot, knees buckle, falls on his back; left hand lets go
# ---------------- deaths (Call of Duty style): limp limbs, dropped blaster, gravity, grounded landing ----------------
GROUND_PTS=[('head','mid',0.13),('spine_03','mid',0.16),('spine_02','mid',0.15),('pelvis','head',0.13),('neck_01','tail',0.09),
            ('upperarm_l','tail',0.06),('upperarm_r','tail',0.06),('lowerarm_l','tail',0.05),('lowerarm_r','tail',0.05),
            ('hand_l','tail',0.035),('hand_r','tail',0.035),('thigh_l','mid',0.085),('thigh_r','mid',0.085),
            ('calf_l','head',0.07),('calf_r','head',0.07),('calf_l','tail',0.06),('calf_r','tail',0.06),('ball_l','tail',0.03),('ball_r','tail',0.03)]
def body_min_z():
    bpy.context.view_layer.update(); m=1e9
    for b,where,r in GROUND_PTS:
        pb=P[b]; pt=pb.head if where=='head' else pb.tail if where=='tail' else (pb.head+pb.tail)/2
        m=min(m,pt.z-r)
    return m
GUN_PTS=[V((0,0,0)),V((0,0.45,0.08)),V((0,-0.16,0.05)),V((0,0.1,0.14)),V((0,0,-0.07))]   # weapon_r local (Y barrel, Z up)
def damp(t,t0,amp,freq=4.0,tau=0.12):
    if t<t0: return 0.0
    x=t-t0; return amp*math.exp(-x/tau)*math.sin(2*math.pi*freq*x)
def ein(x): x=max(0.0,min(1.0,x)); return x*x          # gravity-like ease-in (accelerating fall)
def eout(x): x=max(0.0,min(1.0,x)); return 1-(1-x)**2
def death_clip(name,dur,tl,release,gun_vel,gun_spin,t_contact,notes,start='aim'):
    """tl(t) -> (d, feet, ik{'armL','armR','legs'}, fk{bone:(pitch,yaw,roll)}). The blaster leaves the hand at
    `release` with velocity gun_vel (m/s, armature space) and spin (deg/s about its own axes) and is simulated
    with gravity, ground bounce and friction. The body never goes below the ground; after t_contact it rests on it."""
    new(name,lhand_on=0); N=round(dur*FPS); dt=1.0/FPS
    gun=None; prevW=None; contact_off=None
    for f in range(N+1):
        t=f/FPS
        d,feet,ik,fk=tl(t)
        apply(d,feet)
        K.limb_ik(ao,'arm','l',ik.get('armL',1)); K.limb_ik(ao,'arm','r',ik.get('armR',1)); 
        K.limb_ik(ao,'leg','l',ik.get('legs',1)); K.limb_ik(ao,'leg','r',ik.get('legs',1))
        for b,(pi,ya,ro) in fk.items(): K.rot(P[b],pi,ya,ro)
        # ground: never penetrate; rest on the floor once the body has landed
        mz=body_min_z()
        off=0.0
        if mz<0.0: off=-mz
        if t>=t_contact: off=-mz
        if off:
            K.loc_world(P['pelvis'],(d['px'],d['py'],d['pz']+off)); bpy.context.view_layer.update()
        # blaster: carried until release, then a rigid body
        bpy.context.view_layer.update()
        Wcur=P['weapon_r'].matrix.copy()
        if t<release:
            prevW=Wcur
        else:
            if gun is None:
                vel=(Wcur.translation-prevW.translation)/dt+V(gun_vel)
                gun=dict(pos=Wcur.translation.copy(),rot=Wcur.to_quaternion(),vel=vel,spin=V(gun_spin),rest=False)
            else:
                g=gun
                if not g['rest']:
                    g['vel'].z-=9.81*dt; g['pos']+=g['vel']*dt
                    q=g['rot']; w=g['spin']*dt
                    g['rot']=(q@E((R(w.x),R(w.y),R(w.z))).to_quaternion()).normalized()
                    m=M.Translation(g['pos'])@g['rot'].to_matrix().to_4x4()
                    low=min((m@p).z for p in GUN_PTS)
                    if low<0.012:
                        g['pos'].z+=0.012-low
                        if abs(g['vel'].z)>0.6: g['vel'].z=-g['vel'].z*0.28; g['vel'].x*=0.55; g['vel'].y*=0.55; g['spin']*=0.4
                        else: g['rest']=True
                if g['rest']:
                    # settle onto its side: gun X (lateral) vertical, keep its heading
                    fwd=g['rot']@V((0,1,0)); fwd.z=0
                    if fwd.length<1e-3: fwd=V((0,1,0))
                    fwd.normalize(); up=V((0,0,1)); xax=up; yax=fwd; zax=xax.cross(yax)
                    target=M((xax,yax,zax)).transposed().to_quaternion()
                    g['rot']=g['rot'].slerp(target,0.35)
                    g['vel']*=0.5; g['pos']+=V((g['vel'].x,g['vel'].y,0))*dt
                    m=M.Translation(g['pos'])@g['rot'].to_matrix().to_4x4()
                    low=min((m@p).z for p in GUN_PTS); g['pos'].z+=0.012-low
            P['weapon_r'].matrix=M.Translation(gun['pos'])@gun['rot'].to_matrix().to_4x4()
        key(f)
    finish(name,N,False,0,notes)

def mixd(a,b,u):
    out={}
    for k in set(a)|set(b):
        va=a.get(k,b.get(k)); vb=b.get(k,a.get(k))
        out[k]=lerp(va,vb,u) if isinstance(va,(int,float)) and isinstance(vb,(int,float)) else (mix(va,vb,u) if isinstance(va,tuple) else (va if u<0.5 else vb))
    return out
def segs(t,keys):
    """keys: [(t, dict, ease)] ; ease of the segment ending at that key: 's' smooth, 'i' gravity ease-in, 'o' ease-out"""
    if t<=keys[0][0]: return dict(keys[0][1])
    for (t0,a,_),(t1,b,e) in zip(keys,keys[1:]):
        if t<=t1:
            x=(t-t0)/(t1-t0) if t1>t0 else 1.0
            u={'s':ss,'i':ein,'o':eout}[e](x)
            return mixd(a,b,u)
    return dict(keys[-1][1])
LIMBS0=dict(ulp=0,ulr=0,urp=0,urr=0,llp=0,lrp=0,tlp=0,tlr=0,trp=0,trr=0,clp=0,crp=0)
def fk_of(x):
    return {'upperarm_l':(x['ulp'],0,x['ulr']),'upperarm_r':(x['urp'],0,x['urr']),'lowerarm_l':(x['llp'],0,0),'lowerarm_r':(x['lrp'],0,0),
            'thigh_l':(x['tlp'],0,x['tlr']),'thigh_r':(x['trp'],0,x['trr']),'calf_l':(x['clp'],0,0),'calf_r':(x['crp'],0,0)}
AIMFEET={'l':foot_mat('l',(0.02,-0.12,0),yaw=8),'r':foot_mat('r',(-0.04,0.12,0),yaw=-25)}

# 1) chest hit: jolt back, stagger a step, knees give, drop to the knees, pitch forward onto the face
def die_front():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    keys=[(0.00,K0,'s'),
          (0.07,dict(K0,s2p=-14,s3p=-10,hp=-14,pp=-6,py=0.04,pz=-0.04,gdp=22,gdz=0.04,curlL=0.4,armL=0.6),'o'),
          (0.30,dict(K0,s2p=-8,s3p=-6,hp=-6,pp=-3,py=0.08,pz=-0.12,pyw=18,gdp=-10,gdz=-0.08,armL=0,ulp=-5,ulr=-12,llp=-30),'s'),
          (0.62,dict(K0,s2p=14,s3p=10,hp=26,np_=10,pp=16,py=0.02,pz=-0.50,pyw=22,armL=0,armR=0.2,ulp=-12,ulr=-6,llp=-25,urp=-15,urr=8,lrp=-35,legs=1),'i'),
          (0.80,dict(K0,s2p=18,s3p=12,hp=30,np_=12,pp=28,py=-0.02,pz=-0.62,pyw=22,armL=0,armR=0,ulp=-30,ulr=-8,llp=-30,urp=-30,urr=10,lrp=-30,legs=0.6,
                      tlp=-70,trp=-65,clp=110,crp=105),'s'),
          (1.12,dict(K0,s2p=6,s3p=4,hp=-10,np_=-5,hy=0,pp=88,py=-0.55,pz=-0.70,pyw=26,armL=0,armR=0,ulp=-150,ulr=-35,llp=-50,urp=-40,urr=30,lrp=-25,legs=0,
                      tlp=-6,trp=-4,tlr=-6,trr=8,clp=25,crp=10),'i'),
          (1.35,dict(K0,s2p=2,s3p=2,hp=-14,np_=-6,hy=55,hr=18,pp=90,py=-0.58,pz=-0.70,pyw=26,armL=0,armR=0,ulp=-160,ulr=-40,llp=-60,urp=-20,urr=35,lrp=-15,legs=0,
                      tlp=-4,trp=-2,tlr=-8,trr=10,clp=10,crp=6),'o'),
          (1.9,dict(K0,s2p=2,s3p=2,hp=-14,np_=-6,hy=58,hr=20,pp=90,py=-0.58,pz=-0.70,pyw=26,armL=0,armR=0,ulp=-160,ulr=-40,llp=-62,urp=-18,urr=35,lrp=-14,legs=0,
                      tlp=-4,trp=-2,tlr=-8,trr=10,clp=10,crp=6,curlR=0.4,curlL=0.4),'s')]
    def tl(t):
        x=segs(t,keys)
        # secondary motion after the faceplant (t=1.12): head and limbs bounce, settle
        b=damp(t,1.12,1.0,3.5,0.11)
        x['hp']+=6*b; x['pz']+=0.0; x['ulp']+=10*b; x['urp']+=8*b; x['clp']+=12*b; x['crp']+=10*b; x['s2p']+=3*b
        x['capeP']=10*ss((t-0.6)/0.6)-15*ss((t-0.95)/0.3)
        # one stagger step back with the right foot
        st=ss((t-0.1)/0.22)
        feet={'l':AIMFEET['l'],'r':foot_mat('r',(-0.04,0.12+0.16*st,0.07*math.sin(math.pi*min(1,max(0,(t-0.1)/0.22)))),yaw=-25)}
        fk=fk_of(x); return x,feet,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk
    death_clip('die',1.9,tl,release=0.50,gun_vel=(0.3,-0.6,0.8),gun_spin=(-200,40,250),t_contact=1.12,
               notes='Chest hit: jolts back, staggers a step, knees give, drops to the knees, falls on his face. Blaster flies from his hands.')

# 2) blown back: violent jolt, two stumbling steps back, falls onto his back, legs bounce
def die_back():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    keys=[(0.00,K0,'s'),
          (0.06,dict(K0,s2p=-24,s3p=-16,hp=-24,np_=-8,pp=-14,py=0.10,pz=-0.02,gdp=35,gdz=0.06,armL=0.2,armR=0.5),'o'),
          (0.20,dict(K0,s2p=-20,s3p=-12,hp=-18,pp=-16,py=0.30,pz=-0.06,armL=0,armR=0,ulp=-50,ulr=-45,llp=-25,urp=-45,urr=40,lrp=-30),'s'),
          (0.40,dict(K0,s2p=-16,s3p=-10,hp=-10,pp=-24,py=0.50,pz=-0.18,armL=0,armR=0,ulp=-60,ulr=-60,llp=-20,urp=-55,urr=55,lrp=-25,legs=0.5,
                      tlp=-25,trp=-10,clp=30,crp=15),'s'),
          (0.74,dict(K0,s2p=-8,s3p=-4,hp=-25,np_=-8,pp=-86,py=0.75,pz=-0.72,armL=0,armR=0,ulp=-80,ulr=-65,llp=-25,urp=-70,urr=70,lrp=-30,legs=0,
                      tlp=-35,trp=-20,clp=40,crp=25),'i'),
          (1.0,dict(K0,s2p=-4,s3p=-2,hp=-4,np_=0,hy=-35,hr=-10,pp=-90,py=0.78,pz=-0.72,armL=0,armR=0,ulp=-100,ulr=-75,llp=-35,urp=-80,urr=80,lrp=-40,legs=0,
                      tlp=-12,trp=-6,tlr=-8,trr=6,clp=18,crp=10),'o'),
          (1.6,dict(K0,s2p=-4,s3p=-2,hp=-4,np_=0,hy=-40,hr=-12,pp=-90,py=0.78,pz=-0.72,armL=0,armR=0,ulp=-100,ulr=-78,llp=-38,urp=-78,urr=82,lrp=-42,legs=0,
                      tlp=-10,trp=-5,tlr=-9,trr=7,clp=16,crp=9,curlR=0.4,curlL=0.4),'s')]
    def tl(t):
        x=segs(t,keys)
        b=damp(t,0.74,1.0,3.0,0.13)
        x['tlp']-=18*b; x['trp']-=14*b; x['hp']-=10*b; x['ulp']-=8*b; x['urp']-=8*b; x['s2p']-=3*b
        x['capeP']=-12*ss((t-0.1)/0.3)+20*ss((t-0.6)/0.3)
        s1=ss((t-0.06)/0.16); s2=ss((t-0.18)/0.18)
        feet={'l':foot_mat('l',(0.02,-0.12+0.30*s1,0.08*math.sin(math.pi*min(1,max(0,(t-0.06)/0.16)))),yaw=8),
              'r':foot_mat('r',(-0.04,0.12+0.34*s2,0.08*math.sin(math.pi*min(1,max(0,(t-0.18)/0.18)))),yaw=-25)}
        return x,feet,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    death_clip('die_back',1.6,tl,release=0.10,gun_vel=(-0.8,0.4,1.6),gun_spin=(380,-60,140),t_contact=0.74,
               notes='Blown backward: violent jolt, two stumbling steps back, lands on his back, legs bounce. Blaster flung away.')

# 3) headshot: lights out, straight-down crumple, slumps onto his side
def die_headshot():
    K0=dict(aim,**LIMBS0,armL=1,armR=1,legs=1)
    keys=[(0.00,K0,'s'),
          (0.05,dict(K0,hp=-28,np_=-10,s3p=-6,gdp=10,armL=0.4,armR=0.5),'o'),
          (0.16,dict(K0,hp=-10,np_=-4,s2p=4,s3p=4,pz=-0.10,armL=0,armR=0,ulp=-10,llp=-20,urp=-10,lrp=-25),'s'),
          (0.48,dict(K0,hp=35,np_=15,s1p=8,s2p=14,s3p=10,pp=12,pz=-0.60,pr=-6,armL=0,armR=0,ulp=5,llp=-10,urp=5,lrp=-10,legs=0.7,
                      tlp=-80,trp=-75,clp=120,crp=115),'i'),
          (0.82,dict(K0,hp=20,np_=10,hr=-25,s1p=6,s2p=9,s3p=6,pp=10,pz=-0.70,pr=-88,px=-0.30,armL=0,armR=0,ulp=-30,ulr=25,llp=-40,urp=-60,urr=-20,lrp=-50,legs=0,
                      tlp=-30,trp=-18,clp=45,crp=35),'i'),
          (1.3,dict(K0,hp=18,np_=8,hr=-28,s1p=6,s2p=8,s3p=6,pp=10,pz=-0.70,pr=-90,px=-0.32,armL=0,armR=0,ulp=-35,ulr=28,llp=-45,urp=-62,urr=-22,lrp=-55,legs=0,
                      tlp=-28,trp=-16,clp=46,crp=36,curlR=0.4,curlL=0.4),'o')]
    def tl(t):
        x=segs(t,keys); b=damp(t,0.82,1.0,3.5,0.1)
        x['hr']+=8*b; x['ulp']+=10*b; x['urp']+=10*b; x['clp']+=8*b
        x['capeP']=6*ss((t-0.2)/0.4); x['capeR']=18*ss((t-0.55)/0.4)
        return x,AIMFEET,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    death_clip('die_headshot',1.3,tl,release=0.12,gun_vel=(0.0,-0.2,0.2),gun_spin=(90,0,200),t_contact=0.82,
               notes='Headshot: instant limp collapse straight down, slumps onto his side. Blaster drops from his hands.')

# 4) shot while running: momentum carries him forward into a sliding faceplant
def die_run():
    st=stance('port'); K0=dict(st,**LIMBS0,armL=1,armR=1,legs=1,s1p=st['s1p']+5,s2p=st['s2p']+4,hp=st['hp']-6)
    # forward travel: running speed 4.2 m/s decaying to zero (body slides on landing)
    def travel(t): v0=4.2; k=3.2; return -(v0/k)*(1-math.exp(-k*t))
    keys=[(0.00,dict(K0,pz=-0.06),'s'),
          (0.08,dict(K0,pz=-0.08,s2p=-6,hp=-12,gdp=10,armL=0.4,armR=0.6),'o'),
          (0.30,dict(K0,pz=-0.22,pp=30,s2p=10,s3p=8,hp=10,armL=0,armR=0,ulp=-60,ulr=-15,llp=-20,urp=-55,urr=15,lrp=-25,legs=0.4,tlp=-30,trp=15,clp=40,crp=60),'s'),
          (0.58,dict(K0,pz=-0.72,pp=88,s2p=4,s3p=2,hp=-12,armL=0,armR=0,ulp=-140,ulr=-25,llp=-35,urp=-120,urr=25,lrp=-40,legs=0,tlp=-6,trp=4,clp=30,crp=15),'i'),
          (0.95,dict(K0,pz=-0.72,pp=90,s2p=2,s3p=2,hp=-14,hy=-50,hr=-15,armL=0,armR=0,ulp=-155,ulr=-30,llp=-50,urp=-30,urr=25,lrp=-20,legs=0,tlp=-4,trp=2,tlr=-6,trr=6,clp=14,crp=10),'o'),
          (1.4,dict(K0,pz=-0.72,pp=90,s2p=2,s3p=2,hp=-14,hy=-55,hr=-16,armL=0,armR=0,ulp=-158,ulr=-32,llp=-52,urp=-25,urr=26,lrp=-18,legs=0,tlp=-4,trp=2,tlr=-6,trr=6,clp=14,crp=8,curlR=0.4,curlL=0.4),'s')]
    def tl(t):
        x=segs(t,keys); x['py']=travel(t)
        b=damp(t,0.58,1.0,3.5,0.11); x['ulp']+=10*b; x['urp']+=10*b; x['hp']+=6*b; x['clp']+=15*b; x['crp']+=10*b
        x['capeP']=-14*ss(t/0.3)+10*ss((t-0.5)/0.3)
        u=ss(t/0.3)
        feet={'l':foot_mat('l',(0,-0.10+travel(t)*0.5*u,0.10*u),pitch=30*u),'r':foot_mat('r',(0,0.25+travel(t)*0.5*u,0.18*u),pitch=40*u)}
        return x,feet,dict(armL=x['armL'],armR=x['armR'],legs=x['legs']),fk_of(x)
    death_clip('die_run',1.4,tl,release=0.14,gun_vel=(0.2,-3.2,1.2),gun_spin=(-420,30,120),t_contact=0.58,
               notes='Shot while running: momentum throws him forward into a sliding faceplant (travels ~1.3 m). Blaster flies ahead.')
die_front(); die_back(); die_headshot(); die_run()
# jump (in place: capsule moves in Unreal)
hold('jump',0.9,[(0,ready),(0.12,dict(ready,pz=-0.09,s2p=10,s3p=6)),(0.22,dict(ready,pz=0.0,s2p=-2)),(0.55,dict(ready,pz=0.0,s2p=4,capeP=-12)),(0.7,dict(ready,pz=-0.11,s2p=12,s3p=8)),(0.9,ready)],loop=False,
     feetfn=lambda t:{s:foot_mat(s,(0,0,0.16*ss((t-0.2)/0.12)*(1-ss((t-0.5)/0.15))),pitch=25*ss((t-0.15)/0.1)*(1-ss((t-0.45)/0.15))) for s in 'lr'},notes='Jump: crouch, push, tuck, land.')
# crouch aim + crouch walk
FE_CR={'l':foot_mat('l',(0.04,-0.22,0),yaw=10),'r':foot_mat('r',(-0.06,0.24,0.0),pitch=35,pivot='ball',yaw=-20)}
cra=stance('aim',pz=-0.40,pp=12,s1p=8,s2p=6,s3p=-2,hp=2)
hold('crouch_aim',3.0,breathe(cra,3.0,0.5),feetfn=lambda t:FE_CR,notes='Crouched aim (cover). Loop.')
hold('crouch_shoot',0.3,recoil_keys(cra,1,0.3),loop=True,feetfn=lambda t:FE_CR,notes='Crouched bolt.')
walkcycle('crouch_walk',1.1,1.0,(0,-1),'aim',dict(pp=14,s1p=8,s2p=6,s3p=-2,hp=2,idxR=0.35),s=0.64,lift=0.08,bob=0.010,crouch=0.30,lean=0,gun=0.45,cape=6,notes='Crouched advance, rifle up. 1.0 m/s.')
# walking
walkcycle('walk',0.96,1.4,(0,-1),'patrol',s=0.58,lift=0.11,bob=0.018,cycles=2,lean=3,scan=7,gun=1.0,notes='Patrol walk, low ready, heel-toe, scanning. 1.4 m/s.')
walkcycle('aim_walk_fwd',0.96,1.3,(0,-1),'aim',s=0.62,lift=0.09,bob=0.012,lean=2,gun=0.45,cape=3,notes='Tactical walk forward while aiming (soft knees, stable rifle). 1.3 m/s.')
walkcycle('aim_walk_bwd',1.0,1.1,(0,1),'aim',s=0.62,lift=0.08,bob=0.011,roll='bwd',lean=2,gun=0.45,notes='Backpedal while aiming (toe-first contact). 1.1 m/s.')
walkcycle('aim_strafe_l',0.86,1.2,(1,0),'aim',s=0.55,lift=0.08,bob=0.010,roll='side',lean=2,gun=0.45,width=0.03,notes='Strafe left while aiming. 1.2 m/s.')
walkcycle('aim_strafe_r',0.86,1.2,(-1,0),'aim',s=0.55,lift=0.08,bob=0.010,roll='side',lean=2,gun=0.45,width=0.03,notes='Strafe right while aiming. 1.2 m/s.')
runcycle('run',0.70,4.2,0.30,'port',dict(curlR=0.9),bias=0.12,heel=0.30,bob=0.035,lean=10,strike='mid',yawamp=8,listamp=4,gun=1.0,cape=9,notes='Combat jog, rifle at port: midfoot landing, heel recovery, flight phase. 4.2 m/s.')
runcycle('sprint',0.62,6.2,0.24,'sprint',{},bias=0.06,heel=0.44,bob=0.04,lean=18,strike='fore',yawamp=10,listamp=5,gun=1.2,cape=12,notes='Sprint, rifle across chest: forefoot landing, high heel recovery and knee drive. 6.2 m/s.')
# melee: rifle-butt strike
hold('melee',0.9,[(0,ready),(0.2,dict(ready,s2y=-25,s3y=-20,pyw=-10,gpos=(-0.1,-0.18,1.32),gyaw=60,gpitch=10,groll=-80,curlL=1.0)),
                  (0.36,dict(ready,s2y=22,s3y=18,pyw=12,s2p=8,gpos=(-0.02,-0.42,1.38),gyaw=-40,gpitch=40,groll=-90,curlL=1.0)),(0.55,dict(ready,s2y=10,s3y=8,gpos=(-0.04,-0.36,1.3),gyaw=-20,gpitch=20,groll=-60)),(0.9,ready)],
     loop=False,feetfn=lambda t:{'l':foot_mat('l',(0.02,-0.05-0.15*ss((t-0.15)/0.2)*(1-ss((t-0.6)/0.3)),0.04*math.sin(math.pi*max(0,min(1,(t-0.12)/0.22)))),yaw=4),'r':FE_RDY['r']},notes='Rifle-butt melee strike with a step.')
# hand signals (patrol): left hand raised fist (halt) / forward chop (move up)
def signal(name,poses,secs,notes):
    new(name,lhand_on=0); N=round(secs*FPS)
    for f in range(N+1):
        t=f/FPS; apply(dict(ready,curlL=1.0 if 'halt' in name else 0.15),FE_RDY); bpy.context.view_layer.update()
        ongun=P['ctrl_hand_l'].matrix.copy(); tgt=None
        for (t0,t1,m) in poses:
            if t0<=t<=t1: tgt=(ss((t-t0)/0.25) if t<t0+0.25 else 1)*(1-ss((t-(t1-0.3))/0.3)), m
        if tgt:
            k,m=tgt; m=P['spine_03'].matrix@REST['spine_03'].inverted()@m
            P['ctrl_hand_l'].matrix=M.Translation(ongun.translation.lerp(m.translation,k))@ongun.to_quaternion().slerp(m.to_quaternion(),k).to_matrix().to_4x4()
        key(f)
    finish(name,N,False,0,notes)
signal('signal_halt',[(0.1,1.4,lh_mat((0.24,-0.12,1.55),pitch=180,yaw=-10))],1.6,'Patrol hand signal: halt (raised fist).')
signal('signal_moveup',[(0.1,1.3,lh_mat((0.16,-0.42,1.36),pitch=-95,yaw=-15))],1.5,'Patrol hand signal: move up (forward point).')
bpy.context.scene.frame_set(0)
for o in bpy.context.scene.objects: o.select_set(False)
bpy.ops.object.mode_set(mode='OBJECT')
json.dump(STATS,open(f'{w}/anim_stats.json','w'),indent=1)
bpy.ops.wm.save_as_mainfile(filepath=f'{w}/anim.blend')
print('ANIMS',len(STATS))
