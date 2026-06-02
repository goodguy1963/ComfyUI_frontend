import type { VueNodeData } from '@/composables/graph/useGraphNodeManager'
import type { Bounds } from '@/renderer/core/layout/types'

export const VUE_NODE_VIEWPORT_OVERSCAN = 0.08
export const VUE_NODE_VIEWPORT_EXIT_OVERSCAN = 0.18
export const VUE_NODE_VIEWPORT_FAST_PAN_OVERSCAN = 0.16
export const VUE_NODE_VIEWPORT_MAX_OVERSCAN_VELOCITY = 6

export type ViewportNodeBoundsProvider = (nodeId: string) => Bounds | null

export interface VueNodeViewportBounds {
  spatialQueryBounds: Bounds
  fallbackBounds: Bounds
}

function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  )
}

function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height)
  )
}

export function getViewportNodeIdsWithLiteGraphFallback(
  orderedNodes: VueNodeData[],
  viewportNodeIds: Iterable<string>,
  fallbackBounds: Bounds,
  getNodeBounds: ViewportNodeBoundsProvider,
  fallbackCandidateNodeIds?: Iterable<string>
): string[] {
  const mountedNodeIds = new Set<string>()

  for (const nodeId of viewportNodeIds) {
    mountedNodeIds.add(nodeId)
  }

  const fallbackNodeIds =
    fallbackCandidateNodeIds ?? orderedNodes.map((nodeData) => nodeData.id)

  for (const nodeId of fallbackNodeIds) {
    if (mountedNodeIds.has(nodeId)) continue

    const nodeBounds = getNodeBounds(nodeId)
    if (!nodeBounds || !isFiniteBounds(nodeBounds)) continue

    if (boundsIntersect(nodeBounds, fallbackBounds)) {
      mountedNodeIds.add(nodeId)
    }
  }

  return Array.from(mountedNodeIds)
}

export function getVueNodeViewportBounds(
  viewportBounds: Bounds,
  liteGraphVisibleBounds: Bounds | null
): VueNodeViewportBounds {
  return {
    spatialQueryBounds: liteGraphVisibleBounds ?? viewportBounds,
    fallbackBounds: viewportBounds
  }
}

export function getVelocityAwareViewportOverscan(
  baseOverscan: number,
  viewportVelocity: number,
  maxOverscan = VUE_NODE_VIEWPORT_FAST_PAN_OVERSCAN,
  maxVelocity = VUE_NODE_VIEWPORT_MAX_OVERSCAN_VELOCITY
): number {
  if (!Number.isFinite(viewportVelocity) || viewportVelocity <= 0) {
    return baseOverscan
  }

  if (maxVelocity <= 0) return maxOverscan

  const ratio = Math.min(1, viewportVelocity / maxVelocity)
  return baseOverscan + (maxOverscan - baseOverscan) * ratio
}

export function getOrderedMountedVueNodes(
  orderedNodes: VueNodeData[],
  viewportNodeIds: Iterable<string>,
  stickyNodeIds: Iterable<string> = []
): VueNodeData[] {
  const mountedNodeIds = new Set<string>()

  for (const nodeId of viewportNodeIds) {
    mountedNodeIds.add(nodeId)
  }

  for (const nodeId of stickyNodeIds) {
    mountedNodeIds.add(nodeId)
  }

  return orderedNodes.filter((nodeData) => mountedNodeIds.has(nodeData.id))
}

export function updateMountedVueNodeRegistry(
  registry: Map<string, VueNodeData>,
  orderedNodes: VueNodeData[],
  mountedNodeIds: Iterable<string>
): VueNodeData[] {
  const nextMountedNodeIds = new Set(mountedNodeIds)

  for (const nodeId of registry.keys()) {
    if (!nextMountedNodeIds.has(nodeId)) {
      registry.delete(nodeId)
    }
  }

  const orderedMountedNodes: VueNodeData[] = []

  for (const nodeData of orderedNodes) {
    if (!nextMountedNodeIds.has(nodeData.id)) continue

    registry.set(nodeData.id, nodeData)
    orderedMountedNodes.push(nodeData)
  }

  return orderedMountedNodes
}

export function getHysteresisMountedNodeIds(
  previousMountedNodeIds: Iterable<string>,
  enterNodeIds: Iterable<string>,
  exitNodeIds: Iterable<string>,
  stickyNodeIds: Iterable<string> = []
): string[] {
  const enter = new Set(enterNodeIds)
  const exit = new Set(exitNodeIds)
  const sticky = new Set(stickyNodeIds)
  const mounted = new Set<string>()

  for (const nodeId of enter) {
    mounted.add(nodeId)
  }

  for (const nodeId of previousMountedNodeIds) {
    if (exit.has(nodeId)) {
      mounted.add(nodeId)
    }
  }

  for (const nodeId of sticky) {
    mounted.add(nodeId)
  }

  return Array.from(mounted)
}
