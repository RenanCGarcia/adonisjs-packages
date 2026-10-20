import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('inbox_flows', table => {
      table.increments('id')
      table.string('name').notNullable()
      table.text('draft').notNullable()
      table.integer('draft_revision').notNullable().defaultTo(0)
      // No foreign key, since the versions table points back here.
      table.integer('published_version_id').unsigned().nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
    })

    this.schema.createTable('inbox_flow_versions', table => {
      table.increments('id')
      table
        .integer('flow_id')
        .unsigned()
        .notNullable()
        .references('inbox_flows.id')
        .onDelete('CASCADE')
      table.integer('number').notNullable()
      table.text('graph').notNullable()
      table.string('hash', 64).notNullable()
      table.string('published_by').nullable()

      table.timestamp('created_at').notNullable()

      table.unique(['flow_id', 'number'])
    })

    this.schema.createTable('inbox_flow_bindings', table => {
      table.increments('id')
      table
        .integer('flow_id')
        .unsigned()
        .notNullable()
        .references('inbox_flows.id')
        .onDelete('CASCADE')
      table.integer('priority').notNullable().defaultTo(0)
      table
        .integer('channel_id')
        .unsigned()
        .nullable()
        .references('inbox_channels.id')
        .onDelete('CASCADE')
      table
        .integer('queue_id')
        .unsigned()
        .nullable()
        .references('inbox_queues.id')
        .onDelete('CASCADE')
      table.text('condition').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['priority'])
    })

    this.schema.createTable('inbox_flow_runs', table => {
      table.increments('id')
      table
        .integer('ticket_id')
        .unsigned()
        .notNullable()
        .references('inbox_tickets.id')
        .onDelete('CASCADE')
      table
        .integer('flow_id')
        .unsigned()
        .notNullable()
        .references('inbox_flows.id')
        .onDelete('CASCADE')
      table.integer('version_id').unsigned().notNullable().references('inbox_flow_versions.id')
      table.string('status').notNullable()
      // The ticket id while pending or running, NULL once ended. A plain unique index then keeps
      // one live run per ticket on every database, because NULLs never collide.
      table.integer('live_ticket_id').unsigned().nullable().unique()
      table.integer('revision').notNullable().defaultTo(0)
      table.text('vars').notNullable()
      table.text('waiting').nullable()
      // The ticket's version once the bot turn that last wrote the run committed.
      table.integer('ticket_version').nullable()
      table.timestamp('wake_at').nullable()
      table.timestamp('deadline').nullable()
      table.string('ended_reason').nullable()
      table.text('ended_detail').nullable()
      table
        .integer('binding_id')
        .unsigned()
        .nullable()
        .references('inbox_flow_bindings.id')
        .onDelete('SET NULL')
      table.integer('started_by_id').unsigned().nullable().references('inbox_attendants.id')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('ended_at').nullable()

      table.index(['ticket_id', 'ended_reason'])
      table.index(['status', 'wake_at'])

      // These mirror the FlowRun sum type, so every stored row parses.
      table.check(
        "(status = 'pending' AND live_ticket_id = ticket_id AND deadline IS NOT NULL AND waiting IS NULL AND ended_reason IS NULL) OR (status = 'running' AND live_ticket_id = ticket_id AND waiting IS NOT NULL AND ticket_version IS NOT NULL AND ended_reason IS NULL) OR (status = 'ended' AND live_ticket_id IS NULL AND waiting IS NULL AND wake_at IS NULL AND ended_reason IS NOT NULL AND ended_at IS NOT NULL)",
        [],
        'inbox_flow_runs_status',
      )
    })

    this.schema.createTable('inbox_flow_effects', table => {
      table.increments('id')
      table
        .integer('run_id')
        .unsigned()
        .notNullable()
        .references('inbox_flow_runs.id')
        .onDelete('CASCADE')
      table
        .integer('ticket_id')
        .unsigned()
        .notNullable()
        .references('inbox_tickets.id')
        .onDelete('CASCADE')
      table.string('node_id').notNullable()
      table.string('type').notNullable()
      table.text('payload').notNullable()
      table.string('idempotency_key').notNullable().unique()
      table.string('status').notNullable()
      table.integer('attempts').notNullable().defaultTo(0)
      table.timestamp('lease_until').nullable()
      table.timestamp('next_attempt_at').nullable()
      table.text('last_error').nullable()
      table.timestamp('settled_at').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.index(['status', 'next_attempt_at'])

      table.check(
        "(status = 'pending' AND next_attempt_at IS NOT NULL AND settled_at IS NULL) OR (status = 'delivering' AND lease_until IS NOT NULL AND settled_at IS NULL) OR (status IN ('done', 'failed') AND settled_at IS NOT NULL)",
        [],
        'inbox_flow_effects_status',
      )
    })
  }

  async down() {
    this.schema.dropTable('inbox_flow_effects')
    this.schema.dropTable('inbox_flow_runs')
    this.schema.dropTable('inbox_flow_bindings')
    this.schema.dropTable('inbox_flow_versions')
    this.schema.dropTable('inbox_flows')
  }
}
