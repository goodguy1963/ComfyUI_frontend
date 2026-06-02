/**
 * Vue node lifecycle management for LiteGraph integration
 * Provides event-driven reactivity with performance optimizations
 */
import { reactive, shallowReactive } from 'vue'

import { useChainCallback } from '@/composables/functional/useChainCallback'
import type { PromotedWidgetSource } from '@/core/graph/subgraph/promotedWidgetTypes'
import { isPromotedWidgetView } from '@/core/graph/subgraph/promotedWidgetTypes'
import { matchPromotedInput } from '@/core/graph/subgraph/matchPromotedInput'
import {
  resolveConcretePromotedWidget,
  resolvePromotedWidgetSource
} from '@/core/graph/subgraph/resolveConcretePromotedWidget'
import { resolveSubgraphInputTarget } from '@/core/graph/subgraph/resolveSubgraphInputTarget'
import type {
  INodeInputSlot,
  INodeOutputSlot
} from '@/lib/litegraph/src/interfaces'
import type { IBaseWidget } from '@/lib/litegraph/src/types/widgets'
import { useLayoutMutations } from '@/renderer/core/layout/operations/layoutMutations'
import { layoutStore } from '@/renderer/core/layout/store/layoutStore'
import { LayoutSource } from '@/renderer/core/layout/types'
import type { NodeId } from '@/renderer/core/layout/types'
import { useNodeSlotRegistryStore } from '@/renderer/extensions/vueNodes/stores/nodeSlotRegistryStore'
import type { InputSpec } from '@/schemas/nodeDef/nodeDefSchemaV2'
import { isDOMWidget } from '@/scripts/domWidget'
import { IS_CONTROL_WIDGET } from '@/scripts/widgets'
import { useNodeDefStore } from '@/stores/nodeDefStore'
import type { WidgetValue, SafeControlWidget } from '@/types/simplifiedWidget'
import { normalizeControlOption } from '@/types/simplifiedWidget'
import { getWidgetEntityIdForNode } from '@/utils/litegraphUtil'
import type { WidgetEntityId } from '@/world/entityIds'

import type {
  LGraph,
  LGraphBadge,
  LGraphNode,
  LGraphTriggerAction,
  LGraphTriggerEvent,
  LGraphTriggerParam
} from '@/lib/litegraph/src/litegraph'
import type { TitleMode } from '@/lib/litegraph/src/types/globalEnums'
import { NodeSlotType } from '@/lib/litegraph/src/types/globalEnums'
import { app } from '@/scripts/app'
import { getExecutionIdByNode } from '@/utils/graphTraversalUtil'

export interface WidgetSlotMetadata {
  index: number
  linked: boolean
  originNodeId?: string
  originOutputName?: string
  type: string
}

const reactiveWidgetsSymbol = Symbol('reactiveWidgets')
const reactiveWidgetsGetterSymbol = Symbol('reactiveWidgetsGetter')
const rawWidgetsSymbol = Symbol('rawWidgets')

type Badges = (LGraphBadge | (() => LGraphBadge))[]

/**
 * Minimal render-specific widget data extracted from LiteGraph widgets.
 * Value and metadata (label, hidden, disabled, etc.) are accessed via widgetValueStore.
 */
export interface SafeWidgetData {
  entityId?: WidgetEntityId
  nodeId?: NodeId
  name: string
  type: string
  callback?: ((value: unknown) => void) | undefined
  controlWidget?: SafeControlWidget
  hasLayoutSize?: boolean
  isDOMWidget?: boolean
  options?: {
    canvasOnly?: boolean
    advanced?: boolean
    hidden?: boolean
    read_only?: boolean
  }
  spec?: InputSpec
  slotMetadata?: WidgetSlotMetadata
  slotName?: string
  sourceExecutionId?: string
  tooltip?: string
  promotedLabel?: string
}

export interface VueNodeData {
  executing: boolean
  id: NodeId
  mode: number
  selected: boolean
  title: string
  type: string
  apiNode?: boolean
  badges?: Badges
  bgcolor?: string
  color?: string
  flags?: {
    collapsed?: boolean
    ghost?: boolean
    pinned?: boolean
  }
  hasErrors?: boolean
  inputs?: INodeInputSlot[]
  outputs?: INodeOutputSlot[]
  resizable?: boolean
  shape?: number
  showAdvanced?: boolean
  subgraphId?: string | null
  titleMode?: TitleMode
  widgets?: SafeWidgetData[]
}

