import { createTestingPinia } from '@pinia/testing'
import { fromAny } from '@total-typescript/shoehorn'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, isReactive, nextTick, watch } from 'vue'

import {
  extractVueNodeData,
  useGraphNodeManager
} from '@/composables/graph/useGraphNodeManager'
import { createPromotedWidgetView } from '@/core/graph/subgraph/promotedWidgetView'
import { BaseWidget, LGraph, LGraphNode } from '@/lib/litegraph/src/litegraph'
import { widgetEntityId } from '@/world/entityIds'
import {
  createTestSubgraph,
  createTestSubgraphNode
} from '@/lib/litegraph/src/subgraph/__fixtures__/subgraphHelpers'
import { NodeSlotType } from '@/lib/litegraph/src/types/globalEnums'
import { useMissingModelStore } from '@/platform/missingModel/missingModelStore'
import { useSettingStore } from '@/platform/settings/settingStore'
import { app } from '@/scripts/app'
import { useExecutionErrorStore } from '@/stores/executionErrorStore'
import { useWidgetValueStore } from '@/stores/widgetValueStore'

describe('Node Reactivity', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  function createTestGraph() {
    const graph = new LGraph()
    const node = new LGraphNode('test')
    node.addInput('input', 'INT')
    node.addWidget('number', 'testnum', 2, () => undefined, {})
    graph.add(node)

    const { vueNodeData } = useGraphNodeManager(graph)

    return { node, graph, vueNodeData }
  }

  it('widget values are reactive through the store', async () => {
    const { node, graph } = createTestGraph()
    const store = useWidgetValueStore()
    const widget = node.widgets![0]

    // Verify widget is a BaseWidget with correct value and node assignment
    expect(widget).toBeInstanceOf(BaseWidget)
    expect(widget.value).toBe(2)
    expect((widget as BaseWidget).node.id).toBe(node.id)

    // Initial value should be in store after setNodeId was called
    expect(store.getWidget(graph.id, node.id, 'testnum')?.value).toBe(2)

    const state = store.getWidget(graph.id, node.id, 'testnum')
    if (!state) throw new Error('Expected widget state to exist')

    const onValueChange = vi.fn()
    const widgetValue = computed(() => state.value)
    watch(widgetValue, onValueChange)

    widget.value = 42
    await nextTick()

    expect(widgetValue.value).toBe(42)
    expect(onValueChange).toHaveBeenCalledTimes(1)
  })

  it('widget values remain reactive after a connection is made', async () => {
    const { node, graph } = createTestGraph()
    const store = useWidgetValueStore()
    const onValueChange = vi.fn()

    graph.trigger('node:slot-links:changed', {
      nodeId: String(node.id),
      slotType: NodeSlotType.INPUT
    })
    await nextTick()

    const state = store.getWidget(graph.id, node.id, 'testnum')
    if (!state) throw new Error('Expected widget state to exist')

    const widgetValue = computed(() => state.value)
    watch(widgetValue, onValueChange)

    node.widgets![0].value = 99
    await nextTick()

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(widgetValue.value).toBe(99)
  })

  it('preserves node entry identity for single-node property changes', async () => {
    const graph = new LGraph()
    const node = new LGraphNode('test')
    node.title = 'before'
    graph.add(node)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeId = String(node.id)
    const initialNodeData = vueNodeData.get(nodeId)
    if (!initialNodeData) throw new Error('Expected initial node data')

    graph.trigger('node:property:changed', {
      nodeId,
      property: 'title',
      newValue: 'after'
    })
    await nextTick()

    expect(vueNodeData.get(nodeId)).toBe(initialNodeData)
    expect(initialNodeData.title).toBe('after')
  })

  it('does not keep wrapping the widgets getter when extracting the same node repeatedly', () => {
    const node = new LGraphNode('reroute')
    node.addWidget('number', 'seed', 7, () => undefined, {})

    for (let i = 0; i < 5000; i++) {
      extractVueNodeData(node)
    }

    expect(() => node.widgets?.some((widget) => widget.name === 'seed')).not.toThrow()
    expect(node.widgets?.some((widget) => widget.name === 'seed')).toBe(true)
  })

  it('keeps empty synthetic widget getters non-reactive when syncing into vue node data', () => {
    const graph = new LGraph()
    const node = new LGraphNode('reroute')
    const syntheticWidgets: BaseWidget[] = []
    graph.add(node)

    Object.defineProperty(node, 'widgets', {
      get: () => syntheticWidgets,
      configurable: true,
      enumerable: true
    })

    const { vueNodeData } = useGraphNodeManager(graph)

    for (let i = 0; i < 5000; i++) {
      const nodeData = vueNodeData.get(String(node.id))
      if (!nodeData) {
        throw new Error('Expected vue node data for synthetic widget getter')
      }
      expect(nodeData.widgets).toHaveLength(0)
    }

    expect(node.widgets).toBe(syntheticWidgets)
    expect(isReactive(node.widgets)).toBe(false)
  })

  it('fails closed when malformed widget extraction overflows', () => {
    const graph = new LGraph()
    const node = new LGraphNode('reroute')
    graph.add(node)

    Object.defineProperty(node, 'widgets', {
      get() {
        throw new RangeError('Maximum call stack size exceeded')
      },
      configurable: true,
      enumerable: true
    })

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeData = vueNodeData.get(String(node.id))
    if (!nodeData) {
      throw new Error('Expected vue node data after malformed widget overflow')
    }

    expect(nodeData.widgets).toEqual([])
  })

  it('does not rebuild the ordered node collection for unrelated node property changes', async () => {
    const graph = new LGraph()
    const firstNode = new LGraphNode('first')
    firstNode.title = 'first-before'
    graph.add(firstNode)

    const secondNode = new LGraphNode('second')
    secondNode.title = 'second-before'
    graph.add(secondNode)

    const { vueNodeData } = useGraphNodeManager(graph)
    const orderedNodes = computed(() => Array.from(vueNodeData.values()))
    const orderedNodesWatcher = vi.fn()
    watch(orderedNodes, orderedNodesWatcher)

    const initialOrderedNodes = orderedNodes.value
    const initialSecondNodeData = initialOrderedNodes[1]
    if (!initialSecondNodeData)
      throw new Error('Expected second node in ordered collection')

    graph.trigger('node:property:changed', {
      nodeId: String(firstNode.id),
      property: 'title',
      newValue: 'first-after'
    })
    await nextTick()

    expect(orderedNodes.value).toBe(initialOrderedNodes)
    expect(orderedNodes.value[1]).toBe(initialSecondNodeData)
    expect(orderedNodes.value.map((nodeData) => nodeData.id)).toEqual([
      String(firstNode.id),
      String(secondNode.id)
    ])
    expect(orderedNodesWatcher).not.toHaveBeenCalled()
  })

  it('keeps the ordered node collection aligned through add/remove bursts', async () => {
    const graph = new LGraph()
    const firstNode = new LGraphNode('first')
    const secondNode = new LGraphNode('second')
    const thirdNode = new LGraphNode('third')
    graph.add(firstNode)
    graph.add(secondNode)
    graph.add(thirdNode)

    const { vueNodeData } = useGraphNodeManager(graph)
    const orderedNodeIds = computed(() =>
      Array.from(vueNodeData.values()).map((nodeData) => nodeData.id)
    )

    expect(orderedNodeIds.value).toEqual([
      String(firstNode.id),
      String(secondNode.id),
      String(thirdNode.id)
    ])

    graph.remove(secondNode)
    await nextTick()

    expect(orderedNodeIds.value).toEqual([
      String(firstNode.id),
      String(thirdNode.id)
    ])

    graph.add(secondNode)
    await nextTick()

    expect(orderedNodeIds.value).toEqual([
      String(firstNode.id),
      String(thirdNode.id),
      String(secondNode.id)
    ])
  })

  it('does not replay onNodeAdded for existing nodes during bootstrap', () => {
    const graph = new LGraph()
    const node = new LGraphNode('reroute')
    graph.add(node)

    let replayCount = 0
    graph.onNodeAdded = (addedNode) => {
      replayCount += 1
      if (replayCount === 1) {
        graph.onNodeAdded?.(addedNode)
      }
    }

    expect(() => useGraphNodeManager(graph)).not.toThrow()

    expect(replayCount).toBe(0)

    graph.add(new LGraphNode('new-node'))

    expect(replayCount).toBe(1)
  })
})

