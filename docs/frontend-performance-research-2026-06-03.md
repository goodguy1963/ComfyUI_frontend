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
| D4 | Add DOMRect attribution after R5 to prove remaining slot/layout reads. | Complete | Added standalone attribution probe; remaining reads are low and mostly not slot-cache misses. |
| D5 | Implement true delta-mounted node registry instead of computed list rebuild. | Complete | Replaced computed side-effect rebuild with stable shallow registry and watcher-driven deltas. |
| D6 | Add velocity-aware viewport overscan/hysteresis tuning. | Complete | Enter overscan now expands with canvas transform velocity and keeps exit overscan stable. |
| D7 | Rewrite `useGraphNodeManager` hot load path toward patch/incremental extraction. | Complete | Removed slot-label full widget re-extraction; remaining full extraction work needs deeper load instrumentation. |
| D8 | Make `useLayoutSync` dirty/flush behavior more granular. | Complete | Canvas-originated layout changes now skip LiteGraph writeback scheduling. |
| D9 | Profile and implement next confirmed link drawing optimization. | Complete | Attribution confirmed far-zoom `drawConnections()` cost; far-zoom active pan now skips full link traversal. |
| D10 | Move minimap model toward event-driven updates. | Complete: no-op | Attribution shows minimap is not the current pan bottleneck; avoid speculative changes. |
| D11 | Add widget intrinsic sizing/cache API. | Complete: no-op | Existing resize correctness requires same-width remeasurement; defer until a real intrinsic invalidation model exists. |
| D12 | Continue queue/output/execution store selectorization. | Complete | Vue node execution progress now uses per-locator refs instead of full progress-record subscription. |
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

### D4 DOMRect Attribution Probe

Change:

- Added `scripts/replacer-domrect-attribution.cjs`.
- The script directly loads the Replacer workflow against the running frontend and patches `Element.prototype.getBoundingClientRect` in-page.
- It avoids the repo Playwright global setup, so it does not touch the live `ComfyUI/user` directory while the `8190` backend is running.

Command:

```powershell
$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'
$env:REPLACER_DOMRECT_ATTRIBUTION_OUT='output_sessions\d4-domrect-attribution.json'
node scripts\replacer-domrect-attribution.cjs
```

Result:

| Scenario | Mounted before | DOMRect calls | Top attribution |
| --- | ---: | ---: | --- |
| Far pan | 0 | 7 | `#graph-canvas`; VueUse element bounds and one LiteGraph pointer-event rect cache read. |
| Middle pan | 76 | 10 | `#graph-canvas` plus 2 slot reads and 1 node read from `useVueNodeResizeTracking -> syncNodeSlotLayoutsFromDOM`. |
| Close pan | 29 | 7 | `#graph-canvas`; VueUse element bounds and one LiteGraph pointer-event rect cache read. |

Load context:

| Mark | Time |
| --- | ---: |
| App ready | 4537 ms |
| Workflow load | 10115 ms |
| Total probe | 19504 ms |

Interpretation:

- R5 mostly achieved the intended pan-free slot geometry behavior.
- The remaining pan-time DOMRect reads are low in this sample.
- The only slot-attributed reads were in the middle-zoom pan sample and came through resize observer slot resync, not the primary scheduled slot-cache pan path.
- This does not justify another speculative slot rewrite yet. The next larger target remains D5: reducing mount-set/list churn with a delta-mounted registry.

### D5 Delta-Mounted Vue Node Registry

Changes:

- Added `updateMountedVueNodeRegistry()` in `viewportMountedNodes.ts`.
- Replaced the `GraphCanvas.vue` `mountedNodes` computed side-effect path with a stable `shallowReactive(Map)` registry plus `shallowRef` render list.
- Mount membership still uses the existing enter/exit hysteresis logic.
- The rendered list now updates from watcher-driven deltas instead of rebuilding and mutating `previousMountedVueNodeIds` inside a computed getter.

Tests:

- `node node_modules\vitest\vitest.mjs run src\components\graph\viewportMountedNodes.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'; node output_sessions\replacer_input_latency_probe.cjs > output_sessions\d5-delta-mounted-registry-replacer-probe.json`

Replacer probe comparison against D2:

| Metric | D2 before | D5 after |
| --- | ---: | ---: |
| App ready | 5690 | 4160 |
| Workflow load | 12970 | 8270 |
| Probe total | 23144 | 16688 |
| Far mounted nodes | 0 | 0 |
| Far pan | 33.0 | 64.6 |
| Far wheel | 48.1 | 30.8 |
| Middle mounted nodes | 76 | 66 |
| Middle pan | 49.0 | 63.0 |
| Middle wheel | 49.7 | 36.6 |
| Close mounted nodes | 29 | 29 |
| Close pan | 67.3 | 46.3 |
| Close wheel | 45.9 | 39.2 |

