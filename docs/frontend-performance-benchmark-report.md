# Frontend Performance Benchmark Report

Date: 2026-06-02

## Current Status

Branch: `perf/replacer-pan-optimizations`

Latest tested branch commit: `433494bbf Render far zoom nodes on canvas`

Upstream comparison point: `origin/main` at `f61a3212a9f999b36b76694bade8fa3689b1dde5`

Frontend version state:

- Latest release tag found: `v1.46.7`.
- `origin/main` describes as `v1.46.7-8-gf61a3212a`.
- No separate frontend `nightly` branch was found. The repo comments identify `main` as the source for nightly builds, so `origin/main` is the latest/nightly-like source for this comparison.

Windows tooling status:

- `pnpm` requirement is satisfied with `pnpm 11.3.0`.
- Current machine Node is `22.21.1`, while the latest frontend declares `node >=25`.
- Vite dev serving works on this machine, but a clean latest-main development environment should use Node `>=25`.

Performance-test server mode:

For the latest fair comparisons, both `origin/main` and this branch were run with the same dev-server flags:

```powershell
DISABLE_VUE_PLUGINS=true
DEV_SERVER_COMFYUI_URL=http://127.0.0.1:8190
```

This matters because Vue DevTools and dev-only Vue plugins add measurable overhead and console noise. With plugins enabled, app readiness and some input latencies were worse. Fair comparisons must keep this setting identical for both branches.

## Complete Change Inventory

The branch contains one large initial optimization commit plus later targeted commits. This is the current list of performance-relevant work.

### 1. Initial Vue Pan Optimization Set

Commit: `4cd064f5b Optimize Vue node pan performance`

Main areas changed:

- Added realistic Playwright performance coverage and helper support for loading the Replacer workflow from disk.
- Added benchmark reports and slowdown analysis docs.
- Added viewport-based Vue node mounting:
  - `src/components/graph/GraphCanvas.vue`
  - `src/components/graph/viewportMountedNodes.ts`
  - `src/renderer/core/spatial/SpatialIndex.ts`
- Added motion/detail-state handling for Vue nodes:
  - `src/renderer/extensions/vueNodes/components/LGraphNode.vue`
  - `src/renderer/core/layout/transform/TransformPane.vue`
- Added a transform fallback/snapshot drawing helper:
  - `src/renderer/core/layout/transform/panSnapshotCanvas.ts`
- Reduced slot/layout measurement work:
  - `src/renderer/extensions/vueNodes/composables/useSlotElementTracking.ts`
  - `src/renderer/extensions/vueNodes/composables/useVueNodeResizeTracking.ts`
  - `src/renderer/core/layout/sync/useLayoutSync.ts`
  - `src/renderer/core/layout/store/layoutStore.ts`
- Optimized LiteGraph link/slot drawing and graph cleanup:
  - `src/lib/litegraph/src/LGraphCanvas.ts`
  - `src/renderer/core/canvas/litegraph/slotCalculations.ts`
  - `src/lib/litegraph/src/linkDeduplication.ts`
  - `src/lib/litegraph/src/LGraph.ts`
- Reduced reactive churn in graph/node lifecycle management:
  - `src/composables/graph/useGraphNodeManager.ts`
  - `src/composables/graph/useVueNodeLifecycle.ts`
- Reduced store churn:
  - `src/stores/queueStore.ts`
  - `src/stores/nodeOutputStore.ts`
  - `src/stores/executionStore.ts`
  - `src/scripts/app.ts`

What worked well:

- The repeated Replacer benchmark showed a stable improvement versus original local `main`: median average frame time improved from about `41.9ms` to `16.8-16.9ms`, and p95 improved from `66.7ms` to `16.8ms`.
- Link drawing and production DOM measurement were confirmed bottlenecks and were reduced.

What remained weak:

- The first optimization set was broad and complex.
- Some small changes had noisy or neutral standalone results.
- Middle/close pan still has occasional bad input-latency samples.

### 2. Minimap Pan Polling Skip

Commit: `b65298dd3 Skip minimap graph polling during canvas pan`

Change:

- During active canvas drag, minimap viewport syncing continues, but minimap graph/node change polling is skipped.

Measured effect:

