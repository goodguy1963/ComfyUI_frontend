#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { chromium } = require('@playwright/test')

const url = process.env.PLAYWRIGHT_TEST_URL || 'http://127.0.0.1:5274/'
const workflowPath =
  process.env.REPLACER_WORKFLOW_PATH ||
  'F:\\ComfyUI_DEV_windows_portable_nvidia\\ComfyUI_DEV_windows_portable\\ComfyUI\\user\\default\\workflows\\replacer creative i2v stable Parted 2.8_dev.json'
const outPath =
  process.env.REPLACER_DOMRECT_ATTRIBUTION_OUT ||
  path.join('output_sessions', `replacer-domrect-attribution-${Date.now()}.json`)

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

async function waitForWorkflowIdle(page) {
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
    mountedNodes: document.querySelectorAll('[data-node-id]').length,
    farZoomCanvas: Boolean(document.querySelector('[data-testid="far-zoom-node-canvas"]')),
    scale: window.app?.canvas?.ds?.scale ?? null,
    offset: [...(window.app?.canvas?.ds?.offset ?? [0, 0])],
    activePanDetail: document.documentElement.getAttribute('active-pan-detail')
  }))
}

async function installDomRectAttribution(page) {
  await page.evaluate(() => {
    const win = window
    const counterKey = '__replacerDomRectAttributionCounters'

    const createCounters = () => ({
      getBoundingClientRectCalls: 0,
      elements: {},
      stacks: {},
      samples: []
    })

    const increment = (bucket, key) => {
      bucket[key] = (bucket[key] ?? 0) + 1
    }

    const topBuckets = (bucket, limit = 20) =>
      Object.entries(bucket)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({ key, count }))

    const elementLabel = (element) => {
      if (element instanceof HTMLElement) {
        if (element.dataset.slotKey) return `[data-slot-key] ${element.tagName.toLowerCase()}`
        if (element.dataset.nodeId) return `[data-node-id] ${element.tagName.toLowerCase()}`
        if (element.dataset.testid) {
          return `[data-testid="${element.dataset.testid}"]`
        }
      }

      if (element.id) return `#${element.id}`

      const className =
        element instanceof HTMLElement && typeof element.className === 'string'
          ? element.className.trim().split(/\s+/).slice(0, 3).join('.')
          : ''

      return className
        ? `${element.tagName.toLowerCase()}.${className}`
        : element.tagName.toLowerCase()
    }

    const stackLabel = () => {
      const stack = new Error().stack ?? ''
      const lines = stack
        .split('\n')
        .slice(2)
        .map((line) => line.trim())
        .filter(
          (line) =>
            line &&
            !line.includes('__replacerDomRectAttribution') &&
            !line.includes('stackLabel') &&
            !line.includes('getBoundingClientRect')
        )

      return lines.slice(0, 5).join(' | ') || 'unknown'
    }

    win[counterKey] = createCounters()

    if (!win.__replacerDomRectOriginalGetBoundingClientRect) {
      win.__replacerDomRectOriginalGetBoundingClientRect =
        Element.prototype.getBoundingClientRect

      Element.prototype.getBoundingClientRect = function () {
        if (win.__replacerDomRectAttributionActive) {
          const counters = win[counterKey]
          counters.getBoundingClientRectCalls++
          increment(counters.elements, elementLabel(this))
          increment(counters.stacks, stackLabel())
        }

        return win.__replacerDomRectOriginalGetBoundingClientRect.call(this)
      }
    }

    win.__replacerDomRectAttributionStart = () => {
      win[counterKey] = createCounters()
      win.__replacerDomRectAttributionActive = true
    }

    win.__replacerDomRectAttributionSample = (label) => {
      const counters = win[counterKey]
      counters.samples.push({
        label,
        at: performance.now(),
        calls: counters.getBoundingClientRectCalls,
        mountedNodes: document.querySelectorAll('[data-node-id]').length,
        scale: win.app?.canvas?.ds?.scale ?? null,
        offset: [...(win.app?.canvas?.ds?.offset ?? [0, 0])]
      })
    }

    win.__replacerDomRectAttributionStop = () => {
      win.__replacerDomRectAttributionActive = false
      const counters = win[counterKey]
      return {
        getBoundingClientRectCalls: counters.getBoundingClientRectCalls,
        topElements: topBuckets(counters.elements),
        topStacks: topBuckets(counters.stacks),
        samples: counters.samples
      }
    }
  })
}

async function focusGraph(page, scale, targetNodeId) {
  await page.evaluate(
    ({ scale, targetNodeId }) => {
      const canvas = window.app.canvas
      canvas.ds.scale = scale
      const node = window.app.graph?._nodes?.find(
        (candidate) => String(candidate.id) === String(targetNodeId)
      )
      if (node) canvas.centerOnNode(node)
      canvas.setDirty(true, true)
    },
    { scale, targetNodeId }
  )
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  await page.waitForTimeout(500)
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

async function runPanAttribution(page, label) {
  const point = await findPanPoint(page)
  await page.mouse.move(point.x, point.y)
  await page.evaluate(() => window.__replacerDomRectAttributionStart())
  await page.evaluate(
    (sampleLabel) => window.__replacerDomRectAttributionSample(`${sampleLabel}:before`),
    label
  )
  await page.mouse.down()
  await page.mouse.move(point.x + 220, point.y + 110, { steps: 24 })
  await page.evaluate(
    (sampleLabel) => window.__replacerDomRectAttributionSample(`${sampleLabel}:during`),
    label
  )
  await page.mouse.up()
  await page.waitForTimeout(300)
  await page.evaluate(
    (sampleLabel) => window.__replacerDomRectAttributionSample(`${sampleLabel}:after`),
    label
  )
  const attribution = await page.evaluate(() =>
    window.__replacerDomRectAttributionStop()
  )

  return {
    point,
    attribution
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const consoleMessages = []
  const startedAt = Date.now()

  page.on('console', (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text().slice(0, 1000)
    })
  })

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
  await waitForWorkflowIdle(page)
  await page.waitForTimeout(5000)
  const workflowLoadMs = Date.now() - workflowStartedAt

  await installDomRectAttribution(page)

  const targetNodeId = await findDenseTargetNode(page)
  const initialInfo = await getGraphInfo(page)
  const results = []

  for (const scenario of scenarios) {
    await focusGraph(page, scenario.scale, targetNodeId)
    const before = await getGraphInfo(page)
    const pan = await runPanAttribution(page, `${scenario.label}:pan`)
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
