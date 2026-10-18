// Duke 3D Generator: the production recipes ("scripts") used for every asset type.
// Each recipe fixes what a professional pipeline fixes before anything is generated: the photos it needs,
// the generator settings, the real-world size, the polygon and texture budgets per level of detail,
// how the result is finished for Unreal, and the quality gates it must pass.
// Nothing leaves the pipeline as "AAA" unless it passes every gate in `gates`.

// Required photo angles. `need` = must be uploaded; others improve results.
export const VIEWS={
  front:{label:'Front',hint:'Facing the camera straight on, eyes level with the middle of the subject.'},
  back:{label:'Back',hint:'Turned exactly 180°. Same distance, height and lighting as the front.'},
  left:{label:'Left side',hint:'The subject\'s left side, turned exactly 90°.'},
  right:{label:'Right side',hint:'The subject\'s right side, turned exactly 90°.'},
  three_quarter:{label:'Three-quarter (optional)',hint:'Front-left at 45°. Helps the generator read depth.'},
  detail:{label:'Close-up detail (optional)',hint:'Face, logo-free markings or the most important detail, filling the frame.'}
};

// Rules every photo is checked against, in the browser before upload and again on the server.
export const PHOTO_RULES=[
  'At least 1024 × 1024 pixels (2048 or more is best). PNG or JPG.',
  'One subject only, the whole subject in frame with a little space around it. Nothing cut off.',
  'Plain, evenly lit background: white, gray or a transparent PNG. No clutter, no other people.',
  'Soft, even light from the front. No hard shadows, no colored light, no flash glare.',
  'Same distance, height and lens for every angle. Turn the subject, not the camera height.',
  'Sharp focus. No motion blur, no filters, no watermarks, no text.',
  'Characters: stand in an A-pose (arms 30–45° away from the body, legs slightly apart), neutral face, mouth closed.',
  'Clothing and gear exactly as they should appear in game. Every angle must show the same outfit.'
];

const LOD=(...tris)=>tris;

