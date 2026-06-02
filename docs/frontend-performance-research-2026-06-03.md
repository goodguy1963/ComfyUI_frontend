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
| C1 | Fix low-detail Vue nodes that become blacked out without usable title information. | Pending | Targeted Vue node tests, full typecheck, Replacer visual/perf probe. |
| C2 | Fix far-zoom canvas nodes with oversized titles or oversized header bars. | Pending | `panSnapshotCanvas` tests, Replacer far/middle/close probe. |
| C3 | Add or update visual assertions for far-zoom and low-detail rendering consistency. | Pending | Unit tests plus screenshot or canvas probe where feasible. |

### R22 Implementation Sequence

| ID | Task | Status | Required tests |
| --- | --- | --- | --- |
| R1 | Stabilize instrumentation and comparison reporting for `main`, `research-start`, and `research-final`. | Pending | Benchmark probe runs on all available states. |
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
