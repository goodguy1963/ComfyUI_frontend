import { describe, expect, it } from 'vitest'

import type { VueNodeData } from '@/composables/graph/useGraphNodeManager'

import {
  getHysteresisMountedNodeIds,
  getOrderedMountedVueNodes,
  getViewportNodeIdsWithLiteGraphFallback,
  getVueNodeViewportBounds,
  updateMountedVueNodeRegistry
} from './viewportMountedNodes'

function createNode(id: string): VueNodeData {
  return {
    id,
    title: id,
    type: 'TestNode',
    mode: 0,
    selected: false,
    executing: false
  }
}

describe('getOrderedMountedVueNodes', () => {
  it('preserves the existing node-manager render order', () => {
    const orderedNodes = [createNode('node-a'), createNode('node-b'), createNode('node-c')]

    const mountedNodes = getOrderedMountedVueNodes(orderedNodes, [
      'node-c',
      'node-a'
    ])

    expect(mountedNodes.map((node) => node.id)).toEqual(['node-a', 'node-c'])
  })

  it('keeps sticky nodes mounted even when outside the viewport query', () => {
    const orderedNodes = [createNode('node-a'), createNode('node-b'), createNode('node-c')]

    const mountedNodes = getOrderedMountedVueNodes(
      orderedNodes,
      ['node-a'],
      ['node-c']
    )

    expect(mountedNodes.map((node) => node.id)).toEqual(['node-a', 'node-c'])
  })

  it('adds visible LiteGraph nodes missed by the spatial query', () => {
    const orderedNodes = [createNode('left-node'), createNode('right-node')]

    const mountedNodeIds = getViewportNodeIdsWithLiteGraphFallback(
      orderedNodes,
      ['right-node'],
      { x: -500, y: -100, width: 1000, height: 600 },
      (nodeId) =>
        nodeId === 'left-node'
          ? { x: -320, y: 120, width: 220, height: 120 }
          : { x: 1600, y: 120, width: 220, height: 120 }
    )

    expect(mountedNodeIds).toEqual(['right-node', 'left-node'])
  })

  it('ignores non-finite LiteGraph bounds in the fallback path', () => {
    const orderedNodes = [createNode('bad-node')]

    const mountedNodeIds = getViewportNodeIdsWithLiteGraphFallback(
      orderedNodes,
      [],
      { x: -500, y: -100, width: 1000, height: 600 },
      () => ({ x: Number.NaN, y: 120, width: 220, height: 120 })
    )

    expect(mountedNodeIds).toEqual([])
  })

  it('limits fallback bounds checks to candidate node ids when provided', () => {
    const orderedNodes = [
      createNode('candidate-node'),
      createNode('uncandidate-node')
    ]
    const checkedNodeIds: string[] = []

    const mountedNodeIds = getViewportNodeIdsWithLiteGraphFallback(
      orderedNodes,
      [],
      { x: -500, y: -100, width: 1000, height: 600 },
      (nodeId) => {
        checkedNodeIds.push(nodeId)
        return { x: -320, y: 120, width: 220, height: 120 }
      },
      ['candidate-node']
    )

    expect(checkedNodeIds).toEqual(['candidate-node'])
    expect(mountedNodeIds).toEqual(['candidate-node'])
  })
})

describe('getVueNodeViewportBounds', () => {
  it('keeps the transform viewport as the fallback even when LiteGraph supplies query bounds', () => {
    const viewportBounds = { x: -500, y: -100, width: 1000, height: 600 }
    const liteGraphVisibleBounds = { x: 0, y: -100, width: 500, height: 600 }

    expect(
      getVueNodeViewportBounds(viewportBounds, liteGraphVisibleBounds)
    ).toEqual({
      spatialQueryBounds: liteGraphVisibleBounds,
      fallbackBounds: viewportBounds
    })
  })

  it('uses transform viewport bounds for both paths when LiteGraph bounds are unavailable', () => {
    const viewportBounds = { x: -500, y: -100, width: 1000, height: 600 }

    expect(getVueNodeViewportBounds(viewportBounds, null)).toEqual({
      spatialQueryBounds: viewportBounds,
      fallbackBounds: viewportBounds
    })
  })
})

describe('updateMountedVueNodeRegistry', () => {
  it('applies enter and leave deltas while preserving render order', () => {
    const registry = new Map<string, VueNodeData>([
      ['old-node', createNode('old-node')],
      ['node-b', createNode('stale-node-b')]
    ])
    const orderedNodes = [
      createNode('node-a'),
      createNode('node-b'),
      createNode('node-c')
    ]

    const mountedNodes = updateMountedVueNodeRegistry(registry, orderedNodes, [
      'node-c',
      'node-a'
    ])

    expect(mountedNodes.map((node) => node.id)).toEqual(['node-a', 'node-c'])
    expect([...registry.keys()]).toEqual(['node-a', 'node-c'])
  })

  it('updates existing entries when node data objects are replaced', () => {
    const previousNode = createNode('node-a')
    const nextNode = createNode('node-a')
    const registry = new Map<string, VueNodeData>([['node-a', previousNode]])

    const mountedNodes = updateMountedVueNodeRegistry(registry, [nextNode], [
      'node-a'
    ])

    expect(mountedNodes).toEqual([nextNode])
    expect(registry.get('node-a')).toBe(nextNode)
  })
})

describe('getHysteresisMountedNodeIds', () => {
  it('keeps previous nodes mounted while they remain inside the exit window', () => {
    expect(
      getHysteresisMountedNodeIds(['a', 'b'], ['c'], ['b', 'c'])
    ).toEqual(['c', 'b'])
  })

  it('drops previous nodes after they leave the exit window', () => {
    expect(getHysteresisMountedNodeIds(['a', 'b'], ['c'], ['c'])).toEqual([
      'c'
    ])
  })

  it('always keeps sticky nodes mounted', () => {
    expect(getHysteresisMountedNodeIds([], ['a'], ['a'], ['focused'])).toEqual([
      'a',
      'focused'
    ])
  })
})
