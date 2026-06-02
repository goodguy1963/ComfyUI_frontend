export type LayoutPerfCounterName =
  | 'layoutOperations'
  | 'yjsTransactions'
  | 'changedNodeIds'
  | 'nodeRefTriggers'
  | 'globalChangeDispatches'
  | 'nodeChangeDispatches'
  | 'syncScheduledMicrotasks'
  | 'syncScheduledRafs'
  | 'syncFlushes'
  | 'syncFlushedNodeIds'
  | 'syncDirtyForeground'
  | 'syncDirtyBackground'
  | 'syncDirtyBoth'
  | 'syncSkippedCanvasSource'

export type LayoutPerfCounters = Record<LayoutPerfCounterName, number>

interface LayoutPerfState {
  active: boolean
  counters: LayoutPerfCounters
}

export interface LayoutPerfApi {
  start: () => LayoutPerfCounters
  stop: () => LayoutPerfCounters
  reset: () => LayoutPerfCounters
  snapshot: () => LayoutPerfCounters
  isActive: () => boolean
}

const COUNTER_NAMES: LayoutPerfCounterName[] = [
  'layoutOperations',
  'yjsTransactions',
  'changedNodeIds',
  'nodeRefTriggers',
  'globalChangeDispatches',
  'nodeChangeDispatches',
  'syncScheduledMicrotasks',
  'syncScheduledRafs',
  'syncFlushes',
  'syncFlushedNodeIds',
  'syncDirtyForeground',
  'syncDirtyBackground',
  'syncDirtyBoth',
  'syncSkippedCanvasSource'
]

const GLOBAL_STATE_KEY = '__COMFY_LAYOUT_PERF_STATE__'
const GLOBAL_API_KEY = '__COMFY_LAYOUT_PERF__'

type LayoutPerfGlobal = typeof globalThis & {
  [GLOBAL_STATE_KEY]?: LayoutPerfState
  [GLOBAL_API_KEY]?: LayoutPerfApi
}

function createCounters(): LayoutPerfCounters {
  return Object.fromEntries(
    COUNTER_NAMES.map((name) => [name, 0])
  ) as LayoutPerfCounters
}

function getGlobal(): LayoutPerfGlobal {
  return globalThis as LayoutPerfGlobal
}

function getState(): LayoutPerfState {
  const global = getGlobal()
  global[GLOBAL_STATE_KEY] ??= {
    active: false,
    counters: createCounters()
  }
  return global[GLOBAL_STATE_KEY]
}

export function getLayoutPerfApi(): LayoutPerfApi {
  const global = getGlobal()
  if (global[GLOBAL_API_KEY]) {
    return global[GLOBAL_API_KEY]
  }

  const api: LayoutPerfApi = {
    start: () => {
      const state = getState()
      state.counters = createCounters()
      state.active = true
      return { ...state.counters }
    },
    stop: () => {
      const state = getState()
      state.active = false
      return { ...state.counters }
    },
    reset: () => {
      const state = getState()
      state.counters = createCounters()
      return { ...state.counters }
    },
    snapshot: () => ({ ...getState().counters }),
    isActive: () => getState().active
  }

  global[GLOBAL_API_KEY] = api
  return api
}

export function recordLayoutPerfCounter(
  name: LayoutPerfCounterName,
  count = 1
) {
  const state = getState()
  if (!state.active) return

  state.counters[name] += count
}

getLayoutPerfApi()