- `LayoutStoreDataSource.getNodes()` self time dropped from `264.4ms` to `15.0ms` in the CPU profile window.
- Replacer median script duration dropped from `1042.6ms` to `382.5ms`.

Assessment:

- This was a strong CPU-profile-driven fix.
- It does not change frame p95 once the benchmark is already at frame budget, but it removes real wasted script work.

### 3. Minimap Node Lookup Cleanup

Commit: `00256eb27 Optimize minimap layout node lookup`

Change:

- Replaced repeated `graph._nodes.find(...)` scans with `graph.getNodeById(...)`.

Measured effect:

- No meaningful pan-frame win after minimap polling was already skipped during drag.
- It remains a valid scalability cleanup because it removes an O(n^2) lookup pattern from minimap data rebuilds.

### 4. Malformed Number Widget Handling

Commits:

- `3ddfc027e Handle malformed number widget values`
- `fc8651a55 Accept boolean malformed number widget values`

Change:

- Made `WidgetInputNumber` tolerate malformed string/boolean values that appear in the Replacer workflow/custom-node state.

Effect:

- This is mainly correctness and warning reduction.
- It prevents bad widget values from producing repeated Vue warnings and fragile numeric coercion paths.

### 5. Dev Warning Overhead Reduction

Commit: `d8297e69c Reduce dev warning overhead for large workflows`

Change:

- Defaulted missing Comfy badge state to `false` instead of passing `undefined`.
- Reduced heavy `SubgraphNode.configure` warning payloads.

Effect:

- Reduces console warning spam and object formatting cost on large/malformed workflows.
- This matters most in dev/testing, where console work can distort performance.

### 6. Medium-Zoom Low Detail

Commit: `1703b07aa Use low detail nodes at medium zoom`

Change:

- Raised stable low-detail Vue node threshold to apply low-detail rendering at medium zoom.

Effect:

- In the Replacer probe, middle zoom had many mounted nodes but a large fraction switched to low-detail rendering.
- Earlier samples showed middle wheel/pan improvements after this change, but later fair runs still showed noisy middle/close pan latency. Treat this as useful but not sufficient.

### 7. Viewport Overscan Reduction

Commit: `10bc36b40 Reduce Vue node viewport overscan`

Change:

- Reduced Vue node viewport overscan from `0.35` to `0.08`.

Measured effect:

- Far mounted DOM before far-canvas mode: about `284 -> 240`.
- Middle mounted DOM: about `100 -> 66`.
- Close mounted DOM: about `34 -> 20`.

Assessment:

- This is a real DOM reduction.
- It cannot solve far zoom by itself because many nodes are genuinely visible at far zoom.

### 8. Latest Main Merge

Commit: `952f63e32 Merge remote-tracking branch 'origin/main' into perf/replacer-pan-optimizations`

Change:

- Brought the branch up to latest upstream `main` at `f61a3212a`.
- Updated package state to frontend version `1.46.7`.

Windows note:

- After the merge, dependencies needed to be synced because Vite required `@iconify/tools`.
- `corepack pnpm install` mostly completed but the repo `prepare` script failed on Windows because it uses Unix shell syntax and `true`.
- The needed packages were installed and Vite served correctly afterward.

### 9. Far-Zoom Canvas Mode

Commit: `433494bbf Render far zoom nodes on canvas`

Change:

- Added `src/components/graph/FarZoomNodeCanvas.vue`.
- At zoom `<= 0.18`, Vue node DOM is no longer mounted.
- Nodes are rendered as simplified canvas shapes using the existing `panSnapshotCanvas` drawing helper.
- Medium and close zoom still use normal Vue nodes.

Measured effect:

- Far zoom mounted Vue nodes dropped to `0`.
- In the latest fair comparison, `origin/main` mounted all `291` Vue nodes at far/middle/close zoom; this branch mounted `0` at far, `66` at middle, and `20` at close.

Assessment:

- This directly fixes the far-zoom DOM bottleneck.
- It does not fix middle/close panning. Those are now a separate problem.

## Latest Fair Comparison Against Main

Both runs used:

