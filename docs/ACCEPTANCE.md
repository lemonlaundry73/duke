# V1 acceptance status

Only results observed on a real Unreal Engine worker count. The protocol test in `tests/forge` runs the full
job flow against a stand-in engine (`tests/forge/harness`) to check orchestration, Git, the File Vault,
uploads and the repair loop; it is not an acceptance test.

| Test | Status |
| --- | --- |
| Live Unreal: project, actor via bridge, compile, PIE, shown in browser | pending real worker run |
| Concept Studio: original, variation, compare, approve, history, asset registry | passes (server feature, no Unreal needed) |
| Project files: tree, edit, commit, diff, rollback | passes against harness; pending real worker run |
| Build: Windows artifact, logs, stored, downloadable | pending real worker run |
| Agent: room with door, compile, PIE door validation, evidence, commit, live | pending real worker run |
