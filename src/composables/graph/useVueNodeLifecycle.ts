import { createSharedComposable, whenever } from '@vueuse/core'
import { shallowRef, watch } from 'vue'

import { useGraphNodeManager } from '@/composables/graph/useGraphNodeManager'
import type { GraphNodeManager } from '@/composables/graph/useGraphNodeManager'
import { useVueFeatureFlags } from '@/composables/useVueFeatureFlags'
import { useWorkflowStore } from '@/platform/workflow/management/stores/workflowStore'
import type { LGraph, LGraphNode, Subgraph } from '@/lib/litegraph/src/litegraph'
import { useCanvasStore } from '@/renderer/core/canvas/canvasStore'
import { useLayoutMutations } from '@/renderer/core/layout/operations/layoutMutations'
import { layoutStore } from '@/renderer/core/layout/store/layoutStore'
import { useLayoutSync } from '@/renderer/core/layout/sync/useLayoutSync'
import { app as comfyApp } from '@/scripts/app'

type ActiveGraph = LGraph | Subgraph

interface CachedGraphState {
  graph: ActiveGraph
  manager: GraphNodeManager | null
  workflowPath: string | null
  removeEmptyGraphListener?: () => void
}

function useVueNodeLifecycleIndividual() {
  const canvasStore = useCanvasStore()
  const workflowStore = useWorkflowStore()
  const layoutMutations = useLayoutMutations()
  const { shouldRenderVueNodes } = useVueFeatureFlags()
  const nodeManager = shallowRef<GraphNodeManager | null>(null)
  const activeGraph = shallowRef<ActiveGraph | null>(null)
  const graphStateCache = new Map<ActiveGraph, CachedGraphState>()
  const { startSync, stopSync } = useLayoutSync()
  let deferredTopologySeedGeneration = 0

  const getActiveWorkflowPath = () => workflowStore.activeWorkflow?.path ?? null

  const seedLayoutFromGraph = (graph: ActiveGraph) => {
    const nodes = graph._nodes.map((node: LGraphNode) => ({
      id: node.id.toString(),
      pos: [node.pos[0], node.pos[1]] as [number, number],
      size: [node.size[0], node.size[1]] as [number, number]
    }))
    layoutStore.initializeFromLiteGraph(nodes)
  }

  const seedTopologyFromGraph = async (
    graph: ActiveGraph,
    generation: number
  ) => {
    const yieldToBrowser = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })

    let processed = 0
    for (const reroute of graph.reroutes.values()) {
      if (generation !== deferredTopologySeedGeneration) return

      const [x, y] = reroute.pos
      const parent = reroute.parentId ?? undefined
      const linkIds = Array.from(reroute.linkIds)
      layoutMutations.createReroute(reroute.id, { x, y }, parent, linkIds)

      if (++processed % 100 === 0) {
        await yieldToBrowser()
      }
    }

    processed = 0
    for (const link of graph._links.values()) {
      if (generation !== deferredTopologySeedGeneration) return

      layoutMutations.createLink(
        link.id,
        link.origin_id,
        link.origin_slot,
        link.target_id,
        link.target_slot
      )

      if (++processed % 100 === 0) {
        await yieldToBrowser()
      }
    }
  }

  const deactivateActiveGraph = () => {
    deferredTopologySeedGeneration++
    stopSync()
    activeGraph.value = null
    nodeManager.value = null
  }

  const clearEmptyGraphListener = (state: CachedGraphState) => {
    state.removeEmptyGraphListener?.()
    state.removeEmptyGraphListener = undefined
  }

  const cleanupCachedGraphState = (graph: ActiveGraph) => {
    const state = graphStateCache.get(graph)
    if (!state) return

    clearEmptyGraphListener(state)

    try {
      state.manager?.cleanup()
    } catch {
      /* empty */
    }

    if (activeGraph.value === graph) {
      deactivateActiveGraph()
    }

    graphStateCache.delete(graph)
  }

  const getOrCreateGraphState = (graph: ActiveGraph) => {
    const workflowPath = getActiveWorkflowPath()
    const existingState = graphStateCache.get(graph)

    if (existingState && existingState.workflowPath !== workflowPath) {
      cleanupCachedGraphState(graph)
    }

    const nextState = graphStateCache.get(graph)
    if (nextState) return nextState

    const createdState: CachedGraphState = {
      graph,
      manager: null,
      workflowPath
    }
    graphStateCache.set(graph, createdState)
    return createdState
  }

  const activateGraphState = (state: CachedGraphState) => {
    const isGraphSwitch = activeGraph.value !== state.graph
    if (isGraphSwitch) {
      stopSync()
      layoutStore.clearAllSlotLayouts()
    }

    activeGraph.value = state.graph
    nodeManager.value = state.manager
    seedLayoutFromGraph(state.graph)
    void seedTopologyFromGraph(state.graph, ++deferredTopologySeedGeneration)

    // Start sync AFTER seeding so bootstrap operations don't trigger
    // the Layout→LiteGraph writeback loop redundantly.
    startSync(canvasStore.canvas)
  }

  const ensureEmptyGraphListener = (state: CachedGraphState) => {
    if (
      state.removeEmptyGraphListener ||
      state.manager ||
      state.graph._nodes.length !== 0
    ) {
      return
    }

    const originalOnNodeAdded = state.graph.onNodeAdded
    const emptyGraphListener = function (this: unknown, node: LGraphNode) {
      clearEmptyGraphListener(state)

      if (shouldRenderVueNodes.value && !state.manager) {
        state.manager = useGraphNodeManager(state.graph)
      }

      if (originalOnNodeAdded) {
        originalOnNodeAdded.call(this, node)
      }

      if (comfyApp.canvas?.graph === state.graph && state.manager) {
        activateGraphState(state)
      }
    }

    state.graph.onNodeAdded = emptyGraphListener
    state.removeEmptyGraphListener = () => {
      if (state.graph.onNodeAdded === emptyGraphListener) {
        state.graph.onNodeAdded = originalOnNodeAdded
      }
    }
  }

  const initializeNodeManager = () => {
    const currentGraph = comfyApp.canvas?.graph
    if (!currentGraph) return

    const state = getOrCreateGraphState(currentGraph)

    if (currentGraph._nodes.length === 0) {
      deactivateActiveGraph()
      activeGraph.value = currentGraph
      layoutStore.initializeFromLiteGraph([])
      ensureEmptyGraphListener(state)
      return
    }

    clearEmptyGraphListener(state)
    if (!state.manager) {
      state.manager = useGraphNodeManager(currentGraph)
    }

    activateGraphState(state)
  }

  const disposeNodeManagerAndSyncs = () => {
    deactivateActiveGraph()
  }

  // Watch for Vue nodes enabled state changes
  watch(
    () => shouldRenderVueNodes.value && Boolean(comfyApp.canvas?.graph),
    (enabled) => {
      if (enabled) {
        initializeNodeManager()
      }
    },
    { immediate: true }
  )

  whenever(
    () => !shouldRenderVueNodes.value,
    () => {
      deactivateActiveGraph()

      for (const graph of Array.from(graphStateCache.keys())) {
        cleanupCachedGraphState(graph)
      }

      // Force arrange() on all nodes so input.pos is computed before
      // the first legacy drawConnections frame (which may run before
      // drawNode on the foreground canvas).
      const graph = comfyApp.canvas?.graph
      if (!graph) {
        comfyApp.canvas?.setDirty(true, true)
        return
      }
      for (const node of graph._nodes) {
        if (node.flags.collapsed) continue
        try {
          node.arrange()
        } catch {
          /* skip nodes not fully initialized */
        }
      }

      comfyApp.canvas?.setDirty(true, true)
    }
  )

  // Clear stale slot layouts when switching modes
  watch(
    () => shouldRenderVueNodes.value,
    () => {
      layoutStore.clearAllSlotLayouts()
    }
  )

  const setupEmptyGraphListener = () => {
    const currentGraph = comfyApp.canvas?.graph
    if (!currentGraph) return

    const state = getOrCreateGraphState(currentGraph)
    ensureEmptyGraphListener(state)
  }

  watch(
    () => workflowStore.openWorkflows.map((workflow) => workflow.path),
    (openWorkflowPaths) => {
      const openPathSet = new Set(openWorkflowPaths)

      for (const [graph, state] of graphStateCache) {
        if (state.workflowPath && !openPathSet.has(state.workflowPath)) {
          cleanupCachedGraphState(graph)
        }
      }
    },
    { immediate: true }
  )

  // Cleanup function for component unmounting
  const cleanup = () => {
    deactivateActiveGraph()
    for (const graph of Array.from(graphStateCache.keys())) {
      cleanupCachedGraphState(graph)
    }
  }

  return {
    nodeManager,

    // Lifecycle methods
    initializeNodeManager,
    disposeNodeManagerAndSyncs,
    setupEmptyGraphListener,
    cleanup
  }
}

export const useVueNodeLifecycle = createSharedComposable(
  useVueNodeLifecycleIndividual
)
