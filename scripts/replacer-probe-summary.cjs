#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const METRICS = [
  ['appReadyMs', 'App ready', (data) => data.appReadyMs],
  ['workflowLoadMs', 'Workflow load', (data) => data.workflowLoadMs],
  ['totalMs', 'Probe total', (data) => data.totalMs],
  ['farMounted', 'Far mounted nodes', (data) => readScenario(data, 'far')?.before?.mounted],
  ['farPanMs', 'Far pan', (data) => readScenario(data, 'far')?.pan?.actionToPaintMs],
  ['farWheelMs', 'Far wheel', (data) => readScenario(data, 'far')?.wheel?.actionToPaintMs],
  ['middleMounted', 'Middle mounted nodes', (data) => readScenario(data, 'middle')?.before?.mounted],
  ['middlePanMs', 'Middle pan', (data) => readScenario(data, 'middle')?.pan?.actionToPaintMs],
  ['middleWheelMs', 'Middle wheel', (data) => readScenario(data, 'middle')?.wheel?.actionToPaintMs],
  ['closeMounted', 'Close mounted nodes', (data) => readScenario(data, 'close')?.before?.mounted],
  ['closePanMs', 'Close pan', (data) => readScenario(data, 'close')?.pan?.actionToPaintMs],
  ['closeWheelMs', 'Close wheel', (data) => readScenario(data, 'close')?.wheel?.actionToPaintMs]
]

function readScenario(data, label) {
  return data.results?.find((result) => result.label === label)
}

function parseArgs(argv) {
  const entries = []

  for (const arg of argv) {
    const separator = arg.indexOf('=')
    if (separator <= 0) {
      throw new Error(`Expected arguments as label=path, got: ${arg}`)
    }

    entries.push({
      label: arg.slice(0, separator),
      filePath: arg.slice(separator + 1)
    })
  }

  if (entries.length === 0) {
    throw new Error(
      'Usage: node scripts/replacer-probe-summary.cjs label=probe.json [...]'
    )
  }

  return entries
}

function readEntry(entry) {
  const raw = fs.readFileSync(entry.filePath, 'utf8')
  return {
    ...entry,
    data: JSON.parse(raw)
  }
}

function formatValue(value) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return '-'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${value}` : value.toFixed(1)
  }

  return String(value)
}

function renderMarkdown(entries) {
  const header = ['| Metric |', ...entries.map((entry) => ` ${entry.label} |`)].join('')
  const divider = ['| --- |', ...entries.map(() => ' ---: |')].join('')
  const rows = METRICS.map(([, label, reader]) => {
    const values = entries.map((entry) => ` ${formatValue(reader(entry.data))} |`)
    return [`| ${label} |`, ...values].join('')
  })

  return [header, divider, ...rows].join('\n')
}

try {
  const entries = parseArgs(process.argv.slice(2)).map(readEntry)
  process.stdout.write(`${renderMarkdown(entries)}\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
