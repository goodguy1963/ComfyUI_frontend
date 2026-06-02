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
| R2 | Add drag/pan fast-path instrumentation for Yjs transaction and layout sync rates before changing behavior. | Complete | Unit tests, typecheck, browser API smoke. |
| R3 | Implement interaction fast-path or transient layout buffering for Vue node drag. | Complete | Layout store tests, drag tests, Replacer pan probe. |
| R4 | Implement viewport mount-set hysteresis. | Complete | `viewportMountedNodes` tests, typecheck, Replacer probe. |
| R5 | Make slot geometry pan-free for active canvas pan where cached offsets exist. | Complete | Slot tracking tests, typecheck, Replacer probe. |
| R6 | Continue link/minimap phase separation only after profiling confirms the next hotspot. | Complete: no-op | Existing CPU profile and current probes do not justify another speculative link/minimap patch. |
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

### R2 Layout/Yjs/Sync Instrumentation

Changes:

- Added `window.__COMFY_LAYOUT_PERF__` via `src/renderer/core/layout/performance/layoutPerfInstrumentation.ts`.
- Instrumented `layoutStore.applyOperation()`, Yjs transaction entry, changed node counts, node/global dispatches, `useLayoutSync()` scheduling, flushes, and dirty calls.
- Wired the existing Replacer Playwright instrumentation to call `__COMFY_LAYOUT_PERF__.start()` / `stop()` and include `layoutPerf` counters.
- Updated the Replacer Playwright test to set middle zoom before waiting for Vue nodes. This avoids the far-zoom canvas mode where mounted Vue nodes are intentionally `0`.

Tests:

- `node node_modules\vitest\vitest.mjs run src/renderer/core/layout/performance/layoutPerfInstrumentation.test.ts src/renderer/core/layout/store/layoutStore.test.ts src/renderer/core/layout/sync/useLayoutSync.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- Browser smoke against `http://127.0.0.1:5274/` confirmed `window.__COMFY_LAYOUT_PERF__` exists and remains zeroed/inactive until started.

Playwright caveat:

- Running the full targeted Playwright test through repo global setup timed out after loading the Replacer workflow because the test environment tried to manage the live `ComfyUI/user` folder while the `8190` backend had `comfyui.db` locked.
- Future full Playwright runs should use an isolated `TEST_COMFYUI_DIR`, not the live backend user directory.

### R3 Transient Vue Node Drag Buffer

Changes:

- Added transient node layout overlays in `layoutStore`.
- Vue node drag now updates transient positions during RAF-driven drag preview.
- Yjs/layout operations are committed once on drag end through `commitTransientNodePositions()`.
- Snap-on-release discards the transient preview and commits snapped bounds in one batch.

Scope:

- This targets Vue node dragging write amplification. It is not expected to fix canvas pan latency, because canvas pan does not move node layouts.

Tests:

- `node node_modules\vitest\vitest.mjs run src/renderer/core/layout/store/layoutStore.test.ts src/renderer/extensions/vueNodes/layout/useNodeDrag.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `node output_sessions\replacer_input_latency_probe.cjs > output_sessions\r3-transient-node-drag-replacer-probe.json`

Probe result:

| Replacer probe after R3 | Value |
| --- | ---: |
| App ready | 5597 ms |
| Workflow load | 22478 ms |
| Total | 33173 ms |
| Far mounted nodes | 0 |
| Far pan | 47.6 ms |
| Far wheel | 42.7 ms |
| Middle mounted nodes | 66 |
| Middle pan | 137.1 ms |
| Middle wheel | 42.5 ms |
| Close mounted nodes | 20 |
| Close pan | 99.8 ms |
| Close wheel | 67.4 ms |

Interpretation:

- Mounted node counts stayed stable.
- Canvas pan latency remains unresolved and noisy; this task was a node-drag write-amplification cleanup.

### R4 Viewport Mount Hysteresis

Changes:

- Added an exit overscan window for Vue node mounting.
- Nodes enter with the current tight overscan, but previously mounted nodes remain mounted until they leave the larger exit window.
- Focused/centered sticky nodes are still forced mounted.
- Far-zoom canvas mode still clears Vue node DOM completely.

Tests:

- `node node_modules\vitest\vitest.mjs run src/components/graph/viewportMountedNodes.test.ts src/components/graph/GraphCanvas.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `node output_sessions\replacer_input_latency_probe.cjs > output_sessions\r4-viewport-hysteresis-replacer-probe.json`

Probe result:

| Replacer probe after R4 | Value |
| --- | ---: |
| App ready | 6658 ms |
| Workflow load | 19533 ms |
| Total | 30280 ms |
| Far mounted nodes | 0 |
| Far pan | 57.3 ms |
| Far wheel | 34.6 ms |
| Middle mounted nodes | 76 |
| Middle pan | 36.2 ms |
| Middle wheel | 45.6 ms |
| Close mounted nodes | 29 |
| Close pan | 29.9 ms |
| Close wheel | 49.1 ms |

Interpretation:

- Hysteresis intentionally retains more mounted nodes at middle/close zoom (`66 -> 76`, `20 -> 29` in this local sequence).
- The single-sample pan result improved strongly at middle/close zoom, likely because fewer mount/unmount edges occur during movement.
- This needs repeated samples before claiming a stable win.

### R5 Slot Cache During Active Canvas Pan

Changes:

- Extended slot DOM-measurement deferral from pure middle-button pan to any active canvas pan state where `canvas.dragging_canvas && canvas.pointer.isDown`.
- If usable cached slot offsets exist, slot layouts update from node layout position without DOMRect reads.
- Dirty DOM measurement is deferred until after pan release.

Tests:

- `node node_modules\vitest\vitest.mjs run src/renderer/extensions/vueNodes/composables/useSlotElementTracking.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `node output_sessions\replacer_input_latency_probe.cjs > output_sessions\r5-slot-pan-cache-replacer-probe.json`

Probe result:

| Replacer probe after R5 | Value |
| --- | ---: |
| App ready | 5680 ms |
| Workflow load | 19035 ms |
| Total | 28744 ms |
| Far mounted nodes | 0 |
| Far pan | 35.4 ms |
| Far wheel | 29.8 ms |
| Middle mounted nodes | 76 |
| Middle pan | 45.5 ms |
| Middle wheel | 44.7 ms |
| Close mounted nodes | 29 |
| Close pan | 27.6 ms |
| Close wheel | 43.7 ms |

Interpretation:

- Mounted node counts stayed the same as R4.
- Middle/close pan stayed in the improved range in this single sample.
- A DOMRect attribution run is still needed before claiming DOM reads are fully eliminated during all pan cases.

### R6 Link/Minimap Follow-Up Decision

Decision:

- No new link or minimap behavior change was made in this task.

Reason:

- Earlier research already reduced normal link drawing and minimap polling substantially.
- Current R4/R5 probe samples show the next visible problem is still noisy interaction latency and startup/workflow-load behavior, not a freshly confirmed link/minimap hotspot.
- R22 explicitly recommends continuing link/minimap phase separation only after profiling confirms the next hotspot. Making another patch here without attribution would make the research branch dirtier without a defensible target.

Next profiling requirement:

- Run a fresh CPU/callsite attribution pass after the startup/load task or after repeated R5 samples show a stable remaining pan hotspot.