export const RECIPES={
  character_hero:{
    label:'Hero character',kind:'character',
    for:'Your main character and anyone seen in close-ups and cutscenes.',
    views:['front','back','left','right'],optional:['three_quarter','detail'],
    height_m:1.8,pose:'A-pose',
    providers:{
      rodin:{tier:'Gen-2',quality:'high',mesh_mode:'Quad',material:'PBR',condition_mode:'concat',TAPose:true,addons:['HighPack'],quality_override:150000},
      meshy:{ai_model:'latest',geometry_resolution:'2k',texture_resolution:'4k',enable_pbr:true,should_remesh:true,topology:'quad',target_polycount:150000,pose_mode:'a-pose',remove_lighting:true,image_enhancement:true}
    },
    lods:LOD(120000,60000,25000,8000),texture:4096,
    finish:{rig:'humanoid',collision:'capsule',pivot:'feet',materials:['body','outfit'],sockets:['hand_r','hand_l','head','spine_03']},
    gates:{maxTrisLOD0:160000,minTrisLOD0:40000,minTexture:4096,maxNonManifoldPct:0.5,heightTolerance:0.03,needsUV:true,needsPBR:true,maxIslands:4}
  },
  character_npc:{
    label:'Soldier / NPC',kind:'character',
    for:'Enemies, squadmates and civilians seen at gameplay distance.',
    views:['front','back','left','right'],optional:['three_quarter'],
    height_m:1.78,pose:'A-pose',
    providers:{
      rodin:{tier:'Gen-2',quality:'high',mesh_mode:'Quad',material:'PBR',condition_mode:'concat',TAPose:true,quality_override:80000},
      meshy:{ai_model:'latest',geometry_resolution:'2k',texture_resolution:'4k',enable_pbr:true,should_remesh:true,topology:'quad',target_polycount:80000,pose_mode:'a-pose',remove_lighting:true,image_enhancement:true}
    },
    lods:LOD(60000,30000,12000,4000),texture:4096,
    finish:{rig:'humanoid',collision:'capsule',pivot:'feet',materials:['body','outfit'],sockets:['hand_r','hand_l','head']},
    gates:{maxTrisLOD0:90000,minTrisLOD0:20000,minTexture:2048,maxNonManifoldPct:0.5,heightTolerance:0.03,needsUV:true,needsPBR:true,maxIslands:4}
  },
  weapon:{
    label:'Weapon',kind:'weapon',
    for:'Guns and melee weapons held in first person (seen very close up).',
    views:['left','right','front','back'],optional:['detail'],
    length_m:0.9,
    providers:{
      rodin:{tier:'Gen-2',quality:'high',mesh_mode:'Quad',material:'PBR',condition_mode:'concat',addons:['HighPack'],quality_override:60000},
      meshy:{ai_model:'latest',geometry_resolution:'2k',texture_resolution:'4k',enable_pbr:true,should_remesh:true,topology:'quad',target_polycount:60000,remove_lighting:true,image_enhancement:true}
    },
    lods:LOD(50000,20000,6000),texture:4096,
    finish:{collision:'convex',pivot:'grip',sockets:['Muzzle','Grip','Magazine','Sight'],orient:'barrel_x'},
    gates:{maxTrisLOD0:70000,minTrisLOD0:8000,minTexture:4096,maxNonManifoldPct:1,sizeTolerance:0.05,needsUV:true,needsPBR:true,maxIslands:12}
  },
  vehicle:{
    label:'Vehicle',kind:'vehicle',
    for:'Cars, trucks and armored vehicles (unbranded).',
    views:['front','back','left','right'],optional:['three_quarter'],
    length_m:5.2,
    providers:{
      rodin:{tier:'Gen-2',quality:'high',mesh_mode:'Quad',material:'PBR',condition_mode:'concat',addons:['HighPack'],quality_override:200000},
      meshy:{ai_model:'latest',geometry_resolution:'2k',texture_resolution:'4k',enable_pbr:true,should_remesh:true,topology:'quad',target_polycount:200000,remove_lighting:true,image_enhancement:true}
    },
    lods:LOD(150000,60000,20000,6000),texture:4096,
    finish:{collision:'convex_parts',pivot:'ground_center',sockets:['Driver','Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR']},
    gates:{maxTrisLOD0:220000,minTrisLOD0:30000,minTexture:4096,maxNonManifoldPct:1,sizeTolerance:0.05,needsUV:true,needsPBR:true,maxIslands:40}
  },
  prop:{
    label:'Prop',kind:'prop',
    for:'Barriers, crates, furniture, signs and other world objects.',
    views:['front','back','left','right'],optional:['three_quarter'],
    size_m:1.0,
    providers:{
      rodin:{tier:'Gen-2',quality:'medium',mesh_mode:'Quad',material:'PBR',condition_mode:'concat',quality_override:20000},
      meshy:{ai_model:'latest',geometry_resolution:'standard',texture_resolution:'2k',enable_pbr:true,should_remesh:true,topology:'quad',target_polycount:20000,remove_lighting:true,image_enhancement:true}
    },
    lods:LOD(15000,6000,1500),texture:2048,
    finish:{collision:'convex',pivot:'ground_center'},
    gates:{maxTrisLOD0:25000,minTrisLOD0:500,minTexture:2048,maxNonManifoldPct:2,sizeTolerance:0.05,needsUV:true,needsPBR:true,maxIslands:20}
  },
  building:{
    label:'Building / hero landmark',kind:'building',
    for:'A single building or landmark facade seen from the street.',
    views:['front','back','left','right'],optional:['three_quarter','detail'],
    size_m:12,
    providers:{
      rodin:{tier:'Gen-2',quality:'high',mesh_mode:'Quad',material:'PBR',condition_mode:'concat',addons:['HighPack'],quality_override:200000},
      meshy:{ai_model:'latest',geometry_resolution:'2k',texture_resolution:'4k',enable_pbr:true,should_remesh:true,topology:'quad',target_polycount:200000,remove_lighting:true,image_enhancement:true}
    },
    lods:LOD(150000,50000,12000,3000),texture:4096,
    finish:{collision:'box_parts',pivot:'ground_center',nanite:true},
    gates:{maxTrisLOD0:250000,minTrisLOD0:5000,minTexture:4096,maxNonManifoldPct:2,sizeTolerance:0.05,needsUV:true,needsPBR:true,maxIslands:80}
  }
};

export function recipeView(id){const r=RECIPES[id];return r&&{id,label:r.label,kind:r.kind,for:r.for,views:r.views,optional:r.optional,lods:r.lods,texture:r.texture,
  size:r.height_m?{what:'Height',m:r.height_m}:r.length_m?{what:'Length',m:r.length_m}:{what:'Size',m:r.size_m},pose:r.pose||null,gates:r.gates};}
