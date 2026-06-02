import type { LGraphNode, NodeId } from './LGraphNode'
import type { LLink, LinkId } from './LLink'
import type { ISerialisedNode } from './types/serialisation'

/** Generates a unique string key for a link's connection tuple. */
function linkTupleKey(link: LLink): string {
  return `${link.origin_id}\0${link.origin_slot}\0${link.target_id}\0${link.target_slot}`
}

/** Groups all link IDs by their connection tuple key. */
export function groupLinksByTuple(
  links: Map<LinkId, LLink>
): Map<string, LinkId[]> {
  const groups = new Map<string, LinkId[]>()
  for (const [id, link] of links) {
    const key = linkTupleKey(link)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(id)
  }
  return groups
}

/**
 * Finds the link ID actually referenced by an input on the target node.
 * Cannot rely on target_slot index because widget-to-input conversions
 * during configure() can shift slot indices.
 */
export function selectSurvivorLink(
  ids: LinkId[],
  node: LGraphNode | null
): LinkId {
  if (!node) return ids[0]

  for (const input of node.inputs ?? []) {
    if (!input) continue
    const match = ids.find((id) => input.link === id)
    if (match != null) return match
  }
  return ids[0]
}

/** Removes duplicate links from origin outputs and the graph's link map. */
export function purgeOrphanedLinks(
  ids: LinkId[],
  keepId: LinkId,
  links: Map<LinkId, LLink>,
  getNodeById: (id: NodeId) => LGraphNode | null
): void {
  for (const id of ids) {
    if (id === keepId) continue

    const link = links.get(id)
    if (!link) continue

    const originNode = getNodeById(link.origin_id)
    const output = originNode?.outputs?.[link.origin_slot]
    if (output?.links) {
      for (let i = output.links.length - 1; i >= 0; i--) {
        if (output.links[i] === id) output.links.splice(i, 1)
      }
    }

    links.delete(id)
  }
}

/** Ensures input.link on the target node points to the surviving link. */
export function repairInputLinks(
  ids: LinkId[],
  keepId: LinkId,
  node: LGraphNode | null
): void {
  if (!node) return

  const duplicateIds = new Set(ids)

  for (const input of node.inputs ?? []) {
    if (input?.link == null || input.link === keepId) continue
    if (duplicateIds.has(input.link)) {
      input.link = keepId
    }
  }
}

/** Removes links whose origin/target nodes or slots no longer exist. */
export function purgeInvalidLinks(
  links: Map<LinkId, LLink>,
  getNodeById: (id: NodeId) => LGraphNode | null
): void {
  for (const [id, link] of links) {
    const originNode = getNodeById(link.origin_id)
    const targetNode = getNodeById(link.target_id)
    const originOutput = originNode?.outputs?.[link.origin_slot]
    const targetInput = targetNode?.inputs?.[link.target_slot]

    if (originNode && targetNode && originOutput && targetInput) continue

    if (originOutput && originOutput.links) {
      for (let index = originOutput.links.length - 1; index >= 0; index--) {
        if (originOutput.links[index] === id) originOutput.links.splice(index, 1)
      }
    }

    if (targetInput?.link === id) {
      targetInput.link = null
    }

    links.delete(id)
  }
}

/**
 * Removes obviously dangling links from serialized node data before live node
 * configure callbacks can observe them on a reused graph instance.
 */
export function purgeInvalidSerialisedLinks(
  links: Map<LinkId, LLink>,
  nodes: readonly Pick<ISerialisedNode, 'id' | 'inputs' | 'outputs'>[]
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const))

  for (const [id, link] of links) {
    const originNode = nodeById.get(link.origin_id)
    const targetNode = nodeById.get(link.target_id)
    const originOutput = originNode?.outputs?.[link.origin_slot]
    const targetInput = targetNode?.inputs?.[link.target_slot]

    if (originNode && targetNode && originOutput && targetInput) continue

    if (originOutput?.links) {
      for (let index = originOutput.links.length - 1; index >= 0; index--) {
        if (originOutput.links[index] === id) originOutput.links.splice(index, 1)
      }
    }

    if (targetInput?.link === id) {
      targetInput.link = null
    }

    links.delete(id)
  }
}
