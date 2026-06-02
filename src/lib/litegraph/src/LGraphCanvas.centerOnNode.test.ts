import { fromAny } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

import { LGraph, LGraphCanvas, LGraphNode } from '@/lib/litegraph/src/litegraph'

function createCanvas(graph: LGraph): LGraphCanvas {
  const el = document.createElement('canvas')
  el.width = 800
  el.height = 600

  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 50 }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    roundRect: vi.fn(),
    getTransform: vi
      .fn()
      .mockReturnValue({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline
  } satisfies Partial<CanvasRenderingContext2D>

  el.getContext = vi
    .fn()
    .mockReturnValue(fromAny<CanvasRenderingContext2D, unknown>(ctx))
  el.getBoundingClientRect = vi.fn().mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600
  })

  return new LGraphCanvas(el, graph, { skip_render: true, skip_events: true })
}

class TestNode extends LGraphNode {
  constructor() {
    super('test')
  }
}

describe('LGraphCanvas.centerOnNode', () => {
  it('dispatches the centered node id on the canvas element', () => {
    const graph = new LGraph()
    const canvas = createCanvas(graph)
    const node = new TestNode()
    node.pos = [1200, 600]
    node.size = [180, 120]
    graph.add(node)

    const handler = vi.fn()
    canvas.canvas.addEventListener(
      'litegraph:center-on-node',
      handler as EventListener
    )

    canvas.centerOnNode(node)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(
      (handler.mock.calls[0][0] as CustomEvent<{ nodeId: string | number }>).detail
    ).toEqual({ nodeId: node.id })
  })
})