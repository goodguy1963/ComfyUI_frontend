/**
 * Composable for syncing LiteGraph with the Layout system
 *
 * Implements one-way sync from Layout Store to LiteGraph.
 * The layout store is the single source of truth.
 */
import { onUnmounted, ref } from 'vue'

import type { useCanvasStore } from '@/renderer/core/canvas/canvasStore'
import { recordLayoutPerfCounter } from '@/renderer/core/layout/performance/layoutPerfInstrumentation'
import { layoutStore } from '@/renderer/core/layout/store/layoutStore'
import { LayoutSource } from '@/renderer/core/layout/types'

/**
 * Composable for syncing LiteGraph with the Layout system
 * This replaces the bidirectional sync with a one-way sync
 */
export function useLayoutSync() {
  const unsubscribe = ref<() => void>()
  const pendingNodeIds = new Set<string>()
  let rafId: number | null = null
  let isMicrotaskQueued = false
  let syncGeneration = 0

  function flushPendingChanges(
    canvas: ReturnType<typeof useCanvasStore>['canvas']
  ) {
    rafId = null
    isMicrotaskQueued = false
    if (!canvas?.graph || pendingNodeIds.size === 0) return
    recordLayoutPerfCounter('syncFlushes')
    recordLayoutPerfCounter('syncFlushedNodeIds', pendingNodeIds.size)

    let didMoveNode = false
    let didResizeNode = false

    for (const nodeId of pendingNodeIds) {
      const layout = layoutStore.getNodeLayoutRef(nodeId).value
      if (!layout) continue

      const liteNode = canvas.graph.getNodeById(nodeId)
      if (!liteNode) continue

      if (
        liteNode.pos[0] !== layout.position.x ||
        liteNode.pos[1] !== layout.position.y
      ) {
        liteNode.pos[0] = layout.position.x
        liteNode.pos[1] = layout.position.y
        didMoveNode = true
      }

      // Note: layout.size.height is the content height without title.
      // LiteGraph's measure() will add titleHeight to get boundingRect.
      // Do NOT use addNodeTitleHeight here - that would double-count the title.
      if (
        liteNode.size[0] !== layout.size.width ||
        liteNode.size[1] !== layout.size.height
      ) {
        // Update internal size directly (like position above) to avoid
        // the size setter writing back to layoutStore with Canvas source,
        // which would create a feedback loop through handleLayoutChange.
        liteNode.size[0] = layout.size.width
        liteNode.size[1] = layout.size.height
        liteNode.onResize?.(liteNode.size)
        didResizeNode = true
      }
    }

    pendingNodeIds.clear()
    if (didResizeNode) {
      recordLayoutPerfCounter('syncDirtyForeground')
      recordLayoutPerfCounter('syncDirtyBackground')
      recordLayoutPerfCounter('syncDirtyBoth')
      canvas.setDirty(true, true)
      return
    }

    if (didMoveNode) {
      recordLayoutPerfCounter('syncDirtyBackground')
      canvas.setDirty(false, true)
    }
  }

  function scheduleFlush(
    source: LayoutSource,
    canvas: ReturnType<typeof useCanvasStore>['canvas']
  ) {
    const shouldFlushInMicrotask =
      source === LayoutSource.Vue || source === LayoutSource.DOM

    if (shouldFlushInMicrotask) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      if (isMicrotaskQueued) return

      isMicrotaskQueued = true
      recordLayoutPerfCounter('syncScheduledMicrotasks')
      const gen = syncGeneration
      queueMicrotask(() => {
        if (gen !== syncGeneration) return
        flushPendingChanges(canvas)
      })
      return
    }

    if (rafId !== null || isMicrotaskQueued) return

    const gen = syncGeneration
    recordLayoutPerfCounter('syncScheduledRafs')
    rafId = requestAnimationFrame(() => {
      if (gen !== syncGeneration) return
      flushPendingChanges(canvas)
    })
  }

  /**
   * Start syncing from Layout → LiteGraph
   */
  function startSync(canvas: ReturnType<typeof useCanvasStore>['canvas']) {
    if (!canvas?.graph) return

    // Cancel last subscription
    stopSync()
    // Subscribe to layout changes
    unsubscribe.value = layoutStore.onChange((change) => {
      // Topology-only changes (links, reroutes) don't need LiteGraph
      // node writeback — link rendering reads from the store directly.
      if (change.nodeIds.length === 0) return
      // Canvas-originated layout changes already updated LiteGraph. Writing
      // them back through the sync loop only repeats graph lookups and dirty
      // checks on the interaction path.
      if (change.source === LayoutSource.Canvas) {
        recordLayoutPerfCounter('syncSkippedCanvasSource')
        return
      }

      for (const nodeId of change.nodeIds) {
        pendingNodeIds.add(nodeId)
      }
      scheduleFlush(change.source, canvas)
    })
  }

  function stopSync() {
    syncGeneration++
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    isMicrotaskQueued = false
    pendingNodeIds.clear()
    unsubscribe.value?.()
    unsubscribe.value = undefined
  }

  onUnmounted(stopSync)

  return {
    startSync,
    stopSync
  }
}
