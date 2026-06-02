import { render, screen } from '@testing-library/vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { computed, nextTick, ref } from 'vue'

import type { LGraphCanvas } from '@/lib/litegraph/src/litegraph'

const mocks = vi.hoisted(() => ({
  isTransforming: undefined as ReturnType<typeof ref<boolean>> | undefined,
  requestSlotLayoutSyncForAllNodes: vi.fn()
}))

vi.mock('@/renderer/core/layout/transform/useTransformState', () => ({
  useTransformState: () => ({
    transformStyle: computed(() => ({})),
    syncWithCanvas: vi.fn()
  })
}))

vi.mock('@/renderer/core/layout/transform/useTransformSettling', () => ({
  useTransformSettling: () => {
    if (!mocks.isTransforming) {
      mocks.isTransforming = ref(false)
    }

    return { isTransforming: mocks.isTransforming }
  }
}))

vi.mock('@/renderer/extensions/vueNodes/composables/useSlotElementTracking', () => ({
  requestSlotLayoutSyncForAllNodes: mocks.requestSlotLayoutSyncForAllNodes
}))

import TransformPane from './TransformPane.vue'

describe('TransformPane', () => {
  beforeEach(() => {
    if (!mocks.isTransforming) {
      mocks.isTransforming = ref(false)
    }

    mocks.isTransforming.value = false
    mocks.requestSlotLayoutSyncForAllNodes.mockReset()
  })

  it('has ph-no-capture class to exclude from PostHog session recording', () => {
    render(TransformPane)
    expect(screen.getByTestId('transform-pane').classList).toContain(
      'ph-no-capture'
    )
  })

  it('requests slot sync after transform interaction settles', async () => {
    const canvas = {
      ds: { scale: 1 }
    } as LGraphCanvas

    render(TransformPane, {
      props: {
        canvas
      }
    })

    mocks.isTransforming!.value = true
    await nextTick()
    expect(mocks.requestSlotLayoutSyncForAllNodes).not.toHaveBeenCalled()

    canvas.ds.scale = 2
    mocks.isTransforming!.value = false
    await nextTick()
    expect(mocks.requestSlotLayoutSyncForAllNodes).toHaveBeenCalledOnce()
  })

  it('mutates the active pan detail dataset without template bindings', async () => {
    const { rerender } = render(TransformPane, {
      props: {
        activePanDetail: 'middle'
      }
    })
    await nextTick()

    const transformPane = screen.getByTestId('transform-pane')
    expect(transformPane.dataset.activePanDetail).toBe('middle')

    await rerender({ activePanDetail: 'none' })
    await nextTick()

    expect(transformPane.dataset.activePanDetail).toBeUndefined()
  })

  it('activates the fallback layer only during explicit middle-button pan', async () => {
    const { rerender } = render(TransformPane, {
      props: {
        activePanDetail: 'middle',
        isMiddlePanning: true,
        panFallbackDetail: 'middle'
      },
      slots: {
        default: '<div data-testid="mock-node">node</div>'
      }
    })
    await nextTick()

    const transformPane = screen.getByTestId('transform-pane')
    const livePane = screen.getByTestId('transform-pane-live') as HTMLDivElement
    const fallbackPane = screen.getByTestId(
      'transform-pane-fallback'
    ) as HTMLDivElement

    expect(transformPane.dataset.middlePanActive).toBe('true')
    expect(transformPane.dataset.panFallbackDetail).toBe('middle')
    expect(transformPane.dataset.panFallbackActive).toBe('true')
    expect(transformPane.dataset.livePaneSuppressed).toBe('true')
    expect(livePane.hidden).toBe(true)
    expect(fallbackPane.hidden).toBe(false)
    expect(fallbackPane.childElementCount).toBeGreaterThan(0)

    await rerender({
      activePanDetail: 'middle',
      isMiddlePanning: false,
      panFallbackDetail: 'none'
    })
    await nextTick()

    expect(transformPane.dataset.middlePanActive).toBeUndefined()
    expect(transformPane.dataset.panFallbackDetail).toBeUndefined()
    expect(transformPane.dataset.panFallbackActive).toBeUndefined()
    expect(transformPane.dataset.livePaneSuppressed).toBeUndefined()
    expect(livePane.hidden).toBe(false)
    expect(fallbackPane.hidden).toBe(true)
    expect(fallbackPane.childElementCount).toBe(0)
  })
})
