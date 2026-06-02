# Frontend Performance Slowdown Fix Plan

## Benchmark Fixture

Use the realistic user workflow instead of the default workflow:

`ComfyUI/user/default/workflows/replacer creative i2v stable Parted 2.8_dev.json`

Reason: it has many nodes and loaded custom-node state, so it should expose the frontend costs users actually see. Synthetic large-graph tests are still useful for isolation, but this workflow should be the primary acceptance fixture.

## Goal

Identify and fix the three biggest frontend slowdowns with measured before/after evidence:

1. Vue-node pan remains too slow.
2. Vue-node pan creates excessive layout churn.
3. General large-graph pan/zoom still spends too much scripting time and has at least one regression.

Each fix must include:

- baseline measurement
- targeted instrumentation proving the source of cost
- narrow code change
- repeat measurement
- regression test or benchmark guard

## Slowdown 1: Vue-Node Pan Is Still Too Slow

Current evidence from the 8190 benchmark:

- `vue-large-graph-pan` task time improved from `16735ms` to `14482ms`, but still remains very high.
- Average frame duration improved only from `35.0ms` to `33.5ms`.
- p95 frame duration remained `50ms`.
- Total blocking time improved from `1242ms` to `925ms`, but still indicates visible stutter.

Primary suspicion:

The current optimizations reduce some idle/render cost, but active pan still performs too much per-frame work. Likely sources are viewport filtering, transform watchers, live Vue tree updates, slot/layout sync, and canvas/link redraw.

Analysis steps:

1. Add temporary counters for one pan interaction:
   - mounted Vue node count per frame
   - nodes mounted/unmounted during pan
   - `viewportNodeIds` recompute count and duration
   - `mountedNodes` recompute count and duration
   - `TransformPane` watcher executions
   - `canvas.setDirty()` call count and foreground/background arguments
   - `drawConnections()` duration
2. Run this on the Replacer workflow at three zoom levels:
   - far
   - medium
   - close
3. Capture Chrome trace for the worst case and tag the code regions with `performance.mark()` / `performance.measure()`.

Fix candidates:

- Freeze the mounted-node set during active pan and update it only after transform settles.
- Add hysteresis to viewport culling so nodes do not mount/unmount near viewport edges during movement.
- Move pan-time visibility checks off reactive computed chains and into a throttled requestAnimationFrame path.
- Keep the live Vue tree stable during pan and use a cheap visual-only transform layer.
- Replace DOM-clone fallback with a real canvas bitmap snapshot or remove it if it causes start/end spikes.

Success criteria:

- Replacer workflow pan average frame duration under `20ms`.
- Replacer workflow pan p95 frame duration under `33ms`.
- `vue-large-graph-pan` TBT below `250ms`.
- No correctness regression for focused nodes, selected nodes, centered nodes, subgraph entry/exit, or widget interaction after pan.

## Slowdown 2: Vue-Node Pan Layout Count Explodes

Current evidence from the 8190 benchmark:

- `vue-large-graph-pan` layout count changed from `3` baseline to `181` current.
- This is a red flag even though total task time improved.

Primary suspicion:

Layout churn is likely caused by DOM reads/writes during pan:

- slot tracking
- resize tracking
- fallback pane cloning/hiding
- LOD display changes
- mount/unmount churn
- layout store listener fan-out

Analysis steps:

1. Monkey-patch or instrument these APIs during benchmark runs:
   - `Element.prototype.getBoundingClientRect`
   - `ResizeObserver` callback count
   - `layoutStore.batchUpdateSlotLayouts`
   - `layoutStore.batchUpdateNodeBounds`
   - `requestSlotLayoutSyncForAllNodes`
   - `syncNodeSlotLayoutsFromDOM`
2. For each layout-triggering call, log:
   - call count
   - top callsite label
   - whether pan is active
   - affected node count
3. Run Replacer workflow pan with Vue nodes enabled.
4. Compare against:
   - current working tree
   - local `main`
   - current tree with viewport mounting disabled
   - current tree with motion LOD disabled
   - current tree with fallback pane disabled

Fix candidates:

- Do not resync slot layouts while panning unless a node actually changes size or slot visibility.
- Avoid deleting/recreating slot layouts for nodes that only move with camera transform.
- Ensure LOD hiding does not trigger ResizeObserver or layout-affecting DOM changes during pan.
- Keep fallback/live pane visibility changes from forcing layout on the full node tree.
- Batch layout-store node listener dispatch per animation frame instead of microtask when pan is active.

