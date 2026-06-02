import { beforeEach, describe, expect, it } from 'vitest'

import {
  getLayoutPerfApi,
  recordLayoutPerfCounter
} from './layoutPerfInstrumentation'

describe('layoutPerfInstrumentation', () => {
  beforeEach(() => {
    getLayoutPerfApi().stop()
    getLayoutPerfApi().reset()
  })

  it('does not count while inactive', () => {
    recordLayoutPerfCounter('layoutOperations')

    expect(getLayoutPerfApi().snapshot().layoutOperations).toBe(0)
  })

  it('counts while active and returns a snapshot on stop', () => {
    const api = getLayoutPerfApi()
    api.start()

    recordLayoutPerfCounter('layoutOperations')
    recordLayoutPerfCounter('changedNodeIds', 3)

    const snapshot = api.stop()

    expect(snapshot.layoutOperations).toBe(1)
    expect(snapshot.changedNodeIds).toBe(3)
    expect(api.isActive()).toBe(false)
  })
})
