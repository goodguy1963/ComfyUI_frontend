import { describe, expect, it, vi } from 'vitest'

import {
  buildPanSnapshotPlan,
  drawPanSnapshot,
  getSnapshotDeltaTransform,
  type PanSnapshotCamera,
  type PanSnapshotDrawNode,
  type PanSnapshotNode
} from './panSnapshotCanvas'

function createMockCanvasContext() {
  return {
    canvas: { width: 1, height: 1 },
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    textBaseline: '',
    fillStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: '',
    font: ''
  } as unknown as CanvasRenderingContext2D & {
    fillText: ReturnType<typeof vi.fn>
  }
}

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
      bodyFill: '#334455',
      showTitle: true
    })
    expect(node.titleHeight).toBeLessThanOrEqual(22)
  })

  it('hides titles and keeps compact headers at very far zoom', () => {
    const camera: PanSnapshotCamera = { x: 0, y: 0, z: 0.1 }
    const nodes: PanSnapshotNode[] = [
      {
        id: 'large',
        title: 'Very Large Node Title',
        x: 10,
        y: 10,
        width: 1200,
        height: 500
      }
    ]

    const [node] = buildPanSnapshotPlan(nodes, camera, {
      width: 1280,
      height: 720
    })

    expect(node.showTitle).toBe(false)
    expect(node.titleHeight).toBeLessThanOrEqual(7)
  })

  it('falls back from black or transparent snapshot fills', () => {
    const camera: PanSnapshotCamera = { x: 0, y: 0, z: 0.5 }
    const nodes: PanSnapshotNode[] = [
      {
        id: 'dark',
        title: 'Dark',
        x: 10,
        y: 10,
        width: 240,
        height: 160,
        color: '#000000',
        bgcolor: 'transparent'
      }
    ]

    const [node] = buildPanSnapshotPlan(nodes, camera, {
      width: 1280,
      height: 720
    })

    expect(node.headerFill).toBe('#334155')
    expect(node.bodyFill).toBe('#1f2937')
  })

  it('does not draw title text for far-zoom compact nodes', () => {
    const ctx = createMockCanvasContext()
    const node: PanSnapshotDrawNode = {
      id: 'far',
      title: 'Far Node',
      x: 10,
      y: 10,
      width: 120,
      height: 50,
      radius: 4,
      titleHeight: 5,
      headerFill: '#334155',
      bodyFill: '#1f2937',
      stroke: 'rgba(148, 163, 184, 0.45)',
      titleColor: 'white',
      showTitle: false,
      titleFontSize: 9
    }

    drawPanSnapshot(ctx, [node], { width: 300, height: 200 }, 1)

    expect(ctx.fillText).not.toHaveBeenCalled()
    expect(ctx.fillRect).toHaveBeenCalled()
    expect(ctx.strokeRect).toHaveBeenCalled()
    expect(ctx.beginPath).not.toHaveBeenCalled()
  })

  it('draws title text when snapshot title is enabled', () => {
    const ctx = createMockCanvasContext()
    const node: PanSnapshotDrawNode = {
      id: 'mid',
      title: 'Readable Node',
      x: 10,
      y: 10,
      width: 160,
      height: 80,
      radius: 4,
      titleHeight: 18,
      headerFill: '#334155',
      bodyFill: '#1f2937',
      stroke: 'rgba(148, 163, 184, 0.45)',
      titleColor: 'white',
      showTitle: true,
      titleFontSize: 11
    }

    drawPanSnapshot(ctx, [node], { width: 300, height: 200 }, 1)

    expect(ctx.fillText).toHaveBeenCalledWith(
      'Readable Node',
      20,
      19,
      140
    )
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