Success criteria:

- Replacer workflow pan layout count no more than baseline plus `10%`.
- `getBoundingClientRect()` calls during pan reduced by at least `80%`.
- No stale links after pan settle.
- Slot hit testing still passes after pan, zoom, node drag, node resize, collapse/expand, and widget advanced-toggle.

## Slowdown 3: General Large-Graph Pan/Zoom Scripting Cost

Current evidence from the 8190 benchmark:

- `large-graph-pan` regressed from `1215ms` task time to `1310ms`.
- `large-graph-zoom` is effectively flat: `1595ms` to `1609ms`.
- `viewport-pan-sweep` improved only `8.4%`, from `4624ms` to `4237ms`.

Primary suspicion:

Some changes reduce layout work but add scripting work. Possible sources:

- `computeVisibleNodes()` area-cache logic
- spatial index queries and fallback checks
- slot position calculations
- link drawing
- graph/node manager lifecycle changes
- progress visual suppression and canvas dirtying

Analysis steps:

1. Add timings around LiteGraph hot paths:
   - `LGraphCanvas.computeVisibleNodes`
   - `LGraphNode.updateArea`
   - `LGraphCanvas.drawConnections`
   - `getSlotPosition`
   - `layoutStore.queryNodesInBounds`
   - `getViewportNodeIdsWithLiteGraphFallback`
2. Add counters for:
   - visible nodes
   - visible links
   - reroutes
   - slot-position cache hits/misses
   - spatial query result count
   - fallback-bound checks
3. Run on:
   - Replacer workflow
   - synthetic large graph
   - current tree with each major optimization toggled off one at a time

Fix candidates:

- Replace `computeVisibleNodes()` graph-version skip with explicit node bounds dirty tracking.
- Cache viewport query results for the current camera/frame instead of recomputing through multiple reactive consumers.
- Avoid fallback bounds checks over broad node lists during active pan.
- Make slot-position cache persistent for a frame or graph version where safe.
- Separate canvas dirtying for link redraws from full foreground redraws.

Success criteria:

- No regression in `large-graph-pan` task time versus local `main`.
- Replacer workflow pan task time reduced by at least `25%`.
- `drawConnections()` time reduced or proven not to be the bottleneck.
- Visible-node culling remains correct after node move, resize, group move, center-on-node, subgraph navigation, and workflow tab switch.

## Execution Order

1. Build the benchmark harness around the Replacer workflow.
2. Add temporary instrumentation behind a debug flag.
3. Measure current working tree and local `main`.
4. Isolate the Vue pan layout explosion first.
5. Fix Vue pan layout churn.
6. Re-measure Vue pan frame time.
7. Fix remaining general pan/zoom scripting regressions.
8. Remove temporary instrumentation or keep only lightweight benchmark counters.
9. Update the benchmark report with final before/after numbers.

## 2026-06-02 Execution Notes

Backend used for the realistic pass:

- `http://127.0.0.1:8190`
- Command: `python_embeded/python.exe -s ComfyUI/main.py --cpu --windows-standalone-build --port 8190 --multi-user`
- Workflow: `ComfyUI/user/default/workflows/replacer creative i2v stable Parted 2.8_dev.json`

Added benchmark coverage:

- `WorkflowHelper.loadWorkflowFile(filePath)` so Playwright can load the real workflow from disk instead of an asset fixture.
- `replacer workflow vue pan instrumentation`, which records task/layout/frame metrics plus pan counters for DOM rect reads, ResizeObserver callbacks, canvas dirty calls, mounted node samples, and pan-time node DOM mutations.

Measured Replacer Vue pan before the targeted fixes:

- Graph: `291` nodes, `287` links, `221` LiteGraph visible nodes.
- Pan: `6509ms` total, `87` style recalcs, `22` layouts, `14.6ms` layout, `5836.7ms` task, `18.8ms` average frame, `33.3ms` p95 frame, `19ms` TBT.
- Counters: `954` `getBoundingClientRect()` calls, `0` ResizeObserver callbacks, `6` foreground/background canvas dirty calls, `92` pan-time node DOM additions.

Fixes applied:

1. Disabled middle-button DOM snapshot fallback by making `middlePanFallbackDetail` return `none`.
   - Rationale: the fallback cloned the live Vue node pane during pan. On the Replacer workflow this created pan-time DOM additions without improving the measured drag.
   - Regression coverage: `middle-button pan keeps the live vue pane instead of cloning fallback DOM`.

