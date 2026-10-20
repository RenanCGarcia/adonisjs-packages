import { createHash } from 'node:crypto'

import { canonicalGraph } from './graph/check.ts'
import type { FlowGraph } from './graph/types.ts'

/**
 * The publish identity. Two drafts that differ only in layout hash the same, so moving a node
 * never makes a version.
 */
export function graphHash(graph: FlowGraph) {
  return createHash('sha256').update(canonicalGraph(graph)).digest('hex')
}