- Frontend port: `5274`
- Backend: `http://127.0.0.1:8190`
- Workflow: `ComfyUI/user/default/workflows/replacer creative i2v stable Parted 2.8_dev.json`
- Flags: `DISABLE_VUE_PLUGINS=true`, `DEV_SERVER_COMFYUI_URL=http://127.0.0.1:8190`
- Main: `origin/main @ f61a3212a`
- Branch: `perf/replacer-pan-optimizations @ 433494bbf`

| Replacer probe | Main | Branch |
| --- | ---: | ---: |
| Mounted nodes, far zoom | 291 | 0 |
| Mounted nodes, middle zoom | 291 | 66 |
| Mounted nodes, close zoom | 291 | 20 |
| Far pan action-to-paint | 85.4 ms | 46.2 ms |
| Far wheel action-to-paint | 79.6 ms | 52.6 ms |
| Middle pan action-to-paint | 47.4 ms | 109.9 ms |
| Middle wheel action-to-paint | 57.3 ms | 46.6 ms |
| Close pan action-to-paint | 41.0 ms | 102.0 ms |
| Close wheel action-to-paint | 69.7 ms | 56.0 ms |

Interpretation:

- The branch clearly improves far zoom DOM cost and far zoom input latency.
- The branch clearly reduces mounted Vue DOM at all tested zoom levels.
- Middle and close pan latency are still not solved and were worse in this single fair run. Pan samples are noisy, but this is enough to avoid claiming a universal pan improvement.
- Workflow load time was not improved in this fair run. Treat load time as an open problem.

Current honest status:

- Fixed: far-zoom Vue DOM bottleneck.
- Improved: far-zoom wheel/pan responsiveness.
- Improved: repeated Replacer pan frame budget versus older original local main in the earlier benchmark series.
- Not fixed: middle/close first-input pan latency.
- Not fixed: workflow load/startup time.
- Needs next profiling: why middle/close pan sometimes stalls despite much lower mounted DOM count.

## Environment

- Backend: `http://127.0.0.1:8190`
- Backend command: `python_embeded/python.exe -s ComfyUI/main.py --cpu --windows-standalone-build --port 8190 --multi-user --disable-all-custom-nodes --whitelist-custom-nodes ComfyUI_devtools`
- Baseline frontend: clean detached worktree at local `main` `HEAD` (`c57944f31`) served on `http://127.0.0.1:5273`
- Current frontend: working tree with performance changes served on `http://127.0.0.1:5274`
- Test command: Playwright `performance` project, targeted grep subset
- Samples: one run per scenario
- Artifacts:
  - `../../output_sessions/frontend-benchmark-8190/baseline-perf-metrics.json`
  - `../../output_sessions/frontend-benchmark-8190/current-perf-metrics.json`
  - `../../output_sessions/frontend-benchmark-8190/comparison.json`

Important caveats:

- This is a single-sample local run. Treat results as directional, not statistically stable.
- The backend was started with normal custom nodes disabled and only `ComfyUI_devtools` whitelisted. This removes unrelated backend startup/custom-node noise, but it is not identical to a fully loaded user backend.
- The new `vue renderer large graph > zoom out culling` test was excluded from the comparison because the baseline does not satisfy the changed assertion.
- This original benchmark section compares against local `main` `HEAD`. Later sections include the full `8190` backend and the latest fair comparison against `origin/main`.

## Results

Lower is better for task time, script time, layout time, layouts, frame duration, p95 frame duration, and total blocking time.

| Scenario | Baseline task ms | Current task ms | Delta | Layouts | Frame avg ms | P95 frame ms | TBT ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `canvas-zoom-sweep` | 567.6 | 469.7 | -17.3% | 33 -> 32 | 16.67 -> 16.67 | 16.80 -> 16.80 | 0 -> 0 |
| `large-graph-idle` | 613.5 | 607.8 | -0.9% | 1 -> 0 | 16.67 -> 16.67 | 16.80 -> 16.80 | 0 -> 0 |
| `large-graph-pan` | 1215.1 | 1309.8 | +7.8% | 26 -> 16 | 16.67 -> 16.67 | 16.70 -> 16.70 | 0 -> 0 |
| `large-graph-zoom` | 1594.6 | 1608.6 | +0.9% | 81 -> 79 | 16.67 -> 16.81 | 16.70 -> 16.80 | 0 -> 0 |
| `viewport-pan-sweep` | 4624.0 | 4236.6 | -8.4% | 26 -> 25 | 16.70 -> 16.67 | 16.80 -> 16.80 | 0 -> 0 |
| `vue-large-graph-idle` | 15682.6 | 3275.9 | -79.1% | 3 -> 4 | 33.61 -> 17.11 | 50.00 -> 33.30 | 1251 -> 63 |
| `vue-large-graph-pan` | 16735.3 | 14481.5 | -13.5% | 3 -> 181 | 35.00 -> 33.48 | 50.00 -> 50.00 | 1242 -> 925 |

