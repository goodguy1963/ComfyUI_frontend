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

function collectFiles(args) {
  if (args.length === 0) {
    throw new Error('Usage: node scripts/replacer-probe-stats.cjs path-or-glob [...]')
  }

  const files = []
  for (const arg of args) {
    if (arg.includes('*')) {
      const dir = path.dirname(arg)
      const pattern = path.basename(arg).replace(/\./g, '\\.').replace(/\*/g, '.*')
      const matcher = new RegExp(`^${pattern}$`)
      for (const entry of fs.readdirSync(dir)) {
        if (matcher.test(entry)) files.push(path.join(dir, entry))
      }
      continue
    }

    files.push(arg)
  }

  return [...new Set(files)].sort()
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return null
  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))]
}

function summarize(values) {
  const numericValues = values
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b)

  if (numericValues.length === 0) {
    return { count: 0, min: null, median: null, p95: null, max: null }
  }

  return {
    count: numericValues.length,
    min: numericValues[0],
    median: percentile(numericValues, 50),
    p95: percentile(numericValues, 95),
    max: numericValues[numericValues.length - 1]
  }
}

function formatValue(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return '-'
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function renderMarkdown(files, samples) {
  const validSamples = samples.filter((sample) => sample.initialInfo?.nodes > 0)
  const lines = [
    `Samples: ${validSamples.length}/${samples.length} valid Replacer graphs`,
    '',
    '| Metric | n | min | median | p95 | max |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'
  ]

  for (const [, label, reader] of METRICS) {
    const stats = summarize(validSamples.map(reader))
    lines.push(
      `| ${label} | ${stats.count} | ${formatValue(stats.min)} | ${formatValue(
        stats.median
      )} | ${formatValue(stats.p95)} | ${formatValue(stats.max)} |`
    )
  }

  lines.push('', 'Files:')
  for (const file of files) lines.push(`- ${file}`)

  return lines.join('\n')
}

try {
  const files = collectFiles(process.argv.slice(2))
  const samples = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
  process.stdout.write(`${renderMarkdown(files, samples)}\n`)
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}
