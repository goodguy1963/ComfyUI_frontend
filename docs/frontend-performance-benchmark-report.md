# Frontend Performance Benchmark Report

Date: 2026-06-02

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
- The repo is 32 commits behind `origin/main`; this compares against local `main` `HEAD`.

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
