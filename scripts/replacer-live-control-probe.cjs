#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { chromium } = require('@playwright/test')

const url = process.env.PLAYWRIGHT_TEST_URL || 'http://127.0.0.1:5274/'
const workflowPath =
  process.env.REPLACER_WORKFLOW_PATH ||
  'F:\\ComfyUI_DEV_windows_portable_nvidia\\ComfyUI_DEV_windows_portable\\ComfyUI\\user\\default\\workflows\\replacer creative i2v stable Parted 2.8_dev.json'
const outPath =
  process.env.REPLACER_LIVE_CONTROL_OUT ||
  path.join('output_sessions', `replacer-live-control-${Date.now()}.json`)
const strict = process.env.REPLACER_LIVE_CONTROL_STRICT === '1'
const headless = process.env.REPLACER_LIVE_CONTROL_HEADED !== '1'

async function nextFrame(page, count = 1) {
  for (let i = 0; i < count; i++) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve))
    )
  }
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => window.app?.canvas && window.app?.graph,
    undefined,
    { timeout: 90_000 }
  )
  await page
    .locator('.p-blockui-mask')
    .waitFor({ state: 'hidden', timeout: 90_000 })
    .catch(() => {})
  await nextFrame(page, 2)
}

async function waitForWorkflowReady(page) {
  await page.waitForFunction(
    () => (window.app?.graph?._nodes?.length ?? 0) > 100,
    undefined,
    { timeout: 90_000 }
  )
  await page.waitForFunction(
    () => !window.app?.extensionManager?.workflow?.isBusy,
    undefined,
    { timeout: 90_000 }
  )
  await nextFrame(page, 10)
}

async function loadReplacerWorkflow(page) {
  await page.locator('#comfy-file-input').setInputFiles(workflowPath)
  await waitForWorkflowReady(page)
}

