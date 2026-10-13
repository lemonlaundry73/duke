# Duke Forger V1 architecture

Duke Forger turns a natural-language command into a verified change inside a real Unreal Engine 5 project.

```
Browser (/forge workspace)
   │  HTTPS + Server-Sent Events
   ▼
Duke Forger server (Node, server.js)
   ├─ src/forge/index.js     orchestrator: durable jobs and steps, repair loop, File Vault RPC,
   │                         Concept Studio, asset registry, builds, evidence
   ├─ src/forge/codegen.js   director interpreter, C++ and level generation, PIE test definitions
   └─ src/link.js            Live view and Pixel Streaming relay
   ▲  long-poll (agent token)
   │
Unreal worker = Duke app (public/agent/duke_agent.py, class Forge) on a Windows GPU PC or cloud runner
   ├─ Unreal Build Tool (Build.bat)         compile
   ├─ Unreal Editor + Duke Forger plugin    automation bridge, PIE tests, screenshots
   │     unreal/DukeForgerPlugin/Content/Python/duke_forger_bridge.py
   ├─ Git + Git LFS                          versions, diffs, rollback
   ├─ AutomationTool (RunUAT BuildCookRun)   packaged Windows builds
   └─ Pixel Streaming (editor streaming)     Live Unreal
```

## Durable jobs

Jobs and their steps are stored in the database (`db.forge.jobs`). A step is leased to the worker while it
runs; if the worker restarts it reports `boot` and its running steps are offered again; if a lease expires the
sweeper re-offers the step. Browser closure and server restarts do not lose work.

Result states: PLANNED, IMPLEMENTING, COMPILING, TESTING, FIXING, READY, BLOCKED (plus STOPPED when the
creator stops a job). READY requires a passing test and a commit (configurable in Settings > autonomy).

## Automation bridge

The plugin's Python runs inside the editor on the main thread (Slate post-tick). The worker drops command files
into `<Project>/Saved/DukeForger/inbox` and reads answers from `outbox`. Commands: ping, python (with bridge
helpers for levels, actors, lights, materials), save_all, describe, pie_start, pie_stop, screenshot, run_test
(multi-frame PIE scripts with assertions), quit. The plugin writes a heartbeat every second.

## Repair loop

When a compile, editor or test step fails, the orchestrator (up to `max_repair_attempts`):
1. applies a known deterministic repair when it recognises the failure, otherwise
2. asks the creator's connected AI model for a minimal code fix,
3. rebuilds and re-runs the failed step.
Without a model and without a known repair, the job is BLOCKED with the real error.

## Stack choice

The specification lists Next.js, FastAPI, PostgreSQL, Temporal, Redis and S3. V1 is built inside the existing,
deployed Duke Forger service (a zero-dependency Node server with a JSON store on a persistent disk), as the
specification allows for an existing repository. The orchestrator keeps the same responsibilities (durable
workflows with leases and retries, events over SSE, object storage on disk), so it can move to Temporal/Postgres/S3
when scale requires it without changing the worker protocol.