describe('Widget slotMetadata reactivity on link disconnect', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  function createWidgetInputGraph() {
    const graph = new LGraph()
    const node = new LGraphNode('test')

    // Add a widget and an associated input slot (simulates "widget converted to input")
    node.addWidget('string', 'prompt', 'hello', () => undefined, {})
    const input = node.addInput('prompt', 'STRING')
    // Associate the input slot with the widget (as widgetInputs extension does)
    input.widget = { name: 'prompt' }
    graph.add(node)

    const upstream = new LGraphNode('upstream')
    upstream.addOutput('out', 'STRING')
    graph.add(upstream)
    const link = upstream.connect(0, node, 0)
    if (!link) throw new Error('Expected upstream.connect to produce a link')

    return { graph, node, upstream, linkId: link.id }
  }

  it('sets slotMetadata.linked to true when input has a link', () => {
    const { graph, node } = createWidgetInputGraph()
    const { vueNodeData } = useGraphNodeManager(graph)

    const nodeData = vueNodeData.get(String(node.id))
    const widgetData = nodeData?.widgets?.find((w) => w.name === 'prompt')

    expect(widgetData?.slotMetadata).toBeDefined()
    expect(widgetData?.slotMetadata?.linked).toBe(true)
  })

  it('updates slotMetadata.linked to false after link disconnect event', async () => {
    const { graph, node } = createWidgetInputGraph()
    const { vueNodeData } = useGraphNodeManager(graph)

    const nodeData = vueNodeData.get(String(node.id))
    const widgetData = nodeData?.widgets?.find((w) => w.name === 'prompt')

    // Verify initially linked
    expect(widgetData?.slotMetadata?.linked).toBe(true)

    // Simulate link disconnection (as LiteGraph does before firing the event)
    node.inputs[0].link = null

    // Fire the trigger event that LiteGraph fires on disconnect
    graph.trigger('node:slot-links:changed', {
      nodeId: node.id,
      slotType: NodeSlotType.INPUT,
      slotIndex: 0,
      connected: false,
      linkId: 42
    })

    await nextTick()

    // slotMetadata.linked should now be false
    expect(widgetData?.slotMetadata?.linked).toBe(false)
  })

  it('reactively updates disabled state in a derived computed after disconnect', async () => {
    const { graph, node } = createWidgetInputGraph()
    const { vueNodeData } = useGraphNodeManager(graph)

    const nodeData = vueNodeData.get(String(node.id))!

    // Mimic what processedWidgets does in NodeWidgets.vue:
    // derive disabled from slotMetadata.linked
    const derivedDisabled = computed(() => {
      const widgets = nodeData.widgets ?? []
      const widget = widgets.find((w) => w.name === 'prompt')
      return widget?.slotMetadata?.linked ? true : false
    })

    // Initially linked → disabled
    expect(derivedDisabled.value).toBe(true)

    // Track changes
    const onChange = vi.fn()
    watch(derivedDisabled, onChange)

    // Simulate disconnect
    node.inputs[0].link = null
    graph.trigger('node:slot-links:changed', {
      nodeId: node.id,
      slotType: NodeSlotType.INPUT,
      slotIndex: 0,
      connected: false,
      linkId: 42
    })

    await nextTick()

    // The derived computed should now return false
    expect(derivedDisabled.value).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('marks a widget input slot as linked when connected to a SubgraphInput', () => {
    const subgraph = createTestSubgraph({
      inputs: [{ name: 'prompt', type: 'STRING' }]
    })
    const node = new LGraphNode('test')
    node.addWidget('string', 'prompt', 'hello', () => undefined, {})
    const input = node.addInput('prompt', 'STRING')
    input.widget = { name: 'prompt' }
    subgraph.add(node)

    const link = subgraph.inputNode.slots[0].connect(input, node)
    if (!link)
      throw new Error('Expected SubgraphInput.connect to produce a link')

    const { vueNodeData } = useGraphNodeManager(subgraph)
    const nodeData = vueNodeData.get(String(node.id))
    const widgetData = nodeData?.widgets?.find((w) => w.name === 'prompt')

    expect(widgetData?.slotMetadata?.linked).toBe(true)
  })

  it('resolves slotMetadata for promoted widgets where SafeWidgetData.name differs from input.widget.name', () => {
    // Set up a subgraph with an interior node that has a "prompt" widget.
    // createPromotedWidgetView resolves against this interior node.
    const subgraph = createTestSubgraph()
    const interiorNode = new LGraphNode('interior')
    interiorNode.id = 10
    interiorNode.addWidget('string', 'prompt', 'hello', () => undefined, {})
    subgraph.add(interiorNode)

    const subgraphNode = createTestSubgraphNode(subgraph, { id: 123 })

    // Create a PromotedWidgetView with identityName="value" (subgraph input
    // slot name) and sourceWidgetName="prompt" (interior widget name).
    // PromotedWidgetView.name returns "value" (identity), safeWidgetMapper
    // sets SafeWidgetData.name to sourceWidgetName ("prompt").
    const promotedView = createPromotedWidgetView(
      subgraphNode,
      '10',
      'prompt',
      'value',
      'value'
    )

    // Host the promoted view on a regular node so we can control widgets
    // directly (SubgraphNode.widgets is a synthetic getter).
    const graph = new LGraph()
    const hostNode = new LGraphNode('host')
    hostNode.widgets = [promotedView]
    const input = hostNode.addInput('value', 'STRING')
    input.widget = { name: 'value' }
    graph.add(hostNode)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeData = vueNodeData.get(String(hostNode.id))

    // SafeWidgetData.name is "prompt" (sourceWidgetName), but the
    // input slot widget name is "value" — slotName bridges this gap.
    const widgetData = nodeData?.widgets?.find((w) => w.name === 'prompt')
    expect(widgetData).toBeDefined()
    expect(widgetData?.slotName).toBe('value')
    expect(widgetData?.slotMetadata).toBeDefined()
  })

  it('prefers exact _widget input matches before same-name fallbacks for promoted widgets', () => {
    const subgraph = createTestSubgraph({
      inputs: [
        { name: 'seed', type: '*' },
        { name: 'seed', type: '*' }
      ]
    })

    const firstNode = new LGraphNode('FirstNode')
    const firstInput = firstNode.addInput('seed', '*')
    firstNode.addWidget('number', 'seed', 1, () => undefined, {})
    firstInput.widget = { name: 'seed' }
    subgraph.add(firstNode)

    const secondNode = new LGraphNode('SecondNode')
    const secondInput = secondNode.addInput('seed', '*')
    secondNode.addWidget('number', 'seed', 2, () => undefined, {})
    secondInput.widget = { name: 'seed' }
    subgraph.add(secondNode)

    subgraph.inputNode.slots[0].connect(firstInput, firstNode)
    subgraph.inputNode.slots[1].connect(secondInput, secondNode)

    const subgraphNode = createTestSubgraphNode(subgraph, { id: 124 })
    const graph = subgraphNode.graph
    if (!graph) throw new Error('Expected subgraph node graph')
    graph.add(subgraphNode)

    const promotedViews = subgraphNode.widgets
    const secondPromotedView = promotedViews[1]
    if (!secondPromotedView) throw new Error('Expected second promoted view')

    fromAny<
      {
        sourceNodeId: string
        sourceWidgetName: string
      },
      unknown
    >(secondPromotedView).sourceNodeId = '9999'
    fromAny<
      {
        sourceNodeId: string
        sourceWidgetName: string
      },
      unknown
    >(secondPromotedView).sourceWidgetName = 'stale_widget'

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeData = vueNodeData.get(String(subgraphNode.id))
    const secondMappedWidget = nodeData?.widgets?.find(
      (widget) => widget.slotMetadata?.index === 1
    )
    if (!secondMappedWidget)
      throw new Error('Expected mapped widget for slot 1')

    expect(secondMappedWidget.name).not.toBe('stale_widget')
  })

  it('clears stale slotMetadata when input no longer matches widget', async () => {
    const { graph, node } = createWidgetInputGraph()
    const { vueNodeData } = useGraphNodeManager(graph)

    const nodeData = vueNodeData.get(String(node.id))!
    const widgetData = nodeData.widgets!.find((w) => w.name === 'prompt')!

    expect(widgetData.slotMetadata?.linked).toBe(true)

    node.inputs[0].name = 'other'
    node.inputs[0].widget = { name: 'other' }
    node.inputs[0].link = null

    graph.trigger('node:slot-links:changed', {
      nodeId: node.id,
      slotType: NodeSlotType.INPUT,
      slotIndex: 0,
      connected: false,
      linkId: 42
    })

    await nextTick()

    expect(widgetData.slotMetadata).toBeUndefined()
  })
})

describe('Subgraph output slot label reactivity', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  it('updates output slot labels when node:slot-label:changed is triggered', async () => {
    const graph = new LGraph()
    const node = new LGraphNode('test')
    node.addOutput('original_name', 'STRING')
    node.addOutput('other_name', 'STRING')
    graph.add(node)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeId = String(node.id)
    const nodeData = vueNodeData.get(nodeId)
    if (!nodeData?.outputs) throw new Error('Expected output data to exist')

    expect(nodeData.outputs[0].label).toBeUndefined()
    expect(nodeData.outputs[1].label).toBeUndefined()

    // Simulate what SubgraphNode does: set the label, then fire the trigger
    node.outputs[0].label = 'custom_label'
    graph.trigger('node:slot-label:changed', {
      nodeId: node.id,
      slotType: NodeSlotType.OUTPUT
    })

    await nextTick()

    const updatedData = vueNodeData.get(nodeId)
    expect(updatedData?.outputs?.[0]?.label).toBe('custom_label')
    expect(updatedData?.outputs?.[1]?.label).toBeUndefined()
  })

  it('updates input slot labels when node:slot-label:changed is triggered', async () => {
    const graph = new LGraph()
    const node = new LGraphNode('test')
    node.addInput('original_name', 'STRING')
    graph.add(node)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeId = String(node.id)
    const nodeData = vueNodeData.get(nodeId)
    if (!nodeData?.inputs) throw new Error('Expected input data to exist')

    expect(nodeData.inputs[0].label).toBeUndefined()

    node.inputs[0].label = 'custom_label'
    graph.trigger('node:slot-label:changed', {
      nodeId: node.id,
      slotType: NodeSlotType.INPUT
    })

    await nextTick()

    const updatedData = vueNodeData.get(nodeId)
    expect(updatedData?.inputs?.[0]?.label).toBe('custom_label')
  })

  it('does not rebuild the ordered node collection when a slot label changes', async () => {
    const graph = new LGraph()
    const firstNode = new LGraphNode('first')
    firstNode.addOutput('first_output', 'STRING')
    graph.add(firstNode)

    const secondNode = new LGraphNode('second')
    secondNode.addOutput('second_output', 'STRING')
    graph.add(secondNode)

    const { vueNodeData } = useGraphNodeManager(graph)
    const orderedNodes = computed(() => Array.from(vueNodeData.values()))
    const orderedNodesWatcher = vi.fn()
    watch(orderedNodes, orderedNodesWatcher)

    const initialOrderedNodes = orderedNodes.value
    const initialSecondNodeData = initialOrderedNodes[1]
    if (!initialSecondNodeData)
      throw new Error('Expected second node in ordered collection')

    firstNode.outputs[0].label = 'renamed'
    graph.trigger('node:slot-label:changed', {
      nodeId: firstNode.id,
      slotType: NodeSlotType.OUTPUT
    })
    await nextTick()

    expect(orderedNodes.value).toBe(initialOrderedNodes)
    expect(orderedNodes.value[1]).toBe(initialSecondNodeData)
    expect(orderedNodes.value[0].outputs?.[0]?.label).toBe('renamed')
    expect(orderedNodesWatcher).not.toHaveBeenCalled()
  })

  it('does not re-extract widget data when only a slot label changes', async () => {
    const graph = new LGraph()
    const node = new LGraphNode('test')
    node.addOutput('original_name', 'STRING')
    node.addWidget('string', 'prompt', 'hello', () => undefined, {})
    graph.add(node)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeId = String(node.id)
    const nodeData = vueNodeData.get(nodeId)
    if (!nodeData?.widgets) throw new Error('Expected widget data to exist')

    const initialWidgets = nodeData.widgets

    node.outputs[0].label = 'custom_label'
    graph.trigger('node:slot-label:changed', {
      nodeId: node.id,
      slotType: NodeSlotType.OUTPUT
    })

    await nextTick()

    expect(nodeData.outputs?.[0]?.label).toBe('custom_label')
    expect(nodeData.widgets).toBe(initialWidgets)
  })

  it('ignores node:slot-label:changed for unknown node ids', () => {
    const graph = new LGraph()
    useGraphNodeManager(graph)

    expect(() =>
      graph.trigger('node:slot-label:changed', {
        nodeId: 'missing-node',
        slotType: NodeSlotType.OUTPUT
      })
    ).not.toThrow()
  })
})

