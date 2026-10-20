import vine from '@vinejs/vine'
import type { AttendantId, CloseReason, QueueId } from '@enzopita/adonisjs-inbox'

import { defineNode } from '../define.ts'
import { VARIABLE_NAME } from '../graph/types.ts'
import {
  OPERATORS,
  VARIABLE_TYPES,
  compare,
  operatorsFor,
  parseValue,
  type Value,
  type VariableType,
} from '../graph/values.ts'

const text = () => vine.string().maxLength(4000)
const variable = () => vine.string().regex(VARIABLE_NAME)

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE = /^\+?[0-9]{8,15}$/

/**
 * What a question can capture: the variable type it writes and how it reads an answer.
 */
const CAPTURES = {
  text: { type: 'text', parse: raw => (raw.trim() === '' ? null : parseValue('text', raw.trim())) },
  number: { type: 'number', parse: raw => parseValue('number', raw) },
  boolean: { type: 'boolean', parse: raw => parseValue('boolean', raw) },
  email: {
    type: 'text',
    parse: raw => {
      const email = raw.trim().toLowerCase()

      return EMAIL.test(email) ? { type: 'text', value: email } : null
    },
  },
  phone: {
    type: 'text',
    parse: raw => {
      const phone = raw.replace(/[\s().-]/g, '')

      return PHONE.test(phone) ? { type: 'text', value: phone } : null
    },
  },
} satisfies {
  [Capture: string]: { type: VariableType; parse: (raw: string) => Value | null }
}

const start = defineNode({
  type: 'start',
  typeVersion: 1,
  config: vine.object({}),
  defaults: {},
  ports: [{ id: 'default' }],
  ui: { label: 'Start', category: 'Flow', icon: 'play' },
  execute: () => ({ go: 'default' }),
})

const message = defineNode({
  type: 'message',
  typeVersion: 1,
  config: vine.object({ text: text().minLength(1) }),
  defaults: { text: '' },
  fields: { text: { label: 'Text', widget: 'textarea', binds: 'template' } },
  ports: [{ id: 'default' }],
  ui: { label: 'Message', category: 'Messages', icon: 'message', summary: '{{text}}' },
  execute: ({ config }) => ({ go: 'default', say: [config.text] }),
})

/**
 * Asks, then reads the answer as its capture. An answer that doesn't read re-asks up to
 * `retries` times, then leaves through `answered` with the variable unset. With a timeout, the
 * `timeout` port exists and is taken when no answer came in time.
 */
const question = defineNode({
  type: 'question',
  typeVersion: 1,
  config: vine.object({
    text: text().minLength(1),
    variable: variable(),
    capture: vine.enum(['text', 'number', 'boolean', 'email', 'phone']),
    retries: vine.number().withoutDecimals().min(0).max(5),
    retryText: text().optional(),
    timeoutMinutes: vine.number().withoutDecimals().min(1).max(10_080).optional(),
  }),
  defaults: { text: '', variable: '', capture: 'text', retries: 1 },
  fields: {
    text: { label: 'Question', widget: 'textarea', binds: 'template' },
    variable: { label: 'Save as', binds: { writes: VARIABLE_TYPES } },
    capture: { label: 'Answer type', widget: 'select' },
    retries: { label: 'Re-ask times', widget: 'number' },
    retryText: { label: 'Re-ask with', widget: 'textarea', binds: 'template' },
    timeoutMinutes: { label: 'Give up after (minutes)', widget: 'number' },
  },
  ports: [{ id: 'answered' }, { id: 'timeout', whileSet: 'timeoutMinutes' }],
  ui: { label: 'Question', category: 'Capture', icon: 'help', summary: '{{text}}' },
  validate: (config, { typeOf }) => {
    const declared = typeOf('variable')
    const captured = CAPTURES[config.capture].type

    return declared === null || declared === captured
      ? []
      : [
          {
            field: 'variable',
            detail: `a ${config.capture} answer is a ${captured}, not a ${declared}`,
          },
        ]
  },
  enter: ({ config }) => ({
    say: [config.text],
    wait: {
      for: 'message',
      timeout: config.timeoutMinutes ? { minutes: config.timeoutMinutes } : undefined,
    },
  }),
  resume: ({ config }, input) => {
    if (input.kind === 'elapsed') return { go: 'timeout' }

    const value = CAPTURES[config.capture].parse(input.text)

    if (value) return { go: 'answered', set: { variable: value } }

    if (input.attempt < config.retries) {
      return {
        say: [config.retryText || config.text],
        wait: {
          for: 'message',
          timeout: config.timeoutMinutes ? { minutes: config.timeoutMinutes } : undefined,
        },
      }
    }

    return { go: 'answered' }
  },
})

