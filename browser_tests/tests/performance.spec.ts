import { existsSync } from 'fs'

import { expect, mergeTests } from '@playwright/test'
import type { Page } from '@playwright/test'

import { comfyPageFixture } from '@e2e/fixtures/ComfyPage'
import { ExecutionHelper } from '@e2e/fixtures/helpers/ExecutionHelper'
import { VueNodeFixture } from '@e2e/fixtures/utils/vueNodeFixtures'
import {
  logMeasurement,
  recordMeasurement
} from '@e2e/fixtures/utils/perfReporter'
import { webSocketFixture } from '@e2e/fixtures/ws'

const test = mergeTests(comfyPageFixture, webSocketFixture)

const APP_MODE_INPUTS: [string, string][] = [['3', 'seed']]
const SAVE_IMAGE_NODE = '9'
const PERF_NOTE_TITLE = 'Note'
const REPLACER_WORKFLOW_PATH =
  process.env.REPLACER_WORKFLOW_PATH ??
  'F:\\ComfyUI_DEV_windows_portable_nvidia\\ComfyUI_DEV_windows_portable\\ComfyUI\\user\\default\\workflows\\replacer creative i2v stable Parted 2.8_dev.json'
const TARGET_24_FPS_FRAME_MS = 1000 / 24
const TARGET_100_FPS_FRAME_MS = 1000 / 100
const ACTIVE_PAN_ZOOM_SCENARIOS = [
  {
    key: 'far',
    label: 'Far zoom',
    scale: 0.1
  },
  {
    key: 'middle',
    label: 'Middle zoom',
    scale: 0.35
  },
  {
    key: 'close',
    label: 'Close zoom',
    scale: 0.65
  }
] as const

const QUEUE_BURST_BASELINES = {
  preReconciliation: {
    durationMs: 1516,
    styleRecalcs: 72,
    layouts: 12
  },
  priorStoreReconciliationPass: {
    durationMs: 889,
    styleRecalcs: 50,
    layouts: 12
  },
  durableP0: {
    durationMs: 366,
    styleRecalcs: 30,
    layouts: 13,
    domNodes: 208
  }
} as const

async function readLiteGraphNodeGeometry(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const node = window.app?.canvas?.graph?.getNodeById(Number(id))
    if (!node) {
      throw new Error(`Node ${id} was not found in the LiteGraph graph`)
    }

    return {
      position: [...node.pos] as [number, number],
      size: [...node.size] as [number, number]
    }
  }, nodeId)
}

async function installReplacerPanInstrumentation(page: Page) {
  await page.evaluate(() => {
    const win = window as unknown as Record<string, any>
    const counterKey = '__replacerPanPerfCounters'

    const createCounters = () => ({
      getBoundingClientRectCalls: 0,
      getBoundingClientRectStacks: {} as Record<string, number>,
      getBoundingClientRectElements: {} as Record<string, number>,
      resizeObserverCallbacks: 0,
      resizeObserverEntries: 0,
      computeVisibleNodesCalls: 0,
      computeVisibleNodesDurationMs: 0,
      drawConnectionsCalls: 0,
      drawConnectionsDurationMs: 0,
      setDirtyForegroundCalls: 0,
      setDirtyBackgroundCalls: 0,
      setDirtyBothCalls: 0,
      mountedMutationAdds: 0,
      mountedMutationRemoves: 0,
      panFrameSamples: 0,
      mountedNodeSamples: [] as number[]
    })

    win[counterKey] = createCounters()

    const incrementBucket = (bucket: Record<string, number>, key: string) => {
      bucket[key] = (bucket[key] ?? 0) + 1
    }

    const getTopBuckets = (bucket: Record<string, number>, limit = 12) =>
      Object.entries(bucket)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({ key, count }))

    const getElementLabel = (el: Element) => {
      if (el instanceof HTMLElement && el.dataset.nodeId) {
        return `[data-node-id] ${el.tagName.toLowerCase()}`
      }

      if (el instanceof HTMLElement && el.dataset.slotKey) {
        return `[data-slot-key] ${el.tagName.toLowerCase()}`
      }

      if (el.id) {
        return `#${el.id}`
      }

      if (el instanceof HTMLElement && el.dataset.testid) {
        return `[data-testid="${el.dataset.testid}"]`
      }

      return el.tagName.toLowerCase()
    }

    const getStackLabel = () => {
      const stack = new Error().stack ?? ''
      const lines = stack
        .split('\n')
        .slice(2)
        .map((line) => line.trim())
        .filter(
          (line) =>
            line &&
            !line.includes('__replacerPanPerf') &&
            !line.includes('getStackLabel') &&
            !line.includes('getBoundingClientRect')
        )

      return lines.slice(0, 3).join(' | ') || 'unknown'
    }

    if (!win.__replacerPanPerfOriginalGetBoundingClientRect) {
      win.__replacerPanPerfOriginalGetBoundingClientRect =
        Element.prototype.getBoundingClientRect

      Element.prototype.getBoundingClientRect = function () {
        if (win.__replacerPanPerfActive) {
          win[counterKey].getBoundingClientRectCalls++
          incrementBucket(
            win[counterKey].getBoundingClientRectStacks,
            getStackLabel()
          )
          incrementBucket(
            win[counterKey].getBoundingClientRectElements,
            getElementLabel(this)
          )
        }

        return win.__replacerPanPerfOriginalGetBoundingClientRect.call(this)
      }
    }

    if (!win.__replacerPanPerfOriginalResizeObserver && win.ResizeObserver) {
      win.__replacerPanPerfOriginalResizeObserver = win.ResizeObserver
      win.ResizeObserver = class extends win.__replacerPanPerfOriginalResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          super((entries: ResizeObserverEntry[], observer: ResizeObserver) => {
            if (win.__replacerPanPerfActive) {
              win[counterKey].resizeObserverCallbacks++
              win[counterKey].resizeObserverEntries += entries.length
            }

            callback(entries, observer)
          })
        }
      }
    }

    win.__replacerPanPerfStart = () => {
      win[counterKey] = createCounters()
      win.__replacerPanPerfActive = true

      const canvas = win.app?.canvas
      if (canvas && !canvas.__replacerPanPerfOriginalSetDirty) {
        canvas.__replacerPanPerfOriginalSetDirty = canvas.setDirty
        canvas.setDirty = function (foreground: boolean, background?: boolean) {
          if (win.__replacerPanPerfActive) {
            if (foreground) win[counterKey].setDirtyForegroundCalls++
            if (background) win[counterKey].setDirtyBackgroundCalls++
            if (foreground && background) win[counterKey].setDirtyBothCalls++
          }

          return canvas.__replacerPanPerfOriginalSetDirty.call(
            this,
            foreground,
            background
          )
        }
      }

      if (canvas && !canvas.__replacerPanPerfOriginalDrawConnections) {
        canvas.__replacerPanPerfOriginalDrawConnections = canvas.drawConnections
        canvas.drawConnections = function (...args: unknown[]) {
          const start = performance.now()
          try {
            return canvas.__replacerPanPerfOriginalDrawConnections.apply(
              this,
              args
            )
          } finally {
            if (win.__replacerPanPerfActive) {
              win[counterKey].drawConnectionsCalls++
              win[counterKey].drawConnectionsDurationMs +=
                performance.now() - start
            }
          }
        }
      }

      if (canvas && !canvas.__replacerPanPerfOriginalComputeVisibleNodes) {
        canvas.__replacerPanPerfOriginalComputeVisibleNodes =
          canvas.computeVisibleNodes
        canvas.computeVisibleNodes = function (...args: unknown[]) {
          const start = performance.now()
          try {
            return canvas.__replacerPanPerfOriginalComputeVisibleNodes.apply(
              this,
              args
            )
          } finally {
            if (win.__replacerPanPerfActive) {
              win[counterKey].computeVisibleNodesCalls++
              win[counterKey].computeVisibleNodesDurationMs +=
                performance.now() - start
            }
          }
        }
      }

      const observer = new MutationObserver((mutations) => {
        if (!win.__replacerPanPerfActive) return

        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.matches('[data-node-id]') ||
                node.querySelector('[data-node-id]'))
            ) {
              win[counterKey].mountedMutationAdds++
            }
          }
          for (const node of mutation.removedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.matches('[data-node-id]') ||
                node.querySelector('[data-node-id]'))
            ) {
              win[counterKey].mountedMutationRemoves++
            }
          }
        }
      })

      observer.observe(document.body, { childList: true, subtree: true })
      win.__replacerPanPerfMutationObserver = observer

      const sample = () => {
        if (!win.__replacerPanPerfActive) return

        win[counterKey].panFrameSamples++
        win[counterKey].mountedNodeSamples.push(
          document.querySelectorAll('[data-node-id]').length
        )
        win.__replacerPanPerfRaf = requestAnimationFrame(sample)
      }

      win.__replacerPanPerfRaf = requestAnimationFrame(sample)
    }

    win.__replacerPanPerfStop = () => {
      win.__replacerPanPerfActive = false
      if (win.__replacerPanPerfRaf) {
        cancelAnimationFrame(win.__replacerPanPerfRaf)
      }
      win.__replacerPanPerfMutationObserver?.disconnect()

      const samples = win[counterKey].mountedNodeSamples
      return {
        ...win[counterKey],
        mountedNodeMin: samples.length ? Math.min(...samples) : 0,
        mountedNodeMax: samples.length ? Math.max(...samples) : 0,
        mountedNodeAverage: samples.length
          ? samples.reduce((sum: number, value: number) => sum + value, 0) /
            samples.length
          : 0,
        topGetBoundingClientRectStacks: getTopBuckets(
          win[counterKey].getBoundingClientRectStacks
        ),
        topGetBoundingClientRectElements: getTopBuckets(
          win[counterKey].getBoundingClientRectElements
        ),
        getBoundingClientRectStacks: undefined,
        getBoundingClientRectElements: undefined,
        mountedNodeSamples: undefined
      }
    }
  })
}