## Interpretation

The changes produce a clear improvement for Vue-node idle on the large graph. Task duration drops by about 79%, average frame duration moves from about 33.6 ms to 17.1 ms, and total blocking time drops from 1251 ms to 63 ms. This is the strongest positive signal in the benchmark.

Vue-node pan also improves in total task duration and total blocking time, but it remains far from the intended smooth interaction target. Average frame duration only improves from 35.0 ms to 33.5 ms, and p95 remains at 50 ms. This means the changes reduce some work but do not solve moving-state responsiveness.

The normal large-graph pan path regresses slightly in task duration: 1215 ms to 1310 ms. Layout count improves from 26 to 16, but the total task cost still rises. That suggests new scripting work may be offsetting layout savings.

Large-graph zoom is effectively flat. Layout count improves slightly, but task duration and frame duration are marginally worse. This does not show meaningful improvement.

Viewport pan sweep improves by about 8.4% in task duration. That is useful but not enough to explain a major user-perceived performance improvement.

Canvas zoom sweep improves by about 17.3% in task duration, with stable frame metrics. This is a positive narrow win.

## What Looks Good

- Viewport-related work appears to help the Vue-node idle case substantially.
- The changes reduce total blocking time for Vue-node idle and pan.
- Some non-Vue scenarios show reduced layouts or task time without obvious frame regressions.
- The benchmark confirms there is at least one real performance win; the previous concern that all changes had no measurable benefit is not fully accurate.

## What Still Looks Bad

- Vue-node pan is still not smooth. The current run remains around 33.5 ms average frame time and 50 ms p95.
- Current Vue-node pan triggers far more layouts than baseline: 3 -> 181. Even if task time improves, this layout churn is a red flag.
- Normal large-graph pan task time regresses by about 7.8%.
- Large-graph zoom is effectively unchanged.
- Single-run numbers are noisy. The large Vue idle win is big enough to trust directionally; the small regressions and small wins need repeat runs.

## Likely Conclusions

The current work helps when many Vue nodes would otherwise remain mounted and active while idle. It does not yet address the dominant moving-state cost during pan. The remaining pan bottleneck is likely in a mix of transform-time scripting, layout churn from mount/LOD/fallback behavior, slot/layout sync, and canvas/link redraw work.

The highest-priority follow-up is to instrument pan specifically:

- Count mounted Vue nodes per frame.
- Count node mount/unmount operations during pan.
- Count `getBoundingClientRect()` calls.
- Count slot layout writes.
- Count `layoutStore` node/global listener dispatches.
- Count `canvas.setDirty()` calls and whether foreground/background redraws are requested.
- Measure `drawConnections()` duration.
- Measure time spent in viewport filtering and spatial queries.

## Recommended Next Step

Do not add another broad optimization pass yet. First, rerun this same seven-scenario subset with at least 5 repetitions per scenario and aggregate median/p95. Then add pan-specific counters and rerun only `vue-large-graph-pan`, `large-graph-pan`, and `viewport-pan-sweep`.

The current changes are worth keeping only selectively:

- Keep or continue: Vue idle culling/mount reduction, queue/output-store reductions, slot position caching.
- Rework: pan behavior, especially anything causing layout count explosion in `vue-large-graph-pan`.
- Recheck carefully: `computeVisibleNodes()` area caching and DOM-clone fallback, because they remain correctness/performance risk areas.

## Replacer Workflow Follow-Up

After the initial report, the realistic workflow was tested on the full `8190` backend without the custom-node whitelist:

`ComfyUI/user/default/workflows/replacer creative i2v stable Parted 2.8_dev.json`

The Replacer Vue pan benchmark showed that DOM/layout churn is real but not the only bottleneck.

