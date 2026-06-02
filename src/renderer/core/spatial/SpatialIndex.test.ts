import { describe, expect, it } from 'vitest'

import { SpatialIndexManager } from '@/renderer/core/spatial/SpatialIndex'

describe('SpatialIndexManager', () => {
  it('queries nodes outside the default QuadTree bounds', () => {
    const index = new SpatialIndexManager()

    index.insert('far-left-node', {
      x: -20_100,
      y: -3_000,
      width: 400,
      height: 300
    })

    expect(index.size).toBe(1)
    expect(
      index.query({ x: -20_200, y: -3_100, width: 800, height: 600 })
    ).toContain('far-left-node')
  })

  it('keeps out-of-bounds nodes queryable after batch updates', () => {
    const index = new SpatialIndexManager()

    index.insert('node', { x: 100, y: 100, width: 100, height: 100 })
    index.batchUpdate([
      {
        nodeId: 'node',
        bounds: { x: -20_100, y: -3_000, width: 400, height: 300 }
      }
    ])

    expect(index.size).toBe(1)
    expect(
      index.query({ x: -20_200, y: -3_100, width: 800, height: 600 })
    ).toContain('node')
  })

  it('ignores updates for unknown nodes', () => {
    const index = new SpatialIndexManager()

    index.update('unknown-node', { x: -20_100, y: 0, width: 100, height: 100 })
    index.batchUpdate([
      {
        nodeId: 'unknown-batch-node',
        bounds: { x: -20_100, y: 0, width: 100, height: 100 }
      }
    ])

    expect(index.size).toBe(0)
    expect(index.query({ x: -20_200, y: -100, width: 300, height: 300 })).toEqual(
      []
    )
  })
})