Mounted count details:

| Scenario | Before action | After action |
| --- | ---: | ---: |
| Far | 0 | 0 |
| Middle | 66 | 67 |
| Close | 29 | 22 |

Interpretation:

- The registry reduces render-list identity churn and removes mutation from the computed getter.
- Startup/load improved in this sample, likely because the mounted registry no longer over-retains as many nodes during initialization and viewport transitions.
- Far and middle pan are worse in this single sample, while wheel and close pan improved. Treat the action-to-paint numbers as noisy until repeated samples are collected.
- The middle mounted count dropped from `76` to `66`. That is expected for this implementation because the previous computed side effects could over-retain mounted IDs; the hysteresis behavior still applies during viewport transitions.

### D6 Velocity-Aware Viewport Overscan

Changes:

- Added `getVelocityAwareViewportOverscan()` in `viewportMountedNodes.ts`.
- `GraphCanvas.vue` now samples canvas transform velocity during RAF.
- The Vue-node enter overscan grows from `0.08` toward `0.16` during fast pan/zoom movement.
- The exit overscan remains `0.18`, so this tunes edge pop-in without widening the retained-node exit window.

Tests:

- `node node_modules\vitest\vitest.mjs run src\components\graph\viewportMountedNodes.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'; $env:REPLACER_WORKFLOW_PATH='F:\ComfyUI_DEV_windows_portable_nvidia\ComfyUI_DEV_windows_portable\ComfyUI\user.bak\default\workflows\replacer creative i2v stable Parted 2.8_dev.json'; node output_sessions\replacer_input_latency_probe.cjs > output_sessions\d6-velocity-overscan-replacer-probe-valid.json`

Replacer probe comparison against D5:

| Metric | D5 before | D6 after |
| --- | ---: | ---: |
| App ready | 4160 | 3804 |
| Workflow load | 8270 | 5018 |
| Probe total | 16688 | 12839 |
| Far mounted nodes | 0 | 0 |
| Far pan | 64.6 | 52.5 |
| Far wheel | 30.8 | 28.3 |
| Middle mounted nodes | 66 | 73 |
| Middle pan | 63.0 | 61.6 |
| Middle wheel | 36.6 | 38.4 |
| Close mounted nodes | 29 | 29 |
| Close pan | 46.3 | 30.9 |
| Close wheel | 39.2 | 45.2 |

Mounted count details:

| Scenario | Before action | After action |
| --- | ---: | ---: |
| Far | 0 | 0 |
| Middle | 73 | 69 |
| Close | 29 | 23 |

Workflow file note:

- Two D6 probe attempts were invalid because the default Replacer workflow file had become an empty 244-byte graph with `0` nodes.
- Valid Replacer copies were found at `ComfyUI\user.bak\default\workflows\...` and `ComfyUI\user\default\workflows\... (2).json`.
- The default workflow file was restored from the valid `(2)` copy and verified at `291` nodes / `287` links.
- A follow-up load-timeline run with the restored default path reached the Replacer render surface at `7055 ms` and settled at `12171 ms`.

Interpretation:

- The velocity-aware enter window increases middle mounted nodes from `66` to `73` in this sample, which is the expected tradeoff for reducing edge pop-in while moving.
- Close pan improved materially in this sample; middle pan changed only slightly.
- Close wheel worsened in this single run. Treat wheel/pan latency as noisy until repeated sampling is added.

### D7 useGraphNodeManager Slot-Label Patch Path

Changes:

- Replaced the `node:slot-label:changed` handler's `extractVueNodeData(nodeRef).widgets` call.
- Slot-label changes now update only the affected `inputs` / `outputs` array reference and refresh widget slot metadata in place.
- Added regression coverage that the widget array identity is preserved when only a slot label changes.

Tests:

- `node node_modules\vitest\vitest.mjs run src\composables\graph\useGraphNodeManager.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'; node output_sessions\replacer_input_latency_probe.cjs > output_sessions\d7-slot-label-patch-replacer-probe.json`

Replacer probe comparison against D6:

| Metric | D6 before | D7 after |
| --- | ---: | ---: |
| App ready | 3804 | 4958 |
| Workflow load | 5018 | 8518 |
| Probe total | 12839 | 17588 |
| Far mounted nodes | 0 | 0 |
| Far pan | 52.5 | 29.0 |
| Far wheel | 28.3 | 30.4 |
| Middle mounted nodes | 73 | 73 |
| Middle pan | 61.6 | 52.1 |
| Middle wheel | 38.4 | 37.5 |
| Close mounted nodes | 29 | 29 |
| Close pan | 30.9 | 48.1 |
| Close wheel | 45.2 | 43.4 |

Interpretation:

