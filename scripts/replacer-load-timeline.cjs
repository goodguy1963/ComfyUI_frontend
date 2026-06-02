#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { chromium } = require('@playwright/test')

const url = process.env.PLAYWRIGHT_TEST_URL || 'http://127.0.0.1:5274/'
const workflowPath =
  process.env.REPLACER_WORKFLOW_PATH ||
  'F:\\ComfyUI_DEV_windows_portable_nvidia\\ComfyUI_DEV_windows_portable\\ComfyUI\\user\\default\\workflows\\replacer creative i2v stable Parted 2.8_dev.json'
const outPath =
  process.env.REPLACER_LOAD_TIMELINE_OUT ||
  path.join('output_sessions', `replacer-load-timeline-${Date.now()}.json`)

function elapsed(startedAt) {
  return Date.now() - startedAt
}

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

async function graphState(page) {
  return page.evaluate(() => ({
    busy: Boolean(window.app?.extensionManager?.workflow?.isBusy),
    graphNodes: window.app?.graph?._nodes?.length ?? 0,
    canvasNodes: window.app?.canvas?.graph?._nodes?.length ?? 0,
    mountedNodes: document.querySelectorAll('[data-node-id]').length,
    farZoomCanvas: Boolean(document.querySelector('[data-testid="far-zoom-node-canvas"]')),
    scale: window.app?.canvas?.ds?.scale ?? null
  }))
}

async function waitForMark(page, predicate, timeoutMs = 90_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const state = await graphState(page)
    if (predicate(state)) return state
    await page.waitForTimeout(100)
  }
  throw new Error('Timed out waiting for load timeline mark')
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const startedAt = Date.now()
  const marks = []

  const mark = async (name) => {
    marks.push({
      name,
      ms: elapsed(startedAt),
      state: await graphState(page)
    })
  }

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
  await mark('app-ready')

  await page.locator('#comfy-file-input').setInputFiles(workflowPath)
  await mark('workflow-file-submitted')

  await waitForMark(page, (state) => state.graphNodes > 0 || state.canvasNodes > 0)
  await mark('first-graph-nodes')

  await waitForMark(page, (state) => state.mountedNodes > 0 || state.farZoomCanvas)
  await mark('first-render-surface')

  await waitForMark(page, (state) => !state.busy)
  await mark('workflow-idle')

  await page.waitForTimeout(5000)
  await mark('settled-5s')

  const output = {
    url,
    workflowPath,
    totalMs: elapsed(startedAt),
    marks
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
