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
| C3 | Add or update visual assertions for far-zoom and low-detail rendering consistency. | Complete | Unit tests plus canvas draw assertions. |

### R22 Implementation Sequence

| ID | Task | Status | Required tests |
| --- | --- | --- | --- |
| R1 | Stabilize instrumentation and comparison reporting for `main`, `research-start`, and `research-final`. | Complete | Benchmark probe runs on all available states. |
| R2 | Add drag/pan fast-path instrumentation for Yjs transaction and layout sync rates before changing behavior. | Complete | Unit tests, typecheck, browser API smoke. |
| R3 | Implement interaction fast-path or transient layout buffering for Vue node drag. | Complete | Layout store tests, drag tests, Replacer pan probe. |
| R4 | Implement viewport mount-set hysteresis. | Complete | `viewportMountedNodes` tests, typecheck, Replacer probe. |
| R5 | Make slot geometry pan-free for active canvas pan where cached offsets exist. | Complete | Slot tracking tests, typecheck, Replacer probe. |
| R6 | Continue link/minimap phase separation only after profiling confirms the next hotspot. | Complete: no-op | Existing CPU profile and current probes do not justify another speculative link/minimap patch. |
| R7 | Investigate startup/workflow-load regression against `main`. | Complete | Load timeline probe on current research branch. |
| R8 | Produce final research report with `main` vs `research-start` vs `research-final`. | Complete | Full test summary and benchmark summary. |

## Remaining DeepResearch Backlog

These items come from `docs/deep-research-r22.md`. They are intentionally split into smaller implementation commits for the research branch.

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| D1 | Add stronger visual assertions for low-detail and far-zoom node rendering. | Complete | Added canvas draw assertions and low-detail strip assertions. |
| D2 | Fix first startup/workflow-load synchronous frontend block. | Complete | Removed duplicate bootstrap replay and chunked topology seeding. |
| D3 | Extend transient layout buffering from Vue node drag to resize where safe. | Complete: already satisfied | Resize preview is DOM-only and commits layout once. |
| D4 | Add DOMRect attribution after R5 to prove remaining slot/layout reads. | Pending | Needed before claiming slot geometry is fully pan-free. |
| D5 | Implement true delta-mounted node registry instead of computed list rebuild. | Pending | R4 added hysteresis only. |
| D6 | Add velocity-aware viewport overscan/hysteresis tuning. | Pending | Should reduce edge pop-in without overmounting. |
| D7 | Rewrite `useGraphNodeManager` hot load path toward patch/incremental extraction. | Pending | Large startup/load candidate. |
| D8 | Make `useLayoutSync` dirty/flush behavior more granular. | Pending | Use R2 counters to guide this. |
| D9 | Profile and implement next confirmed link drawing optimization. | Pending | No speculative link work without a profile. |
| D10 | Move minimap model toward event-driven updates. | Pending | Earlier pan skip helped; full event model remains. |
| D11 | Add widget intrinsic sizing/cache API. | Pending | Correctness plus layout churn reduction. |
| D12 | Continue queue/output/execution store selectorization. | Pending | Prior partial improvements exist; not complete. |
| D13 | Prototype OffscreenCanvas for minimap or far-zoom layer. | Pending | Start with a contained canvas layer only. |
| D14 | Prototype worker spatial query/snapshot planning. | Pending | No UI rewrite. |
| D15 | Evaluate optional Rust/WASM geometry kernel after worker boundary exists. | Pending | Last step, not near-term. |

## Commit Policy

- One implementation task per commit where possible.
- Each commit should update this report or the benchmark report with test evidence.
- Do not commit transient artifacts from `output_sessions/` or browser HAR files.

## Completed Task Evidence

### D1/C3 Visual Assertions

Changes:

- Added draw-level `panSnapshotCanvas` tests to verify far-zoom compact nodes do not draw title text.
- Added draw-level test to verify readable snapshot nodes still draw title text.
- Strengthened the low-detail Vue node test to verify the cheap title strip remains visible while slots/widgets stay pruned.

Tests:

- `node node_modules\vitest\vitest.mjs run src/renderer/core/layout/transform/panSnapshotCanvas.test.ts src/renderer/extensions/vueNodes/components/LGraphNode.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`

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

### R7 Startup / Workflow Load Timeline

Change:

- Added `scripts/replacer-load-timeline.cjs` to separate app ready, workflow file submit, first graph nodes, first render surface, workflow idle, and settled state.

Command:

```powershell
$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'
$env:REPLACER_LOAD_TIMELINE_OUT='output_sessions\r7-load-timeline-current.json'
node scripts\replacer-load-timeline.cjs
```

Current research branch timeline:

| Mark | Time |
| --- | ---: |
| App ready | 4708 ms |
| Workflow file submitted | 4720 ms |
| First graph nodes observable | 18727 ms |
| First render surface observable | 18767 ms |
| Workflow idle observable | 18794 ms |
| Settled 5s | 23812 ms |

Interpretation:

- At the `workflow-file-submitted` mark, the state already reported `291` graph nodes and far-zoom canvas active, but the next observable mark did not run until about `18.7s`.
- This suggests the browser main thread is blocked for roughly `14s` during workflow load/setup after file submission.
- The extension-manager busy flag was already false by the observable marks. The regression is more likely synchronous frontend graph/load/render initialization than backend/network wait.
- Next implementation target should be startup/load phase splitting: visible/far-zoom surface first, deferred non-visible Vue node/lifecycle/index work second.

