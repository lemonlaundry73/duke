# Blaster Trooper (Phase II clone trooper + blaster carbine)

Rigged, skinned and animated from the creator's uploaded Phase II clone trooper and blaster models
(this replaced the earlier caped trooper on 2026-11-08; that version is in git history, commit 82e158a). Patrol and combat ready, holding the
blaster in both hands, firing red blaster bolts.

Status: **rigged and animated, validated in Blender and the browser. Not yet imported or tested in Unreal**
(this pack was built in a Linux container with no Unreal Editor). See *Unreal status* below.

## What is here

| Folder | Contents |
|---|---|
| `Source/` | The original uploads, untouched (Tripo-generated GLB, meshopt-compressed): `trooper_armor_source.glb` (came with Tripo's own 80-joint auto-rig, which is discarded), `blaster_source.glb`; `character.json` (no cape, place the skeleton on the source's joints) |
| `Unreal/SK_Trooper.fbx` | Skeletal mesh: trooper (84,902 tris) + blaster (19,996 tris) skinned to `weapon_r`. 1.83 m. 62 bones |
| `Unreal/Animations/` | 31 animation FBX files, `A_Trooper_<clip>.fbx`, 30 fps, in place (no root motion) |
| `Unreal/SM_Blaster.fbx` | The blaster as a static mesh: origin at the pistol grip, muzzle along +X, 0.61 m long |
| `Unreal/Textures/` | 4K BaseColor and Normal (OpenGL; flip green in Unreal) for both; ORM (R occlusion, G roughness, B metallic): 4K for the blaster, a flat map for the trooper from its source values (roughness 0.9, metallic 0), since the source has no roughness texture |
| `Audio/` | Star Wars-style blaster shots (3 variations) and an impact, physically modelled on the original struck-guy-wire technique. No recordings or samples |
| `Web/trooper.glb` | Everything in one GLB with all 31 clips (2K textures) for web preview |
| `QA/` | `anim_stats.json` (per-clip IK and foot-slip metrics), `stretch.json` (mesh stretch per clip), `validation.json` (re-import check), renders |

Rebuild everything from `Source/` with `tools/rigging/run.sh <work> <out>`.

## Skeleton

Unreal mannequin naming, so the UE5 IK Retargeter can map it to Manny/Quinn animation:
`root, pelvis, spine_01..03, neck_01, head, clavicle_l/r, upperarm, lowerarm, hand, thumb/index/middle/ring/pinky_01..03, thigh, calf, foot, ball`,
plus `ik_foot_root, ik_foot_l/r, ik_hand_root, ik_hand_gun, ik_hand_l/r` (keyed to match the hands and feet).

Extra bones:
- `weapon_r` (child of `hand_r`): the blaster's grip. The built-in blaster is 100% weighted to it; any other weapon can snap here.
- `muzzle` (child of `weapon_r`): barrel tip. Bolts spawn here.

## Animation clips

| Group | Clips |
|---|---|
| Patrol | `idle` (low ready, breathing), `patrol_look` (scans left/right), `walk` (1.4 m/s, two-stride loop with a slow head scan), `signal_halt`, `signal_moveup` |
| Locomotion | `run` (4.2 m/s, rifle at port, midfoot landing), `sprint` (6.2 m/s, forefoot landing), `jump`, `crouch_walk` (1.0 m/s) |
| Combat stance | `aim`, `aim_walk_fwd` (1.3 m/s), `aim_walk_bwd` (1.1), `aim_strafe_l` / `aim_strafe_r` (1.2), `crouch_aim` |
| Aim offsets | `aim_up`, `aim_down`, `aim_left`, `aim_right` (single poses) |
| Firing | `shoot` (one bolt, loopable), `shoot_burst` (3 bolts), `shoot_hip`, `crouch_shoot` |
| Deaths | `die` (chest hit: stagger, knees give, faceplant), `die_back` (blown back two steps onto his back), `die_headshot` (instant limp crumple onto his side), `die_run` (momentum carries him ~1.3 m into a sliding faceplant). In all four the arms go limp and the blaster leaves his hands and tumbles to the floor |
| Other | `reload` (power-cell swap, 2.2 s), `hit_front`, `hit_back`, `melee` (rifle-butt strike) |

Run and sprint use human running reference: a flight phase, the pelvis lowest at mid-stance and highest in the air, landing under the body,
heel recovery (heel kicks up behind), knee drive and the foot pawing back into contact, with counter-rotating chest and trailing head and rifle (and cape, on caped characters).