export interface GraphNodeManager {
  vueNodeData: ReadonlyMap<string, VueNodeData>
  getNode(id: string): LGraphNode | undefined
  cleanup(): void
}

function isPromotedDOMWidget(widget: IBaseWidget): boolean {
  if (!isPromotedWidgetView(widget)) return false
  const sourceWidget = resolvePromotedWidgetSource(widget.node, widget)
  if (!sourceWidget) return false

  const innerWidget = sourceWidget.widget
  return (
    ('element' in innerWidget && !!innerWidget.element) ||
    ('component' in innerWidget && !!innerWidget.component)
  )
}

export function getControlWidget(
  widget: IBaseWidget
): SafeControlWidget | undefined {
  const cagWidget = widget.linkedWidgets?.find((w) => w[IS_CONTROL_WIDGET])
  if (!cagWidget) return
  return {
    value: normalizeControlOption(cagWidget.value),
    update: (value) => (cagWidget.value = normalizeControlOption(value))
  }
}

interface SharedWidgetEnhancements {
  controlWidget?: SafeControlWidget
  spec?: InputSpec
}

function getSharedWidgetEnhancements(
  node: LGraphNode,
  widget: IBaseWidget
): SharedWidgetEnhancements {
  const nodeDefStore = useNodeDefStore()

  return {
    controlWidget: getControlWidget(widget),
    spec: nodeDefStore.getInputSpecForWidget(node, widget.name)
  }
}

function normalizeWidgetValue(value: unknown): WidgetValue {
  if (value === null || value === undefined || value === void 0) {
    return undefined
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'object') {
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((item): item is File => item instanceof File)
    ) {
      return value
    }
    return value
  }
  console.warn(`Invalid widget value type: ${typeof value}`, value)
  return undefined
}

function extractWidgetDisplayOptions(
  widget: IBaseWidget
): SafeWidgetData['options'] | undefined {
  const options = widget.options
  if (!options) return undefined

  const displayOptions = {
    canvasOnly: options.canvasOnly,
    advanced: options.advanced,
    hidden: options.hidden,
    read_only: options.read_only
  }

  return Object.values(displayOptions).some((value) => value !== undefined)
    ? displayOptions
    : undefined
}

function isMaximumCallStackError(error: unknown): error is RangeError {
  return (
    error instanceof RangeError ||
    (error instanceof Error &&
      /maximum call stack size exceeded/i.test(error.message))
  )
}

function tryReadNodeArray<T>(read: () => T[] | undefined): T[] {
  try {
    return read() ?? []
  } catch (error) {
    if (isMaximumCallStackError(error)) {
      return []
    }
    throw error
  }
}

