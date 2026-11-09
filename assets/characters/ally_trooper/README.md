# Alliance Trooper

Allied NPC soldiers: the same armour, skeleton, clip set, deaths, ragdoll physics and squad behaviour as the Empire
blaster trooper (`assets/characters/clone_trooper`), with their own rifle and **blue** bolts.

- **Body:** `Source/trooper_armor_source.glb` is byte-identical to the Empire trooper's armour source (same SHA-256), so the body, rig and weights are the same.
- **Rifle:** `Source/blaster_source.fbx`, the modern assault rifle. Grip, handguard and muzzle points are in `Source/blaster.json`.
  - Scaled to 0.68 m.
  - The left hand holds the handguard just behind the vertical foregrip. The foregrip itself is 26 cm ahead of the pistol grip, out of reach in the trooper stances.
- **Faction:** `alliance`. In Unreal (`ADukeTrooper`, `Faction = Alliance`), allies fire blue bolts and target Empire troopers. Empire troopers target the allies, the Jedi and the player.
- **Unreal folder:** `/Game/DukeForge/Characters/AllyTrooper` (from `Unreal/pack.json`; `duke_trooper_import.py` reads it). Set `AssetPath` on the actor to this folder.
- **No lightsaber attacks:** allies have only the trooper clip set. They can still *be hit* by a lightsaber (saber hit and dismemberment endings), like every trooper.

## Contents

| Folder | |
|---|---|
| `Unreal/` | `SK_Trooper.fbx`, `Animations/A_Trooper_<clip>.fbx`, `Cuts/` (pre-cut dismemberment meshes), `Textures/`, `pack.json` |
| `Web/` | `trooper.glb` (all clips), `trooper_web.glb` (meshopt) |
| `Audio/` | synthesized blaster, explosion and saber sounds (no recordings) |
| `QA/` | per-clip measurements (see the Empire trooper README for what each file means) |

Rebuild: `SRC=assets/characters/ally_trooper/Source tools/rigging/run.sh <work> <out>`.