- This is a targeted hot-path cleanup, not a full `useGraphNodeManager` rewrite.
- It removes a defensible source of avoidable re-extraction during slot-label changes.
- The Replacer sample is mixed: far/middle pan improved, close pan worsened, startup/load worsened versus the unusually fast D6 sample.
- The next deeper `useGraphNodeManager` load work should be preceded by extraction-count/load-phase instrumentation, otherwise the branch risks speculative churn.

### D8 Canvas-Source Layout Sync Skip

Changes:

- `useLayoutSync()` now skips node writeback scheduling for `LayoutSource.Canvas` changes.
- Canvas-source changes already came from LiteGraph, so syncing them back only repeats graph lookups and dirty checks.
- Added `syncSkippedCanvasSource` to the layout performance counters.

Tests:

- `node node_modules\vitest\vitest.mjs run src\renderer\core\layout\sync\useLayoutSync.test.ts src\renderer\core\layout\performance\layoutPerfInstrumentation.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'; node output_sessions\replacer_input_latency_probe.cjs > output_sessions\d8-canvas-source-sync-skip-replacer-probe.json`

Replacer probe comparison against D7:

| Metric | D7 before | D8 after |
| --- | ---: | ---: |
| App ready | 4958 | 5298 |
| Workflow load | 8518 | 8527 |
| Probe total | 17588 | 17893 |
| Far mounted nodes | 0 | 0 |
| Far pan | 29.0 | 37.3 |
| Far wheel | 30.4 | 40.2 |
| Middle mounted nodes | 73 | 73 |
| Middle pan | 52.1 | 41.2 |
| Middle wheel | 37.5 | 39.2 |
| Close mounted nodes | 29 | 29 |
| Close pan | 48.1 | 31.5 |
| Close wheel | 43.4 | 41.1 |

Interpretation:

- This is a source-aware correctness/performance cleanup for the sync loop.
- Startup/load stayed effectively unchanged.
- Middle and close pan improved in this sample; far pan and far wheel worsened.
- The next step should use attribution again before making more link/minimap changes.

### D9 Far-Zoom Link Traversal Skip

Measurement tooling:

- Added `scripts/replacer-render-attribution.cjs` for direct browser attribution against the running `5274` frontend and `8190` backend.
- Added `scripts/replacer-probe-stats.cjs` to summarize repeated latency probe samples by min, median, p95, and max.

Pre-change attribution:

| Scenario | `drawConnections()` calls | `drawConnections()` total | Minimap canvas total |
| --- | ---: | ---: | ---: |
| Far pan | 26 | 292.8 ms | 2.2 ms |
| Middle pan | 27 | 134.9 ms | 1.2 ms |
| Close pan | 26 | 83.9 ms | 1.4 ms |

Decision:

- D9 was justified: link drawing was the confirmed hot path.
- Minimap was not changed because measured minimap canvas time was only about `1-2 ms` in the same pan windows.

Changes:

- Far-zoom Vue-node canvas pan now skips full link traversal for any active canvas pan, not only middle-button pan.
- The threshold is aligned with far-zoom canvas mode (`0.18`).
- Middle and close zoom link rendering remains unchanged.

Tests:

- `node node_modules\vitest\vitest.mjs run src\lib\litegraph\src\LGraphCanvas.drawConnections.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'; $env:REPLACER_RENDER_ATTRIBUTION_OUT='output_sessions\d9-far-pan-link-skip-render-attribution.json'; node scripts\replacer-render-attribution.cjs`
- `$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'; for ($i=1; $i -le 3; $i++) { node output_sessions\replacer_input_latency_probe.cjs > "output_sessions\d9-far-link-skip-latency-$i.json" }`
- `node scripts\replacer-probe-stats.cjs output_sessions\d9-far-link-skip-latency-*.json`

Post-change attribution:

| Scenario | `drawConnections()` calls | `drawConnections()` total | Minimap canvas total |
| --- | ---: | ---: | ---: |
| Far pan | 26 | 9.1 ms | 1.7 ms |
| Middle pan | 26 | 124.0 ms | 1.2 ms |
| Close pan | 26 | 88.8 ms | 2.2 ms |

Repeated D9 latency samples:

Samples: `3/3` valid Replacer graphs.

| Metric | n | min | median | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| App ready | 3 | 3465 | 3551 | 3817 | 3817 |
| Workflow load | 3 | 8360 | 8389 | 8420 | 8420 |
| Probe total | 3 | 15768 | 15913 | 16131 | 16131 |
| Far mounted nodes | 3 | 0 | 0 | 0 | 0 |
| Far pan | 3 | 49.8 | 64.5 | 66.9 | 66.9 |
| Far wheel | 3 | 31.0 | 33.2 | 34.0 | 34.0 |
| Middle mounted nodes | 3 | 73 | 73 | 73 | 73 |
| Middle pan | 3 | 43.7 | 43.8 | 48.7 | 48.7 |
| Middle wheel | 3 | 35.6 | 36.1 | 40.7 | 40.7 |
| Close mounted nodes | 3 | 29 | 29 | 29 | 29 |
| Close pan | 3 | 30.7 | 37.3 | 39.9 | 39.9 |
| Close wheel | 3 | 40.1 | 42.3 | 46.2 | 46.2 |

