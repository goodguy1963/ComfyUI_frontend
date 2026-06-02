import { describe, expect, it } from 'vitest'

import {
  buildPanSnapshotPlan,
  getSnapshotDeltaTransform,
  type PanSnapshotCamera,
  type PanSnapshotNode
} from './panSnapshotCanvas'

describe('panSnapshotCanvas', () => {
  it('projects graph nodes into viewport screen coordinates', () => {
    const camera: PanSnapshotCamera = { x: 100, y: 40, z: 0.5 }
    const nodes: PanSnapshotNode[] = [
      {
        id: '7',
        title: 'KSampler',
        x: 200,
        y: 120,
        width: 240,
        height: 160,
        color: '#112233',
        bgcolor: '#334455'
      }
    ]

    const [node] = buildPanSnapshotPlan(nodes, camera, {
      width: 1280,
      height: 720
    })

    expect(node).toMatchObject({
      id: '7',
      x: 150,
      y: 80,
      width: 120,
      height: 80,
      headerFill: '#112233',
      bodyFill: '#334455'
    })
    expect(node.titleHeight).toBeGreaterThanOrEqual(16)
  })

  it('drops nodes that are too small or fully offscreen', () => {
    const camera: PanSnapshotCamera = { x: 0, y: 0, z: 0.1 }
    const nodes: PanSnapshotNode[] = [
      {
        id: 'tiny',
        title: 'Tiny',
        x: 10,
        y: 10,
        width: 20,
        height: 20
      },
      {
        id: 'offscreen',
        title: 'Offscreen',
        x: 30000,
        y: 30000,
        width: 200,
        height: 120
      }
    ]

    const plan = buildPanSnapshotPlan(nodes, camera, {
      width: 1280,
      height: 720
    })

    expect(plan).toEqual([])
  })

  it('computes the screen-space delta transform between snapshot start and live pan', () => {
    const delta = getSnapshotDeltaTransform(
      { x: 100, y: 50, z: 0.5 },
      { x: 112, y: 54, z: 0.65 }
    )

    expect(delta.scale).toBeCloseTo(1.3)
    expect(delta.translateX).toBeCloseTo(7.8)
    expect(delta.translateY).toBeCloseTo(2.6)
  })
})