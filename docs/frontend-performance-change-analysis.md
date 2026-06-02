# Frontend Performance Change Analysis

Baseline: local `main` `HEAD` in `ComfyUI_frontend`.

Scope: the current working tree contains uncommitted frontend changes in 57 tracked files plus several new test/helper files. The repo is currently on `main` and is reported as 32 commits behind `origin/main`; this analysis compares the local changes against the local `main` baseline, not against the remote branch tip.

## Executive summary

The changes target real frontend bottlenecks: too many mounted Vue node components, repeated DOM measurements for slot/link layout, unnecessary object churn in stores, expensive per-frame LiteGraph layout work, and interaction-time rendering cost. Those are valid areas to optimize.

The main reason these changes may not yet improve observed performance is that several optimizations reduce work only in narrow states, while the high-cost paths still run during common interactions. Some changes also add new per-frame computations, DOM cloning, and lifecycle complexity. Without a measured before/after trace per scenario, it is hard to prove that the new work is cheaper than the old work.

The highest-risk changes are:

- `LGraphCanvas.computeVisibleNodes()` skips `node.updateArea()` when `graph._version` is unchanged. Node position and size changes do not clearly map to graph version changes, so culling, hit testing, and visible node lists can become stale.
- Viewport mounting reduces the number of Vue nodes, but can cause mount/unmount churn, lost local DOM state, and expensive recomputation while panning.
- The middle-button pan fallback clones the live Vue node DOM into a hidden pane. That can be expensive at pan start and does not remove the cost of maintaining the live Vue tree outside that fallback window.
- The graph node manager now mutates LiteGraph node property descriptors for `widgets`, `inputs`, and `outputs`. This is powerful but fragile, especially for extension nodes with custom getters/setters.

## What changed

### Viewport-based Vue node mounting

Files:

- `src/components/graph/GraphCanvas.vue`
- `src/components/graph/viewportMountedNodes.ts`
- `src/renderer/core/spatial/SpatialIndex.ts`
- `src/components/graph/viewportMountedNodes.test.ts`
- `src/renderer/core/spatial/SpatialIndex.test.ts`

The template now renders `mountedNodes` instead of all Vue node data. `mountedNodes` is derived from spatial index queries, LiteGraph visible-node fallback data, and sticky nodes such as focused or recently centered nodes.

Good:

- Reduces DOM size when large graphs have many offscreen nodes.
- Keeps focused nodes and center-on-node targets mounted, which avoids some obvious interaction breakage.
- Adds overflow handling to `SpatialIndexManager`, so nodes outside default QuadTree bounds remain queryable.
- Adds unit coverage for ordering, sticky nodes, fallback behavior, and out-of-bounds spatial index cases.

Bad or risky:

- Culling is only useful when the DOM node count is a major bottleneck. If the bottleneck is canvas drawing, link layout, store updates, or extension code, this will not move the main metric much.
- `viewportNodeIds` depends on camera and viewport state. During pan and zoom it can cause frequent filtering and set construction across all node data.
- Mount/unmount churn can be expensive for nodes with widgets, previews, async content, ResizeObservers, and slot tracking.
- At `camera.z <= 0.12` during transform, the code intentionally returns all nodes. That keeps the worst large-graph DOM case alive at far zoom while moving.
- Fallback visibility depends partly on LiteGraph `visible_nodes`. If LiteGraph visibility is stale, Vue node mounting can also become stale.

Assessment:

This is directionally good for large static graphs and zoomed-in navigation. It is not sufficient by itself for pan smoothness if the active interaction still triggers per-frame store, layout, link, and canvas work.

### Motion level-of-detail for Vue nodes

Files:

- `src/components/graph/GraphCanvas.vue`
- `src/renderer/extensions/vueNodes/components/LGraphNode.vue`
- `src/renderer/core/layout/transform/TransformPane.vue`

The code introduces `activePanDetail` values of `none`, `middle`, and `close`. During transform, eligible nodes hide heavy internals such as widgets, custom content, live previews, badges, footers, and resize handles.

Good:

- Targets expensive DOM subtrees instead of trying to optimize every component.
- Avoids applying LOD to selected, executing, error, collapsed, reroute, or ghost-placement nodes.
- Uses CSS-driven hiding for motion states, which is cheaper than fully rebuilding the component tree during every frame.
- Async-loads `NodeContent` and `LivePreview`.

Bad or risky:

- The computed `shouldRenderMotionHeavyInternals` only suppresses internals at `middle` detail. At `close`, the CSS classes hide some content but the Vue subtrees can still exist, so much of the reactive/component cost remains.
- At far zoom, `lowDetail` uses `camera.z <= 0.2`, while `activePanDetail` returns `none` below `0.12`. These thresholds may work against each other and should be benchmarked rather than guessed.
- Hiding DOM does not remove upstream costs: store updates, slot tracking, ResizeObserver callbacks, link drawing, and canvas invalidation can still run.

Assessment:

This can help rendering cost during panning, but only if the hidden content was the measured bottleneck. It should be validated with component update counts and frame traces, not only FPS averages.

### Middle-button pan fallback pane

Files:

- `src/renderer/core/layout/transform/TransformPane.vue`
- `src/components/graph/GraphCanvas.vue`
- `src/renderer/core/layout/transform/panSnapshotCanvas.ts`
- `src/renderer/core/layout/transform/panSnapshotCanvas.test.ts`

`TransformPane` now has a live pane and fallback pane. When middle-button panning is active, it clones live DOM children into the fallback pane, hides the live pane, and transforms the fallback pane.

Good:

- Conceptually useful: moving one static layer during pan can be cheaper than updating many live node elements.
- The tests check fallback activation in the performance spec.

Bad or risky:

- The fallback uses `cloneNode(true)` on the live pane. For a large mounted graph this can be a large synchronous DOM operation at the exact moment interaction starts.
- Cloned DOM is still DOM. It may be cheaper to transform, but it is not as cheap as a canvas snapshot.
- `panSnapshotCanvas.ts` appears to be implemented and tested, but not wired into production code. If the intended optimization was a canvas snapshot, the current production path does not use it.
- Hiding the live pane can defer needed DOM measurement work; the code compensates by requesting slot layout sync after settling, but that can create a post-pan cost spike.

Assessment:

The idea is valid, but the current implementation may trade steady per-frame cost for start/end interaction spikes. A real canvas bitmap snapshot would likely be more effective than cloning the live DOM tree.

### Slot layout and resize measurement batching

Files:

- `src/renderer/extensions/vueNodes/composables/useSlotElementTracking.ts`
- `src/renderer/extensions/vueNodes/composables/useVueNodeResizeTracking.ts`
- `src/renderer/core/layout/sync/useLayoutSync.ts`
- `src/renderer/core/layout/store/layoutStore.ts`

Slot sync now distinguishes dirty nodes from nodes that can update slot positions from cached offsets. Resize tracking defers slot resync while node resizing is active. Layout sync only marks the foreground dirty for moves and avoids redraws when nothing changed.

Good:

- Reduces repeated `getBoundingClientRect()` usage when nodes move but slot offsets are stable.
- Avoids slot layout writes when computed positions did not change.
- Defers resize slot resync until resize completes.
- Reduces canvas redraw scope for move-only layout sync.

Bad or risky:

- Cached slot offsets require careful invalidation. Hidden tabs, unmounted nodes, LOD-hidden internals, collapsed states, widget changes, and extension-rendered content can all change slot geometry.
- `useSlotElementTracking` no longer deletes a slot layout directly on unmount; cleanup now relies on node-level deletion paths. That can leave stale slot layouts if individual slot elements disappear while the node remains mounted.
- Microtask-queued node listener dispatch in `layoutStore` can change timing assumptions for consumers that expected synchronous updates after canvas or external writes.

Assessment:

This is one of the stronger optimization areas because DOM measurement is often expensive. It needs targeted regression tests for widget visibility changes, collapse/expand, advanced widgets, extension widgets, and graph tab switches.

### LiteGraph canvas and link drawing changes

Files:

- `src/lib/litegraph/src/LGraphCanvas.ts`
- `src/renderer/core/canvas/litegraph/slotCalculations.ts`
- `src/lib/litegraph/src/linkDeduplication.ts`
- `src/lib/litegraph/src/LGraph.ts`

The canvas now caches slot positions within `drawConnections()`, skips some Vue node arrange work, avoids slot-position array allocations, and purges invalid links during graph configure.

Good:

- Per-frame slot position caching is a concrete improvement for dense link graphs.
- Avoiding intermediate arrays in slot calculations is small but reasonable.
- Purging invalid and duplicate links can reduce pathological graph work and prevent corrupted state from amplifying render cost.

Bad or risky:

- Skipping `updateArea()` based on `graph._version` is the biggest correctness risk in this change set. Node movement and resizing can affect render areas without necessarily changing graph structure or `_version`.
- The Vue-node arrange skip depends on `_widgetSlotsDirty`. If that flag is incomplete, link positions and slot hit testing can drift.
- Link cleanup during configure changes graph loading semantics. It is probably good for corrupted workflows, but should be tested against workflows that rely on unusual extension-generated links.

Assessment:

Slot-position caching is likely beneficial. The `updateArea()` skip should be revised or guarded by a node-level bounds dirty flag before relying on it.

### Graph node manager and lifecycle caching

Files:

- `src/composables/graph/useGraphNodeManager.ts`
- `src/composables/graph/useVueNodeLifecycle.ts`

The node manager now mutates existing `VueNodeData` objects instead of replacing map entries, attempts to preserve reactive arrays for widgets/inputs/outputs, guards against recursive node additions, and caches manager state per active graph/workflow.

Good:

- Reduces reactive invalidation from replacing full node data objects.
- Preserves graph state when switching graphs/subgraphs instead of always rebuilding from scratch.
- Adds cleanup for slot layouts and slot registry entries when nodes are removed.
- Handles empty graphs more explicitly.

Bad or risky:

- Defining custom property descriptors on LiteGraph node instances is invasive. It can conflict with node classes or extensions that already define custom behavior.
- The fallback for maximum call stack errors returns partial node data. That avoids crashes but can hide root causes and render incomplete nodes.
- Manager caching increases lifecycle complexity. Graph close, workflow path reuse, subgraph switching, and empty graph transitions need strong tests.
- Reusing `VueNodeData` objects can improve rendering, but if deep consumers depend on object identity changing, they may stop updating.

Assessment:

This change is plausible but high-complexity. It should be treated as a separate refactor with focused correctness tests, not only as a performance patch.

### Store-level reconciliation and derived data caching

Files:

- `src/stores/queueStore.ts`
- `src/stores/nodeOutputStore.ts`
- `src/stores/executionStore.ts`
- `src/scripts/app.ts`
- `src/services/customerEventsService.ts`

Queue tasks are reconciled to preserve object identity. Node output image URLs are cached by output/image references. Execution progress visuals can be suppressed after workflow path changes. Canvas resize ignores invalid or oversized backing-store dimensions.

Good:

- Queue reconciliation directly reduces unnecessary component churn during polling and burst updates.
- Image URL caching avoids repeated URL construction when output references are stable.
- Canvas backing-store cap prevents pathological allocation and resize loops.
- Suppressing stale progress visuals during workflow switches reduces cross-workflow visual noise.

Bad or risky:

- `areSerializedValuesEqual()` uses `JSON.stringify()` for some fields. For frequent polling, this can become non-trivial if those objects grow.
- WeakMap image URL caching depends on stable node/output references. It will not help if the API or store recreates output objects often.
- Progress suppression is stateful and must be reset reliably; otherwise users may miss progress indicators.

Assessment:

These are pragmatic optimizations with relatively low risk, except for the cost of JSON serialization under heavy queue polling.

### Browser performance tests and helpers

Files:

- `browser_tests/tests/performance.spec.ts`
- `browser_tests/fixtures/helpers/PerformanceHelper.ts`
- `browser_tests/fixtures/ComfyPage.ts`
- `browser_tests/fixtures/helpers/*`

