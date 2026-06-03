#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { chromium } = require('@playwright/test')

const url = process.env.PLAYWRIGHT_TEST_URL || 'http://127.0.0.1:5274/'
const workflowPath =
  process.env.REPLACER_WORKFLOW_PATH ||
  'F:\\ComfyUI_DEV_windows_portable_nvidia\\ComfyUI_DEV_windows_portable\\ComfyUI\\user\\default\\workflows\\replacer creative i2v stable Parted 2.8_dev.json'
const outPath =
  process.env.REPLACER_RENDER_ATTRIBUTION_OUT ||
  path.join('output_sessions', `replacer-render-attribution-${Date.now()}.json`)

const scenarios = [
  { label: 'far', scale: 0.12 },
  { label: 'middle', scale: 0.45 },
  { label: 'close', scale: 1.0 }
]

async function waitForAppReady(page) {
  await page.waitForFunction(
    () =>
      window.app &&
      (window.app.extensionManager || window.app.canvas || window.app.graph),
    undefined,
    { timeout: 90_000 }
  )
  await page.locator('.p-blockui-mask').waitFor({ state: 'hidden', timeout: 90_000 })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

async function waitForWorkflowNodes(page) {
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
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

async function getGraphInfo(page) {
  return page.evaluate(() => ({
    nodes: window.app?.graph?._nodes?.length ?? 0,
    mounted: document.querySelectorAll('[data-node-id]').length,
    minimapVisible: Boolean(document.querySelector('[data-testid="minimap-canvas"]')),
    farZoomCanvas: Boolean(document.querySelector('[data-testid="far-zoom-node-canvas"]')),
    scale: window.app?.canvas?.ds?.scale ?? null,
    offset: [...(window.app?.canvas?.ds?.offset ?? [0, 0])]
  }))
}

async function installAttribution(page) {
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
      minimapCanvasCalls: 0,
      minimapCanvasMs: 0,
      minimapCanvasMethods: {},
      frameSamples: 0,
      mountedSamples: []
    })

    const increment = (bucket, key) => {
      bucket[key] = (bucket[key] ?? 0) + 1
    }

    const timeCall = (counters, keyCalls, keyMs, fn) => {
      const startedAt = performance.now()
      try {
        return fn()
      } finally {
        counters[keyCalls]++
        counters[keyMs] += performance.now() - startedAt
      }
    }

    win.__replacerRenderAttributionCounters = createCounters()

    if (!win.__replacerRenderOriginalGetContext) {
      win.__replacerRenderOriginalGetContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (...args) {
        const ctx = win.__replacerRenderOriginalGetContext.apply(this, args)
        if (!ctx || this.dataset?.testid !== 'minimap-canvas') return ctx
        if (ctx.__replacerRenderAttributionWrapped) return ctx

        const methods = [
          'clearRect',
          'fillRect',
          'strokeRect',
          'beginPath',
          'moveTo',
          'lineTo',
          'rect',
          'arc',
          'fill',
          'stroke',
          'drawImage',
          'fillText'
        ]

        for (const method of methods) {
          if (typeof ctx[method] !== 'function') continue
          const original = ctx[method]
          ctx[method] = function (...methodArgs) {
            if (!win.__replacerRenderAttributionActive) {
              return original.apply(this, methodArgs)
            }

            const counters = win.__replacerRenderAttributionCounters
            const startedAt = performance.now()
            try {
              return original.apply(this, methodArgs)
            } finally {
              counters.minimapCanvasCalls++
              counters.minimapCanvasMs += performance.now() - startedAt
              increment(counters.minimapCanvasMethods, method)
            }
          }
        }

        ctx.__replacerRenderAttributionWrapped = true
        return ctx
      }
    }

    win.__replacerRenderAttributionStart = () => {
      const counters = createCounters()
      win.__replacerRenderAttributionCounters = counters
      win.__replacerRenderAttributionActive = true

      const canvas = win.app?.canvas
      if (canvas && !canvas.__replacerRenderOriginalDrawConnections) {
        canvas.__replacerRenderOriginalDrawConnections = canvas.drawConnections
        canvas.drawConnections = function (...args) {
          if (!win.__replacerRenderAttributionActive) {
            return canvas.__replacerRenderOriginalDrawConnections.apply(this, args)
          }

          return timeCall(
            win.__replacerRenderAttributionCounters,
            'drawConnectionsCalls',
            'drawConnectionsMs',
            () => canvas.__replacerRenderOriginalDrawConnections.apply(this, args)
          )
        }
      }

      if (canvas && !canvas.__replacerRenderOriginalComputeVisibleNodes) {
        canvas.__replacerRenderOriginalComputeVisibleNodes = canvas.computeVisibleNodes
        canvas.computeVisibleNodes = function (...args) {
          if (!win.__replacerRenderAttributionActive) {
            return canvas.__replacerRenderOriginalComputeVisibleNodes.apply(this, args)
          }

          return timeCall(
            win.__replacerRenderAttributionCounters,
            'computeVisibleNodesCalls',
            'computeVisibleNodesMs',
            () => canvas.__replacerRenderOriginalComputeVisibleNodes.apply(this, args)
          )
        }
      }

      if (canvas && !canvas.__replacerRenderOriginalSetDirty) {
        canvas.__replacerRenderOriginalSetDirty = canvas.setDirty
        canvas.setDirty = function (foreground, background) {
          if (win.__replacerRenderAttributionActive) {
            if (foreground) counters.setDirtyForegroundCalls++
            if (background) counters.setDirtyBackgroundCalls++
            if (foreground && background) counters.setDirtyBothCalls++
          }

          return canvas.__replacerRenderOriginalSetDirty.call(
            this,
            foreground,
            background
          )
        }
      }

      const sample = () => {
        if (!win.__replacerRenderAttributionActive) return
        counters.frameSamples++
        counters.mountedSamples.push(document.querySelectorAll('[data-node-id]').length)
        win.__replacerRenderAttributionRaf = requestAnimationFrame(sample)
      }
      win.__replacerRenderAttributionRaf = requestAnimationFrame(sample)
    }

    win.__replacerRenderAttributionStop = () => {
      win.__replacerRenderAttributionActive = false
      if (win.__replacerRenderAttributionRaf) {
        cancelAnimationFrame(win.__replacerRenderAttributionRaf)
      }

      const counters = win.__replacerRenderAttributionCounters
      const mounted = counters.mountedSamples
      return {
        ...counters,
        mountedSamples: undefined,
        mountedMin: mounted.length ? Math.min(...mounted) : 0,
        mountedMax: mounted.length ? Math.max(...mounted) : 0,
        mountedAverage: mounted.length
          ? mounted.reduce((sum, value) => sum + value, 0) / mounted.length
          : 0,
        minimapCanvasMethods: Object.entries(counters.minimapCanvasMethods)
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => ({ key, count }))
      }
    }
  })
}