async function createPerfNoteNode(page: Page): Promise<string> {
  const nodeId = await page.evaluate(() => {
    window.app?.graph?.clear()
    const node = window.LiteGraph?.createNode('Note')
    if (!node) {
      throw new Error('Failed to create Note node for performance measurement')
    }

    node.pos = [200, 220]
    window.app?.graph?.add(node)
    window.app?.canvas?.setDirty(true, true)
    return String(node.id)
  })

  await page.waitForFunction(
    (id) => !!document.querySelector(`[data-node-id="${id}"]`),
    nodeId
  )
  return nodeId
}

async function createZoomedOutStressGraph(
  page: Page,
  nodeCount = 600
): Promise<void> {
  await page.evaluate((count) => {
    const graph = window.app?.graph
    const canvas = window.app?.canvas
    const LiteGraph = window.LiteGraph
    if (!graph || !canvas || !LiteGraph) {
      throw new Error('LiteGraph app is not ready for stress graph creation')
    }

    graph.clear()
    const columns = 40

    for (let i = 0; i < count; i++) {
      const node = LiteGraph.createNode('Note')
      if (!node) {
        throw new Error(`Failed to create stress graph node ${i}`)
      }

      node.title = `Perf Note ${i}`
      node.pos = [(i % columns) * 320, Math.floor(i / columns) * 220]
      graph.add(node)
    }

    canvas.ds.offset = [-180, -120]
    canvas.ds.scale = 0.1
    canvas.setDirty(true, true)
  }, nodeCount)

  await page.waitForFunction(
    (count) => window.app?.graph?._nodes?.length === count,
    nodeCount
  )
}

async function waitForStableMountedVueNodeCount(
  page: Page,
  stableFrames = 6,
  maxFrames = 60
): Promise<number> {
  let previousCount = -1
  let stableCount = 0

  for (let i = 0; i < maxFrames; i++) {
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )

    const currentCount = await page.evaluate(
      () => document.querySelectorAll('[data-node-id]').length
    )

    if (currentCount === previousCount) {
      stableCount += 1
      if (stableCount >= stableFrames) {
        return currentCount
      }
    } else {
      stableCount = 1
      previousCount = currentCount
    }
  }

  return previousCount
}

async function readTransformPanePanState(page: Page) {
  return page.evaluate(() => {
    const transformPane = document.querySelector<HTMLElement>(
      '[data-testid="transform-pane"]'
    )
    const livePane = document.querySelector<HTMLElement>(
      '[data-testid="transform-pane-live"]'
    )
    const fallbackPane = document.querySelector<HTMLElement>(
      '[data-testid="transform-pane-fallback"]'
    )

    if (!transformPane || !livePane || !fallbackPane) {
      throw new Error('Transform pane fallback elements are not available')
    }

    return {
      activePanDetail: transformPane.dataset.activePanDetail ?? null,
      panFallbackDetail: transformPane.dataset.panFallbackDetail ?? null,
      middlePanActive: transformPane.dataset.middlePanActive === 'true',
      panFallbackActive: transformPane.dataset.panFallbackActive === 'true',
      livePaneSuppressed: transformPane.dataset.livePaneSuppressed === 'true',
      livePaneHidden: livePane.hidden,
      fallbackPaneHidden: fallbackPane.hidden,
      fallbackChildCount: fallbackPane.childElementCount
    }
  })
}

