export type ActivePanDetailLevel = 'none' | 'middle' | 'close'

export const FAR_ZOOM_CANVAS_ENTER_SCALE = 0.16
export const FAR_ZOOM_CANVAS_EXIT_SCALE = 0.22

export const ACTIVE_PAN_MIDDLE_ENTER_SCALE = 0.35
export const ACTIVE_PAN_MIDDLE_TO_CLOSE_SCALE = 0.39
export const ACTIVE_PAN_CLOSE_TO_MIDDLE_SCALE = 0.31
export const ACTIVE_PAN_CLOSE_ENTER_SCALE = 0.65
export const ACTIVE_PAN_CLOSE_EXIT_SCALE = 0.72

export function resolveFarZoomCanvasMode(options: {
  scale: number
  previous: boolean
  vueNodesEnabled: boolean
}): boolean {
  const { scale, previous, vueNodesEnabled } = options
  if (!vueNodesEnabled) return false

  if (previous) {
    return scale < FAR_ZOOM_CANVAS_EXIT_SCALE
  }

  return scale <= FAR_ZOOM_CANVAS_ENTER_SCALE
}

export function resolveActivePanDetail(options: {
  scale: number
  previous: ActivePanDetailLevel
  isCanvasPanning: boolean
  farZoomCanvasActive: boolean
}): ActivePanDetailLevel {
  const { scale, previous, isCanvasPanning, farZoomCanvasActive } = options

  if (!isCanvasPanning || farZoomCanvasActive) {
    return 'none'
  }

  if (previous === 'middle') {
    if (scale > ACTIVE_PAN_MIDDLE_TO_CLOSE_SCALE) return 'close'
    return 'middle'
  }

  if (previous === 'close') {
    if (scale < ACTIVE_PAN_CLOSE_TO_MIDDLE_SCALE) return 'middle'
    if (scale > ACTIVE_PAN_CLOSE_EXIT_SCALE) return 'none'
    return 'close'
  }

  if (scale <= ACTIVE_PAN_MIDDLE_ENTER_SCALE) return 'middle'
  if (scale <= ACTIVE_PAN_CLOSE_ENTER_SCALE) return 'close'
  return 'none'
}
