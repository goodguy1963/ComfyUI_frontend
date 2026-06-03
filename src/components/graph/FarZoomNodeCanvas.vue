<template>
  <canvas
    ref="canvasRef"
    data-testid="far-zoom-node-canvas"
    class="pointer-events-none absolute inset-0 size-full"
  />
</template>

<script setup lang="ts">
import { useRafFn } from '@vueuse/core'
import { ref } from 'vue'

import type { LGraphCanvas } from '@/lib/litegraph/src/LGraphCanvas'
import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import {
  buildPanSnapshotPlan,
  drawPanSnapshot,
  type PanSnapshotNode
} from '@/renderer/core/layout/transform/panSnapshotCanvas'
import { useTransformState } from '@/renderer/core/layout/transform/useTransformState'

const { canvas } = defineProps<{
  canvas: LGraphCanvas
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const { camera, syncWithCanvas } = useTransformState()

function toSnapshotNode(node: LGraphNode): PanSnapshotNode | null {
  const [x, y] = node.pos ?? []
  const [width, height] = node.size ?? []

  if (![x, y, width, height].every(Number.isFinite)) {
    return null
  }

  return {
    id: node.id,
    x,
    y,
    width,
    height,
    title: node.title ?? '',
    color: node.color,
    bgcolor: node.bgcolor,
    collapsed: node.flags?.collapsed,
    selected: node.selected,
    executing: Boolean(node.graph?.nodes_executing?.[Number(node.id)]),
    hasErrors: node.has_errors
  }
}

useRafFn(
  () => {
    const el = canvasRef.value
    const mainCanvas = canvas.canvas
    const ctx = el?.getContext('2d')
    if (!el || !mainCanvas || !ctx) return

    syncWithCanvas(canvas)

    const viewport = {
      width: mainCanvas.clientWidth || mainCanvas.width,
      height: mainCanvas.clientHeight || mainCanvas.height
    }

    const nodes = (canvas.graph?._nodes ?? [])
      .map(toSnapshotNode)
      .filter((node): node is PanSnapshotNode => node !== null)
    const drawNodes = buildPanSnapshotPlan(nodes, camera, viewport)

    drawPanSnapshot(ctx, drawNodes, viewport, window.devicePixelRatio)
  },
  { immediate: true }
)
</script>