describe('Nested promoted widget mapping', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  it('maps store identity to deepest concrete widget for two-layer promotions', () => {
    const subgraphA = createTestSubgraph({
      inputs: [{ name: 'a_input', type: '*' }]
    })
    const innerNode = new LGraphNode('InnerComboNode')
    const innerInput = innerNode.addInput('picker_input', '*')
    innerNode.addWidget('combo', 'picker', 'a', () => undefined, {
      values: ['a', 'b']
    })
    innerInput.widget = { name: 'picker' }
    subgraphA.add(innerNode)
    subgraphA.inputNode.slots[0].connect(innerInput, innerNode)

    const subgraphNodeA = createTestSubgraphNode(subgraphA, { id: 11 })

    const subgraphB = createTestSubgraph({
      inputs: [{ name: 'b_input', type: '*' }]
    })
    subgraphB.add(subgraphNodeA)
    subgraphNodeA._internalConfigureAfterSlots()
    subgraphB.inputNode.slots[0].connect(subgraphNodeA.inputs[0], subgraphNodeA)

    const subgraphNodeB = createTestSubgraphNode(subgraphB, { id: 22 })
    const graph = subgraphNodeB.graph as LGraph
    graph.add(subgraphNodeB)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeData = vueNodeData.get(String(subgraphNodeB.id))
    const mappedWidget = nodeData?.widgets?.[0]

    expect(mappedWidget).toBeDefined()
    expect(mappedWidget?.type).toBe('combo')
    expect(mappedWidget?.entityId).toBe(
      widgetEntityId(graph.id, subgraphNodeB.id, 'b_input')
    )
  })

  it('preserves distinct store identity for duplicate-named promoted widgets', () => {
    const subgraph = createTestSubgraph({
      inputs: [
        { name: 'first_seed', type: '*' },
        { name: 'second_seed', type: '*' }
      ]
    })

    const firstNode = new LGraphNode('FirstNode')
    const firstInput = firstNode.addInput('seed', '*')
    firstNode.addWidget('number', 'seed', 1, () => undefined)
    firstInput.widget = { name: 'seed' }
    subgraph.add(firstNode)
    subgraph.inputNode.slots[0].connect(firstInput, firstNode)

    const secondNode = new LGraphNode('SecondNode')
    const secondInput = secondNode.addInput('seed', '*')
    secondNode.addWidget('number', 'seed', 2, () => undefined)
    secondInput.widget = { name: 'seed' }
    subgraph.add(secondNode)
    subgraph.inputNode.slots[1].connect(secondInput, secondNode)

    const subgraphNode = createTestSubgraphNode(subgraph, { id: 100 })
    const graph = subgraphNode.graph as LGraph
    graph.add(subgraphNode)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeData = vueNodeData.get(String(subgraphNode.id))
    const widgets = nodeData?.widgets

    expect(widgets).toHaveLength(2)
    expect(widgets?.[0]?.entityId).toBe(
      widgetEntityId(graph.id, subgraphNode.id, 'first_seed')
    )
    expect(widgets?.[1]?.entityId).toBe(
      widgetEntityId(graph.id, subgraphNode.id, 'second_seed')
    )
    expect(widgets?.[0]?.entityId).not.toBe(widgets?.[1]?.entityId)
  })
})

