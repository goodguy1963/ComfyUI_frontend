import { createTestingPinia } from '@pinia/testing'
import { render, screen } from '@testing-library/vue'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import type { Directive } from 'vue'
import type { ComponentProps } from 'vue-component-type-helpers'
import { createI18n } from 'vue-i18n'

import type { VueNodeData } from '@/composables/graph/useGraphNodeManager'
import { TitleMode } from '@/lib/litegraph/src/types/globalEnums'
import LGraphNode from '@/renderer/extensions/vueNodes/components/LGraphNode.vue'
import { useVueElementTracking } from '@/renderer/extensions/vueNodes/composables/useVueNodeResizeTracking'
import { useCanvasStore } from '@/renderer/core/canvas/canvasStore'
import { useSettingStore } from '@/platform/settings/settingStore'
import { app } from '@/scripts/app'

const mockData = vi.hoisted(() => ({
  mockExecuting: false,
  mockCamera: { z: 1 },
  mockLatestPreviewUrl: '',
  mockLgraphNode: null as Record<string, unknown> | null,
  mockShouldShowPreviewImg: false
}))

vi.mock('@/utils/graphTraversalUtil', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    getLocatorIdFromNodeData: vi.fn(() => 'test-node-123'),
    getNodeByLocatorId: vi.fn(
      () => mockData.mockLgraphNode ?? { isSubgraphNode: () => false }
    )
  }
})

vi.mock('@/renderer/core/layout/transform/useTransformState', () => {
  return {
    useTransformState: () => ({
      screenToCanvas: vi.fn(),
      canvasToScreen: vi.fn(),
      camera: mockData.mockCamera,
      isNodeInViewport: vi.fn()
    })
  }
})

vi.mock(
  '@/renderer/extensions/vueNodes/composables/useNodeEventHandlers',
  () => {
    const handleNodeSelect = vi.fn()
    return { useNodeEventHandlers: () => ({ handleNodeSelect }) }
  }
)

vi.mock(
  '@/renderer/extensions/vueNodes/composables/useVueNodeResizeTracking',
  () => ({
    useVueElementTracking: vi.fn()
  })
)

vi.mock('@/scripts/app', () => ({
  app: {
    rootGraph: { getNodeById: vi.fn() },
    canvas: { setDirty: vi.fn() }
  }
}))

vi.mock('@/composables/useErrorHandling', () => ({
  useErrorHandling: () => ({
    toastErrorHandler: vi.fn()
  })
}))

vi.mock('@/renderer/extensions/vueNodes/layout/useNodeLayout', () => ({
  useNodeLayout: () => ({
    position: computed(() => ({ x: 100, y: 50 })),
    size: computed(() => ({ width: 200, height: 100 })),
    zIndex: 0,
    startDrag: vi.fn(),
    handleDrag: vi.fn(),
    endDrag: vi.fn(),
    moveTo: vi.fn()
  })
}))

vi.mock(
  '@/renderer/extensions/vueNodes/execution/useNodeExecutionState',
  () => ({
    useNodeExecutionState: vi.fn(() => ({
      executing: computed(() => mockData.mockExecuting),
      progress: computed(() => undefined),
      progressPercentage: computed(() => undefined),
      progressState: computed(() => undefined),
      executionState: computed(() => 'idle' as const)
    }))
  })
)

vi.mock('@/renderer/extensions/vueNodes/preview/useNodePreviewState', () => ({
  useNodePreviewState: vi.fn(() => ({
    latestPreviewUrl: computed(() => mockData.mockLatestPreviewUrl),
    shouldShowPreviewImg: computed(() => mockData.mockShouldShowPreviewImg)
  }))
}))

vi.mock(
  '@/renderer/extensions/vueNodes/interactions/resize/useNodeResize',
  () => ({
    useNodeResize: vi.fn(() => ({
      startResize: vi.fn(),
      isResizing: computed(() => false)
    }))
  })
)

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      g: {
        error: 'Error'
      },
      rightSidePanel: {
        showAdvancedShort: 'Show Advanced',
        showAdvancedInputsButton: 'Show Advanced Inputs'
      },
      'Node Render Error': 'Node Render Error'
    }
  }
})

