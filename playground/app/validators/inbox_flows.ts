import vine from '@vinejs/vine'
import { VARIABLE_TYPES, type BindingVariable } from '@enzopita/adonisjs-inbox-flows'

const id = () => vine.number().withoutDecimals().min(1)

const graph = vine.object({
  schemaVersion: vine.literal(1),
  variables: vine.array(vine.object({ name: vine.string(), type: vine.enum(VARIABLE_TYPES) })),
  nodes: vine.array(
    vine.object({
      id: vine.string(),
      type: vine.string(),
      typeVersion: vine.number().withoutDecimals().min(1),
      position: vine.object({ x: vine.number(), y: vine.number() }),
      data: vine.record(vine.any()),
    }),
  ),
  edges: vine.array(
    vine.object({
      id: vine.string(),
      source: vine.string(),
      sourceHandle: vine.string(),
      target: vine.string(),
    }),
  ),
})

const revision = vine.number().withoutDecimals().min(0)

export const flowValidator = vine.create({ name: vine.string().trim().minLength(1) })

export const draftValidator = vine.create({ graph, revision })

export const restoreValidator = vine.create({ revision })

export const bindingsValidator = vine.create({
  bindings: vine.array(
    vine.object({
      priority: vine.number().withoutDecimals(),
      channelId: id().nullable(),
      queueId: id().nullable(),
      condition: vine
        .object({
          variable: vine.enum(['message'] as const satisfies BindingVariable[]),
          operator: vine.string(),
          value: vine.string().optional(),
        })
        .nullable(),
    }),
  ),
})

export const startValidator = vine.create({ flowId: id() })