const condition = defineNode({
  type: 'condition',
  typeVersion: 1,
  config: vine.object({
    variable: variable(),
    operator: vine.enum(OPERATORS),
    value: text().optional(),
  }),
  defaults: { variable: '', operator: 'is_set' },
  fields: {
    variable: { label: 'Variable', binds: { reads: VARIABLE_TYPES } },
    operator: { label: 'Is', widget: 'select' },
    value: { label: 'Value' },
  },
  ports: [{ id: 'true' }, { id: 'false' }],
  ui: {
    label: 'Condition',
    category: 'Logic',
    icon: 'split',
    summary: '{{variable}} {{operator}}',
  },
  validate: (config, { typeOf }) => {
    const type = typeOf('variable')

    if (type === null) return []

    const operator = operatorsFor(type).find(({ id }) => id === config.operator)

    if (!operator) {
      return [{ field: 'operator', detail: `${config.operator} doesn't apply to a ${type}` }]
    }

    return operator.operand && parseValue(type, config.value ?? '') === null
      ? [{ field: 'value', detail: `the value must be a ${type}` }]
      : []
  },
  execute: ({ config, read }) => ({
    go: compare(read('variable'), config.operator, config.value) ? 'true' : 'false',
  }),
})

/**
 * Renders the value, then reads it as the variable's declared type. A value that doesn't read
 * as one leaves the variable unset.
 */
const setVariable = defineNode({
  type: 'set_variable',
  typeVersion: 1,
  config: vine.object({ variable: variable(), value: text() }),
  defaults: { variable: '', value: '' },
  fields: {
    variable: { label: 'Variable', binds: { writes: VARIABLE_TYPES } },
    value: { label: 'Value', binds: 'template' },
  },
  ports: [{ id: 'default' }],
  ui: { label: 'Set variable', category: 'Logic', icon: 'variable', summary: '{{variable}}' },
  execute: ({ config, typeOf }) => ({
    go: 'default',
    set: { variable: parseValue(typeOf('variable'), config.value) },
  }),
})

/**
 * Messages the contact sends meanwhile answer nothing: the next question only takes later ones.
 */
const delay = defineNode({
  type: 'delay',
  typeVersion: 1,
  config: vine.object({
    seconds: vine
      .number()
      .withoutDecimals()
      .min(1)
      .max(7 * 24 * 3600),
  }),
  defaults: { seconds: 60 },
  fields: { seconds: { label: 'Wait', widget: 'duration' } },
  ports: [{ id: 'default' }],
  ui: { label: 'Delay', category: 'Flow', icon: 'clock', summary: '{{seconds}}s' },
  enter: ({ config }) => ({ wait: { for: 'time', delay: { seconds: config.seconds } } }),
  resume: () => ({ go: 'default' }),
})

// SAFETY: ids in a graph are the host's own; its publish checks that the row exists.
const queueId = (id: number) => id as QueueId

// SAFETY: as above, for attendants.
const attendantId = (id: number) => id as AttendantId

const handoff = defineNode({
  type: 'handoff',
  typeVersion: 1,
  config: vine.object({
    target: vine.enum(['own_queue', 'queue']),
    queueId: vine.number().withoutDecimals().positive().optional(),
    attendantId: vine.number().withoutDecimals().positive().optional(),
    text: text().optional(),
  }),
  defaults: { target: 'own_queue' },
  fields: {
    target: { label: 'To', widget: 'select' },
    queueId: { label: 'Queue', widget: 'queue' },
    attendantId: { label: 'Attendant', widget: 'attendant' },
    text: { label: 'Say first', widget: 'textarea', binds: 'template' },
  },
  ports: [],
  ui: { label: 'Hand off', category: 'Flow', icon: 'users' },
  validate: config =>
    config.target === 'queue' && config.queueId === undefined
      ? [{ field: 'queueId', detail: 'a transfer needs a queue' }]
      : [],
  execute: ({ config }) => ({
    say: config.text ? [config.text] : [],
    end: 'handoff',
    to:
      config.target === 'queue' && config.queueId !== undefined
        ? {
            queueId: queueId(config.queueId),
            attendantId:
              config.attendantId === undefined ? undefined : attendantId(config.attendantId),
          }
        : 'own_queue',
  }),
})

const close = defineNode({
  type: 'close',
  typeVersion: 1,
  config: vine.object({
    reason: vine.string().minLength(1).maxLength(64),
    text: text().optional(),
  }),
  defaults: { reason: 'bot_completed' },
  fields: {
    reason: { label: 'Reason', widget: 'select' },
    text: { label: 'Say first', widget: 'textarea', binds: 'template' },
  },
  ports: [],
  ui: { label: 'Close', category: 'Flow', icon: 'check', summary: '{{reason}}' },
  execute: ({ config }) => ({
    say: config.text ? [config.text] : [],
    end: 'close',
    // SAFETY: close reasons are a type-level augmentation of the inbox, so a stored graph can
    // only be checked against the host's list at publish.
    reason: config.reason as CloseReason,
  }),
})

const end = defineNode({
  type: 'end',
  typeVersion: 1,
  config: vine.object({}),
  defaults: {},
  ports: [],
  ui: { label: 'End', category: 'Flow', icon: 'stop' },
  execute: () => ({ end: 'complete' }),
})

export const builtins = [
  start,
  message,
  question,
  condition,
  setVariable,
  delay,
  handoff,
  close,
  end,
] as const