The performance suite now measures frame counts, frame durations, p95 frame duration, task duration per frame, queue bursts, active pan at multiple zoom levels, viewport culling, graph switching, and oversized group fit.

Good:

- Adds coverage for the actual scenarios the optimization is trying to improve.
- Captures more than duration/style/layout counts by adding frame metrics.
- Includes stress graphs and interaction-specific tests.

Bad or risky:

- Some assertions appear based on hard-coded local baselines. Those can be unstable across machines, browser versions, debug/release builds, and CI load.
- FPS/frame-duration targets can pass while user-perceived responsiveness is still poor if there are interaction start/end spikes.
- The tests need to record before/after data for the same scenarios. Without a baseline artifact from local `main`, they mostly guard thresholds rather than prove improvement.

Assessment:

The test direction is good. The next step is to turn these into a repeatable benchmark report that compares local `main` versus this working tree on the same machine and same browser.

## Why performance may not have improved

1. The expensive path may not be DOM node count. If link drawing, canvas dirtying, slot layout sync, queue hydration, or extension widgets dominate the trace, viewport mounting will have limited effect.
2. Several optimizations add work during interactions: viewport filtering, set creation, fallback DOM cloning, post-pan slot sync, and graph lifecycle bookkeeping.
3. Some heavy subtrees are hidden visually but still exist reactively, especially outside the `middle` pan detail path.
4. The far-zoom transform path deliberately keeps all nodes mounted below `0.12` scale, which is likely one of the most stressful large-graph cases.
5. The current changes are broad. If a regression in one area offsets an improvement in another, aggregate FPS will show no gain even though some local changes are beneficial.
6. There is no checked-in before/after benchmark report tying each optimization to a measurable scenario.

## Recommendations

### Keep

- Queue task reconciliation, with profiling around `JSON.stringify()`.
- Node output URL caching.
- Slot position caching inside `drawConnections()`.
- Slot layout cache/update-from-cache work, if expanded with invalidation tests.
- Spatial index overflow handling.
- Browser performance tests, converted into a stable benchmark workflow.

### Rework before relying on

- `computeVisibleNodes()` `updateArea()` skipping. Replace the graph-version heuristic with explicit node bounds dirty tracking, or only skip during pure camera transforms after proving node bounds are stable.
- Middle-button fallback cloning. Prefer a real canvas bitmap snapshot or a cheaper representation. The existing `panSnapshotCanvas.ts` appears intended for this but is not wired in.
- Motion LOD thresholds and behavior. Use traces to choose thresholds and ensure hidden content is not still doing expensive reactive work.
- Viewport mounting during active pan/zoom. Consider freezing the mounted set during interaction and updating it after transform settles, or use a larger hysteresis window to avoid churn.

### Investigate with measurements

- Compare local `main` versus this working tree for these scenarios:
  - idle large graph
  - normal pan
  - middle-button pan
  - zoom sweep
  - node drag
  - node resize
  - queue burst hydration
  - workflow tab switching
- Capture Chrome performance traces, not only Playwright summary metrics.
- Break down time by scripting, style, layout, paint, canvas drawing, event handlers, ResizeObserver, and Vue component updates.
- Count mounted Vue nodes, slot layout writes, `getBoundingClientRect()` calls, `canvas.setDirty()` calls, and `drawConnections()` time per frame.

## Suggested next implementation order

1. Add instrumentation counters around the hot paths listed above.
2. Run the same benchmark suite on local `main` and the working tree.
3. Remove or disable the highest-risk broad changes that do not show clear wins.
4. Land narrow, measured improvements first: queue reconciliation, slot-position caching, output URL caching, spatial overflow fixes.
5. Reintroduce viewport mounting and motion LOD only with per-scenario benchmark evidence and correctness tests for graph switching, subgraphs, widgets, and extension nodes.

## Bottom line

The change set attacks the right general areas, but it is too broad to explain a missing performance improvement from code inspection alone. Some changes are likely good in isolation, while others can plausibly erase those gains or introduce correctness issues. The most important next step is not another optimization pass; it is a controlled benchmark comparison against local `main`, with trace-level attribution for the exact frame-time cost.