function safeWidgetMapper(
  node: LGraphNode,
  slotMetadata: Map<string, WidgetSlotMetadata>
) {
  const resolvePromotedSourceByInputName = (
    inputName: string
  ): PromotedWidgetSource | undefined => {
    if (!node.isSubgraphNode()) return undefined

    const target = resolveSubgraphInputTarget(node, inputName)
    if (!target) return undefined

    return {
      sourceNodeId: target.nodeId,
      sourceWidgetName: target.widgetName
    }
  }

  const resolvePromotedWidgetIdentity = (widget: IBaseWidget) => {
    if (!isPromotedWidgetView(widget)) {
      return {
        displayName: widget.name,
        promotedSource: undefined
      }
    }

    const matchedInput = matchPromotedInput(node.inputs, widget)
    const promotedInputName = matchedInput?.name
    const displayName = promotedInputName ?? widget.name
    const directSource: PromotedWidgetSource = {
      sourceNodeId: widget.sourceNodeId,
      sourceWidgetName: widget.sourceWidgetName
    }
    const promotedSource =
      matchedInput?._widget === widget
        ? (resolvePromotedSourceByInputName(displayName) ?? directSource)
        : directSource

    return {
      displayName,
      promotedSource
    }
  }

  return function (widget: IBaseWidget): SafeWidgetData {
    try {
      const { displayName, promotedSource } =
        resolvePromotedWidgetIdentity(widget)

      const sharedEnhancements = getSharedWidgetEnhancements(node, widget)
      const slotInfo =
        slotMetadata.get(displayName) ?? slotMetadata.get(widget.name)

      const callback = (v: unknown) => {
        const value = normalizeWidgetValue(v)
        widget.value = value ?? undefined
        widget.callback?.(value, app.canvas, node)
        node.widgets?.forEach((w) => w.triggerDraw?.())
      }

      const isPromotedPseudoWidget =
        isPromotedWidgetView(widget) && widget.sourceWidgetName.startsWith('$$')

      const options = extractWidgetDisplayOptions(widget)
      const subgraphId = node.isSubgraphNode() && node.subgraph.id

      const resolvedSourceResult =
        isPromotedWidgetView(widget) && promotedSource
          ? resolveConcretePromotedWidget(
              node,
              promotedSource.sourceNodeId,
              promotedSource.sourceWidgetName
            )
          : null
      const resolvedSource =
        resolvedSourceResult?.status === 'resolved'
          ? resolvedSourceResult.resolved
          : undefined
      const sourceWidget = resolvedSource?.widget
      const sourceNode = resolvedSource?.node

      const effectiveWidget = sourceWidget ?? widget

      const localId = isPromotedWidgetView(widget)
        ? String(sourceNode?.id ?? promotedSource?.sourceNodeId)
        : undefined
      const nodeId =
        subgraphId && localId ? `${subgraphId}:${localId}` : undefined
      const sourceWidgetName = isPromotedWidgetView(widget)
        ? (sourceWidget?.name ?? promotedSource?.sourceWidgetName)
        : undefined
      const name = sourceWidgetName ?? displayName

      if (isPromotedWidgetView(widget)) widget.ensureHostWidgetState()

      return {
        entityId: getWidgetEntityIdForNode(node, widget),
        nodeId,
        name,
        type: effectiveWidget.type,
        ...sharedEnhancements,
        callback,
        hasLayoutSize: typeof effectiveWidget.computeLayoutSize === 'function',
        isDOMWidget: isDOMWidget(widget) || isPromotedDOMWidget(widget),
        options: isPromotedPseudoWidget
          ? {
              ...(extractWidgetDisplayOptions(effectiveWidget) ?? options),
              canvasOnly: true
            }
          : (extractWidgetDisplayOptions(effectiveWidget) ?? options),
        slotMetadata: slotInfo,
        slotName: name !== widget.name ? widget.name : undefined,
        sourceExecutionId:
          sourceNode && app.rootGraph
            ? (getExecutionIdByNode(app.rootGraph, sourceNode) ?? undefined)
            : undefined,
        tooltip: widget.tooltip,
        promotedLabel: isPromotedWidgetView(widget) ? widget.label : undefined
      }
    } catch (error) {
      console.warn(
        '[safeWidgetMapper] Failed to map widget:',
        widget.name,
        error
      )
      return {
        name: widget.name || 'unknown',
        type: widget.type || 'text'
      }
    }
  }
}

function buildSlotMetadata(
  inputs: INodeInputSlot[] | undefined,
  graphRef: LGraph | null | undefined
): Map<string, WidgetSlotMetadata> {
  const metadata = new Map<string, WidgetSlotMetadata>()
  inputs?.forEach((input, index) => {
    let originNodeId: string | undefined
    let originOutputName: string | undefined

    if (input.link != null && graphRef) {
      const link = graphRef.getLink(input.link)
      const originNode = link ? graphRef.getNodeById(link.origin_id) : null
      if (link && originNode) {
        originNodeId = String(link.origin_id)
        originOutputName = originNode.outputs?.[link.origin_slot]?.name
      }
    }

    const slotInfo: WidgetSlotMetadata = {
      index,
      linked: input.link != null,
      originNodeId,
      originOutputName,
      type: String(input.type)
    }

    metadata.set(input.name, slotInfo)

    const widgetName = (input as INodeInputSlot & { widget?: { name?: string } })
      .widget?.name
    if (widgetName) {
      metadata.set(widgetName, slotInfo)
    }
  })

  return metadata
}

