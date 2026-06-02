import { render } from '@testing-library/vue'
import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'

vi.mock('@vueuse/core', async () => {
  const { ref } = await import('vue')
  return {
    useDocumentVisibility: () => ref<'visible' | 'hidden'>('visible')
  }
})

import { LiteGraph } from '@/lib/litegraph/src/litegraph'
import { getSlotKey } from '@/renderer/core/layout/slots/slotIdentifier'
import { layoutStore } from '@/renderer/core/layout/store/layoutStore'
import { LayoutSource } from '@/renderer/core/layout/types'
import type { SlotLayout } from '@/renderer/core/layout/types'
import { useNodeSlotRegistryStore } from '@/renderer/extensions/vueNodes/stores/nodeSlotRegistryStore'

import {
  scheduleSlotLayoutSync,
  syncNodeSlotLayoutsFromDOM,
  flushScheduledSlotLayoutSync,
  requestSlotLayoutSyncForAllNodes,
  useSlotElementTracking
} from './useSlotElementTracking'

const mockGraph = vi.hoisted(() => ({ _nodes: [] as unknown[] }))
const mockCanvasState = vi.hoisted(() => ({
  canvas: {} as object | null
}))
const mockAppCanvasState = vi.hoisted(() => ({
  pointer: {
    isDown: false,
    eDown: { button: 0 }
  },
  dragging_canvas: false,
  graph: mockGraph,
  setDirty: vi.fn()
}))
const mockClientPosToCanvasPos = vi.hoisted(() =>
  vi.fn(([x, y]: [number, number]) => [x * 0.5, y * 0.5] as [number, number])
)

vi.mock('@/scripts/app', () => ({
  app: { canvas: mockAppCanvasState }
}))

vi.mock('@/renderer/core/canvas/canvasStore', () => ({
  useCanvasStore: () => mockCanvasState
}))

vi.mock('@/composables/element/useCanvasPositionConversion', () => ({
  useSharedCanvasPositionConversion: () => ({
    clientPosToCanvasPos: mockClientPosToCanvasPos
  })
}))

const NODE_ID = 'test-node'
const SLOT_INDEX = 0

function seedNodeLayout(nodeId: string) {
  layoutStore.applyOperation({
    type: 'createNode',
    entity: 'node',
    nodeId,
    layout: {
      id: nodeId,
      position: { x: 0, y: 0 },
      size: { width: 200, height: 100 },
      zIndex: 0,
      visible: true,
      bounds: { x: 0, y: 0, width: 200, height: 100 }
    },
    timestamp: Date.now(),
    source: LayoutSource.External,
    actor: 'test'
  })
}

function createTestSetup(type: 'input' | 'output') {
  const el = ref<HTMLElement | null>(null)
  const TestComponent = defineComponent({
    setup() {
      useSlotElementTracking({
        nodeId: NODE_ID,
        index: SLOT_INDEX,
        type,
        element: el
      })
      return { el }
    },
    template: '<div />'
  })
  return { el, TestComponent }
}