const pinia = createTestingPinia({
  createSpy: vi.fn
})

const tooltipDirective: Directive = {
  mounted() {}
}

function getNodeRoot(container: Element): HTMLElement {
  return container.firstElementChild as HTMLElement
}

function renderLGraphNode(
  props: ComponentProps<typeof LGraphNode>,
  options?: { stubs?: Record<string, unknown> }
) {
  return render(LGraphNode, {
    props,
    global: {
      plugins: [pinia, i18n],
      directives: {
        tooltip: tooltipDirective
      },
      stubs: {
        NodeHeader: true,
        NodeSlots: true,
        NodeWidgets: true,
        NodeContent: true,
        SlotConnectionDot: true,
        ...options?.stubs
      }
    }
  })
}

function renderLGraphNodeInTransformPane(
  props: ComponentProps<typeof LGraphNode>,
  activePanDetail: 'middle' | 'close',
  options?: { stubs?: Record<string, unknown> }
) {
  return render(
    {
      components: { LGraphNode },
      setup() {
        return {
          nodeProps: props,
          activePanDetail
        }
      },
      template: `
        <div data-testid="transform-pane" :data-active-pan-detail="activePanDetail">
          <LGraphNode v-bind="nodeProps" :active-pan-detail="activePanDetail" />
        </div>
      `
    },
    {
      global: {
        plugins: [pinia, i18n],
        directives: {
          tooltip: tooltipDirective
        },
        stubs: {
          NodeHeader: true,
          NodeSlots: true,
          NodeWidgets: true,
          NodeContent: true,
          SlotConnectionDot: true,
          ...options?.stubs
        }
      }
    }
  )
}
const mockNodeData: VueNodeData = {
  id: 'test-node-123',
  title: 'Test Node',
  type: 'TestNode',
  mode: 0,
  flags: {},
  inputs: [],
  outputs: [],
  widgets: [],
  selected: false,
  executing: false
}

const mockRerouteNodeData: VueNodeData = {
  ...mockNodeData,
  id: 'reroute-node-1',
  title: '',
  type: 'Reroute',
  titleMode: TitleMode.NO_TITLE
}

const nodeHeaderStub = {
  template: '<div data-testid="node-header-stub" />'
}

const nodeSlotsStub = {
  template: '<div data-testid="node-slots-stub" />'
}

const nodeWidgetsStub = {
  template: '<div data-testid="node-widgets-stub" />'
}

const nodeBadgesStub = {
  template: '<div data-testid="node-badges-stub" />'
}

const nodeFooterStub = {
  template: '<div data-testid="node-footer-stub" />'
}