describe('Promoted widget sourceExecutionId', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  it('sets sourceExecutionId to the interior node execution ID for promoted widgets', () => {
    const subgraph = createTestSubgraph({
      inputs: [{ name: 'ckpt_input', type: '*' }]
    })
    const interiorNode = new LGraphNode('CheckpointLoaderSimple')
    const interiorInput = interiorNode.addInput('ckpt_input', '*')
    interiorNode.addWidget(
      'combo',
      'ckpt_name',
      'model.safetensors',
      () => undefined,
      {
        values: ['model.safetensors']
      }
    )
    interiorInput.widget = { name: 'ckpt_name' }
    subgraph.add(interiorNode)
    subgraph.inputNode.slots[0].connect(interiorInput, interiorNode)

    const subgraphNode = createTestSubgraphNode(subgraph, { id: 65 })
    subgraphNode._internalConfigureAfterSlots()
    const graph = subgraphNode.graph as LGraph
    graph.add(subgraphNode)

    vi.spyOn(app, 'rootGraph', 'get').mockReturnValue(graph)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeData = vueNodeData.get(String(subgraphNode.id))
    const promotedWidget = nodeData?.widgets?.find(
      (w) => w.name === 'ckpt_name'
    )

    expect(promotedWidget).toBeDefined()
    // The interior node is inside subgraphNode (id=65),
    // so its execution ID should be "65:<interiorNodeId>"
    expect(promotedWidget?.sourceExecutionId).toBe(
      `${subgraphNode.id}:${interiorNode.id}`
    )
  })

  it('does not set sourceExecutionId for non-promoted widgets', () => {
    const graph = new LGraph()
    const node = new LGraphNode('test')
    node.addWidget('number', 'steps', 20, () => undefined, {})
    graph.add(node)

    vi.spyOn(app, 'rootGraph', 'get').mockReturnValue(graph)

    const { vueNodeData } = useGraphNodeManager(graph)
    const nodeData = vueNodeData.get(String(node.id))
    const widget = nodeData?.widgets?.find((w) => w.name === 'steps')

    expect(widget).toBeDefined()
    expect(widget?.sourceExecutionId).toBeUndefined()
  })
})

