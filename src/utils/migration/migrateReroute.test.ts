import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { WorkflowJSON04 } from '@/platform/workflow/validation/schemas/workflowSchema'
import { migrateLegacyRerouteNodes } from '@/utils/migration/migrateReroute'

describe('migrateReroute', () => {
  describe('migrateReroute snapshots', () => {
    // Helper function to load workflow JSON files
    const loadWorkflow = (filePath: string): WorkflowJSON04 => {
      const fullPath = path.resolve(__dirname, filePath)
      const fileContent = fs.readFileSync(fullPath, 'utf-8')
      return JSON.parse(fileContent) as WorkflowJSON04
    }

    it.for([
      'branching.json',
      'single_connected.json',
      'floating.json',
      'floating_branch.json'
    ])('should correctly migrate %s', async (fileName) => {
      // Load the legacy workflow
      const legacyWorkflow = loadWorkflow(
        `__fixtures__/reroute/legacy/${fileName}`
      )

      // Migrate the workflow
      const migratedWorkflow = migrateLegacyRerouteNodes(legacyWorkflow)

      // Compare with snapshot
      await expect(
        JSON.stringify(migratedWorkflow, null, 2)
      ).toMatchFileSnapshot(`__fixtures__/reroute/native/${fileName}`)
    })
  })

  it('drops malformed dangling links when migrating a lone legacy reroute', () => {
    const legacyWorkflow = {
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
    } satisfies WorkflowJSON04

    const migratedWorkflow = migrateLegacyRerouteNodes(legacyWorkflow)

    expect(migratedWorkflow.nodes).toEqual([])
    expect(migratedWorkflow.links).toEqual([])
    expect(migratedWorkflow.extra?.reroutes).toEqual([])
    expect(migratedWorkflow.extra?.linkExtensions).toEqual([])
  })

  it('does not recurse forever on cyclic legacy reroute chains', () => {
    const legacyWorkflow = {
      last_node_id: 3,
      last_link_id: 2,
      nodes: [
        {
          id: 1,
          type: 'Reroute',
          pos: [0, 0],
          size: [75, 26],
          flags: {},
          order: 0,
          mode: 0,
          inputs: [{ name: '', type: '*', link: 2 }],
          outputs: [{ name: '', type: '*', links: [1] }],
          properties: { showOutputText: false, horizontal: false }
        },
        {
          id: 2,
          type: 'Reroute',
          pos: [100, 0],
          size: [75, 26],
          flags: {},
          order: 1,
          mode: 0,
          inputs: [{ name: '', type: '*', link: 1 }],
          outputs: [{ name: '', type: '*', links: [2] }],
          properties: { showOutputText: false, horizontal: false }
        },
        {
          id: 3,
          type: 'TestTarget',
          pos: [200, 0],
          size: [100, 40],
          flags: {},
          order: 2,
          mode: 0,
          inputs: [{ name: 'in', type: '*', link: 2 }],
          outputs: [],
          properties: {}
        }
      ],
      links: [
        [1, 1, 0, 2, 0, '*'],
        [2, 2, 0, 1, 0, '*']
      ],
      groups: [],
      config: {},
      extra: {},
      version: 0.4
    } satisfies WorkflowJSON04

    const migratedWorkflow = migrateLegacyRerouteNodes(legacyWorkflow)

    expect(migratedWorkflow.nodes).toHaveLength(1)
    expect(migratedWorkflow.links).toEqual([])
  })
})
