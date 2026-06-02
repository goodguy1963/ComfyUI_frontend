export interface PanSnapshotCamera {
  x: number
  y: number
  z: number
}

export interface PanSnapshotViewport {
  width: number
  height: number
}

export interface PanSnapshotNode {
  id: string | number
  x: number
  y: number
  width: number
  height: number
  title: string
  color?: string
  bgcolor?: string
  collapsed?: boolean
  selected?: boolean
  executing?: boolean
  hasErrors?: boolean
}

export interface PanSnapshotDrawNode {
  id: string | number
  title: string
  x: number
  y: number
  width: number
  height: number
  radius: number
  titleHeight: number
  headerFill: string
  bodyFill: string
  stroke: string
  titleColor: string
}

export interface PanSnapshotDeltaTransform {
  scale: number
  translateX: number
  translateY: number
}

const OFFSCREEN_PADDING_PX = 96
const MIN_VISIBLE_NODE_SIZE_PX = 6
const DEFAULT_HEADER_FILL = '#334155'
const DEFAULT_BODY_FILL = '#1f2937'
const DEFAULT_STROKE = 'rgba(148, 163, 184, 0.45)'
const DEFAULT_ERROR_STROKE = 'rgba(248, 113, 113, 0.85)'
const DEFAULT_ACTIVE_STROKE = 'rgba(96, 165, 250, 0.9)'
const DEFAULT_TITLE_COLOR = 'rgba(248, 250, 252, 0.96)'

function isNodeVisibleInViewport(
  x: number,
  y: number,
  width: number,
  height: number,
  viewport: PanSnapshotViewport
): boolean {
  return !(
    x + width < -OFFSCREEN_PADDING_PX ||
    y + height < -OFFSCREEN_PADDING_PX ||
    x > viewport.width + OFFSCREEN_PADDING_PX ||
    y > viewport.height + OFFSCREEN_PADDING_PX
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function buildStroke(node: PanSnapshotNode): string {
  if (node.hasErrors) {
    return DEFAULT_ERROR_STROKE
  }

  if (node.selected || node.executing) {
    return DEFAULT_ACTIVE_STROKE
  }

  return DEFAULT_STROKE
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2))

  ctx.beginPath()
  ctx.moveTo(x + safeRadius, y)
  ctx.lineTo(x + width - safeRadius, y)
  ctx.arcTo(x + width, y, x + width, y + safeRadius, safeRadius)
  ctx.lineTo(x + width, y + height - safeRadius)
  ctx.arcTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height,
    safeRadius
  )
  ctx.lineTo(x + safeRadius, y + height)
  ctx.arcTo(x, y + height, x, y + height - safeRadius, safeRadius)
  ctx.lineTo(x, y + safeRadius)
  ctx.arcTo(x, y, x + safeRadius, y, safeRadius)
  ctx.closePath()
}

function fitSnapshotTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
  maxWidth: number
): string {
  if (!title || maxWidth <= 0) {
    return ''
  }

  if (ctx.measureText(title).width <= maxWidth) {
    return title
  }

  const ellipsis = '...'
  let truncated = title

  while (truncated.length > 1) {
    truncated = truncated.slice(0, -1)
    const candidate = `${truncated}${ellipsis}`
    if (ctx.measureText(candidate).width <= maxWidth) {
      return candidate
    }
  }

  return ellipsis
}

export function buildPanSnapshotPlan(
  nodes: PanSnapshotNode[],
  camera: PanSnapshotCamera,
  viewport: PanSnapshotViewport
): PanSnapshotDrawNode[] {
  return nodes.flatMap((node) => {
    const width = node.width * camera.z
    const height = node.height * camera.z

    if (
      width < MIN_VISIBLE_NODE_SIZE_PX ||
      height < MIN_VISIBLE_NODE_SIZE_PX
    ) {
      return []
    }

    const x = (node.x + camera.x) * camera.z
    const y = (node.y + camera.y) * camera.z

    if (!isNodeVisibleInViewport(x, y, width, height, viewport)) {
      return []
    }

    const titleHeight = node.collapsed
      ? clamp(height, 12, 26)
      : clamp(height * 0.24, 16, 30)

    return [
      {
        id: node.id,
        title: node.title,
        x,
        y,
        width,
        height,
        radius: clamp(Math.min(width, height) * 0.08, 4, 14),
        titleHeight,
        headerFill: node.color ?? DEFAULT_HEADER_FILL,
        bodyFill: node.bgcolor ?? node.color ?? DEFAULT_BODY_FILL,
        stroke: buildStroke(node),
        titleColor: DEFAULT_TITLE_COLOR
      }
    ]
  })
}

export function getSnapshotDeltaTransform(
  startCamera: PanSnapshotCamera,
  currentCamera: PanSnapshotCamera
): PanSnapshotDeltaTransform {
  const scale = currentCamera.z / startCamera.z

  return {
    scale,
    translateX: currentCamera.z * (currentCamera.x - startCamera.x),
    translateY: currentCamera.z * (currentCamera.y - startCamera.y)
  }
}

export function drawPanSnapshot(
  ctx: CanvasRenderingContext2D,
  drawNodes: PanSnapshotDrawNode[],
  viewport: PanSnapshotViewport,
  devicePixelRatio = 1
) {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1
  const pixelWidth = Math.max(1, Math.round(viewport.width * dpr))
  const pixelHeight = Math.max(1, Math.round(viewport.height * dpr))

  if (ctx.canvas.width !== pixelWidth) {
    ctx.canvas.width = pixelWidth
  }
  if (ctx.canvas.height !== pixelHeight) {
    ctx.canvas.height = pixelHeight
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.scale(dpr, dpr)
  ctx.textBaseline = 'middle'

  for (const node of drawNodes) {
    drawRoundedRect(ctx, node.x, node.y, node.width, node.height, node.radius)
    ctx.fillStyle = node.bodyFill
    ctx.globalAlpha = 0.92
    ctx.fill()

    drawRoundedRect(
      ctx,
      node.x,
      node.y,
      node.width,
      node.titleHeight,
      node.radius
    )
    ctx.fillStyle = node.headerFill
    ctx.globalAlpha = 0.98
    ctx.fill()

    drawRoundedRect(ctx, node.x, node.y, node.width, node.height, node.radius)
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = node.stroke
    ctx.stroke()

    if (node.width >= 64) {
      ctx.fillStyle = node.titleColor
      ctx.font = `${clamp(node.titleHeight * 0.46, 10, 14)}px sans-serif`
      ctx.fillText(
        fitSnapshotTitle(ctx, node.title, node.width - 20),
        node.x + 10,
        node.y + node.titleHeight / 2,
        Math.max(0, node.width - 20)
      )
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
}