async function findDenseTargetNode(page) {
  return page.evaluate(() => {
    const nodes = window.app.graph?._nodes ?? []
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
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.waitForTimeout(500)
}

async function findPanPoint(page) {
  return page.evaluate(() => {
    for (const y of [500, 650, 800, 350, 200, 900]) {
      for (const x of [800, 1100, 1400, 500, 250, 1500]) {
        const top = document.elementsFromPoint(x, y)[0]
        if (top?.id === 'graph-canvas') return { x, y }
      }
    }
    return { x: Math.floor(innerWidth * 0.9), y: Math.floor(innerHeight * 0.9) }
  })
}

async function measurePan(page, label) {
  const point = await findPanPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.evaluate(() => window.__replacerRenderAttributionStart())
  const startedAt = Date.now()
  await page.mouse.down()
  await page.mouse.move(point.x + 220, point.y + 110, { steps: 24 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const counters = await page.evaluate(() => window.__replacerRenderAttributionStop())
  return {
    label,
    point,
    elapsedMs: Date.now() - startedAt,
    counters
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const consoleMessages = []

  page.on('console', (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text().slice(0, 1000)
    })
  })

  const startedAt = Date.now()
  await page.goto(`${url.replace(/\/$/, '')}/api/users`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000
  })
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('Comfy.userId', 'default')
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await waitForAppReady(page)
  const appReadyMs = Date.now() - startedAt

  const workflowStartedAt = Date.now()
  await page.locator('#comfy-file-input').setInputFiles(workflowPath)
  await waitForWorkflowNodes(page)
  await page.waitForTimeout(5000)
  const workflowLoadMs = Date.now() - workflowStartedAt

  await installAttribution(page)
  const targetNodeId = await findDenseTargetNode(page)
  const initialInfo = await getGraphInfo(page)
  const results = []

  for (const scenario of scenarios) {
    await focusGraph(page, scenario.scale, targetNodeId)
    const before = await getGraphInfo(page)
    const pan = await measurePan(page, `${scenario.label}:pan`)
    const after = await getGraphInfo(page)
    results.push({ ...scenario, before, pan, after })
  }

  const output = {
    url,
    workflowPath,
    appReadyMs,
    workflowLoadMs,
    totalMs: Date.now() - startedAt,
    targetNodeId,
    initialInfo,
    results,
    consoleSummary: consoleMessages.reduce((acc, message) => {
      const key = `${message.type}: ${message.text.slice(0, 120)}`
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error && (error.stack || error.message || String(error)))
  process.exit(1)
})