async function dragVueNodeHeaderBy(
  node: VueNodeFixture,
  deltaX: number,
  deltaY: number
) {
  const box = await node.header.boundingBox()
  if (!box) {
    throw new Error('Vue node header has no bounding box')
  }

  const page = node.header.page()
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
  await page.mouse.down()
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
  await page.mouse.move(startX + deltaX, startY + deltaY, {
    steps: 100
  })
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
  await page.mouse.up()
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
}

async function resizeVueNodeFromSouthEast(
  node: VueNodeFixture,
  deltaX: number,
  deltaY: number
) {
  const handle = node.getResizeHandle('SE')
  const box = await handle.boundingBox()
  if (!box) {
    throw new Error('Vue node resize handle has no bounding box')
  }

  const page = handle.page()
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
  await page.mouse.down()
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
  await page.mouse.move(startX + deltaX, startY + deltaY, {
    steps: 100
  })
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
  await page.mouse.up()
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
}

test.describe('Performance', { tag: ['@perf'] }, () => {
  test('canvas idle style recalculations', async ({ comfyPage }) => {
    await comfyPage.workflow.loadWorkflow('default')
    await comfyPage.perf.startMeasuring()

    // Let the canvas idle for 2 seconds — no user interaction.
    // Measures baseline style recalcs from reactive state + render loop.
    for (let i = 0; i < 120; i++) {
      await comfyPage.nextFrame()
    }

    const m = await comfyPage.perf.stopMeasuring('canvas-idle')
    recordMeasurement(m)
    console.log(
      `Canvas idle: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts`
    )
  })

  test('canvas mouse interaction style recalculations', async ({
    comfyPage
  }) => {
    await comfyPage.workflow.loadWorkflow('default')
    await comfyPage.perf.startMeasuring()

    const canvas = comfyPage.canvas
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not available')

    // Sweep mouse across the canvas — crosses nodes, empty space, slots
    for (let i = 0; i < 100; i++) {
      await comfyPage.page.mouse.move(
        box.x + (box.width * i) / 100,
        box.y + (box.height * (i % 3)) / 3
      )
    }

    const m = await comfyPage.perf.stopMeasuring('canvas-mouse-sweep')
    recordMeasurement(m)
    console.log(
      `Mouse sweep: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts`
    )
  })

  test('DOM widget clipping during node selection', async ({ comfyPage }) => {
    // Load default workflow which has DOM widgets (text inputs, combos)
    await comfyPage.workflow.loadWorkflow('default')
    await comfyPage.perf.startMeasuring()

    // Select and deselect nodes rapidly to trigger clipping recalculation
    const canvas = comfyPage.canvas
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not available')

    for (let i = 0; i < 20; i++) {
      // Click on canvas area (nodes occupy various positions)
      await comfyPage.page.mouse.click(
        box.x + box.width / 3 + (i % 5) * 30,
        box.y + box.height / 3 + (i % 4) * 30
      )
      await comfyPage.nextFrame()
    }

    const m = await comfyPage.perf.stopMeasuring('dom-widget-clipping')
    recordMeasurement(m)
    console.log(`Clipping: ${m.layouts} forced layouts`)
  })

  test('subgraph idle style recalculations', async ({ comfyPage }) => {
    await comfyPage.workflow.loadWorkflow('subgraphs/nested-subgraph')
    await comfyPage.perf.startMeasuring()

    for (let i = 0; i < 120; i++) {
      await comfyPage.nextFrame()
    }

    const m = await comfyPage.perf.stopMeasuring('subgraph-idle')
    recordMeasurement(m)
    console.log(
      `Subgraph idle: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts`
    )
  })

  test('subgraph mouse interaction style recalculations', async ({
    comfyPage
  }) => {
    await comfyPage.workflow.loadWorkflow('subgraphs/nested-subgraph')
    await comfyPage.perf.startMeasuring()

    const canvas = comfyPage.canvas
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not available')

    for (let i = 0; i < 100; i++) {
      await comfyPage.page.mouse.move(
        box.x + (box.width * i) / 100,
        box.y + (box.height * (i % 3)) / 3
      )
    }

    const m = await comfyPage.perf.stopMeasuring('subgraph-mouse-sweep')
    recordMeasurement(m)
    console.log(
      `Subgraph mouse sweep: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts`
    )
  })

  test('large graph idle rendering', async ({ comfyPage }) => {
    await comfyPage.workflow.loadWorkflow('large-graph-workflow')
    await comfyPage.perf.startMeasuring()

    // Let the large graph idle for 2 seconds — measures compositor and
    // style recalculation cost at scale (245 nodes).
    for (let i = 0; i < 120; i++) {
      await comfyPage.nextFrame()
    }

    const m = await comfyPage.perf.stopMeasuring('large-graph-idle')
    recordMeasurement(m)
    console.log(
      `Large graph idle: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts`
    )
  })

  test('large graph pan interaction', async ({ comfyPage }) => {
    await comfyPage.workflow.loadWorkflow('large-graph-workflow')

    const canvas = comfyPage.canvas
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not available')

    await comfyPage.perf.startMeasuring()

    // Simulate panning across a large graph — stresses compositor
    // layer management and transform recalculation.
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    await comfyPage.page.mouse.move(centerX, centerY)
    await comfyPage.page.mouse.down({ button: 'middle' })
    for (let i = 0; i < 60; i++) {
      await comfyPage.page.mouse.move(centerX + i * 5, centerY + i * 2)
      await comfyPage.nextFrame()
    }
    await comfyPage.page.mouse.up({ button: 'middle' })

    const m = await comfyPage.perf.stopMeasuring('large-graph-pan')
    recordMeasurement(m)
    console.log(
      `Large graph pan: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts, ${m.taskDurationMs.toFixed(1)}ms task`
    )
  })

  test('large graph zoom interaction', async ({ comfyPage }) => {
    await comfyPage.workflow.loadWorkflow('large-graph-workflow')

    const canvas = comfyPage.canvas
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not available')

    // Position mouse at center so wheel events hit the canvas
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    await comfyPage.page.mouse.move(centerX, centerY)

    await comfyPage.perf.startMeasuring()

    // Zoom in 30 steps then out 30 steps — each step triggers
    // ResizeObserver for all ~245 node elements due to CSS scale change.
    for (let i = 0; i < 30; i++) {
      await comfyPage.page.mouse.wheel(0, -100)
      await comfyPage.nextFrame()
    }
    for (let i = 0; i < 30; i++) {
      await comfyPage.page.mouse.wheel(0, 100)
      await comfyPage.nextFrame()
    }

    const m = await comfyPage.perf.stopMeasuring('large-graph-zoom')
    recordMeasurement(m)
    console.log(
      `Large graph zoom: ${m.layouts} layouts, ${m.layoutDurationMs.toFixed(1)}ms layout, ${m.frameDurationMs.toFixed(1)}ms/frame, TBT=${m.totalBlockingTimeMs.toFixed(0)}ms`
    )
  })

  test('large graph viewport pan sweep', async ({ comfyPage }) => {
    await comfyPage.workflow.loadWorkflow('large-graph-workflow')

    await comfyPage.perf.startMeasuring()
    await comfyPage.canvasOps.panSweep()

    const measurement = await comfyPage.perf.stopMeasuring('viewport-pan-sweep')
    recordMeasurement(measurement)
    logMeasurement('Viewport pan sweep', measurement, [
      'styleRecalcs',
      'layouts',
      'taskDurationMs',
      'heapDeltaBytes',
      'domNodes'
    ])
  })

  test('zoomed-out large graph pan and zoom stays above 24fps', async ({
    comfyPage
  }) => {
    await comfyPage.settings.setSetting('Comfy.VueNodes.Enabled', true)
    await createZoomedOutStressGraph(comfyPage.page)

    await comfyPage.canvasOps.setScale(0.1)

    await expect
      .poll(() => comfyPage.canvasOps.getScale())
      .toBeLessThanOrEqual(0.101)

    await comfyPage.perf.startMeasuring()

    await comfyPage.canvasOps.panSweep({ steps: 45, dx: 7, dy: 4 })

    for (let i = 0; i < 8; i++) {
      await comfyPage.canvasOps.zoom(-100)
      await comfyPage.nextFrame()
    }
    for (let i = 0; i < 8; i++) {
      await comfyPage.canvasOps.zoom(100)
      await comfyPage.nextFrame()
    }

    const measurement = await comfyPage.perf.stopMeasuring(
      'zoomed-out-large-graph-pan-zoom'
    )
    recordMeasurement(measurement)
    logMeasurement('Zoomed-out large graph pan/zoom', measurement, [
      'durationMs',
      'taskDurationMs',
      'layoutDurationMs',
      'frameDurationMs',
      'p95FrameDurationMs',
      'totalBlockingTimeMs',
      'domNodes'
    ])

    expect(measurement.frameDurationMs).toBeLessThanOrEqual(
      TARGET_24_FPS_FRAME_MS
    )
    expect(measurement.p95FrameDurationMs).toBeLessThanOrEqual(
      TARGET_24_FPS_FRAME_MS
    )
  })

  test('large graph active pan stays above 100fps at far middle and close zoom', async ({
    comfyPage
  }) => {
    test.setTimeout(180_000)

    await comfyPage.settings.setSetting('Comfy.VueNodes.Enabled', true)
    await createZoomedOutStressGraph(comfyPage.page)

    const stressGraphSummary = await comfyPage.page.evaluate(() => ({
      totalNodes: window.app?.graph?._nodes?.length ?? 0
    }))

    expect(stressGraphSummary.totalNodes).toBe(600)

    const failures: string[] = []

    for (const scenario of ACTIVE_PAN_ZOOM_SCENARIOS) {
      await comfyPage.canvasOps.setScale(scenario.scale)

      await expect
        .poll(async () => {
          const currentScale = await comfyPage.canvasOps.getScale()
          return Math.abs(currentScale - scenario.scale)
        })
        .toBeLessThanOrEqual(0.001)

      await comfyPage.nextFrame()

      const stableMountedNodeCount = await waitForStableMountedVueNodeCount(
        comfyPage.page
      )

      expect(stableMountedNodeCount).toBeGreaterThan(0)

      const visibilitySummary = await comfyPage.page.evaluate(() => ({
        visibleNodes: window.app?.canvas?.visible_nodes?.length ?? 0,
        mountedVueNodes: document.querySelectorAll('[data-node-id]').length
      }))

      await comfyPage.perf.startMeasuring()

      await comfyPage.canvasOps.panSweep({ steps: 45, dx: 7, dy: 4 })

      const measurement = await comfyPage.perf.stopMeasuring(
        `large-graph-active-pan-${scenario.key}-100fps`
      )
      recordMeasurement(measurement)
      logMeasurement(`${scenario.label} active pan`, measurement, [
        'durationMs',
        'taskDurationMs',
        'taskDurationPerFrameMs',
        'frameCount',
        'layoutDurationMs',
        'frameDurationMs',
        'p95FrameDurationMs',
        'totalBlockingTimeMs',
        'domNodes'
      ])

      console.log(
        `${scenario.label} active pan visibility: ${visibilitySummary.visibleNodes} visible nodes, ${visibilitySummary.mountedVueNodes} mounted Vue nodes`
      )

      const provesTrue100Fps =
        measurement.frameDurationMs <= TARGET_100_FPS_FRAME_MS &&
        measurement.p95FrameDurationMs <= TARGET_100_FPS_FRAME_MS

      if (provesTrue100Fps) {
        console.log(
          `${scenario.label} active pan: true 100fps proven with ${measurement.frameDurationMs.toFixed(2)}ms average frame duration, ${measurement.p95FrameDurationMs.toFixed(2)}ms p95 frame duration, and ${measurement.taskDurationPerFrameMs.toFixed(2)}ms active task per frame`
        )
      } else {
        console.log(
          `${scenario.label} active pan: requestAnimationFrame remained refresh-limited at ${measurement.frameDurationMs.toFixed(2)}ms average frame duration and ${measurement.p95FrameDurationMs.toFixed(2)}ms p95 frame duration; enforcing ${measurement.taskDurationPerFrameMs.toFixed(2)}ms active task per frame as the honest moving-state 100fps proxy`
        )
      }

      if (measurement.frameCount <= 0) {
        failures.push(`${scenario.label} active pan did not record any frames`)
        continue
      }

      if (provesTrue100Fps) {
        if (
          measurement.frameDurationMs > TARGET_100_FPS_FRAME_MS ||
          measurement.p95FrameDurationMs > TARGET_100_FPS_FRAME_MS
        ) {
          failures.push(
            `${scenario.label} active pan missed the true 100fps budget with ${measurement.frameDurationMs.toFixed(2)}ms average frame duration and ${measurement.p95FrameDurationMs.toFixed(2)}ms p95 frame duration`
          )
        }
      } else if (
        measurement.taskDurationPerFrameMs > TARGET_100_FPS_FRAME_MS
      ) {
        failures.push(
          `${scenario.label} active pan missed the honest moving-state 100fps proxy with ${measurement.taskDurationPerFrameMs.toFixed(2)}ms active task per frame while requestAnimationFrame stayed refresh-limited at ${measurement.frameDurationMs.toFixed(2)}ms average and ${measurement.p95FrameDurationMs.toFixed(2)}ms p95`
        )
      }
    }

    if (failures.length > 0) {
      throw new Error(failures.join('\n'))
    }
  })

  test('middle-button pan keeps the live vue pane instead of cloning fallback DOM', async ({
    comfyPage
  }) => {
    test.setTimeout(180_000)

    await comfyPage.settings.setSetting('Comfy.VueNodes.Enabled', true)
    await createZoomedOutStressGraph(comfyPage.page)

    await comfyPage.canvasOps.setScale(0.35)

    await expect
      .poll(async () => Math.abs((await comfyPage.canvasOps.getScale()) - 0.35))
      .toBeLessThanOrEqual(0.001)

    expect(await waitForStableMountedVueNodeCount(comfyPage.page)).toBeGreaterThan(
      0
    )

    const canvasBox = await comfyPage.canvas.boundingBox()
    if (!canvasBox) {
      throw new Error('Canvas bounding box not available')
    }

    const startX = canvasBox.x + canvasBox.width / 2
    const startY = canvasBox.y + canvasBox.height / 2
    const dragSamples = []

    await comfyPage.page.mouse.move(startX, startY)
    await comfyPage.page.mouse.down({ button: 'middle' })

    for (let step = 1; step <= 8; step++) {
      await comfyPage.page.mouse.move(startX + step * 18, startY + step * 10, {
        steps: 2
      })
      await comfyPage.nextFrame()
      dragSamples.push(await readTransformPanePanState(comfyPage.page))
    }

    const activeSamples = dragSamples.filter(
      (sample) =>
        sample.middlePanActive &&
        !sample.panFallbackActive &&
        !sample.livePaneSuppressed &&
        !sample.livePaneHidden &&
        sample.fallbackPaneHidden &&
        sample.fallbackChildCount === 0
    )

    expect(activeSamples.length).toBeGreaterThanOrEqual(3)
    expect(dragSamples.at(-1)).toMatchObject({
      middlePanActive: true,
      panFallbackActive: false,
      livePaneSuppressed: false,
      livePaneHidden: false,
      fallbackPaneHidden: true,
      fallbackChildCount: 0
    })

    await comfyPage.page.mouse.up({ button: 'middle' })
    await comfyPage.nextFrame()

    await expect.poll(() => readTransformPanePanState(comfyPage.page)).toMatchObject({
      middlePanActive: false,
      panFallbackActive: false,
      livePaneSuppressed: false,
      livePaneHidden: false,
      fallbackPaneHidden: true
    })
  })

  test('subgraph DOM widget clipping during node selection', async ({
    comfyPage
  }) => {
    await comfyPage.workflow.loadWorkflow('subgraphs/nested-subgraph')
    await comfyPage.perf.startMeasuring()

    const canvas = comfyPage.canvas
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not available')

    for (let i = 0; i < 20; i++) {
      await comfyPage.page.mouse.click(
        box.x + box.width / 3 + (i % 5) * 30,
        box.y + box.height / 3 + (i % 4) * 30
      )
      await comfyPage.nextFrame()
    }

    const m = await comfyPage.perf.stopMeasuring('subgraph-dom-widget-clipping')
    recordMeasurement(m)
    console.log(`Subgraph clipping: ${m.layouts} forced layouts`)
  })

  test('canvas zoom sweep', async ({ comfyPage }) => {
    await comfyPage.workflow.loadWorkflow('default')
    await comfyPage.perf.startMeasuring()

    // Zoom in 10 steps, then zoom out 10 steps
    for (let i = 0; i < 10; i++) {
      await comfyPage.canvasOps.zoom(-100)
      await comfyPage.nextFrame()
    }
    for (let i = 0; i < 10; i++) {
      await comfyPage.canvasOps.zoom(100)
      await comfyPage.nextFrame()
    }

    const m = await comfyPage.perf.stopMeasuring('canvas-zoom-sweep')
    recordMeasurement(m)
    console.log(
      `Zoom sweep: ${m.layouts} layouts, ${m.frameDurationMs.toFixed(1)}ms/frame, TBT=${m.totalBlockingTimeMs.toFixed(0)}ms`
    )
  })

  test('minimap idle', async ({ comfyPage }) => {
    // Enable minimap via setting, load workflow, then measure idle cost
    await comfyPage.settings.setSetting('Comfy.Minimap.Visible', true)
    await comfyPage.workflow.loadWorkflow('large-graph-workflow')

    // Wait for minimap to render
    await comfyPage.page
      .locator('.litegraph-minimap')
      .waitFor({ state: 'visible', timeout: 5000 })

    await comfyPage.perf.startMeasuring()

    // Idle for 2 seconds with minimap open and 245 nodes
    for (let i = 0; i < 120; i++) {
      await comfyPage.nextFrame()
    }

    const m = await comfyPage.perf.stopMeasuring('minimap-idle')
    recordMeasurement(m)
    console.log(
      `Minimap idle: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts, TBT=${m.totalBlockingTimeMs.toFixed(0)}ms`
    )
  })

  test('replacer workflow vue pan instrumentation', async ({ comfyPage }) => {
    test.setTimeout(240_000)
    test.skip(
      !existsSync(REPLACER_WORKFLOW_PATH),
      `Replacer workflow not found at ${REPLACER_WORKFLOW_PATH}`
    )

    await comfyPage.settings.setSetting('Comfy.VueNodes.Enabled', true)
    await installReplacerPanInstrumentation(comfyPage.page)
    await comfyPage.workflow.loadWorkflowFile(REPLACER_WORKFLOW_PATH)
    await comfyPage.vueNodes.waitForNodes()

    for (let i = 0; i < 30; i++) {
      await comfyPage.nextFrame()
    }

    const graphStats = await comfyPage.page.evaluate(() => ({
      totalNodes: window.app?.canvas?.graph?._nodes?.length ?? 0,
      mountedNodes: document.querySelectorAll('[data-node-id]').length,
      links:
        window.app?.canvas?.graph?._links instanceof Map
          ? window.app.canvas.graph._links.size
          : Object.keys(window.app?.canvas?.graph?._links ?? {}).length,
      visibleNodes: window.app?.canvas?.visible_nodes?.length ?? 0,
      scale: window.app?.canvas?.ds?.scale ?? 1
    }))

    expect(graphStats.totalNodes).toBeGreaterThan(0)
    expect(graphStats.mountedNodes).toBeGreaterThan(0)

    const canvas = comfyPage.canvas
    const box = await canvas.boundingBox()
    if (!box) throw new Error('Canvas bounding box not available')

    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    await comfyPage.page.evaluate(() => {
      const win = window as unknown as Record<string, any>
      win.__replacerPanPerfStart()
    })
    await comfyPage.perf.startMeasuring()

    await comfyPage.page.mouse.move(centerX, centerY)
    await comfyPage.page.mouse.down({ button: 'middle' })
    for (let i = 0; i < 60; i++) {
      await comfyPage.page.mouse.move(centerX + i * 5, centerY + i * 2)
      await comfyPage.nextFrame()
    }
    await comfyPage.page.mouse.up({ button: 'middle' })

    const m = await comfyPage.perf.stopMeasuring('replacer-vue-pan')
    const counters = await comfyPage.page.evaluate(() => {
      const win = window as unknown as Record<string, any>
      return win.__replacerPanPerfStop()
    })

    recordMeasurement(m)
    logMeasurement('Replacer workflow Vue pan', m, [
      'durationMs',
      'styleRecalcs',
      'layouts',
      'layoutDurationMs',
      'taskDurationMs',
      'taskDurationPerFrameMs',
      'frameDurationMs',
      'p95FrameDurationMs',
      'totalBlockingTimeMs',
      'domNodes'
    ])

    console.log(
      `Replacer workflow graph: ${JSON.stringify(graphStats)}; pan counters: ${JSON.stringify(counters)}`
    )
  })

  test.describe('vue renderer large graph', () => {
    test.beforeEach(async ({ comfyPage }) => {
      await comfyPage.settings.setSetting('Comfy.VueNodes.Enabled', true)
      await comfyPage.workflow.loadWorkflow('large-graph-workflow')
      await comfyPage.vueNodes.waitForNodes()
    })

    test('idle', async ({ comfyPage }) => {
      await comfyPage.perf.startMeasuring()

      for (let i = 0; i < 120; i++) {
        await comfyPage.nextFrame()
      }

      const m = await comfyPage.perf.stopMeasuring('vue-large-graph-idle')
      recordMeasurement(m)
      console.log(
        `Vue large graph idle: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts, ${m.domNodes} DOM nodes`
      )
    })

    test('pan', async ({ comfyPage }) => {
      const canvas = comfyPage.canvas
      const box = await canvas.boundingBox()
      if (!box) throw new Error('Canvas bounding box not available')

      await comfyPage.perf.startMeasuring()

      const centerX = box.x + box.width / 2
      const centerY = box.y + box.height / 2
      await comfyPage.page.mouse.move(centerX, centerY)
      await comfyPage.page.mouse.down({ button: 'middle' })
      for (let i = 0; i < 60; i++) {
        await comfyPage.page.mouse.move(centerX + i * 5, centerY + i * 2)
        await comfyPage.nextFrame()
      }
      await comfyPage.page.mouse.up({ button: 'middle' })

      const m = await comfyPage.perf.stopMeasuring('vue-large-graph-pan')
      recordMeasurement(m)
      console.log(
        `Vue large graph pan: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts, ${m.frameDurationMs.toFixed(1)}ms/frame, TBT=${m.totalBlockingTimeMs.toFixed(0)}ms`
      )
    })

    test.describe('node interactions', () => {
      test.beforeEach(async ({ comfyPage }) => {
        await comfyPage.settings.setSetting('Comfy.VueNodes.Enabled', true)
        const nodeId = await createPerfNoteNode(comfyPage.page)
        await comfyPage.vueNodes.getNodeLocator(nodeId).waitFor({
          state: 'visible'
        })
      })

      test('drag commits', async ({ comfyPage }) => {
        const nodeId = await comfyPage.vueNodes.getNodeIdByTitle(PERF_NOTE_TITLE)
        const node = new VueNodeFixture(comfyPage.vueNodes.getNodeLocator(nodeId))
        const before = await readLiteGraphNodeGeometry(comfyPage.page, nodeId)

        await comfyPage.perf.startMeasuring()

        for (let i = 0; i < 6; i++) {
          await dragVueNodeHeaderBy(node, 32, 18)
          await comfyPage.nextFrame()
        }

        const measurement = await comfyPage.perf.stopMeasuring(
          'vue-node-drag-commits'
        )
        const after = await readLiteGraphNodeGeometry(comfyPage.page, nodeId)

        expect(after.position[0]).toBeGreaterThan(before.position[0])
        expect(after.position[1]).toBeGreaterThan(before.position[1])

        recordMeasurement(measurement)
        logMeasurement('Vue node drag commits', measurement, [
          'durationMs',
          'styleRecalcs',
          'layouts',
          'taskDurationMs',
          'frameDurationMs',
          'totalBlockingTimeMs'
        ])
      })

      test('resize commits', async ({ comfyPage }) => {
        const nodeId = await comfyPage.vueNodes.getNodeIdByTitle(PERF_NOTE_TITLE)
        const node = new VueNodeFixture(comfyPage.vueNodes.getNodeLocator(nodeId))
        const before = await readLiteGraphNodeGeometry(comfyPage.page, nodeId)

        await comfyPage.perf.startMeasuring()

        for (let i = 0; i < 6; i++) {
          await resizeVueNodeFromSouthEast(node, 18, 12)
          await comfyPage.nextFrame()
        }

        const measurement = await comfyPage.perf.stopMeasuring(
          'vue-node-resize-commits'
        )
        const after = await readLiteGraphNodeGeometry(comfyPage.page, nodeId)

        expect(after.size[0]).toBeGreaterThan(before.size[0])
        expect(after.size[1]).toBeGreaterThan(before.size[1])

        recordMeasurement(measurement)
        logMeasurement('Vue node resize commits', measurement, [
          'durationMs',
          'styleRecalcs',
          'layouts',
          'layoutDurationMs',
          'frameDurationMs',
          'totalBlockingTimeMs'
        ])
      })
    })

    test('zoom out culling', async ({ comfyPage }) => {
      await comfyPage.perf.startMeasuring()

      // Zoom out to the actual LiteGraph floor and confirm virtualization
      // still keeps part of the graph out of the DOM at that scale.
      await comfyPage.canvasOps.setScale(0.1)

      await expect
        .poll(() =>
          comfyPage.page.evaluate(() => {
            const graph = window.app?.canvas?.graph
            const totalNodes = graph?._nodes?.length ?? 0
            const mountedNodes = document.querySelectorAll('[data-node-id]').length
            const ds = window.app?.canvas?.ds
            const scale = ds?.scale ?? 1
            const minScale = ds?.min_scale ?? 0.1

            return (
              totalNodes > 0 &&
              mountedNodes > 0 &&
              mountedNodes < totalNodes &&
              scale <= minScale + 0.001
            )
          })
        )
        .toBe(true)

      // Idle at the floor while viewport virtualization is active.
      for (let i = 0; i < 60; i++) {
        await comfyPage.nextFrame()
      }

      // Zoom back in
      for (let i = 0; i < 20; i++) {
        await comfyPage.canvasOps.zoom(-100)
      }

      const m = await comfyPage.perf.stopMeasuring('vue-zoom-culling')
      recordMeasurement(m)
      console.log(
        `Vue zoom culling: ${m.styleRecalcs} style recalcs, ${m.layouts} layouts, ${m.frameDurationMs.toFixed(1)}ms/frame`
      )
    })

    test('viewport mount culling remounts centered off-screen nodes', async ({
      comfyPage
    }) => {
      const totalNodeCount = await comfyPage.nodeOps.getNodeCount()
      const mountedBefore = await comfyPage.vueNodes.getNodeCount()

      expect(mountedBefore).toBeLessThan(totalNodeCount)

      const targetNodeId = await comfyPage.page.evaluate(() => {
        const graph = window.app?.canvas?.graph
        const targetNode = graph?._nodes?.at(-1)
        return targetNode ? String(targetNode.id) : null
      })

      expect(targetNodeId).toBeTruthy()

      await comfyPage.page.evaluate((nodeId) => {
        if (!nodeId) return

        const graph = window.app?.canvas?.graph
        const node = graph?._nodes_by_id?.[nodeId]
        if (node) {
          window.app?.canvas?.centerOnNode(node)
        }
      }, targetNodeId)

      await expect(
        comfyPage.vueNodes.getNodeLocator(targetNodeId as string)
      ).toBeVisible()
    })
  })

  test(
    'subgraph transition (enter and exit)',
    { tag: ['@vue-nodes'] },
    async ({ comfyPage }, testInfo) => {
      // Heaviest perf test: loads an 80-node subgraph and pays ~30s/repeat.
      // The signal is dominated by N=80 mount cost, so a single sample per
      // CI invocation is sufficient — early-return on subsequent repeats.
      if (testInfo.repeatEachIndex > 0) return

      // Load workflow with a subgraph containing 80 interior nodes.
      // Entering the subgraph unmounts root nodes and mounts all 80 interior
      // nodes synchronously — this is the bottleneck we're measuring.
      await comfyPage.workflow.loadWorkflow('subgraphs/large-subgraph-80-nodes')

      await comfyPage.idleFrames(30)

      await comfyPage.vueNodes.enterSubgraph()
      await comfyPage.vueNodes.waitForNodes(80)
      await comfyPage.idleFrames(30)

      // Exit back to root graph before measuring a fresh enter/exit cycle
      await comfyPage.subgraph.exitViaBreadcrumb()
      await comfyPage.idleFrames(10)

      // Start measuring the enter transition
      await comfyPage.perf.startMeasuring()

      await comfyPage.vueNodes.enterSubgraph()
      await comfyPage.vueNodes.waitForNodes(80)
      await comfyPage.idleFrames(30)

      const m = await comfyPage.perf.stopMeasuring('subgraph-transition-enter')
      recordMeasurement(m)
      console.log(
        `Subgraph enter (80 nodes): ${m.taskDurationMs.toFixed(0)}ms task, ${m.layouts} layouts, TBT=${m.totalBlockingTimeMs.toFixed(0)}ms`
      )
    }
  )

  test('active execution preview hydration', async ({ comfyPage, getWebSocket }) => {
    await comfyPage.appMode.enterAppModeWithInputs(APP_MODE_INPUTS)
    await expect(comfyPage.appMode.linearWidgets).toBeVisible()

    const exec = new ExecutionHelper(comfyPage, await getWebSocket())

    await comfyPage.perf.startMeasuring()

    const jobId = await exec.run()
    await comfyPage.nextFrame()
    exec.executionStart(jobId)
    exec.latentPreview(jobId, SAVE_IMAGE_NODE)
    exec.executed(jobId, SAVE_IMAGE_NODE, {
      images: [
        {
          filename: 'baseline-preview.png',
          subfolder: '',
          type: 'output'
        }
      ]
    })
    await exec.completeWithHistory(jobId, SAVE_IMAGE_NODE, 'baseline-preview.png')

    await expect(comfyPage.appMode.outputHistory.historyItems.first()).toBeVisible()

    const m = await comfyPage.perf.stopMeasuring('active-execution-preview')
    recordMeasurement(m)
    logMeasurement('Active execution preview', m, [
      'durationMs',
      'styleRecalcs',
      'layouts',
      'totalBlockingTimeMs',
      'domNodes'
    ])
  })

  test('queue burst hydration', async ({ comfyPage, getWebSocket }) => {
    await comfyPage.appMode.enterAppModeWithInputs(APP_MODE_INPUTS)
    await expect(comfyPage.appMode.linearWidgets).toBeVisible()

    const exec = new ExecutionHelper(comfyPage, await getWebSocket())
    const jobIds: string[] = []
    const outputHistoryDomNodesBefore =
      await comfyPage.appMode.outputHistory.outputs.evaluate(
        (element) => {
          const root = element.closest('[role="group"]')
          return root ? root.querySelectorAll('*').length + 1 : 0
        }
      )

    await comfyPage.perf.startMeasuring()

    for (let i = 0; i < 6; i++) {
      const jobId = await exec.run()
      await comfyPage.nextFrame()
      jobIds.push(jobId)
      exec.executionStart(jobId)
      await comfyPage.nextFrame()
    }

    expect(jobIds).toHaveLength(6)
    await expect(comfyPage.appMode.outputHistory.inProgressItems.first()).toBeVisible()
    const outputHistoryDomNodesAfter =
      await comfyPage.appMode.outputHistory.outputs.evaluate(
        (element) => {
          const root = element.closest('[role="group"]')
          return root ? root.querySelectorAll('*').length + 1 : 0
        }
      )
    const outputHistoryDomNodes =
      outputHistoryDomNodesAfter - outputHistoryDomNodesBefore

    const m = await comfyPage.perf.stopMeasuring('queue-burst-hydration')
    recordMeasurement(m)
    logMeasurement('Queue burst hydration', m, [
      'durationMs',
      'styleRecalcs',
      'layouts',
      'totalBlockingTimeMs',
      'domNodes'
    ])
    console.log(
      `Queue burst proof: current ${m.durationMs.toFixed(0)}ms/${m.styleRecalcs} recalcs/${m.layouts} layouts/output-history DOM Δ${outputHistoryDomNodes}/global DOM Δ${m.domNodes}; ` +
        `pre-reconciliation ${QUEUE_BURST_BASELINES.preReconciliation.durationMs}ms/${QUEUE_BURST_BASELINES.preReconciliation.styleRecalcs} recalcs/${QUEUE_BURST_BASELINES.preReconciliation.layouts} layouts; ` +
        `prior pass ${QUEUE_BURST_BASELINES.priorStoreReconciliationPass.durationMs}ms/${QUEUE_BURST_BASELINES.priorStoreReconciliationPass.styleRecalcs} recalcs/${QUEUE_BURST_BASELINES.priorStoreReconciliationPass.layouts} layouts; ` +
        `durable P0 DOM budget ${QUEUE_BURST_BASELINES.durableP0.domNodes}`
    )

    expect(m.durationMs).toBeLessThan(
      QUEUE_BURST_BASELINES.priorStoreReconciliationPass.durationMs
    )
    expect(m.styleRecalcs).toBeLessThanOrEqual(
      QUEUE_BURST_BASELINES.preReconciliation.styleRecalcs
    )
    expect(m.layouts).toBeLessThanOrEqual(
      QUEUE_BURST_BASELINES.durableP0.layouts
    )
    expect(outputHistoryDomNodes).toBeLessThanOrEqual(
      QUEUE_BURST_BASELINES.durableP0.domNodes
    )
  })

  test('graph switch rapid tabs', async ({ comfyPage }) => {
    const runId = `${test.info().workerIndex}-${test.info().retry}-${Date.now()}`
    const workflowA = `p0-graph-switch-a-${runId}`
    const workflowB = `p0-graph-switch-b-${runId}`

    await comfyPage.workflow.loadWorkflow('default')
    await comfyPage.menu.topbar.saveWorkflow(workflowA)
    const nodeCountA = await comfyPage.nodeOps.getNodeCount()

    await comfyPage.workflow.loadWorkflow('nodes/single_ksampler')
    await comfyPage.menu.topbar.saveWorkflow(workflowB)
    const nodeCountB = await comfyPage.nodeOps.getNodeCount()

    await comfyPage.perf.startMeasuring()

    for (let i = 0; i < 3; i++) {
      await comfyPage.workflow.switchToTab(workflowA)
      await comfyPage.workflow.switchToTab(workflowB)
    }

    await expect.poll(() => comfyPage.nodeOps.getNodeCount()).toBe(nodeCountB)
    await comfyPage.workflow.switchToTab(workflowA)
    await expect.poll(() => comfyPage.nodeOps.getNodeCount()).toBe(nodeCountA)
    await comfyPage.workflow.switchToTab(workflowB)

    const m = await comfyPage.perf.stopMeasuring('graph-switch-rapid-tabs')
    recordMeasurement(m)
    logMeasurement('Graph switch rapid tabs', m, [
      'durationMs',
      'styleRecalcs',
      'layouts',
      'taskDurationMs',
      'totalBlockingTimeMs'
    ])
  })

  test('pathological oversized group fit', async ({ comfyPage }) => {
    await comfyPage.workflow.loadWorkflow('groups/oversized_group')

    const initialGroupSize = await expect
      .poll(() =>
        comfyPage.page.evaluate(() => {
          const group = window.app!.graph.groups[0]
          return group ? [group.size[0], group.size[1]] : null
        })
      )
      .not.toBeNull()

    await comfyPage.keyboard.selectAll()
    await comfyPage.nextFrame()

    await comfyPage.perf.startMeasuring()
    await comfyPage.command.executeCommand('Comfy.Graph.FitGroupToContents')

    await expect
      .poll(() =>
        comfyPage.page.evaluate(() => {
          const group = window.app!.graph.groups[0]
          return group ? [group.size[0], group.size[1]] : null
        })
      )
      .not.toEqual(initialGroupSize)

    const m = await comfyPage.perf.stopMeasuring(
      'pathological-oversized-group-fit'
    )
    recordMeasurement(m)
    logMeasurement('Pathological oversized group fit', m, [
      'durationMs',
      'styleRecalcs',
      'layouts',
      'taskDurationMs',
      'totalBlockingTimeMs'
    ])
  })

  test('workflow execution', async ({ comfyPage }) => {
    // Uses lightweight PrimitiveString → PreviewAny workflow (no GPU needed)
    await comfyPage.workflow.loadWorkflow('execution/partial_execution')
    await comfyPage.perf.startMeasuring()

    // Queue the prompt and wait for execution to complete
    await comfyPage.command.executeCommand('Comfy.QueuePrompt')

    // Wait for the output widget to populate (execution_success)
    const outputNode = await comfyPage.nodeOps.getNodeRefById(1)
    await expect
      .poll(async () => (await outputNode.getWidget(0)).getValue(), {
        timeout: 10000
      })
      .toBe('foo')

    const m = await comfyPage.perf.stopMeasuring('workflow-execution')
    recordMeasurement(m)
    console.log(
      `Workflow execution: ${m.durationMs.toFixed(0)}ms total, ${m.layouts} layouts, TBT=${m.totalBlockingTimeMs.toFixed(0)}ms`
    )
  })
})