| Replacer Vue pan | Before targeted fixes | After targeted fixes |
| --- | ---: | ---: |
| Style recalcs | 87 | 68 |
| Layouts | 22 | 10 |
| Layout duration | 14.6 ms | 12.3 ms |
| Task duration | 5836.7 ms | 5993.1 ms |
| Average frame | 18.8 ms | 19.5 ms |
| P95 frame | 33.3 ms | 33.4 ms |
| Pan-time node DOM additions | 92 | 0 |
| `getBoundingClientRect()` calls | 954 | 954 |

Targeted changes applied:

- Disabled middle-button DOM snapshot fallback.
- Kept viewport culling active during low-zoom pan instead of force-mounting all Vue nodes.
- Avoided all-node slot-layout sync after pure pan; it now runs after scale-changing interactions.

Interpretation:

These changes reduce structural churn, especially layouts and pan-time DOM additions, but they do not materially reduce active scripting time. The remaining highest-confidence next step is callsite attribution for the roughly `954` pan-window `getBoundingClientRect()` calls and timing around LiteGraph link/canvas drawing on the Replacer workflow.

## Link-Draw Attribution Result

The follow-up attribution run identified normal LiteGraph link drawing as the largest confirmed production cost during Replacer low-zoom pan.

| Replacer Vue pan attribution | Before link fix | After link fix |
| --- | ---: | ---: |
| `drawConnections()` duration | 795.4 ms | 27.4 ms |
| `computeVisibleNodes()` duration | 15.9 ms | 15.7 ms |
| Task duration | 5615.4 ms | 4776.2 ms |
| Average frame | 19.1 ms | 17.7 ms |
| P95 frame | 33.3 ms | 16.8 ms |
| Layouts | 10 | 10 |
| Pan-time node DOM additions | 0 | 0 |

Change made:

- Skip normal LiteGraph link drawing during active middle-button pan in Vue-node mode when zoom is at the low-detail floor (`scale <= 0.12`).
- Force a background redraw when middle-button pan ends, so links are restored after release.

The remaining rect-read attribution showed smaller production callsites:

- slot layout tracking: `88` slot rect reads plus `28` node rect reads.
- mouse coordinate conversion: `60` canvas rect reads.

The largest rect-read bucket was from anonymous browser/test injected code (`visitNode`) and should not be counted as a production app bottleneck.

## Slot-Measurement Deferral Result

The next optimization removed slot-layout DOM measurement from the measured middle-pan window.

| Replacer Vue pan | Before slot deferral | After slot deferral |
| --- | ---: | ---: |
| Total `getBoundingClientRect()` calls | 954 | 838 |
| Slot element rect reads | 90 | 2 |
| Node element rect reads from slot sync | 29 | 1 |
| Task duration | 4972.5 ms | 4661.7 ms |
| Average frame | 17.9 ms | 17.5 ms |
| P95 frame | 16.8 ms | 16.8 ms |
| Layouts | 10 | 10 |

Change made:

- Defer dirty slot DOM measurement while middle-button Vue pan is active.
- Use cached slot offsets during pan when available.
- Refresh deferred slot geometry `120ms` after pan release.

This leaves `LGraphCanvas.adjustMouseEvent()` as the next small production rect-read source at about `60` canvas rect reads per Replacer pan.

## Pointer Rect Cache Result

The next optimization cached the canvas bounding rect for the duration of a pointer drag.

| Replacer Vue pan | Before pointer rect cache | After pointer rect cache |
| --- | ---: | ---: |
| Total `getBoundingClientRect()` calls | 838 | 777 |
| Mouse-move `adjustMouseEvent()` rect reads | 60 | 0 |
| Intentional pointerdown rect cache read | 0 | 1 |
| Task duration | 4661.7 ms | 4455.9 ms |
| Average frame | 17.5 ms | 17.2 ms |
| P95 frame | 16.8 ms | 16.7 ms |
| Layouts | 10 | 10 |
| TBT | 145 ms | 110 ms |

Change made:

- Cache `canvas.getBoundingClientRect()` on pointer down.
- Reuse the cached rect for drag-time `adjustMouseEvent()` calls.
- Clear the cache on pointer up, pointer out, and pointer cancel.

At this point the confirmed production geometry-read optimizations are complete for this benchmark. Further reductions should come from CPU profiling the remaining script time.

