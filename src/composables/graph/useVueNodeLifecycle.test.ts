import { nextTick, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as VueUseCore from '@vueuse/core'

const shouldRenderVueNodes = ref(true)
const startSync = vi.fn()
const stopSync = vi.fn()
const initializeFromLiteGraph = vi.fn()
const clearAllSlotLayouts = vi.fn()
const createReroute = vi.fn()
const createLink = vi.fn()
const useGraphNodeManager = vi.fn()

const workflowStore = reactive({
  activeWorkflow: { path: 'workflows/alpha.json' } as { path: string } | null,
  openWorkflows: [{ path: 'workflows/alpha.json' }]
})

const canvasStore = {
  canvas: {
    graph: null as MockGraph | null
  }
}

interface MockNode {
  id: string
  pos: [number, number]
  size: [number, number]
}

interface MockGraph {
  _nodes: MockNode[]
  _links: Map<number, {
    id: number
    origin_id: string
    origin_slot: number
    target_id: string
    target_slot: number
  }>
  reroutes: Map<number, {
    id: number
    pos: [number, number]
    parentId: number | null
    linkIds: Set<number>
  }>
  onNodeAdded?: ((node: MockNode) => void) | undefined
}

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof VueUseCore>()

  return {
    ...actual,
    createSharedComposable: <T extends (...args: never[]) => unknown>(fn: T) =>
      fn
  }
})

vi.mock('@/composables/useVueFeatureFlags', () => ({
  useVueFeatureFlags: () => ({ shouldRenderVueNodes })
}))

vi.mock('@/renderer/core/canvas/canvasStore', () => ({
  useCanvasStore: () => canvasStore
}))

vi.mock('@/renderer/core/layout/sync/useLayoutSync', () => ({
  useLayoutSync: () => ({ startSync, stopSync })
}))

vi.mock('@/renderer/core/layout/store/layoutStore', () => ({
  layoutStore: {
    initializeFromLiteGraph,
    clearAllSlotLayouts
  }
}))

vi.mock('@/renderer/core/layout/operations/layoutMutations', () => ({
  useLayoutMutations: () => ({ createReroute, createLink })
}))

vi.mock('@/platform/workflow/management/stores/workflowStore', () => ({
  useWorkflowStore: () => workflowStore
}))

vi.mock('@/composables/graph/useGraphNodeManager', () => ({
  useGraphNodeManager
}))

vi.mock('@/scripts/app', () => ({
  app: {
    canvas: canvasStore.canvas
  }
}))

function createGraph(nodeIds: string[] = ['1']): MockGraph {
  return {
    _nodes: nodeIds.map((id, index) => ({
      id,
      pos: [index * 100, index * 50],
      size: [180, 120]
    })),
    _links: new Map(),
    reroutes: new Map(),
    onNodeAdded: undefined
  }
}

async function loadLifecycle() {
  const module = await import('@/composables/graph/useVueNodeLifecycle')
  return module.useVueNodeLifecycle()
}

describe('useVueNodeLifecycle', () => {
  beforeEach(() => {
    canvasStore.canvas.graph = null
    shouldRenderVueNodes.value = true
    workflowStore.activeWorkflow = { path: 'workflows/alpha.json' }
    workflowStore.openWorkflows = [{ path: 'workflows/alpha.json' }]

    startSync.mockReset()
    stopSync.mockReset()
    initializeFromLiteGraph.mockReset()
    clearAllSlotLayouts.mockReset()
    createReroute.mockReset()
    createLink.mockReset()
    useGraphNodeManager.mockReset()
    useGraphNodeManager.mockImplementation((graph: MockGraph) => ({
      vueNodeData: new Map(graph._nodes.map((node) => [node.id, { id: node.id }])),
      getNode: vi.fn(),
      cleanup: vi.fn()
    }))
    vi.resetModules()
  })

  it('reuses cached managers when returning to a previously active graph', async () => {
    const graphA = createGraph(['1'])
    const graphB = createGraph(['2'])

    canvasStore.canvas.graph = graphA
    const lifecycle = await loadLifecycle()

    lifecycle.initializeNodeManager()
    const managerA = lifecycle.nodeManager.value

    canvasStore.canvas.graph = graphB
    lifecycle.initializeNodeManager()
    const managerB = lifecycle.nodeManager.value

    canvasStore.canvas.graph = graphA
    lifecycle.initializeNodeManager()

    expect(useGraphNodeManager).toHaveBeenCalledTimes(2)
    expect(managerA).not.toBeNull()
    expect(managerB).not.toBeNull()
    expect(lifecycle.nodeManager.value).toBe(managerA)
    expect(stopSync.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(startSync.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('invalidates a cached graph when the same graph object is reused for another workflow', async () => {
    const reusedGraph = createGraph(['1'])

    canvasStore.canvas.graph = reusedGraph
    const lifecycle = await loadLifecycle()

    lifecycle.initializeNodeManager()
    const initialManager = lifecycle.nodeManager.value

    workflowStore.activeWorkflow = { path: 'workflows/beta.json' }
    workflowStore.openWorkflows = [{ path: 'workflows/beta.json' }]
    await nextTick()

    lifecycle.initializeNodeManager()

    expect(useGraphNodeManager).toHaveBeenCalledTimes(2)
    expect(initialManager?.cleanup).toHaveBeenCalledTimes(1)
    expect(lifecycle.nodeManager.value).not.toBe(initialManager)
  })

  it('drops cached managers for workflows that are no longer open', async () => {
    const cachedGraph = createGraph(['1'])

    canvasStore.canvas.graph = cachedGraph
    const lifecycle = await loadLifecycle()

    lifecycle.initializeNodeManager()
    const cachedManager = lifecycle.nodeManager.value

    workflowStore.openWorkflows = []
    await nextTick()

    expect(cachedManager?.cleanup).toHaveBeenCalledTimes(1)

    workflowStore.openWorkflows = [{ path: 'workflows/alpha.json' }]
    await nextTick()

    lifecycle.initializeNodeManager()

    expect(useGraphNodeManager).toHaveBeenCalledTimes(2)
    expect(lifecycle.nodeManager.value).not.toBe(cachedManager)
  })

  it('defers manager creation for empty graphs until the first node is added', async () => {
    const emptyGraph = createGraph([])

    canvasStore.canvas.graph = emptyGraph
    const lifecycle = await loadLifecycle()

    lifecycle.initializeNodeManager()

    expect(useGraphNodeManager).not.toHaveBeenCalled()
    expect(lifecycle.nodeManager.value).toBeNull()
    expect(initializeFromLiteGraph).toHaveBeenCalledWith([])

    const addedNode: MockNode = {
      id: '9',
      pos: [0, 0],
      size: [160, 100]
    }
    emptyGraph._nodes.push(addedNode)
    emptyGraph.onNodeAdded?.(addedNode)

    expect(useGraphNodeManager).toHaveBeenCalledTimes(1)
    expect(lifecycle.nodeManager.value).not.toBeNull()
  })
})