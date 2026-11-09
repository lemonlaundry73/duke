#!/usr/bin/env bash
# Hilt source (dense AI/photogrammetry GLB) -> game hilt for assets/characters/<c>/Source/blaster_source.glb
#   weld + simplify (~14k tris) + 2K textures, then centre and scale to 0.28 m along +Z.
# Usage: tools/rigging/hilt_prep.sh <source.glb> <out.glb> [ratio=0.018]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; PY="${BLENDER_PY:-python3.11}"
IN="${1:?source glb}"; OUT="${2:?out glb}"; RATIO="${3:-0.018}"
T="$(mktemp -d)"; trap 'rm -rf -- "$T"' EXIT
GT="npx --yes @gltf-transform/cli@4.1.1"
$GT weld "$IN" "$T/w.glb"
$GT simplify "$T/w.glb" "$T/s.glb" --ratio "$RATIO" --error 0.001
$GT resize "$T/s.glb" "$T/r.glb" --width 2048 --height 2048
"$PY" -I "$HERE/hilt_fit.py" "$T/r.glb" "$OUT"