async function installLiveControlInstrumentation(page) {
  await page.evaluate(() => {
    const win = window

    const createCounters = () => ({
      drawConnectionsCalls: 0,
      drawConnectionsMs: 0,
      computeVisibleNodesCalls: 0,
      computeVisibleNodesMs: 0,
      setDirtyForegroundCalls: 0,
      setDirtyBackgroundCalls: 0,
      setDirtyBothCalls: 0,
      mountedMutationAdds: 0,
      mountedMutationRemoves: 0,
      longTasks: [],
      startedAt: 0,
      frameTimestamps: [],
      modeSamples: [],
      modeTransitions: []
    })

    const modeSnapshot = () => {
      const transformPane = document.querySelector('[data-testid="transform-pane"]')
      const farCanvas = document.querySelector('[data-testid="far-zoom-node-canvas"]')
      const mountedNodes = document.querySelectorAll('[data-node-id]').length
      const scale = win.app?.canvas?.ds?.scale ?? null
      const activePanDetail = transformPane?.dataset?.activePanDetail ?? 'none'
      const middlePanActive = transformPane?.dataset?.middlePanActive === 'true'
      const mode = farCanvas
        ? 'far-canvas'
        : mountedNodes > 0
          ? `dom:${activePanDetail}`
          : 'dom:unmounted'

      return {
        at: performance.now(),
        mode,
        scale,
        activePanDetail,
        middlePanActive,
        farCanvas: Boolean(farCanvas),
        mountedNodes
      }
    }

    const timeCall = (keyCalls, keyMs, fn) => {
      const startedAt = performance.now()
      try {
        return fn()
      } finally {
        win.__replacerLiveControlCounters[keyCalls]++
        win.__replacerLiveControlCounters[keyMs] +=
          performance.now() - startedAt
      }
    }

    win.__replacerLiveControlStart = () => {
      const counters = createCounters()
      counters.startedAt = performance.now()
      win.__replacerLiveControlCounters = counters
      win.__replacerLiveControlActive = true

      if (!win.__replacerLiveControlLongTaskObserver) {
        win.__replacerLiveControlLongTaskObserver = new PerformanceObserver(
          (list) => {
            if (!win.__replacerLiveControlActive) return
            for (const entry of list.getEntries()) {
              if (entry.startTime < counters.startedAt) continue
              counters.longTasks.push({
                startTime: entry.startTime,
                duration: entry.duration
              })
            }
          }
        )
        win.__replacerLiveControlLongTaskObserver.observe({
          type: 'longtask',
          buffered: true
        })
      }

      const canvas = win.app?.canvas
      if (canvas && !canvas.__replacerLiveControlOriginalSetDirty) {
        canvas.__replacerLiveControlOriginalSetDirty = canvas.setDirty
        canvas.setDirty = function (foreground, background) {
          if (win.__replacerLiveControlActive) {
            if (foreground) counters.setDirtyForegroundCalls++
            if (background) counters.setDirtyBackgroundCalls++
            if (foreground && background) counters.setDirtyBothCalls++
          }
          return canvas.__replacerLiveControlOriginalSetDirty.call(
            this,
            foreground,
            background
          )
        }
      }

      if (canvas && !canvas.__replacerLiveControlOriginalDrawConnections) {
        canvas.__replacerLiveControlOriginalDrawConnections =
          canvas.drawConnections
        canvas.drawConnections = function (...args) {
          if (!win.__replacerLiveControlActive) {
            return canvas.__replacerLiveControlOriginalDrawConnections.apply(
              this,
              args
            )
          }
          return timeCall('drawConnectionsCalls', 'drawConnectionsMs', () =>
            canvas.__replacerLiveControlOriginalDrawConnections.apply(
              this,
              args
            )
          )
        }
      }

      if (canvas && !canvas.__replacerLiveControlOriginalComputeVisibleNodes) {
        canvas.__replacerLiveControlOriginalComputeVisibleNodes =
          canvas.computeVisibleNodes
        canvas.computeVisibleNodes = function (...args) {
          if (!win.__replacerLiveControlActive) {
            return canvas.__replacerLiveControlOriginalComputeVisibleNodes.apply(
              this,
              args
            )
          }
          return timeCall(
            'computeVisibleNodesCalls',
            'computeVisibleNodesMs',
            () =>
              canvas.__replacerLiveControlOriginalComputeVisibleNodes.apply(
                this,
                args
              )
          )
        }
      }

      const mutationObserver = new MutationObserver((mutations) => {
        if (!win.__replacerLiveControlActive) return
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.matches('[data-node-id]') ||
                node.querySelector('[data-node-id]'))
            ) {
              counters.mountedMutationAdds++
            }
          }
          for (const node of mutation.removedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.matches('[data-node-id]') ||
                node.querySelector('[data-node-id]'))
            ) {
              counters.mountedMutationRemoves++
            }
          }
        }
      })
      mutationObserver.observe(document.body, { childList: true, subtree: true })
      win.__replacerLiveControlMutationObserver = mutationObserver

      let lastMode = null
      const sample = (timestamp) => {
        if (!win.__replacerLiveControlActive) return
        counters.frameTimestamps.push(timestamp)
        const snapshot = modeSnapshot()
        counters.modeSamples.push(snapshot)
        if (snapshot.mode !== lastMode) {
          counters.modeTransitions.push(snapshot)
          lastMode = snapshot.mode
        }
        win.__replacerLiveControlRaf = requestAnimationFrame(sample)
      }
      win.__replacerLiveControlRaf = requestAnimationFrame(sample)
    }

    win.__replacerLiveControlStop = () => {
      win.__replacerLiveControlActive = false
      if (win.__replacerLiveControlRaf) {
        cancelAnimationFrame(win.__replacerLiveControlRaf)
      }
      win.__replacerLiveControlMutationObserver?.disconnect()

      const counters = win.__replacerLiveControlCounters ?? createCounters()
      const timestamps = counters.frameTimestamps
      const frameDurations = []
      for (let i = 1; i < timestamps.length; i++) {
        frameDurations.push(timestamps[i] - timestamps[i - 1])
      }
      const sortedFrames = [...frameDurations].sort((a, b) => a - b)
      const mountedSamples = counters.modeSamples.map(
        (sample) => sample.mountedNodes
      )
      const activePanDuringWheelSamples = counters.modeSamples.filter(
        (sample) => sample.activePanDetail !== 'none' && !sample.middlePanActive
      )

      return {
        ...counters,
        frameTimestamps: undefined,
        modeSamples: counters.modeSamples.slice(0, 1500),
        frameCount: frameDurations.length,
        frameAverageMs: frameDurations.length
          ? frameDurations.reduce((sum, value) => sum + value, 0) /
            frameDurations.length
          : 0,
        frameP95Ms: sortedFrames.length
          ? sortedFrames[Math.ceil(sortedFrames.length * 0.95) - 1]
          : 0,
      longTaskCount: counters.longTasks.length,
        longTaskTotalMs: counters.longTasks.reduce(
          (sum, entry) => sum + entry.duration,
          0
        ),
        mountedMin: mountedSamples.length ? Math.min(...mountedSamples) : 0,
        mountedMax: mountedSamples.length ? Math.max(...mountedSamples) : 0,
        activePanDuringWheelSampleCount: activePanDuringWheelSamples.length
      }
    }
  })
}