// Extract safe data from LiteGraph node for Vue consumption
export function extractVueNodeData(node: LGraphNode): VueNodeData {
  const subgraphId =
    node.graph && 'id' in node.graph && node.graph !== node.graph.rootGraph
      ? String(node.graph.id)
      : null
  const nodeType =
    node.type ||
    node.constructor?.comfyClass ||
    node.constructor?.title ||
    node.constructor?.name ||
    'Unknown'
  const apiNode = node.constructor?.nodeData?.api_node ?? false
  const badges = node.badges

  try {
    const slotMetadata = new Map<string, WidgetSlotMetadata>()
    const existingWidgetsDescriptor = Object.getOwnPropertyDescriptor(
      node,
      'widgets'
    )
    const nodeWithReactiveWidgets = node as LGraphNode & {
      [reactiveWidgetsSymbol]?: IBaseWidget[]
      [rawWidgetsSymbol]?: IBaseWidget[]
    }
    const reactiveWidgets =
      nodeWithReactiveWidgets[reactiveWidgetsSymbol] ??
      shallowReactive<IBaseWidget[]>(node.widgets ?? [])
    const syncReactiveWidgets = (widgets: IBaseWidget[] | undefined) => {
      const nextWidgets = widgets ?? []
      if (
        nextWidgets.length !== reactiveWidgets.length ||
        nextWidgets.some((widget, index) => widget !== reactiveWidgets[index])
      ) {
        reactiveWidgets.splice(0, reactiveWidgets.length, ...nextWidgets)
      }
      return reactiveWidgets
    }

    nodeWithReactiveWidgets[reactiveWidgetsSymbol] = reactiveWidgets
    nodeWithReactiveWidgets[rawWidgetsSymbol] ??= node.widgets ?? []

    const existingWidgetsGetter = existingWidgetsDescriptor?.get as
      | ((() => IBaseWidget[]) & { [reactiveWidgetsGetterSymbol]?: true })
      | undefined

    if (
      existingWidgetsGetter &&
      !existingWidgetsGetter[reactiveWidgetsGetterSymbol]
    ) {
      const originalGetter = existingWidgetsGetter
      const reactiveGetter = () => {
        const current: IBaseWidget[] = originalGetter.call(node) ?? []
        syncReactiveWidgets(current)
        return current
      }

      reactiveGetter[reactiveWidgetsGetterSymbol] = true
      Object.defineProperty(node, 'widgets', {
        get: reactiveGetter,
        set: existingWidgetsDescriptor?.set ?? (() => {}),
        configurable: true,
        enumerable: true
      })
    } else if (!existingWidgetsGetter) {
      const reactiveGetter = () => nodeWithReactiveWidgets[rawWidgetsSymbol] ?? []

      reactiveGetter[reactiveWidgetsGetterSymbol] = true
      Object.defineProperty(node, 'widgets', {
        get: reactiveGetter,
        set(v) {
          const nextWidgets = v ?? []
          nodeWithReactiveWidgets[rawWidgetsSymbol] = nextWidgets
          syncReactiveWidgets(nextWidgets)
        },
        configurable: true,
        enumerable: true
      })
    }

    const reactiveInputs = shallowReactive<INodeInputSlot[]>(node.inputs ?? [])
    Object.defineProperty(node, 'inputs', {
      get() {
        return reactiveInputs
      },
      set(v) {
        reactiveInputs.splice(0, reactiveInputs.length, ...v)
      },
      configurable: true,
      enumerable: true
    })

    const reactiveOutputs = shallowReactive<INodeOutputSlot[]>(node.outputs ?? [])
    Object.defineProperty(node, 'outputs', {
      get() {
        return reactiveOutputs
      },
      set(v) {
        reactiveOutputs.splice(0, reactiveOutputs.length, ...v)
      },
      configurable: true,
      enumerable: true
    })

    const widgetsSnapshot = existingWidgetsGetter
      ? syncReactiveWidgets(existingWidgetsGetter.call(node) ?? [])
      : syncReactiveWidgets(nodeWithReactiveWidgets[rawWidgetsSymbol])
    const freshMetadata = buildSlotMetadata(node.inputs, node.graph)
    slotMetadata.clear()
    for (const [key, value] of freshMetadata) {
      slotMetadata.set(key, value)
    }
    const safeWidgets = widgetsSnapshot.map(safeWidgetMapper(node, slotMetadata))

    return {
      id: String(node.id),
      title: typeof node.title === 'string' ? node.title : '',
      type: nodeType,
      mode: node.mode || 0,
      titleMode: node.title_mode,
      selected: node.selected || false,
      executing: false,
      subgraphId,
      apiNode,
      badges,
      hasErrors: !!node.has_errors,
      widgets: safeWidgets,
      inputs: reactiveInputs,
      outputs: reactiveOutputs,
      flags: node.flags ? { ...node.flags } : undefined,
      color: node.color || undefined,
      bgcolor: node.bgcolor || undefined,
      resizable: node.resizable,
      shape: node.shape,
      showAdvanced: node.showAdvanced
    }
  } catch (error) {
    if (!isMaximumCallStackError(error)) {
      throw error
    }

    console.warn(
      '[extractVueNodeData] Falling back to minimal node data after extraction overflow:',
      node.id,
      node.type,
      error
    )

    return {
      id: String(node.id),
      title: typeof node.title === 'string' ? node.title : '',
      type: nodeType,
      mode: node.mode || 0,
      titleMode: node.title_mode,
      selected: node.selected || false,
      executing: false,
      subgraphId,
      apiNode,
      badges,
      hasErrors: !!node.has_errors,
      widgets: [],
      inputs: tryReadNodeArray(() => node.inputs),
      outputs: tryReadNodeArray(() => node.outputs),
      flags: node.flags ? { ...node.flags } : undefined,
      color: node.color || undefined,
      bgcolor: node.bgcolor || undefined,
      resizable: node.resizable,
      shape: node.shape,
      showAdvanced: node.showAdvanced
    }
  }
}