function createMeasuredSlotElement(
  nodeId = NODE_ID,
  collapsed = false
): {
  container: HTMLElement
  el: HTMLElement
  nodeRectSpy: ReturnType<typeof vi.fn>
  slotRectSpy: ReturnType<typeof vi.fn>
} {
  const container = document.createElement('div')
  container.dataset.nodeId = nodeId
  if (collapsed) container.dataset.collapsed = ''
  const nodeRectSpy = vi.fn(() =>
    ({
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect)
  container.getBoundingClientRect = nodeRectSpy as typeof container.getBoundingClientRect
  document.body.appendChild(container)

  const el = document.createElement('div')
  const slotRectSpy = vi.fn(() =>
    ({
      left: 10,
      top: 30,
      right: 20,
      bottom: 40,
      width: 10,
      height: 10,
      x: 10,
      y: 30,
      toJSON: () => ({})
    }) as DOMRect)
  el.getBoundingClientRect = slotRectSpy as typeof el.getBoundingClientRect
  container.appendChild(el)

  return { container, el, nodeRectSpy, slotRectSpy }
}

function createSlotElement(collapsed = false, nodeId = NODE_ID): HTMLElement {
  return createMeasuredSlotElement(nodeId, collapsed).el
}

/**
 * Mount the wrapper, set the element ref, and wait for slot registration.
 */
async function mountAndRegisterSlot(type: 'input' | 'output') {
  const { el, TestComponent } = createTestSetup(type)
  const { unmount } = render(TestComponent)
  el.value = createSlotElement()
  await nextTick()
  flushScheduledSlotLayoutSync()
  return { unmount }
}

describe('useSlotElementTracking', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    document.body.innerHTML = ''
    layoutStore.initializeFromLiteGraph([])
    seedNodeLayout(NODE_ID)
    mockGraph._nodes = [{ id: 1 }]
    mockCanvasState.canvas = {}
    mockAppCanvasState.pointer.isDown = false
    mockAppCanvasState.pointer.eDown = { button: 0 }
    mockAppCanvasState.dragging_canvas = false
    mockAppCanvasState.setDirty.mockClear()
    LiteGraph.vueNodesMode = true
    mockClientPosToCanvasPos.mockClear()
  })

  it.for([
    { type: 'input' as const, isInput: true },
    { type: 'output' as const, isInput: false }
  ])('cleans up $type slot layout on unmount', async ({ type, isInput }) => {
    const { unmount } = await mountAndRegisterSlot(type)

    const slotKey = getSlotKey(NODE_ID, SLOT_INDEX, isInput)
    const registryStore = useNodeSlotRegistryStore()
    expect(registryStore.getNode(NODE_ID)?.slots.has(slotKey)).toBe(true)
    expect(layoutStore.getSlotLayout(slotKey)).not.toBeNull()

    unmount()

    expect(layoutStore.getSlotLayout(slotKey)).not.toBeNull()
    expect(registryStore.getNode(NODE_ID)).toBeUndefined()
  })

  it('clears pendingSlotSync when slot layouts already exist', () => {
    // Seed a slot layout (simulates slot layouts persisting through undo/redo)
    const slotKey = getSlotKey(NODE_ID, SLOT_INDEX, true)
    const slotLayout: SlotLayout = {
      nodeId: NODE_ID,
      index: 0,
      type: 'input',
      position: { x: 0, y: 0 },
      bounds: { x: 0, y: 0, width: 10, height: 10 }
    }
    layoutStore.batchUpdateSlotLayouts([{ key: slotKey, layout: slotLayout }])

    // Simulate what app.ts onConfigure does: set pending, then flush
    layoutStore.setPendingSlotSync(true)
    expect(layoutStore.pendingSlotSync).toBe(true)

    // No slots were scheduled (undo/redo — onMounted didn't fire),
    // but slot layouts already exist. Flush should clear the flag.
    flushScheduledSlotLayoutSync()

    expect(layoutStore.pendingSlotSync).toBe(false)
  })

  it('keeps pendingSlotSync when graph has nodes but no slot layouts', () => {
    // No slot layouts exist (simulates initial mount before Vue registers slots)
    layoutStore.setPendingSlotSync(true)

    flushScheduledSlotLayoutSync()

    // Should remain pending — waiting for Vue components to mount
    expect(layoutStore.pendingSlotSync).toBe(true)
  })

  it('keeps pendingSlotSync when all registered slots are hidden', () => {
    const slotKey = getSlotKey(NODE_ID, SLOT_INDEX, true)
    const hiddenSlot = document.createElement('div')

    const registryStore = useNodeSlotRegistryStore()
    const node = registryStore.ensureNode(NODE_ID)
    node.slots.set(slotKey, {
      el: hiddenSlot,
      index: SLOT_INDEX,
      type: 'input'
    })

    layoutStore.setPendingSlotSync(true)
    requestSlotLayoutSyncForAllNodes()

    expect(layoutStore.pendingSlotSync).toBe(true)
    expect(layoutStore.getSlotLayout(slotKey)).toBeNull()
  })

  it('removes stale slot layouts when slot element is hidden', () => {
    const slotKey = getSlotKey(NODE_ID, SLOT_INDEX, true)
    const hiddenSlot = document.createElement('div')

    const staleLayout: SlotLayout = {
      nodeId: NODE_ID,
      index: SLOT_INDEX,
      type: 'input',
      position: { x: 10, y: 20 },
      bounds: { x: 6, y: 16, width: 8, height: 8 }
    }
    layoutStore.batchUpdateSlotLayouts([{ key: slotKey, layout: staleLayout }])

    const registryStore = useNodeSlotRegistryStore()
    const node = registryStore.ensureNode(NODE_ID)
    node.slots.set(slotKey, {
      el: hiddenSlot,
      index: SLOT_INDEX,
      type: 'input',
      cachedOffset: { x: 15, y: 5 }
    })

    syncNodeSlotLayoutsFromDOM(NODE_ID)

    expect(layoutStore.getSlotLayout(slotKey)).toBeNull()
    expect(node.slots.get(slotKey)?.cachedOffset).toBeUndefined()
  })

  it('skips slot layout writeback when measured slot geometry is unchanged', () => {
    const slotKey = getSlotKey(NODE_ID, SLOT_INDEX, true)
    const slotEl = createSlotElement()

    const registryStore = useNodeSlotRegistryStore()
    const node = registryStore.ensureNode(NODE_ID)

    const expectedX = 15
    const expectedY = 35 - LiteGraph.NODE_TITLE_HEIGHT

    node.slots.set(slotKey, {
      el: slotEl,
      index: SLOT_INDEX,
      type: 'input',
      cachedOffset: { x: expectedX, y: expectedY }
    })

    const slotSize = LiteGraph.NODE_SLOT_HEIGHT
    const halfSlotSize = slotSize / 2
    const initialLayout: SlotLayout = {
      nodeId: NODE_ID,
      index: SLOT_INDEX,
      type: 'input',
      position: { x: expectedX, y: expectedY },
      bounds: {
        x: expectedX - halfSlotSize,
        y: expectedY - halfSlotSize,
        width: slotSize,
        height: slotSize
      }
    }
    layoutStore.batchUpdateSlotLayouts([
      { key: slotKey, layout: initialLayout }
    ])

    const batchUpdateSpy = vi.spyOn(layoutStore, 'batchUpdateSlotLayouts')

    syncNodeSlotLayoutsFromDOM(NODE_ID)

    expect(batchUpdateSpy).not.toHaveBeenCalled()
  })

  it('measures only dirty nodes during request-all syncs', () => {
    const cleanNodeId = 'clean-node'
    const dirtyNodeId = 'dirty-node'
    seedNodeLayout(cleanNodeId)
    seedNodeLayout(dirtyNodeId)

    const cleanSlotKey = getSlotKey(cleanNodeId, SLOT_INDEX, true)
    const dirtySlotKey = getSlotKey(dirtyNodeId, SLOT_INDEX, true)
    const cleanMeasured = createMeasuredSlotElement(cleanNodeId)
    const dirtyMeasured = createMeasuredSlotElement(dirtyNodeId)

    const expectedX = 15
    const expectedY = 35 - LiteGraph.NODE_TITLE_HEIGHT
    const slotSize = LiteGraph.NODE_SLOT_HEIGHT
    const halfSlotSize = slotSize / 2

    const registryStore = useNodeSlotRegistryStore()
    registryStore.ensureNode(cleanNodeId).slots.set(cleanSlotKey, {
      el: cleanMeasured.el,
      index: SLOT_INDEX,
      type: 'input',
      cachedOffset: { x: expectedX, y: expectedY }
    })
    registryStore.ensureNode(dirtyNodeId).slots.set(dirtySlotKey, {
      el: dirtyMeasured.el,
      index: SLOT_INDEX,
      type: 'input',
      cachedOffset: { x: expectedX, y: expectedY }
    })

    const initialLayouts: Array<{ key: string; layout: SlotLayout }> = [
      {
        key: cleanSlotKey,
        layout: {
          nodeId: cleanNodeId,
          index: SLOT_INDEX,
          type: 'input',
          position: { x: expectedX, y: expectedY },
          bounds: {
            x: expectedX - halfSlotSize,
            y: expectedY - halfSlotSize,
            width: slotSize,
            height: slotSize
          }
        }
      },
      {
        key: dirtySlotKey,
        layout: {
          nodeId: dirtyNodeId,
          index: SLOT_INDEX,
          type: 'input',
          position: { x: expectedX, y: expectedY },
          bounds: {
            x: expectedX - halfSlotSize,
            y: expectedY - halfSlotSize,
            width: slotSize,
            height: slotSize
          }
        }
      }
    ]
    layoutStore.batchUpdateSlotLayouts(initialLayouts)

    scheduleSlotLayoutSync(dirtyNodeId)
    requestSlotLayoutSyncForAllNodes()
    flushScheduledSlotLayoutSync()

    expect(cleanMeasured.slotRectSpy).not.toHaveBeenCalled()
    expect(cleanMeasured.nodeRectSpy).not.toHaveBeenCalled()
    expect(dirtyMeasured.slotRectSpy).toHaveBeenCalledOnce()
    expect(dirtyMeasured.nodeRectSpy).toHaveBeenCalledOnce()
  })

  it('uses cached slot offsets instead of DOM reads during active canvas pan', () => {
    const slotKey = getSlotKey(NODE_ID, SLOT_INDEX, true)
    const measured = createMeasuredSlotElement(NODE_ID)

    const registryStore = useNodeSlotRegistryStore()
    registryStore.ensureNode(NODE_ID).slots.set(slotKey, {
      el: measured.el,
      index: SLOT_INDEX,
      type: 'input',
      cachedOffset: { x: 50, y: 60 }
    })

    mockAppCanvasState.pointer.isDown = true
    mockAppCanvasState.dragging_canvas = true
    scheduleSlotLayoutSync(NODE_ID)
    flushScheduledSlotLayoutSync()

    expect(measured.slotRectSpy).not.toHaveBeenCalled()
    expect(measured.nodeRectSpy).not.toHaveBeenCalled()
    expect(layoutStore.getSlotLayout(slotKey)?.position).toEqual({
      x: 50,
      y: 60
    })
  })

  describe('collapsed node slot sync', () => {
    function registerCollapsedSlot() {
      const slotKey = getSlotKey(NODE_ID, SLOT_INDEX, true)
      const slotEl = createSlotElement(true)

      const registryStore = useNodeSlotRegistryStore()
      const node = registryStore.ensureNode(NODE_ID)
      node.slots.set(slotKey, {
        el: slotEl,
        index: SLOT_INDEX,
        type: 'input',
        cachedOffset: { x: 50, y: 60 }
      })

      return { slotKey, node }
    }

    it('uses clientPosToCanvasPos for collapsed nodes', () => {
      const { slotKey } = registerCollapsedSlot()

      syncNodeSlotLayoutsFromDOM(NODE_ID)

      // Slot element center: (10 + 10/2, 30 + 10/2) = (15, 35)
      const screenCenter: [number, number] = [15, 35]
      expect(mockClientPosToCanvasPos).toHaveBeenCalledWith(screenCenter)

      // Mock returns x*0.5, y*0.5
      const layout = layoutStore.getSlotLayout(slotKey)
      expect(layout).not.toBeNull()
      expect(layout!.position.x).toBe(screenCenter[0] * 0.5)
      expect(layout!.position.y).toBe(screenCenter[1] * 0.5)
    })

    it('clears cachedOffset for collapsed nodes', () => {
      const { slotKey, node } = registerCollapsedSlot()
      const entry = node.slots.get(slotKey)!
      expect(entry.cachedOffset).toBeDefined()

      syncNodeSlotLayoutsFromDOM(NODE_ID)

      expect(entry.cachedOffset).toBeUndefined()
    })

    it('defers sync when canvas is not initialized', () => {
      mockCanvasState.canvas = null
      registerCollapsedSlot()

      syncNodeSlotLayoutsFromDOM(NODE_ID)

      expect(mockClientPosToCanvasPos).not.toHaveBeenCalled()
    })
  })
})