function summarizeScenario(scenario) {
  const counters = scenario.result.counters
  return {
    label: scenario.label,
    scale: scenario.scale,
    before: scenario.before,
    after: scenario.after,
    elapsedMs: scenario.result.elapsedMs,
    frameCount: counters.frameCount,
    frameAverageMs: Number(counters.frameAverageMs.toFixed(1)),
    frameP95Ms: Number(counters.frameP95Ms.toFixed(1)),
    drawConnectionsMs: Number(counters.drawConnectionsMs.toFixed(1)),
    drawConnectionsCalls: counters.drawConnectionsCalls,
    mountedMin: counters.mountedMin,
    mountedMax: counters.mountedMax,
    modeTransitions: counters.modeTransitions.map((transition) => ({
      mode: transition.mode,
      scale:
        typeof transition.scale === 'number'
          ? Number(transition.scale.toFixed(4))
          : transition.scale,
      mountedNodes: transition.mountedNodes
    })),
    activePanDuringWheelSampleCount: counters.activePanDuringWheelSampleCount,
    warnings: scenario.result.warnings
  }
}

function summarizeOutput(output) {
  return {
    url: output.url,
    workflowPath: output.workflowPath,
    totalMs: output.totalMs,
    targetNodeId: output.targetNodeId,
    initialInfo: output.initialInfo,
    scenarios: output.scenarios.map(summarizeScenario),
    warnings: output.warnings,
    outputFile: outPath
  }
}

async function getGraphInfo(page) {
  return page.evaluate(() => ({
    nodes: window.app?.graph?._nodes?.length ?? 0,
    mounted: document.querySelectorAll('[data-node-id]').length,
    lowDetailNodes: document.querySelectorAll('[data-low-detail]').length,
    lowDetailSlotAreas: document.querySelectorAll(
      '[data-low-detail] [data-testid="node-low-detail-slots"]'
    ).length,
    lowDetailSlotDots: document.querySelectorAll(
      '[data-low-detail] [data-testid="node-low-detail-slots"] [data-testid="slot-dot"]'
    ).length,
    farZoomCanvas: Boolean(
      document.querySelector('[data-testid="far-zoom-node-canvas"]')
    ),
    scale: window.app?.canvas?.ds?.scale ?? null,
    offset: [...(window.app?.canvas?.ds?.offset ?? [0, 0])]
  }))
}

async function findDenseTargetNode(page) {
  return page.evaluate(() => {
    const nodes = window.app?.graph?._nodes ?? []
    if (!nodes.length) return null

    let bestNode = nodes[0]
    let bestScore = -1
    for (const candidate of nodes) {
      const candidateCenter = [
        candidate.pos[0] + candidate.size[0] / 2,
        candidate.pos[1] + candidate.size[1] / 2
      ]
      let score = 0
      for (const node of nodes) {
        const nodeCenter = [
          node.pos[0] + node.size[0] / 2,
          node.pos[1] + node.size[1] / 2
        ]
        const dx = nodeCenter[0] - candidateCenter[0]
        const dy = nodeCenter[1] - candidateCenter[1]
        if (dx * dx + dy * dy < 1400 * 1400) score++
      }
      if (score > bestScore) {
        bestScore = score
        bestNode = candidate
      }
    }

    return String(bestNode.id)
  })
}

async function focusGraph(page, scale, targetNodeId) {
  await page.evaluate(
    ({ scale, targetNodeId }) => {
      const canvas = window.app.canvas
      canvas.ds.scale = scale
      const targetNode = window.app.graph?._nodes?.find(
        (node) => String(node.id) === String(targetNodeId)
      )
      if (targetNode) canvas.centerOnNode(targetNode)
      canvas.setDirty(true, true)
    },
    { scale, targetNodeId }
  )
  await nextFrame(page, 12)
}

