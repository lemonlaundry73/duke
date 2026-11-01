#!/usr/bin/env bash
# Rebuild the blaster trooper from the two source GLBs:
#   orient/scale/decimate -> cape mask + landmarks -> skeleton + skin weights + blaster on weapon_r
#   -> control rig + 28 animations (with QA) -> Unreal FBX / textures / web GLB -> re-import validation.
# Needs: Python 3.11 with `pip install bpy==4.5.*` (Blender as a module), Node with @gltf-transform/cli.
# Usage: tools/rigging/run.sh <work dir> <out dir>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
W="${1:?work dir}"; O="${2:?out dir}"; PY="${BLENDER_PY:-python3.11}"
SRC="$REPO/assets/characters/clone_trooper/Source"
mkdir -p "$W" "$O"
# glTF from Tripo/gltfpack is meshopt-compressed and quantized; Blender needs it plain
npx --yes @gltf-transform/cli@4.1.1 dequantize "$SRC/trooper_armor_source.glb" "$W/trooper_dq.glb"
npx --yes @gltf-transform/cli@4.1.1 dequantize "$SRC/blaster_source.glb" "$W/blaster_dq.glb"
"$PY" -I "$HERE/inspect.py" "$W"            # import both -> raw.blend
"$PY" -I "$HERE/prep.py" "$W"               # 1.83 m, feet at origin, 85k-tri trooper -> prep.blend
"$PY" -I "$HERE/stage1.py" "$W"             # face -Y, cape mask, joint landmarks -> s1.blend
"$PY" -I "$HERE/stage2.py" "$W"             # skeleton, weights, bridge cuts, blaster -> s2.blend
"$PY" -I "$HERE/anims.py" "$HERE" "$W"      # control rig + clips + QA -> anim.blend, anim_stats.json
"$PY" -I "$HERE/stretch.py" "$W/anim.blend" # mesh stretch per clip -> stretch.json
"$PY" -I "$HERE/export.py" "$W" "$O"        # Unreal/ (FBX + textures), Web/trooper.glb
mkdir -p "$O/Audio"; "$PY" -I "$HERE/blaster_sfx.py" "$O/Audio"
"$PY" -I "$HERE/validate.py" "$O"           # re-import everything -> validation.json
echo "done: $O"