## Three-Way Replacer Result

The same Replacer workflow pan benchmark was rerun against three frontend states on the full `8190` backend:

- **Original:** clean local `main` at `c57944f31`.
- **Branch Before:** optimization branch with all changes except the pointer rect cache.
- **Branch After:** `perf/replacer-pan-optimizations` after the pointer rect cache.

Artifacts:

- `output_sessions/replacer-three-way-20260602/original-main-perf-metrics.json`
- `output_sessions/replacer-three-way-20260602/branch-before-pointer-cache-perf-metrics.json`
- `output_sessions/replacer-three-way-20260602/branch-after-perf-metrics.json`

| Replacer Vue pan | Original | Branch Before | Branch After |
| --- | ---: | ---: | ---: |
| Total duration | 16303.5 ms | 5650.7 ms | 5797.8 ms |
| Task duration | 16276.4 ms | 4590.6 ms | 4765.7 ms |
| Script duration | 2411.3 ms | 974.8 ms | 1014.1 ms |
| Average frame | 42.0 ms | 17.5 ms | 17.8 ms |
| P95 frame | 66.7 ms | 16.8 ms | 16.8 ms |
| Layouts | 3 | 12 | 10 |
| Layout duration | 1.4 ms | 17.5 ms | 13.6 ms |
| Total blocking time | 199 ms | 81 ms | 114 ms |
| `getBoundingClientRect()` calls | 835 | 838 | 777 |
| `adjustMouseEvent()` move rect reads | 60 | 60 | 0 |
| `drawConnections()` duration | 593.5 ms | 21.6 ms | 30.8 ms |
| Mounted node average | 291.0 | 287.2 | 287.2 |

Interpretation:

- The branch is much faster than original for the realistic Replacer pan: average frame time improves from `42.0ms` to about `17.8ms`, and p95 frame time improves from `66.7ms` to `16.8ms`.
- The pointer rect cache removes the targeted production rect-read source: `adjustMouseEvent()` move reads go from `60` to `0`.
- The single after run is slightly noisier than the branch-before run in task/TBT, but it keeps p95 at `16.8ms`, reduces layouts from `12` to `10`, and removes the targeted geometry reads.
- Use repeated median runs before making claims about small task-duration differences; the large original-to-branch improvement is directionally clear.

## Repeated Three-Way Replacer Result

The three-way Replacer benchmark was repeated with `5` samples per state on the full `8190` backend.

Artifacts:

- `output_sessions/replacer-three-way-repeat-20260602/samples-parsed.json`
- `output_sessions/replacer-three-way-repeat-20260602/summary.json`

Median results:

| Replacer Vue pan, median of 5 | Original | Branch Before | Branch After |
| --- | ---: | ---: | ---: |
| Total duration | 16472.2 ms | 5436.2 ms | 5553.3 ms |
| Task duration | 16448.1 ms | 4507.6 ms | 4656.7 ms |
| Script duration | 2417.0 ms | 998.0 ms | 1042.6 ms |
| Average frame | 41.9 ms | 16.9 ms | 16.8 ms |
| P95 frame | 66.7 ms | 16.8 ms | 16.8 ms |
| Layouts | 3 | 9 | 9 |
| Layout duration | 1.5 ms | 5.3 ms | 5.1 ms |
| Total blocking time | 204 ms | 0 ms | 0 ms |
| `getBoundingClientRect()` calls | 835 | 835 | 774 |
| `adjustMouseEvent()` move rect reads | 60 | 60 | 0 |
| `drawConnections()` duration | 579.5 ms | 20.3 ms | 25.5 ms |
| `computeVisibleNodes()` duration | 53.2 ms | 15.1 ms | 15.2 ms |
| Mounted node average | 291.0 | 287.2 | 287.2 |

Interpretation:

- The branch improvement over original is stable across repeated runs. Median average frame time drops from `41.9ms` to `16.8-16.9ms`, and p95 drops from `66.7ms` to `16.8ms`.
- The pointer rect cache is confirmed to remove the targeted production geometry reads: `adjustMouseEvent()` move reads go from `60` to `0`, and total rect reads drop from `835` to `774`.
- The pointer cache is not a large standalone frame-time win. Branch After has the same p95, slightly lower median average frame, and slightly higher median task/script time than Branch Before. Treat this as a small cleanup, not the next major optimization.
- The next performance block is remaining script time around the pan loop. The best next task is a CPU-profile pass on Branch After, focused on why median task duration is still about `4.7s` even after link drawing and production rect reads have been reduced.