export function useGraphNodeManager(graph: LGraph): GraphNodeManager {
  // Get layout mutations composable
  const { createNode, deleteNode, setSource } = useLayoutMutations()
  // Safe reactive data extracted from LiteGraph nodes
  const vueNodeData = reactive(new Map<string, VueNodeData>())

  // Non-reactive storage for original LiteGraph nodes
  const nodeRefs = new Map<string, LGraphNode>()
  const activeNodeAdditions = new Set<string>()

  const replaceVueNodeData = (node: LGraphNode): VueNodeData => {
    const id = String(node.id)
    const nextData = extractVueNodeData(node)
    const currentData = vueNodeData.get(id)

    if (!currentData) {
      vueNodeData.set(id, nextData)
      return nextData
    }

    currentData.executing = nextData.executing
    currentData.mode = nextData.mode
    currentData.selected = nextData.selected
    currentData.title = nextData.title
    currentData.type = nextData.type
    currentData.apiNode = nextData.apiNode
    currentData.badges = nextData.badges
    currentData.bgcolor = nextData.bgcolor
    currentData.color = nextData.color
    currentData.flags = nextData.flags ? { ...nextData.flags } : undefined
    currentData.hasErrors = nextData.hasErrors
    currentData.inputs = nextData.inputs
    currentData.outputs = nextData.outputs
    currentData.resizable = nextData.resizable
    currentData.shape = nextData.shape
    currentData.showAdvanced = nextData.showAdvanced
    currentData.subgraphId = nextData.subgraphId
    currentData.titleMode = nextData.titleMode
    currentData.widgets = nextData.widgets

    return currentData
  }

  const updateVueNodeData = (
    nodeId: string,
    updater: (nodeData: VueNodeData) => void
  ) => {
    const currentData = vueNodeData.get(nodeId)
    if (!currentData) return
    updater(currentData)
  }

  const refreshNodeSlots = (nodeId: string) => {
    const nodeRef = nodeRefs.get(nodeId)
    const currentData = vueNodeData.get(nodeId)

    if (!nodeRef || !currentData) return

    const slotMetadata = buildSlotMetadata(nodeRef.inputs, graph)

    // Update only widgets with new slot metadata, keeping other widget data intact
    for (const widget of currentData.widgets ?? []) {
      widget.slotMetadata = slotMetadata.get(widget.slotName ?? widget.name)
    }
  }

  const refreshNodeSlotLabels = (
    nodeId: string,
    slotType: NodeSlotType | undefined
  ) => {
    const nodeRef = nodeRefs.get(nodeId)
    const currentData = vueNodeData.get(nodeId)

    if (!nodeRef || !currentData) return

    if (slotType !== NodeSlotType.OUTPUT) {
      currentData.inputs = nodeRef.inputs ? [...nodeRef.inputs] : undefined
    }
    if (slotType !== NodeSlotType.INPUT) {
      currentData.outputs = nodeRef.outputs ? [...nodeRef.outputs] : undefined
    }

    refreshNodeSlots(nodeId)
  }

  // Get access to original LiteGraph node (non-reactive)
  const getNode = (id: string): LGraphNode | undefined => {
    return nodeRefs.get(id)
  }

  const syncWithGraph = () => {
    if (!graph?._nodes) return

    const currentNodes = new Set(graph._nodes.map((n) => String(n.id)))

    // Remove deleted nodes
    for (const id of Array.from(vueNodeData.keys())) {
      if (!currentNodes.has(id)) {
        nodeRefs.delete(id)
        vueNodeData.delete(id)
      }
    }

    // Add/update existing nodes
    graph._nodes.forEach((node) => {
      const id = String(node.id)

      // Store non-reactive reference
      nodeRefs.set(id, node)

      // Extract and store safe data for Vue
      replaceVueNodeData(node)
    })
  }

  /**
   * Handles node addition to the graph - sets up Vue state and spatial indexing
   * Defers position extraction until after potential configure() calls
   */
  const handleNodeAdded = (
    node: LGraphNode,
    originalCallback?: (node: LGraphNode) => void
  ) => {
    const id = String(node.id)

    if (activeNodeAdditions.has(id)) return
    activeNodeAdditions.add(id)

    try {
      // Store non-reactive reference to original node
      nodeRefs.set(id, node)

      // Extract initial data for Vue (may be incomplete during graph configure)
      replaceVueNodeData(node)

      const initializeVueNodeLayout = () => {
        // Check if the node was removed mid-sequence
        if (!nodeRefs.has(id)) return

        // Extract actual positions after configure() has potentially updated them
        const nodePosition = { x: node.pos[0], y: node.pos[1] }
        const nodeSize = { width: node.size[0], height: node.size[1] }

        // Skip layout creation if it already exists
        // (e.g. in-place node replacement where the old node's layout is reused for the new node with the same ID).
        const existingLayout = layoutStore.getNodeLayoutRef(id).value
        if (existingLayout) return

        // Add node to layout store with final positions
        setSource(LayoutSource.Canvas)
        void createNode(id, {
          position: nodePosition,
          size: nodeSize,
          zIndex: node.order || 0,
          visible: true
        })
      }

      // Check if we're in the middle of configuring the graph (workflow loading)
      if (window.app?.configuringGraph) {
        // During workflow loading - defer layout initialization until configure completes
        // Chain our callback with any existing onAfterGraphConfigured callback
        node.onAfterGraphConfigured = useChainCallback(
          node.onAfterGraphConfigured,
          () => {
            // Re-extract data now that configure() has populated title/slots/widgets/etc.
            replaceVueNodeData(node)
            initializeVueNodeLayout()
          }
        )
      } else {
        // Not during workflow loading - initialize layout immediately
        // This handles individual node additions during normal operation
        initializeVueNodeLayout()
      }

      // Call original callback if provided
      if (originalCallback) {
        void originalCallback(node)
      }
    } finally {
      activeNodeAdditions.delete(id)
    }
  }

  /**
   * Handles node removal from the graph - cleans up all references
   */
  const handleNodeRemoved = (
    node: LGraphNode,
    originalCallback?: (node: LGraphNode) => void
  ) => {
    const id = String(node.id)

    // Remove node from layout store
    setSource(LayoutSource.Canvas)
    void deleteNode(id)
    layoutStore.deleteSlotLayoutsForNode(id)
    useNodeSlotRegistryStore().deleteNode(id)

    // Clean up all tracking references
    nodeRefs.delete(id)
    vueNodeData.delete(id)

    // Call original callback if provided
    if (originalCallback) {
      originalCallback(node)
    }
  }

  /**
   * Creates cleanup function for event listeners and state
   */
  const createCleanupFunction = (
    originalOnNodeAdded: ((node: LGraphNode) => void) | undefined,
    originalOnNodeRemoved: ((node: LGraphNode) => void) | undefined,
    originalOnTrigger: ((event: LGraphTriggerEvent) => void) | undefined
  ) => {
    return () => {
      // Restore original callbacks
      graph.onNodeAdded = originalOnNodeAdded || undefined
      graph.onNodeRemoved = originalOnNodeRemoved || undefined
      graph.onTrigger = originalOnTrigger || undefined

      // Clear all state maps
      nodeRefs.clear()
      vueNodeData.clear()
    }
  }

  /**
   * Sets up event listeners - now simplified with extracted handlers
   */
  const setupEventListeners = (): (() => void) => {
    // Store original callbacks
    const originalOnNodeAdded = graph.onNodeAdded
    const originalOnNodeRemoved = graph.onNodeRemoved
    const originalOnTrigger = graph.onTrigger

    // Set up graph event handlers
    graph.onNodeAdded = (node: LGraphNode) => {
      handleNodeAdded(node, originalOnNodeAdded)
    }

    graph.onNodeRemoved = (node: LGraphNode) => {
      handleNodeRemoved(node, originalOnNodeRemoved)
    }

    const triggerHandlers: {
      [K in LGraphTriggerAction]: (event: LGraphTriggerParam<K>) => void
    } = {
      'node:property:changed': (propertyEvent) => {
        const nodeId = String(propertyEvent.nodeId)
        switch (propertyEvent.property) {
          case 'title':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.title = String(propertyEvent.newValue)
            })
            break
          case 'has_errors':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.hasErrors = Boolean(propertyEvent.newValue)
            })
            break
          case 'flags.collapsed':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.flags = {
                ...currentData.flags,
                collapsed: Boolean(propertyEvent.newValue)
              }
            })
            break
          case 'flags.ghost':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.flags = {
                ...currentData.flags,
                ghost: Boolean(propertyEvent.newValue)
              }
            })
            break
          case 'flags.pinned':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.flags = {
                ...currentData.flags,
                pinned: Boolean(propertyEvent.newValue)
              }
            })
            break
          case 'mode':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.mode =
                typeof propertyEvent.newValue === 'number'
                  ? propertyEvent.newValue
                  : 0
            })
            break
          case 'color':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.color =
                typeof propertyEvent.newValue === 'string'
                  ? propertyEvent.newValue
                  : undefined
            })
            break
          case 'bgcolor':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.bgcolor =
                typeof propertyEvent.newValue === 'string'
                  ? propertyEvent.newValue
                  : undefined
            })
            break
          case 'shape':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.shape =
                typeof propertyEvent.newValue === 'number'
                  ? propertyEvent.newValue
                  : undefined
            })
            break
          case 'showAdvanced':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.showAdvanced = Boolean(propertyEvent.newValue)
            })
            break
          case 'badges':
            updateVueNodeData(nodeId, (currentData) => {
              currentData.badges = propertyEvent.newValue as Badges
            })
            break
        }
      },
      'node:slot-errors:changed': (slotErrorsEvent) => {
        refreshNodeSlots(String(slotErrorsEvent.nodeId))
      },
      'node:slot-links:changed': (slotLinksEvent) => {
        if (slotLinksEvent.slotType === NodeSlotType.INPUT) {
          refreshNodeSlots(String(slotLinksEvent.nodeId))
        }
      },
      'node:slot-label:changed': (slotLabelEvent) => {
        const nodeId = String(slotLabelEvent.nodeId)
        refreshNodeSlotLabels(nodeId, slotLabelEvent.slotType)
      }
    }

    graph.onTrigger = (event: LGraphTriggerEvent) => {
      switch (event.type) {
        case 'node:property:changed':
          triggerHandlers['node:property:changed'](event)
          break
        case 'node:slot-errors:changed':
          triggerHandlers['node:slot-errors:changed'](event)
          break
        case 'node:slot-links:changed':
          triggerHandlers['node:slot-links:changed'](event)
          break
        case 'node:slot-label:changed':
          triggerHandlers['node:slot-label:changed'](event)
          break
      }

      // Chain to original handler
      originalOnTrigger?.(event)
    }

    // Initialize state
    syncWithGraph()

    // Return cleanup function
    return createCleanupFunction(
      originalOnNodeAdded || undefined,
      originalOnNodeRemoved || undefined,
      originalOnTrigger || undefined
    )
  }

  // Set up event listeners immediately
  const cleanup = setupEventListeners()

  return {
    vueNodeData,
    getNode,
    cleanup
  }
}