describe('LGraphNode', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockData.mockExecuting = false
    mockData.mockCamera.z = 1
    mockData.mockLatestPreviewUrl = ''
    mockData.mockShouldShowPreviewImg = false

    setActivePinia(pinia)
    const canvasStore = useCanvasStore()
    canvasStore.selectedNodeIds.clear()
    const settingStore = useSettingStore(pinia)
    vi.mocked(settingStore.get).mockImplementation((key) => {
      if (key === 'Comfy.RightSidePanel.ShowErrorsTab') return true
      if (key === 'Comfy.Node.AlwaysShowAdvancedWidgets') return false
      if (key === 'Comfy.Node.Opacity') return 1
    })
  })

  it('should call resize tracking composable with node ID', () => {
    renderLGraphNode({ nodeData: mockNodeData })

    expect(useVueElementTracking).toHaveBeenCalledWith('test-node-123', 'node')
  })

  it('should render with data-node-id attribute', () => {
    const { container } = renderLGraphNode({ nodeData: mockNodeData })

    expect(getNodeRoot(container).getAttribute('data-node-id')).toBe(
      'test-node-123'
    )
  })

  it('should render node title', () => {
    const { container } = render(LGraphNode, {
      props: { nodeData: mockNodeData },
      global: {
        plugins: [pinia, i18n],
        stubs: {
          NodeSlots: true,
          NodeWidgets: true,
          NodeContent: true,
          SlotConnectionDot: true
        }
      }
    })

    expect(container.textContent).toContain('Test Node')
  })

  it('should apply selected styling when selected prop is true', async () => {
    const canvasStore = useCanvasStore()
    canvasStore.selectedNodeIds.clear()
    canvasStore.selectedNodeIds.add('test-node-123')

    const { container } = renderLGraphNode({ nodeData: mockNodeData })
    const root = getNodeRoot(container)

    expect(root).toHaveClass('outline-node-component-outline')

    const overlay = screen.getByTestId('node-state-outline-overlay')
    expect(overlay).toHaveClass('border-node-component-outline')
  })

  it('should render progress indicator when executing prop is true', () => {
    mockData.mockExecuting = true

    const { container } = renderLGraphNode({ nodeData: mockNodeData })
    const root = getNodeRoot(container)

    expect(root).toHaveClass('outline-node-stroke-executing')

    const overlay = screen.getByTestId('node-state-outline-overlay')
    expect(overlay).toHaveClass('border-node-stroke-executing')
  })

  it('should render live preview when preview state is active', () => {
    mockData.mockLatestPreviewUrl = 'blob:preview'
    mockData.mockShouldShowPreviewImg = true

    renderLGraphNode(
      { nodeData: mockNodeData },
      {
        stubs: {
          LivePreview: {
            props: ['imageUrl'],
            template: '<div data-testid="live-preview-stub">{{ imageUrl }}</div>'
          }
        }
      }
    )

    expect(screen.getByTestId('live-preview-stub')).toHaveTextContent(
      'blob:preview'
    )
  })

  it('hides expensive internals through the transform pane middle motion LOD', () => {
    mockData.mockLatestPreviewUrl = 'blob:preview'
    mockData.mockShouldShowPreviewImg = true

    const { container } = renderLGraphNode(
      {
        nodeData: {
          ...mockNodeData,
          widgets: [{ name: 'strength', type: 'number' }]
        }
      },
      {
        stubs: {
          NodeHeader: nodeHeaderStub,
          NodeSlots: nodeSlotsStub,
          NodeWidgets: nodeWidgetsStub,
          NodeBadges: nodeBadgesStub,
          NodeFooter: nodeFooterStub,
          LivePreview: {
            props: ['imageUrl'],
            template:
              '<div data-testid="live-preview-stub">{{ imageUrl }}</div>'
          }
        }
      }
    )

    expect(getNodeRoot(container)).toHaveAttribute('data-motion-lod-eligible')
  })

  it('keeps error nodes eligible for middle motion LOD styling', () => {
    const { container } = renderLGraphNodeInTransformPane(
      {
        nodeData: {
          ...mockNodeData,
          hasErrors: true,
          widgets: [{ name: 'strength', type: 'number' }]
        }
      },
      'middle',
      {
        stubs: {
          NodeWidgets: nodeWidgetsStub
        }
      }
    )

    const root = container.querySelector('[data-node-id="test-node-123"]')
    const inner = screen.getByTestId('node-inner-wrapper')

    expect(root).toHaveAttribute('data-motion-lod-eligible')
    expect(inner).toHaveClass('ring-destructive-background')
    expect(screen.queryByTestId('node-widgets-stub')).not.toBeInTheDocument()
  })

  it('prunes expensive internals during middle active pan detail', () => {
    mockData.mockLatestPreviewUrl = 'blob:preview'
    mockData.mockShouldShowPreviewImg = true

    const { container } = renderLGraphNodeInTransformPane(
      {
        nodeData: {
          ...mockNodeData,
          widgets: [{ name: 'strength', type: 'number' }]
        }
      },
      'middle',
      {
        stubs: {
          NodeHeader: nodeHeaderStub,
          NodeSlots: nodeSlotsStub,
          NodeWidgets: nodeWidgetsStub,
          NodeBadges: nodeBadgesStub,
          NodeFooter: nodeFooterStub,
          LivePreview: {
            props: ['imageUrl'],
            template:
              '<div data-testid="live-preview-stub">{{ imageUrl }}</div>'
          }
        }
      }
    )

    const badges = screen.getByTestId('node-badges-stub')
    const resizeHandle = container.querySelector('[role="button"][aria-label]')

    expect(screen.getByTestId('node-header-stub')).toBeInTheDocument()
    expect(screen.getByTestId('node-body-test-node-123')).toBeInTheDocument()
    expect(screen.queryByTestId('node-widgets-stub')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-preview-stub')).not.toBeInTheDocument()
    expect(screen.queryByTestId('node-footer-stub')).not.toBeInTheDocument()
    expect(badges.parentElement).toHaveClass('node-motion-hide-middle')
    expect(resizeHandle).not.toBeNull()
    expect(resizeHandle).toHaveClass('node-motion-hide-middle-close')
  })

  it('keeps widgets but hides heavier extras during close active pan detail', () => {
    mockData.mockLatestPreviewUrl = 'blob:preview'
    mockData.mockShouldShowPreviewImg = true

    const { container } = renderLGraphNodeInTransformPane(
      {
        nodeData: {
          ...mockNodeData,
          widgets: [{ name: 'strength', type: 'number' }]
        }
      },
      'close',
      {
        stubs: {
          NodeWidgets: nodeWidgetsStub,
          NodeBadges: nodeBadgesStub,
          NodeFooter: nodeFooterStub,
          LivePreview: {
            props: ['imageUrl'],
            template:
              '<div data-testid="live-preview-stub">{{ imageUrl }}</div>'
          }
        }
      }
    )

    const widgets = screen.getByTestId('node-widgets-stub')
    const livePreview = screen.getByTestId('live-preview-stub')
    const badges = screen.getByTestId('node-badges-stub')
    const footer = screen.getByTestId('node-footer-stub')
    const resizeHandle = container.querySelector('[role="button"][aria-label]')

    expect(widgets.parentElement).toHaveClass('node-motion-hide-middle-close')
    expect(livePreview.parentElement).toHaveClass(
      'node-motion-hide-middle-close'
    )
    expect(badges.parentElement).toHaveClass('node-motion-hide-middle')
    expect(footer.parentElement).toHaveClass('node-motion-hide-middle-close')
    expect(resizeHandle).not.toBeNull()
    expect(resizeHandle).toHaveClass('node-motion-hide-middle-close')
    expect(
      badges.parentElement?.classList.contains('node-motion-hide-middle-close')
    ).toBe(false)
  })

  it('keeps full detail for selected nodes during active pan detail', () => {
    mockData.mockLatestPreviewUrl = 'blob:preview'
    mockData.mockShouldShowPreviewImg = true

    const canvasStore = useCanvasStore()
    canvasStore.selectedNodeIds.add('test-node-123')

    const { container } = renderLGraphNodeInTransformPane(
      {
        nodeData: {
          ...mockNodeData,
          widgets: [{ name: 'strength', type: 'number' }]
        }
      },
      'middle',
      {
        stubs: {
          NodeWidgets: nodeWidgetsStub,
          NodeBadges: nodeBadgesStub,
          NodeFooter: nodeFooterStub,
          LivePreview: {
            props: ['imageUrl'],
            template:
              '<div data-testid="live-preview-stub">{{ imageUrl }}</div>'
          }
        }
      }
    )

    const root = getNodeRoot(container)
    const widgets = screen.getByTestId('node-widgets-stub')
    const livePreview = screen.getByTestId('live-preview-stub')
    const badges = screen.getByTestId('node-badges-stub')
    const footer = screen.getByTestId('node-footer-stub')
    const resizeHandle = container.querySelector('[role="button"][aria-label]')

    expect(root.hasAttribute('data-motion-lod-eligible')).toBe(false)
    expect(widgets).toBeInTheDocument()
    expect(livePreview).toBeInTheDocument()
    expect(badges).toBeInTheDocument()
    expect(footer).toBeInTheDocument()
    expect(resizeHandle).not.toBeNull()
  })

  it('keeps a cheap readable title in low detail mode', () => {
    mockData.mockCamera.z = 0.25

    const { container } = renderLGraphNode(
      {
        nodeData: {
          ...mockNodeData,
          color: '#000000',
          bgcolor: '#000000',
          inputs: [
            {
              name: 'image',
              type: 'IMAGE',
              link: null,
              boundingRect: [0, 0, 0, 0]
            }
          ],
          outputs: [
            {
              name: 'image',
              type: 'IMAGE',
              links: null,
              boundingRect: [0, 0, 0, 0]
            }
          ],
          widgets: [{ name: 'strength', type: 'number' }]
        }
      },
      {
        stubs: {
          NodeHeader: nodeHeaderStub,
          NodeSlots: nodeSlotsStub,
          NodeWidgets: nodeWidgetsStub
        }
      }
    )

    const root = getNodeRoot(container)
    const inner = screen.getByTestId('node-inner-wrapper')
    expect(inner).toHaveStyle({ backgroundColor: '#64748b' })
    expect(root).toHaveStyle({ opacity: '1' })
    expect(
      inner.style.getPropertyValue('--component-node-background')
    ).toBe('#475569')
    expect(screen.getByTestId('node-low-detail-header')).toHaveTextContent(
      'Test Node'
    )
    expect(screen.getByTestId('node-low-detail-header')).toHaveClass(
      'overflow-hidden'
    )
    expect(screen.queryByTestId('node-header-stub')).not.toBeInTheDocument()
    expect(screen.getByTestId('node-low-detail-body')).toBeInTheDocument()
    expect(screen.getByTestId('node-low-detail-slots')).toBeInTheDocument()
    expect(screen.getByTestId('node-slots-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('node-widgets-stub')).not.toBeInTheDocument()
  })

  it('renders error nodes with the same low detail shell and an error ring', () => {
    mockData.mockCamera.z = 0.25

    const { container } = renderLGraphNode(
      {
        nodeData: {
          ...mockNodeData,
          hasErrors: true,
          inputs: [
            {
              name: 'image',
              type: 'IMAGE',
              link: null,
              boundingRect: [0, 0, 0, 0]
            }
          ],
          outputs: [
            {
              name: 'image',
              type: 'IMAGE',
              links: null,
              boundingRect: [0, 0, 0, 0]
            }
          ],
          widgets: [{ name: 'strength', type: 'number' }]
        }
      },
      {
        stubs: {
          NodeHeader: nodeHeaderStub,
          NodeSlots: nodeSlotsStub,
          NodeWidgets: nodeWidgetsStub
        }
      }
    )

    const root = getNodeRoot(container)
    const inner = screen.getByTestId('node-inner-wrapper')

    expect(root).toHaveAttribute('data-low-detail', 'true')
    expect(inner).toHaveClass('ring-destructive-background')
    expect(screen.getByTestId('node-low-detail-header')).toHaveTextContent(
      'Test Node'
    )
    expect(screen.getByTestId('node-low-detail-body')).toBeInTheDocument()
    expect(screen.getByTestId('node-low-detail-slots')).toBeInTheDocument()
    expect(screen.queryByTestId('node-header-stub')).not.toBeInTheDocument()
    expect(screen.queryByTestId('node-widgets-stub')).not.toBeInTheDocument()
  })

  it('should initialize height CSS vars for collapsed nodes', () => {
    const { container } = renderLGraphNode({
      nodeData: {
        ...mockNodeData,
        flags: { collapsed: true }
      }
    })
    const root = getNodeRoot(container)

    expect(root.style.getPropertyValue('--node-height')).toBe('')
    expect(root.style.getPropertyValue('--node-height-x')).toBe('130px')
  })

  it('should initialize height CSS vars for expanded nodes', () => {
    const { container } = renderLGraphNode({
      nodeData: {
        ...mockNodeData,
        flags: { collapsed: false }
      }
    })
    const root = getNodeRoot(container)

    expect(root.style.getPropertyValue('--node-height')).toBe('130px')
    expect(root.style.getPropertyValue('--node-height-x')).toBe('')
  })

  it('should hide advanced footer button while the node is collapsed', () => {
    renderLGraphNode({
      nodeData: {
        ...mockNodeData,
        flags: { collapsed: true },
        widgets: [
          {
            name: 'advancedWidget',
            type: 'number',
            options: { advanced: true }
          }
        ]
      }
    })

    expect(
      screen.queryByRole('button', { name: /show advanced/i })
    ).not.toBeInTheDocument()
  })

  it('should show error-only footer for collapsed nodes with advanced widgets', () => {
    renderLGraphNode({
      nodeData: {
        ...mockNodeData,
        flags: { collapsed: true },
        hasErrors: true,
        widgets: [
          {
            name: 'advancedWidget',
            type: 'number',
            options: { advanced: true }
          }
        ]
      }
    })

    expect(screen.getByRole('button', { name: 'Error' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /show advanced/i })
    ).not.toBeInTheDocument()
  })

  describe('Reroute node sizing', () => {
    it('should not enforce minimum width for reroute nodes', () => {
      const { container: rerouteContainer } = renderLGraphNode({
        nodeData: mockRerouteNodeData
      })
      const { container: regularContainer } = renderLGraphNode({
        nodeData: mockNodeData
      })

      const rerouteRoot = getNodeRoot(rerouteContainer)
      const regularRoot = getNodeRoot(regularContainer)

      const rerouteHasMinWidth = [...rerouteRoot.classList].some((c) =>
        c.startsWith('min-w-')
      )
      const regularHasMinWidth = [...regularRoot.classList].some((c) =>
        c.startsWith('min-w-')
      )

      expect(rerouteHasMinWidth).toBe(false)
      expect(regularHasMinWidth).toBe(true)
    })

    it('should use fixed height for reroute nodes', () => {
      const { container } = renderLGraphNode({
        nodeData: mockRerouteNodeData
      })
      const root = getNodeRoot(container)
      const hasFixedHeight = [...root.classList].some((c) => c.startsWith('h-'))
      expect(hasFixedHeight).toBe(true)
    })

    it('should not render resize handle for reroute nodes', () => {
      const { container } = renderLGraphNode({
        nodeData: mockRerouteNodeData
      })
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
      expect(container.querySelector('[role="button"][aria-label]')).toBeNull()
    })

    it('should render resize handle for regular nodes', () => {
      const { container } = renderLGraphNode({ nodeData: mockNodeData })
      expect(
        // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
        container.querySelector('[role="button"][aria-label]')
      ).not.toBeNull()
    })
  })

  describe('handleDrop', () => {
    it('should set app.dragOverNode and let event bubble', async () => {
      mockData.mockLgraphNode = {
        onDragOver: vi.fn(),
        isSubgraphNode: () => false
      }

      const { container } = renderLGraphNode({ nodeData: mockNodeData })
      const nodeEl = getNodeRoot(container)
      // eslint-disable-next-line testing-library/no-node-access
      const parent = nodeEl.parentElement!

      const parentListener = vi.fn()
      expect(parent).not.toBeNull()
      parent.addEventListener('drop', parentListener)

      nodeEl.dispatchEvent(
        new Event('drop', { bubbles: true, cancelable: true })
      )

      expect(parentListener).toHaveBeenCalled()
      expect(app.dragOverNode).toBe(mockData.mockLgraphNode)
    })
  })
})