## Final Validation

Commands:

- `node node_modules\vitest\vitest.mjs run *> output_sessions\final-research-vitest.log`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false *> output_sessions\final-research-typecheck.log`
- `node output_sessions\replacer_input_latency_probe.cjs > output_sessions\final-research-replacer-probe.json`
- `node scripts\replacer-probe-summary.cjs main=output_sessions\fair-main-branch-tests-20260602\main-replacer-probe.json research-start=output_sessions\fair-main-branch-tests-20260602\branch-replacer-probe.json research-final=output_sessions\final-research-replacer-probe.json`

Automated tests:

| Check | Result |
| --- | --- |
| Full Vitest | 828 passed files, 11194 passed tests, 8 skipped |
| Typecheck | Passed |

Final single-sample comparison:

| Metric | main | research-start | research-final |
| --- | ---: | ---: | ---: |
| App ready | 5224 | 8548 | 9220 |
| Workflow load | 9170 | 20278 | 27209 |
| Probe total | 19327 | 33586 | 41554 |
| Far mounted nodes | 291 | 0 | 0 |
| Far pan | 70.1 | 56.0 | 33.2 |
| Far wheel | 90.9 | 61.9 | 54.4 |
| Middle mounted nodes | 291 | 66 | 76 |
| Middle pan | 61.9 | 166.9 | 64.7 |
| Middle wheel | 102.8 | 57.6 | 78.1 |
| Close mounted nodes | 291 | 20 | 29 |
| Close pan | 51.0 | 75.7 | 46.5 |
| Close wheel | 105.7 | 62.2 | 66.6 |

Final interpretation:

- Interaction responsiveness improved materially compared with `research-start`.
- Far zoom remains the clearest win: Vue DOM stays at `0`, and far pan is better than both comparison states in this final sample.
- Middle pan recovered from the bad `research-start` result and is now close to main in this sample.
- Close pan is slightly better than main in this sample.
- Mounted node counts at middle/close increased because R4 hysteresis intentionally keeps recently visible nodes mounted longer to avoid edge churn.
- Startup/workflow-load is not fixed. It is worse in the final single sample and remains the next major blocker.
- The R7 timeline indicates the load issue is likely a long synchronous frontend block after workflow file submission.

## Continued DeepResearch Implementation

### D2 Startup / Workflow Load Split

Changes:

- Removed duplicate existing-node bootstrap replay in `useGraphNodeManager()`.
  - Existing nodes are already extracted by `syncWithGraph()`.
  - Replaying `graph.onNodeAdded()` for every existing node extracted all nodes again and created layout entries that lifecycle seeding later replaced.
- Split lifecycle seeding into synchronous node layout seeding and asynchronous topology seeding.
  - Node positions/sizes still seed immediately for first render.
  - Reroutes and links seed in small async chunks so the browser can return to the event loop sooner.

Tests:

- `node node_modules\vitest\vitest.mjs run src/composables/graph/useVueNodeLifecycle.test.ts src/composables/graph/useGraphNodeManager.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'; $env:REPLACER_LOAD_TIMELINE_OUT='output_sessions\d2-async-topology-load-timeline.json'; node scripts\replacer-load-timeline.cjs`
- `node output_sessions\replacer_input_latency_probe.cjs > output_sessions\d2-async-topology-replacer-probe.json`

Load timeline result:

| Mark | Before R7 sample | D2 after |
| --- | ---: | ---: |
| App ready | 4708 ms | 5654 ms |
| Workflow file submitted | 4720 ms | 5665 ms |
| First graph nodes observable | 18727 ms | 11293 ms |
| First render surface observable | 18767 ms | 11335 ms |
| Workflow idle observable | 18794 ms | 11353 ms |
| Settled 5s | 23812 ms | 16373 ms |

Replacer probe comparison against previous final sample:

| Metric | before | after |
| --- | ---: | ---: |
| App ready | 9220 | 5690 |
| Workflow load | 27209 | 12970 |
| Probe total | 41554 | 23144 |
| Far mounted nodes | 0 | 0 |
| Far pan | 33.2 | 33.0 |
| Far wheel | 54.4 | 48.1 |
| Middle mounted nodes | 76 | 76 |
| Middle pan | 64.7 | 49.0 |
| Middle wheel | 78.1 | 49.7 |
| Close mounted nodes | 29 | 29 |
| Close pan | 46.5 | 67.3 |
| Close wheel | 66.6 | 45.9 |

Interpretation:

- This is the first clear startup/load improvement after R7.
- The first observable render moved much earlier in the load timeline.
- Replacer workflow load dropped substantially in the normal probe.
- Close pan remains noisy; this task was startup/load focused.

### D3 Resize Fast-Path Verification

Decision:

- No additional resize buffering patch was needed.

Reason:

- `useNodeResize.ts` emits `phase: 'preview'` during pointer movement.
- `LGraphNode.vue` handles preview by directly updating `--node-width`, `--node-height`, and preview position.
- `layoutStore.batchUpdateNodeBounds()` is called only on commit.
- This already matches the intended transient/commit split and avoids Yjs writes per resize frame.

Tests:

- `node node_modules\vitest\vitest.mjs run src/renderer/extensions/vueNodes/interactions/resize/useNodeResize.test.ts src/renderer/extensions/vueNodes/components/LGraphNode.test.ts`