## CPU Profile: Minimap Graph Polling

A Chromium DevTools CPU profile was captured around the same Replacer middle-button pan on Branch After.

Artifacts:

- `output_sessions/replacer-cpu-profile-20260602/branch-after-replacer-pan-analysis.json`
- `output_sessions/replacer-cpu-profile-20260602/after-minimap-skip-replacer-pan.cpuprofile`
- `output_sessions/replacer-cpu-profile-20260602/minimap-skip-profile-comparison.json`
- `output_sessions/replacer-after-minimap-skip-20260602/summary.json`

The largest app-level hotspot was minimap graph polling. The minimap was checking for graph/node changes on every RAF during canvas pan, rebuilding all minimap node data even though only the viewport rectangle needed to move.

Profile result:

| CPU profile bucket | Before | After |
| --- | ---: | ---: |
| Total profile window | 6660.1 ms | 6292.5 ms |
| `LayoutStoreDataSource.getNodes()` self time | 264.4 ms | 15.0 ms |
| `checkForChangesInternal()` self time | 202.3 ms | 7.5 ms |
| `useMinimap` RAF self time | 13.7 ms | 2.1 ms |

Change made:

- Skip minimap graph change detection while `canvas.dragging_canvas && canvas.pointer.isDown`.
- Keep minimap viewport syncing active, so the viewport rectangle can still track canvas movement during pan.

Replacer pan benchmark after the minimap change, median of 3:

| Replacer Vue pan | Branch After before minimap skip | After minimap skip |
| --- | ---: | ---: |
| Total duration | 5553.3 ms | 5365.7 ms |
| Task duration | 4656.7 ms | 3892.5 ms |
| Script duration | 1042.6 ms | 382.5 ms |
| Average frame | 16.8 ms | 16.8 ms |
| P95 frame | 16.8 ms | 16.8 ms |
| Layouts | 9 | 9 |
| Total blocking time | 0 ms | 0 ms |
| `getBoundingClientRect()` calls | 774 | 774 |
| `drawConnections()` duration | 25.5 ms | 23.9 ms |
| `computeVisibleNodes()` duration | 15.2 ms | 12.7 ms |

Interpretation:

- This is a real CPU reduction, mainly in script time, without changing the frame p95 because the benchmark was already at the frame budget after the earlier link-drawing and slot-measurement fixes.
- The next profile target is no longer minimap graph polling. The remaining app self-time is fragmented across normal canvas/Vue/layout work, with no single hotspot comparable to the minimap polling issue.

## Minimap Data Lookup Cleanup

After minimap polling was removed from the active pan window, `LayoutStoreDataSource.getNodes()` was still cleaned up because the CPU profile exposed an inefficient lookup pattern. The old code scanned `graph._nodes` with `Array.find()` once for every layout-store node. On large graphs this is O(n^2). The new code uses `graph.getNodeById()`, which is backed by LiteGraph's `_nodes_by_id` map.

Replacer pan benchmark after the lookup cleanup, median of 3:

| Replacer Vue pan | After minimap skip | After lookup cleanup |
| --- | ---: | ---: |
| Total duration | 5365.7 ms | 5446.8 ms |
| Task duration | 3892.5 ms | 4033.1 ms |
| Script duration | 382.5 ms | 410.3 ms |
| Average frame | 16.8 ms | 16.9 ms |
| P95 frame | 16.8 ms | 16.8 ms |
| Layouts | 9 | 9 |
| Total blocking time | 0 ms | 0 ms |
| `getBoundingClientRect()` calls | 774 | 774 |
| `drawConnections()` duration | 23.9 ms | 24.3 ms |
| `computeVisibleNodes()` duration | 12.7 ms | 15.7 ms |

Interpretation:

- The lookup cleanup is a scalability fix for minimap data rebuilds, not a new pan-frame win after minimap polling is already skipped during active pan.
- The Replacer pan remains at the frame budget. The small task/script differences are within local-run noise for this benchmark.
