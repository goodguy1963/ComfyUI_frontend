import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { LGraph, LGraphNode, LLink, LiteGraph } from '@/lib/litegraph/src/litegraph'
import { zeroUuid } from '@/lib/litegraph/src/utils/uuid'
import { app } from '@/scripts/app'
import { useExtensionStore } from '@/stores/extensionStore'

class SinkNode extends LGraphNode {
  constructor(title?: string) {
    super(title ?? 'SinkNode')
    this.addInput('in', '*')
  }
}

describe('RerouteNode', () => {
  beforeAll(async () => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    localStorage['Comfy.RerouteNode.DefaultVisibility'] = 'true'

    if (!useExtensionStore().isExtensionInstalled('Comfy.RerouteNode')) {
      await import('./rerouteNode')
    }

    const extension = useExtensionStore().extensions.find(
      (candidate) => candidate.name === 'Comfy.RerouteNode'
    )

    expect(extension).toBeDefined()

    if (!LiteGraph.registered_node_types.Reroute) {
      await extension?.registerCustomNodes?.(app)
    }

    if (!LiteGraph.registered_node_types['test/SinkNode']) {
      LiteGraph.registerNodeType('test/SinkNode', SinkNode)
    }
  })

  afterAll(() => {
    if (LiteGraph.registered_node_types['test/SinkNode']) {
      LiteGraph.unregisterNodeType('test/SinkNode')
    }
  })

  it('breaks cyclic reroute traversals without aborting valid downstream updates', () => {
    const graph = new LGraph()
    const first = LiteGraph.createNode('Reroute', 'First')!
    const second = LiteGraph.createNode('Reroute', 'Second')!
    const sink = LiteGraph.createNode('test/SinkNode', 'Sink')!

    graph.add(first)
    graph.add(second)
    graph.add(sink)

    const cycleForward = new LLink(1, '*', first.id, 0, second.id, 0)
    const cycleBackward = new LLink(2, '*', second.id, 0, first.id, 0)
    const downstream = new LLink(3, '*', second.id, 0, sink.id, 0)

    graph.links.set(cycleForward.id, cycleForward)
    graph.links.set(cycleBackward.id, cycleBackward)
    graph.links.set(downstream.id, downstream)

    first.inputs[0].link = cycleBackward.id
    first.outputs[0].links = [cycleForward.id]
    second.inputs[0].link = cycleForward.id
    second.outputs[0].links = [cycleBackward.id, downstream.id]
    sink.inputs[0].link = downstream.id
    sink.onConnectionsChange = vi.fn()

    expect(() => {
      second.onConnectionsChange?.(
        LiteGraph.INPUT,
        0,
        true,
        cycleForward,
        second.inputs[0]
      )
    }).not.toThrow()

    expect(sink.inputs[0].link).toBe(downstream.id)
    expect(sink.onConnectionsChange).toHaveBeenCalled()
  })

  it('drops malformed dangling legacy reroute links during configure()', () => {
    const graph = new LGraph()

    graph.configure({
      id: zeroUuid,
      revision: 0,
      last_node_id: 743,
      last_link_id: 2002,
      nodes: [
        {
          id: 743,
          type: 'Reroute',
          pos: [0, 0],
          size: [75, 26],
          flags: {},
          order: 0,
          mode: 0,
          inputs: [{ name: '', type: '*', link: null }],
          outputs: [{ name: '', type: '*', links: null }],
          properties: { showOutputText: false, horizontal: false }
        }
      ],
      links: [
        [2000, 100, 0, 101, 0, '*'],
        [2001, 102, 0, 743, 0, '*'],
        [2002, 743, 0, 103, 0, '*']
      ],
      groups: [],
      config: {},
      extra: {
        workflowRendererVersion: 'LG',
        frontendVersion: '1.43.18'
      },
      version: 0.4
    })

    expect(graph.links.size).toBe(0)
    const reroute = graph.getNodeById(743)
    expect(reroute?.inputs?.[0]?.link).toBeNull()
    expect(reroute?.outputs?.[0]?.links ?? []).toEqual([])
  })
})