async function findCanvasPoint(page) {
  return page.evaluate(() => {
    for (const y of [500, 650, 800, 350, 200]) {
      for (const x of [800, 1100, 1400, 500, 250]) {
        const top = document.elementsFromPoint(x, y)[0]
        if (top?.id === 'graph-canvas') return { x, y }
      }
    }
    return {
      x: Math.floor(innerWidth * 0.75),
      y: Math.floor(innerHeight * 0.75)
    }
  })
}

async function measureScenario(page, label, interaction) {
  await page.evaluate(() => window.__replacerLiveControlStart())
  const startedAt = Date.now()
  await interaction()
  await nextFrame(page, 10)
  const counters = await page.evaluate(() => window.__replacerLiveControlStop())
  const elapsedMs = Date.now() - startedAt

  const warnings = []
  if (label.includes('wheel') && counters.activePanDuringWheelSampleCount > 0) {
    warnings.push(
      `active pan LOD was active during wheel zoom for ${counters.activePanDuringWheelSampleCount} samples`
    )
  }
  if (label.includes('wheel') && counters.modeTransitions.length > 3) {
    warnings.push(
      `wheel zoom produced ${counters.modeTransitions.length} render mode transitions`
    )
  }
  if (counters.frameP95Ms > 66.7) {
    warnings.push(`p95 frame duration ${counters.frameP95Ms.toFixed(1)}ms`)
  }

  return { label, elapsedMs, counters, warnings }
}

async function panInteraction(page) {
  const point = await findCanvasPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(point.x + 260, point.y + 140, { steps: 36 })
  await page.mouse.up({ button: 'middle' })
}

async function wheelInteraction(page, direction) {
  const point = await findCanvasPoint(page)
  await page.mouse.move(point.x, point.y)
  for (let i = 0; i < 28; i++) {
    await page.mouse.wheel(0, direction * 100)
    await nextFrame(page, 1)
  }
}

async function main() {
  const browser = await chromium.launch({ headless })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const startedAt = Date.now()
  const warnings = []

  try {
    await page.goto(`${url.replace(/\/$/, '')}/api/users`, {
      waitUntil: 'domcontentloaded',
      timeout: 90_000
    })
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('Comfy.userId', 'default')
      localStorage.setItem('Comfy.VueNodes.Enabled', 'true')
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await waitForAppReady(page)
    await loadReplacerWorkflow(page)
    await installLiveControlInstrumentation(page)

    const targetNodeId = await findDenseTargetNode(page)
    const initialInfo = await getGraphInfo(page)
    const scenarios = []

    for (const scenario of [
      { label: 'pan:far', scale: 0.12 },
      { label: 'pan:middle', scale: 0.35 },
      { label: 'pan:close', scale: 0.65 }
    ]) {
      await focusGraph(page, scenario.scale, targetNodeId)
      const before = await getGraphInfo(page)
      if (
        scenario.label === 'pan:middle' &&
        before.mounted > 0 &&
        before.lowDetailSlotDots === 0
      ) {
        warnings.push(
          'pan:middle: low-detail connection slot dots were not mounted'
        )
      }
      const result = await measureScenario(page, scenario.label, () =>
        panInteraction(page)
      )
      const after = await getGraphInfo(page)
      scenarios.push({ ...scenario, before, result, after })
      warnings.push(...result.warnings.map((warning) => `${scenario.label}: ${warning}`))
    }

    await focusGraph(page, 0.12, targetNodeId)
    scenarios.push({
      label: 'wheel:zoom-in',
      before: await getGraphInfo(page),
      result: await measureScenario(page, 'wheel:zoom-in', () =>
        wheelInteraction(page, -1)
      ),
      after: await getGraphInfo(page)
    })
    warnings.push(...scenarios.at(-1).result.warnings.map((warning) => `wheel:zoom-in: ${warning}`))

    scenarios.push({
      label: 'wheel:zoom-out',
      before: await getGraphInfo(page),
      result: await measureScenario(page, 'wheel:zoom-out', () =>
        wheelInteraction(page, 1)
      ),
      after: await getGraphInfo(page)
    })
    warnings.push(...scenarios.at(-1).result.warnings.map((warning) => `wheel:zoom-out: ${warning}`))

    const output = {
      url,
      workflowPath,
      totalMs: Date.now() - startedAt,
      targetNodeId,
      initialInfo,
      scenarios,
      warnings
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
    console.log(JSON.stringify(summarizeOutput(output), null, 2))

    if (strict && warnings.length > 0) {
      process.exitCode = 1
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error && (error.stack || error.message || String(error)))
  process.exit(1)
})
