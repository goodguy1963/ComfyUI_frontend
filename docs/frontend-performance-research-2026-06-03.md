# Frontend Performance Research Continuation

Branch: `perf/replacer-pan-optimizations`

Purpose: continue using this branch as the research preview branch. Proven changes can later be split into clean branches from `origin/main`.

Date note: the local execution environment reported `2026-06-02`; the user requested this continuation as the June 3 work log. Exact benchmark artifacts should keep their generated timestamps.

## Baseline States To Compare

| State | Meaning |
| --- | --- |
| `main` | Latest upstream `origin/main` used for fair comparison. |
| `research-start` | Current research branch before the June 3 continuation tasks. |
| `research-final` | Research branch after the full task sequence is complete. |

## Task List

### Cosmetic And UX Stabilization

| ID | Task | Status | Required tests |
| --- | --- | --- | --- |
| C1 | Fix low-detail Vue nodes that become blacked out without usable title information. | Complete | Targeted Vue node tests, full typecheck, Replacer visual/perf probe. |
| C2 | Fix far-zoom canvas nodes with oversized titles or oversized header bars. | Complete | `panSnapshotCanvas` tests, Replacer far/middle/close probe. |
| C3 | Add or update visual assertions for far-zoom and low-detail rendering consistency. | Pending | Unit tests plus screenshot or canvas probe where feasible. |

### R22 Implementation Sequence

| ID | Task | Status | Required tests |
| --- | --- | --- | --- |
| R1 | Stabilize instrumentation and comparison reporting for `main`, `research-start`, and `research-final`. | Complete | Benchmark probe runs on all available states. |
| R2 | Add drag/pan fast-path instrumentation for Yjs transaction and layout sync rates before changing behavior. | Pending | Unit tests, typecheck, Replacer probe with instrumentation counters. |
| R3 | Implement interaction fast-path or transient layout buffering behind a feature flag. | Pending | Layout store tests, drag/resize tests, Replacer pan probe. |
| R4 | Implement delta-based mounting or mount-set hysteresis behind a feature flag. | Pending | `viewportMountedNodes` tests, GraphCanvas tests, Replacer probe. |
| R5 | Make slot geometry fully pan-free where safe. | Pending | Slot tracking tests, DOMRect attribution probe. |
| R6 | Continue link/minimap phase separation only after profiling confirms the next hotspot. | Pending | CPU profile/probe comparison, minimap tests. |
| R7 | Investigate startup/workflow-load regression against `main`. | Pending | App-ready/workflow-load probe, focused startup instrumentation. |
| R8 | Produce final research report with `main` vs `research-start` vs `research-final`. | Pending | Full test summary and benchmark summary. |

## Commit Policy

- One implementation task per commit where possible.
- Each commit should update this report or the benchmark report with test evidence.
- Do not commit transient artifacts from `output_sessions/` or browser HAR files.

## Completed Task Evidence

### C1/C2 Cosmetic Node Visuals

Changes:

- Low-detail Vue nodes now keep a cheap title strip instead of becoming an information-free colored shell.
- Far-zoom canvas snapshots now hide titles at very far zoom, clamp header height, and fall back from transparent or near-black custom fills.
- Heavy internals remain pruned in low-detail mode; the change only restores title-level information.

Tests:

- `node node_modules\vitest\vitest.mjs run src/renderer/core/layout/transform/panSnapshotCanvas.test.ts src/renderer/extensions/vueNodes/components/LGraphNode.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `node output_sessions\replacer_input_latency_probe.cjs > output_sessions\cosmetic-node-visuals-replacer-probe.json`

Probe result:

| Replacer probe after C1/C2 | Value |
| --- | ---: |
| App ready | 5169 ms |
| Workflow load | 19194 ms |
| Total | 28444 ms |
| Far mounted nodes | 0 |
| Far pan | 50.7 ms |
| Far wheel | 26.0 ms |
| Middle mounted nodes | 66 |
| Middle pan | 77.8 ms |
| Middle wheel | 38.7 ms |
| Close mounted nodes | 20 |
| Close pan | 101.1 ms |
| Close wheel | 39.8 ms |

### R1 Replacer Probe Summary Helper

Change:

- Added `scripts/replacer-probe-summary.cjs` to render consistent Markdown tables from one or more `replacer_input_latency_probe.cjs` JSON outputs.
- The helper is intentionally small and independent of transient `output_sessions/` files, so future research commits can quote comparable tables without hand-parsing JSON.

Command:

```powershell
node scripts\replacer-probe-summary.cjs main=output_sessions\fair-main-branch-tests-20260602\main-replacer-probe.json research-start=output_sessions\fair-main-branch-tests-20260602\branch-replacer-probe.json research-current=output_sessions\cosmetic-node-visuals-replacer-probe.json
```

Single-sample local comparison:

| Metric | main | research-start | research-current |
| --- | ---: | ---: | ---: |
| App ready | 5224 | 8548 | 5169 |
| Workflow load | 9170 | 20278 | 19194 |
| Probe total | 19327 | 33586 | 28444 |
| Far mounted nodes | 291 | 0 | 0 |
| Far pan | 70.1 | 56.0 | 50.7 |
| Far wheel | 90.9 | 61.9 | 26.0 |
| Middle mounted nodes | 291 | 66 | 66 |
| Middle pan | 61.9 | 166.9 | 77.8 |
| Middle wheel | 102.8 | 57.6 | 38.7 |
| Close mounted nodes | 291 | 20 | 20 |
| Close pan | 51.0 | 75.7 | 101.1 |
| Close wheel | 105.7 | 62.2 | 39.8 |

Interpretation:

- Treat this as a continuity table, not a final benchmark. These are single samples from already-created local probe outputs.
- The cosmetic patch keeps the same mounted-node counts as the research-start state.
- Close-pan latency remains noisy and is still an unresolved issue.