Deaths are Call of Duty style: limbs switch from IK to limp FK, falls accelerate like gravity, the body is kept on the floor (never through it) and
bounces and settles on impact, and the blaster is simulated as a rigid body (gravity, bounce, friction, settles on its side). Unreal picks the death
from the hit: running -> `die_run`, head-height hit -> `die_headshot`, shot from behind or heavy damage -> `die_back`, otherwise `die`.

Walks (`walk`, `aim_walk_*`, `aim_strafe_*`, `crouch_walk`) are built from human gait reference: heel strike, foot flat, heel rise and toe push-off;
the swing foot peaks early and reaches before contact; pelvis bob, side drop, rotation, sway and a small forward surge per step;
the spine, head and rifle (and a cape, if the character has one) each trail the pelvis slightly (overlapping action), the head stays level, and the knees stay soft
at one constant height instead of the hips pumping to reach.

How they were made: a control rig (IK arms locked to the blaster, IK legs with knee/elbow pole targets), with
procedurally authored keys. Locomotion feet are planted in world space at the clip's authored speed, and the
pelvis drops automatically wherever a leg would over-extend.

## Measured quality (from `QA/`)

- Hands on the blaster (while held): no gap in 30 of 31 clips; 1.61 cm briefly in the `melee` swing.
- Foot targets reached in every clip while the legs are locked (max 0.9 cm), except `die_run` (7.75 cm, as the legs give way).
- Planted-foot slip at the authored speed: 0.9–9.9 cm/s across walks, strafes, run and sprint (sub-millimetre per frame).
- Mesh stretch (edges stretched over 3x versus idle, of ~125k): under 40 in 22 of 31 clips (walk: 0, run: 26, sprint: 20); deaths and melee 74–145.
- Re-import check: the FBX has 62 bones, both meshes and materials, and is 1.83 m tall; all 31 animation FBXs re-import with keys on every bone; the GLB has all 31 clips.

## Known limits

- The source is a single fused Tripo mesh. Faces where body parts touch (arms at the armpits) were cut apart and holes filled; small seams may show up close.
- Joint positions come from the source's Tripo skeleton; skin weights are Duke's own (bone-distance weighting with per-limb separation and smoothing).
- The trooper's roughness is one flat value from the source (0.9, matte). A painted roughness map would give the armour a more realistic semi-gloss.
- The blaster is scaled to 0.61 m (a carbine) so both hands reach it.
- Animations are procedurally keyed from gait reference, not motion-captured.

## Unreal status

Code for the Duke game template (`src/unreal/template`) is in the repo but has **not been compiled or run** here:
- `DukeTrooper` (character: patrol → alert → combat → death AI, bursts of bolts from `muzzle`, reloads, hit reactions, crouch under fire)
- `DukeTrooperAnimInstance` (graph-free native anim instance: speed- and direction-matched locomotion blending, cross-fades, aim pitch, upper-body action layer)
- `DukeBlasterBolt` (red emissive bolt with glow, light, impact flash and sound)
- `DukeCharacter` now fires visible bolts for any weapon whose type contains "Blaster", and attaches weapons to `weapon_r` when the mesh has it.
- `Content/Python/duke_trooper_import.py` imports this pack: textures (normal green flip), PBR and bolt materials, skeletal mesh, 31 animations, static blaster, sounds.

To finish on the Windows GPU worker:
1. Copy `Unreal/` and `Audio/` to `<Project>/Import/characters/clone_trooper/`.
2. Build the project, then run `UnrealEditor-Cmd <Project>.uproject -run=pythonscript -script=<Project>/Content/Python/duke_trooper_import.py`.
3. Read `Saved/DukeForge/trooper_import.json` for errors, then place `DukeTrooper` actors (or call `spawn_test_troopers()`) and run PIE.

## Provenance

| Asset | Origin |
|---|---|
| Trooper armor mesh + textures | Creator upload `clone_trooper_armor_3d_model.glb` (Tripo, with Tripo auto-rig; gltfpack 1.2), 2026-11-08 |
| Blaster mesh + textures | Creator upload `assault_rifle_3d_model.glb` (Tripo; gltfpack 1.2), 2026-11-01 |
| Rig, weights, animations, LOD0 reduction | Generated by Duke Forger (`tools/rigging`, Blender 4.5 as a Python module) |
| Blaster sounds | `tools/rigging/blaster_sfx.py`: physical model of a hammer-struck steel guy-wire (dispersive bending waves), the technique behind the classic film blaster. Not Lucasfilm's recordings |
