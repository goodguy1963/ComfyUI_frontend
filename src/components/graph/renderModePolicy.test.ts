import { describe, expect, it } from 'vitest'

import {
  resolveActivePanDetail,
  resolveFarZoomCanvasMode,
  type ActivePanDetailLevel
} from './renderModePolicy'

describe('renderModePolicy', () => {
  it('uses hysteresis for far zoom canvas mode', () => {
    expect(
      resolveFarZoomCanvasMode({
        scale: 0.17,
        previous: false,
        vueNodesEnabled: true
      })
    ).toBe(false)

    expect(
      resolveFarZoomCanvasMode({
        scale: 0.15,
        previous: false,
        vueNodesEnabled: true
      })
    ).toBe(true)

    expect(
      resolveFarZoomCanvasMode({
        scale: 0.2,
        previous: true,
        vueNodesEnabled: true
      })
    ).toBe(true)

    expect(
      resolveFarZoomCanvasMode({
        scale: 0.23,
        previous: true,
        vueNodesEnabled: true
      })
    ).toBe(false)
  })

  it('does not enter active pan LOD during wheel-only zoom transforms', () => {
    expect(
      resolveActivePanDetail({
        scale: 0.3,
        previous: 'none',
        isCanvasPanning: false,
        farZoomCanvasActive: false
      })
    ).toBe('none')
  })

  it('uses hysteresis between middle and close active pan detail', () => {
    const samples = [0.35, 0.37, 0.4, 0.36, 0.33, 0.29]
    let previous: ActivePanDetailLevel = 'none'
    const states = samples.map((scale) => {
      previous = resolveActivePanDetail({
        scale,
        previous,
        isCanvasPanning: true,
        farZoomCanvasActive: false
      })
      return previous
    })

    expect(states).toEqual([
      'middle',
      'middle',
      'close',
      'close',
      'close',
      'middle'
    ])
  })

  it('disables active pan LOD while the far zoom canvas is active', () => {
    expect(
      resolveActivePanDetail({
        scale: 0.12,
        previous: 'middle',
        isCanvasPanning: true,
        farZoomCanvasActive: true
      })
    ).toBe('none')
  })
})
