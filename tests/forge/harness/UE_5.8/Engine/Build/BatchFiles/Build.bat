#!/bin/sh
# TEST HARNESS ONLY: stands in for Unreal Build Tool on Linux.
echo "Building $1..."; proj=$(echo "$4" | sed 's/-Project=//'); root=$(dirname "$proj")
if grep -rq "SYNTAX_ERROR" "$root/Source" 2>/dev/null; then echo "$root/Source/x.cpp(3): error C2065: 'SYNTAX_ERROR': undeclared identifier"; exit 6; fi
echo "Total time in Parallel executor: 1.00 seconds"; exit 0