Interpretation:

- The targeted rendering cost is fixed: far-zoom `drawConnections()` dropped from `292.8 ms` to `9.1 ms` in the attribution pan window.
- The synthetic action-to-paint far-pan latency did not improve in the repeated latency probe; it remains noisy and likely measures more than link drawing.
- Middle/close link rendering remains the next possible link target, but it should not be changed blindly. The remaining D9 follow-up would be a separate medium/close link-level simplification if user-visible IRL testing still reports lag there.

### D10 Minimap Event Model Decision

Decision:

- No minimap behavior change was made in this task.

Evidence:

- `scripts/replacer-render-attribution.cjs` measured minimap canvas work in the same pan windows as link drawing.
- Pre-D9 minimap canvas time was only `2.2 ms` far, `1.2 ms` middle, and `1.4 ms` close.
- Post-D9 minimap canvas time was only `1.7 ms` far, `1.2 ms` middle, and `2.2 ms` close.
- `useMinimap()` already skips its RAF graph change detection while `canvas.dragging_canvas && canvas.pointer.isDown`.
- `useMinimapGraph()` already has event hooks for node add/remove, connection changes, selected visual property changes, API `graphChanged`, and layout-store version changes.

Interpretation:

- D10 is not the current performance blocker for Replacer pan.
- A deeper minimap event-model rewrite would be speculative right now and would make the research branch dirtier without a measurable target.
- The next minimap work should wait until a profile shows idle minimap scanning or minimap redraw time as a real cost.

### D11 Widget Intrinsic Sizing Decision

Decision:

- No widget intrinsic sizing/cache behavior change was made in this task.

Evidence:

- Vue node resize currently probes minimum content height inside `useNodeResize.ts` by applying the candidate width and reading the node's DOM height.
- Existing resize tests explicitly cover a same-width second move where widget/content minimum height changes and must be re-measured.
- The codebase already has LiteGraph widget sizing hooks such as `computeLayoutSize()`, and Vue node ResizeObserver tracking already caches unchanged node measurements.
- There is no reliable widget `layoutHash` or intrinsic invalidation signal available to safely key a resize min-content cache.

Interpretation:

- A width-only cache would reduce some forced DOM reads but would be incorrect for responsive widgets that become taller at the same candidate width.
- D11 should stay deferred until widget implementations can report a stable intrinsic signature such as `minWidth`, `preferredWidth`, and `layoutHash`.
- The next useful D11 work is instrumentation around widget intrinsic changes and resize-probe counts, not a blind cache in the resize hot path.

### D12 Execution Progress Selectorization

Changes:

- Added per-locator execution progress refs in `executionStore`.
- `useNodeExecutionState()` now subscribes to the selected node locator ref instead of reading the full `nodeLocationProgressStates` record.
- Kept the existing full-record computed for canvas progress propagation and compatibility.

Tests:

- `node node_modules\vitest\vitest.mjs run src\stores\executionStore.test.ts src\renderer\extensions\vueNodes\components\LGraphNode.test.ts`
- `node node_modules\vue-tsc\bin\vue-tsc.js --noEmit --pretty false`
- `$env:PLAYWRIGHT_TEST_URL='http://127.0.0.1:5274/'; node output_sessions\replacer_input_latency_probe.cjs > output_sessions\d12-execution-selector-replacer-probe.json`

Replacer probe comparison against a D9 sample:

| Metric | D9 sample | D12 after |
| --- | ---: | ---: |
| App ready | 3465 | 4783 |
| Workflow load | 8360 | 8450 |
| Probe total | 15768 | 17260 |
| Far mounted nodes | 0 | 0 |
| Far pan | 64.5 | 64.4 |
| Far wheel | 33.2 | 40.3 |
| Middle mounted nodes | 73 | 73 |
| Middle pan | 48.7 | 57.5 |
| Middle wheel | 35.6 | 34.9 |
| Close mounted nodes | 29 | 29 |
| Close pan | 30.7 | 31.0 |
| Close wheel | 46.2 | 39.7 |

Interpretation:

- D12 is a store fan-out cleanup, not an idle-pan optimization.
- Mounted node counts stayed unchanged in the Replacer probe.
- Pan and wheel latency remains within the existing noisy range; the expected benefit is during execution/progress events, where unrelated mounted Vue nodes no longer have to observe the full progress-record identity.