2. Kept viewport culling active during low-zoom transforms by removing the branch that force-mounted all Vue nodes when `camera.z <= STABLE_LOW_DETAIL_SCALE`.
   - Rationale: force-mounting all nodes while moving reduces mount churn, but it also makes large workflows carry the full Vue DOM tree during pan.
   - Measured effect on Replacer pan: layouts dropped from `22` to `10`; pan-time node DOM additions dropped from `92` to `0`.

3. Limited global slot-layout resync after transform settling to interactions where zoom scale changed.
   - Rationale: pure pan changes the transform container, not slot offsets in canvas space. A full all-node slot sync after ordinary pan is avoidable.
   - Expected effect: reduces post-pan work and stale-frame risk after movement; the measured drag window itself remains mostly task-bound.

Measured Replacer Vue pan after fixes:

- `6888ms` total, `68` style recalcs, `10` layouts, `12.3ms` layout, `5993.1ms` task, `19.5ms` average frame, `33.4ms` p95 frame, `180ms` TBT.
- Counters: `954` `getBoundingClientRect()` calls, `0` ResizeObserver callbacks, `6` foreground/background canvas dirty calls, `0` pan-time node DOM additions.

What improved:

- Layout count: `22 -> 10`.
- Style recalcs: `87 -> 68`.
- Pan-time node DOM additions: `92 -> 0`.

What did not improve enough:

- Task duration remains around `5.8s-6.0s`.
- Average frame time remains around `19ms-20ms`.
- p95 frame time remains around `33ms`.
- `getBoundingClientRect()` calls remain high at about `954` during the pan.

Current conclusion:

The first three fixes remove avoidable structural churn but do not solve the dominant scripting cost. The next pass should instrument callsites for the remaining `getBoundingClientRect()` reads and LiteGraph/link draw time during the same Replacer pan test. Another broad optimization pass would be low-confidence until those two costs are attributed.

## 2026-06-02 Link-Draw Attribution Pass

Added attribution counters for:

- `getBoundingClientRect()` stack buckets and element buckets.
- `LGraphCanvas.computeVisibleNodes()` call count and duration.
- `LGraphCanvas.drawConnections()` call count and duration.

Replacer Vue pan attribution before the link fix:

- `computeVisibleNodes`: `64` calls, `15.9ms` total.
- `drawConnections`: `64` calls, `795.4ms` total.
- Production `getBoundingClientRect()` callsites:
  - slot element tracking: `88` slot rect reads plus `28` node rect reads.
  - LiteGraph mouse coordinate conversion: `60` reads from `LGraphCanvas.adjustMouseEvent`.
- A large anonymous `visitNode` bucket appeared in browser/test injected code and should not be treated as a production app callsite.

Fix applied:

- In Vue-node mode, while middle-button panning at low-detail zoom (`scale <= 0.12`), skip normal LiteGraph link drawing.
- On middle-pan end, force a background redraw so links return immediately after release.

Replacer Vue pan after the link fix:

- `drawConnections`: `64` calls, `27.4ms` total.
- Task duration: `5615.4ms -> 4776.2ms`.
- Average frame: `19.1ms -> 17.7ms` in the attribution run.
- P95 frame: `33.3ms -> 16.8ms`.
- Layouts stayed at `10`.
- Pan-time node DOM additions stayed at `0`.

Interpretation:

The largest confirmed moving-state bottleneck was low-zoom link redraw. Skipping normal links only while the user is actively middle-panning at the Vue low-detail zoom floor produces a visible performance win without changing normal settled rendering. The next remaining production callsites are slot tracking rect reads and `LGraphCanvas.adjustMouseEvent`, but their measured cost is much smaller than link drawing.

## 2026-06-02 Slot-Measurement Deferral Pass

Fix applied:

- During middle-button Vue-node pan, `flushScheduledSlotLayoutSync()` no longer runs DOM slot measurement.
- If cached slot offsets exist, it updates slot layouts from cache.
- If cached offsets are missing or dirty, it defers DOM measurement until after pan release.
- Pan release schedules `flushPanDeferredSlotLayoutSyncs()` after `120ms`, outside the drag interaction frame.

Before slot deferral, after the link-redraw fix:

