#!/usr/bin/env bash
# Rebuild the blaster trooper from the two source GLBs:
#   orient/scale/decimate -> cape mask + landmarks -> skeleton + skin weights + blaster on weapon_r
#   -> control rig + 28 animations (with QA) -> Unreal FBX / textures / web GLB -> re-import validation.
# Needs: Python 3.11 with `pip install bpy==4.5.*` (Blender as a module), Node with @gltf-transform/cli.
# Usage: tools/rigging/run.sh <work dir> <out dir>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
W="${1:?work dir}"; O="${2:?out dir}"; PY="${BLENDER_PY:-python3.11}"
SRC="${SRC:-$REPO/assets/characters/clone_trooper/Source}"
mkdir -p "$W" "$O"
# glTF from Tripo/gltfpack is meshopt-compressed and quantized; Blender needs it plain
npx --yes @gltf-transform/cli@4.1.1 dequantize "$SRC/trooper_armor_source.glb" "$W/trooper_dq.glb"
npx --yes @gltf-transform/cli@4.1.1 dequantize "$SRC/blaster_source.glb" "$W/blaster_dq.glb"
for cfg in character.json blaster.json; do if [ -f "$SRC/$cfg" ]; then cp "$SRC/$cfg" "$W/"; fi; done
if grep -q '"joints": *"source"' "$W/character.json" 2>/dev/null; then
  "$PY" -I "$HERE/strip_rig.py" "$W"        # pre-rigged source: keep its mesh + joint positions, drop its skin
else
  "$PY" -I "$HERE/inspect.py" "$W"          # import both -> raw.blend
fi
"$PY" -I "$HERE/prep.py" "$W"               # 1.83 m, feet at origin, 85k-tri trooper -> prep.blend
"$PY" -I "$HERE/stage1.py" "$W"             # face -Y, cape mask, joint landmarks -> s1.blend
"$PY" -I "$HERE/stage2.py" "$W"             # skeleton, weights, bridge cuts, blaster -> s2.blend
"$PY" -I "$HERE/anims.py" "$HERE" "$W"      # control rig + clips + QA -> anim.blend, anim_stats.json
"$PY" -I "$HERE/cuts.py" "$W"            # lightsaber/explosion dismemberment variants -> cut_variants.json
"$PY" -I "$HERE/ragdoll.py" "$W"         # physics ragdoll for every death (muscle tone fades, limp on the ground) -> baked
"$PY" -I "$HERE/ground_pass.py" "$W"     # living clips: mesh never below the floor
"$PY" -I "$HERE/stretch.py" "$W/anim.blend" # mesh stretch per clip -> stretch.json
"$PY" -I "$HERE/export.py" "$W" "$O"        # Unreal/ (FBX + textures), Web/trooper.glb
mkdir -p "$O/Audio"; "$PY" -I "$HERE/blaster_sfx.py" "$O/Audio"
# web preview: meshopt-compressed copy (three.js MeshoptDecoder); the plain GLB stays for tools that cannot decode it
npx --yes @gltf-transform/cli@4.1.1 meshopt "$O/Web/trooper.glb" "$O/Web/trooper_web.glb"
"$PY" -I "$HERE/validate.py" "$O"           # re-import everything -> validation.json
QA_ALL=1 "$PY" -I "$HERE/death_qa.py" "$W"   # every clip: floor contact + mesh self-intersection -> body_qa.json
"$PY" -I "$HERE/drag_pair.py" "$W" "$O"   # rescuer/wounded alignment for the drag -> drag_pair.json
echo "done: $O"
