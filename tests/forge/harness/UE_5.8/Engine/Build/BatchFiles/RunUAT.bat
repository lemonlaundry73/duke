#!/bin/sh
# TEST HARNESS ONLY: stands in for AutomationTool.
for a in "$@"; do case "$a" in -archivedirectory=*) out="${a#-archivedirectory=}";; esac; done
mkdir -p "$out/Windows"; echo "fake exe" > "$out/Windows/Game.exe"; echo "BUILD SUCCESSFUL"; exit 0