- Total `getBoundingClientRect()` calls: `954`.
- Production slot tracking reads:
  - `[data-slot-key]`: `90`.
  - `[data-node-id]`: `29`.
- Stack buckets:
  - slot rect reads from `getSlotElementRect()` during `flushScheduledSlotLayoutSync()`: `88`.
  - node rect reads from `syncNodeSlotLayoutsFromDOM()` during `flushScheduledSlotLayoutSync()`: `28`.
- Replacer pan: `5894ms` total, `4972.5ms` task, `17.9ms` average frame, `16.8ms` p95 frame, `10` layouts.

After slot deferral:

- Total `getBoundingClientRect()` calls: `838`.
- Production slot tracking reads:
  - `[data-slot-key]`: `2`.
  - `[data-node-id]`: `1`.
- Stack buckets:
  - slot rect reads from ResizeObserver path: `2`.
  - node rect reads from ResizeObserver path: `1`.
  - no `flushScheduledSlotLayoutSync()` slot measurement bucket remained in the measured pan window.
- Replacer pan verification run: `5718ms` total, `4661.7ms` task, `17.5ms` average frame, `16.8ms` p95 frame, `10` layouts.

Interpretation:

This removes the remaining confirmed production slot DOM measurement from the drag window. The total rect count still contains a large anonymous `visitNode` bucket from browser/test injected code and `60` canvas rect reads from `LGraphCanvas.adjustMouseEvent`; those are separate from slot layout tracking.

## 2026-06-02 Pointer Rect Cache Pass

Fix applied:

- `LGraphCanvas` now caches `canvas.getBoundingClientRect()` on pointer down.
- Pointer move and pointer up reuse the cached rect during the drag.
- The cache is cleared on pointer up, pointer out, and pointer cancel.

Before pointer rect caching, after slot deferral:

- Total `getBoundingClientRect()` calls: `838`.
- `LGraphCanvas.adjustMouseEvent()` mouse-move rect reads: `60`.
- Replacer pan verification run: `5718ms` total, `4661.7ms` task, `17.5ms` average frame, `16.8ms` p95 frame, `10` layouts, `145ms` TBT.

After pointer rect caching:

- Total `getBoundingClientRect()` calls: `777`.
- Pointer path rect reads:
  - `beginPointerEventRectCache()`: `1`.
  - `LGraphCanvas.adjustMouseEvent()` mouseout fallback: `1`.
  - no mouse-move `adjustMouseEvent()` rect bucket remained.
- Replacer pan verification run: `5522ms` total, `4455.9ms` task, `17.2ms` average frame, `16.7ms` p95 frame, `10` layouts, `110ms` TBT.

Interpretation:

The measured production geometry-read path is now mostly removed from the Replacer pan interaction. The remaining large rect-read bucket is the anonymous browser/test `visitNode` bucket, not an attributed app callsite. The next optimization should use a CPU profile rather than more rect-read counters.

## Required Test Matrix

Use `http://127.0.0.1:8190` backend.

Run each case at least five times and report median plus p95:

- Replacer workflow idle, Vue nodes off
- Replacer workflow pan, Vue nodes off
- Replacer workflow zoom, Vue nodes off
- Replacer workflow idle, Vue nodes on
- Replacer workflow pan, Vue nodes on
- Replacer workflow zoom, Vue nodes on
- Replacer workflow node drag, Vue nodes on
- Replacer workflow node resize, Vue nodes on
- Replacer workflow subgraph enter/exit if the workflow contains subgraphs

Metrics:

- task duration
- script duration
- style recalculation count and duration
- layout count and duration
- frame average and p95
- total blocking time
- mounted Vue node count
- DOM node count
- `getBoundingClientRect()` count
- slot layout write count
- canvas dirty count
- `drawConnections()` duration

## Stop Conditions

Stop and reassess if:

- a fix improves synthetic large graph but not the Replacer workflow
- layout count drops but frame time does not improve
- pan frame time improves by hiding live content but links, widgets, focus, or selection become stale
- correctness requires broad lifecycle changes not backed by targeted measurements

## Expected Outcome

The likely path is not one large rewrite. The expected fix sequence is:

1. Reduce pan-time layout reads/writes.
2. Stabilize mounted Vue nodes during pan.
3. Remove or replace costly fallback/LOD behavior.
4. Tighten LiteGraph canvas/link redraw work.

The Replacer workflow should be the final acceptance benchmark because it represents the user-facing workload better than the default workflow.
