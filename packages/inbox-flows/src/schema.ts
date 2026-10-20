import { defineMigrations } from '@enzopita/adonisjs-inbox/migrations'

import { stubsRoot } from '../stubs/main.ts'
import type { FlowsModelRole } from './models.ts'

/**
 * The migrations the flows ship. A schema change after a release is a new entry with its own
 * stub, never an edit to a released one, because hosts already ran and own those.
 */
export const FLOWS_MIGRATIONS = defineMigrations<FlowsModelRole>({
  package: 'inbox-flows',
  command: 'flows:migrations',
  stubsRoot,
  entries: [
    {
      id: '0001',
      name: 'create_inbox_flows_tables',
      columns: {
        flow: [
          'id',
          'name',
          'draft',
          'draft_revision',
          'published_version_id',
          'created_at',
          'updated_at',
        ],
        flowVersion: ['id', 'flow_id', 'number', 'graph', 'hash', 'published_by', 'created_at'],
        flowBinding: [
          'id',
          'flow_id',
          'priority',
          'channel_id',
          'queue_id',
          'condition',
          'created_at',
          'updated_at',
        ],
        flowRun: [
          'id',
          'ticket_id',
          'flow_id',
          'version_id',
          'status',
          'live_ticket_id',
          'revision',
          'vars',
          'waiting',
          'ticket_version',
          'wake_at',
          'deadline',
          'ended_reason',
          'ended_detail',
          'binding_id',
          'started_by_id',
          'created_at',
          'updated_at',
          'ended_at',
        ],
        flowEffect: [
          'id',
          'run_id',
          'ticket_id',
          'node_id',
          'type',
          'payload',
          'idempotency_key',
          'status',
          'attempts',
          'lease_until',
          'next_attempt_at',
          'last_error',
          'settled_at',
          'created_at',
          'updated_at',
        ],
      },
    },
  ],
})