describe('reconcileNodeErrorFlags (via lastNodeErrors watcher)', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  function setupGraphWithStore() {
    const graph = new LGraph()
    const nodeA = new LGraphNode('KSampler')
    nodeA.addInput('model', 'MODEL')
    nodeA.addInput('steps', 'INT')
    graph.add(nodeA)

    const nodeB = new LGraphNode('LoadCheckpoint')
    nodeB.addInput('ckpt_name', 'STRING')
    graph.add(nodeB)

    vi.spyOn(app, 'rootGraph', 'get').mockReturnValue(graph)
    vi.spyOn(app, 'isGraphReady', 'get').mockReturnValue(true)

    const settingStore = useSettingStore()
    settingStore.settingValues['Comfy.RightSidePanel.ShowErrorsTab'] = true

    // Initialize store (triggers watcher registration)
    useGraphNodeManager(graph)
    const store = useExecutionErrorStore()
    return { graph, nodeA, nodeB, store }
  }

  it('sets has_errors on nodes referenced in lastNodeErrors', async () => {
    const { nodeA, nodeB, store } = setupGraphWithStore()

    store.lastNodeErrors = {
      [String(nodeA.id)]: {
        errors: [
          {
            type: 'value_bigger_than_max',
            message: 'Too big',
            details: '',
            extra_info: { input_name: 'steps' }
          }
        ],
        dependent_outputs: [],
        class_type: 'KSampler'
      }
    }
    await nextTick()

    expect(nodeA.has_errors).toBe(true)
    expect(nodeB.has_errors).toBeFalsy()
  })

  it('sets slot hasErrors for inputs matching error input_name', async () => {
    const { nodeA, store } = setupGraphWithStore()

    store.lastNodeErrors = {
      [String(nodeA.id)]: {
        errors: [
          {
            type: 'required_input_missing',
            message: 'Missing',
            details: '',
            extra_info: { input_name: 'model' }
          }
        ],
        dependent_outputs: [],
        class_type: 'KSampler'
      }
    }
    await nextTick()

    expect(nodeA.inputs[0].hasErrors).toBe(true)
    expect(nodeA.inputs[1].hasErrors).toBe(false)
  })

  it('clears has_errors and slot hasErrors when errors are removed', async () => {
    const { nodeA, store } = setupGraphWithStore()

    store.lastNodeErrors = {
      [String(nodeA.id)]: {
        errors: [
          {
            type: 'value_bigger_than_max',
            message: 'Too big',
            details: '',
            extra_info: { input_name: 'steps' }
          }
        ],
        dependent_outputs: [],
        class_type: 'KSampler'
      }
    }
    await nextTick()
    expect(nodeA.has_errors).toBe(true)
    expect(nodeA.inputs[1].hasErrors).toBe(true)

    store.lastNodeErrors = null
    await nextTick()

    expect(nodeA.has_errors).toBeFalsy()
    expect(nodeA.inputs[1].hasErrors).toBe(false)
  })

  it('propagates has_errors to parent subgraph node', async () => {
    const subgraph = createTestSubgraph()
    const interiorNode = new LGraphNode('InnerNode')
    interiorNode.addInput('value', 'INT')
    subgraph.add(interiorNode)

    const subgraphNode = createTestSubgraphNode(subgraph, { id: 50 })
    const graph = subgraphNode.graph as LGraph
    graph.add(subgraphNode)

    vi.spyOn(app, 'rootGraph', 'get').mockReturnValue(graph)
    vi.spyOn(app, 'isGraphReady', 'get').mockReturnValue(true)

    useGraphNodeManager(graph)
    const store = useExecutionErrorStore()

    // Error on interior node: execution ID = "50:<interiorNodeId>"
    const interiorExecId = `${subgraphNode.id}:${interiorNode.id}`
    store.lastNodeErrors = {
      [interiorExecId]: {
        errors: [
          {
            type: 'required_input_missing',
            message: 'Missing',
            details: '',
            extra_info: { input_name: 'value' }
          }
        ],
        dependent_outputs: [],
        class_type: 'InnerNode'
      }
    }
    await nextTick()

    // Interior node should have the error
    expect(interiorNode.has_errors).toBe(true)
    expect(interiorNode.inputs[0].hasErrors).toBe(true)
    // Parent subgraph node should also be flagged
    expect(subgraphNode.has_errors).toBe(true)
  })

  it('sets has_errors on nodes with missing models', async () => {
    const { nodeA, nodeB } = setupGraphWithStore()
    const missingModelStore = useMissingModelStore()

    missingModelStore.setMissingModels([
      {
        nodeId: String(nodeA.id),
        nodeType: 'CheckpointLoader',
        widgetName: 'ckpt_name',
        isAssetSupported: false,
        name: 'missing.safetensors',
        isMissing: true
      }
    ])
    await nextTick()

    expect(nodeA.has_errors).toBe(true)
    expect(nodeB.has_errors).toBeFalsy()
  })

  it('clears has_errors when missing models are removed', async () => {
    const { nodeA } = setupGraphWithStore()
    const missingModelStore = useMissingModelStore()

    missingModelStore.setMissingModels([
      {
        nodeId: String(nodeA.id),
        nodeType: 'CheckpointLoader',
        widgetName: 'ckpt_name',
        isAssetSupported: false,
        name: 'missing.safetensors',
        isMissing: true
      }
    ])
    await nextTick()
    expect(nodeA.has_errors).toBe(true)

    missingModelStore.clearMissingModels()
    await nextTick()
    expect(nodeA.has_errors).toBeFalsy()
  })

  it('flags parent subgraph node when interior node has missing model', async () => {
    const subgraph = createTestSubgraph()
    const interiorNode = new LGraphNode('CheckpointLoader')
    subgraph.add(interiorNode)

    const subgraphNode = createTestSubgraphNode(subgraph, { id: 50 })
    const graph = subgraphNode.graph as LGraph
    graph.add(subgraphNode)

    vi.spyOn(app, 'rootGraph', 'get').mockReturnValue(graph)
    vi.spyOn(app, 'isGraphReady', 'get').mockReturnValue(true)

    const settingStore = useSettingStore()
    settingStore.settingValues['Comfy.RightSidePanel.ShowErrorsTab'] = true

    useGraphNodeManager(graph)
    useExecutionErrorStore()
    const missingModelStore = useMissingModelStore()

    missingModelStore.setMissingModels([
      {
        nodeId: `${subgraphNode.id}:${interiorNode.id}`,
        nodeType: 'CheckpointLoader',
        widgetName: 'ckpt_name',
        isAssetSupported: false,
        name: 'missing.safetensors',
        isMissing: true
      }
    ])
    await nextTick()

    expect(interiorNode.has_errors).toBe(true)
    expect(subgraphNode.has_errors).toBe(true)
  })
})
