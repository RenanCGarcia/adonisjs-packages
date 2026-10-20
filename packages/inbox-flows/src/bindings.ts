import type { ChannelId, QueueId } from '@enzopita/adonisjs-inbox'

import { compare, operatorsFor, parseValue, type VariableType } from './graph/values.ts'
import type { FlowBindingId, FlowId } from './types.ts'

/**
 * What a binding's condition can read on the turn that picks a flow: `message` is the text of
 * the contact's waiting messages, joined by newline.
 */
export const BINDING_VARIABLES = { message: 'text' } as const satisfies {
  [name: string]: VariableType
}

export type BindingVariable = keyof typeof BINDING_VARIABLES

/**
 * Compared with the same operators as the `condition` node.
 */
export interface BindingCondition {
  variable: BindingVariable
  operator: string
  value?: string
}

export interface BindingInput {
  /**
   * Higher first. Equal priorities go by creation.
   */
  priority: number
  /**
   * Only tickets on this channel, or any channel when `null`.
   */
  channelId: ChannelId | null
  /**
   * Only tickets in this queue, or any queue when `null`.
   */
  queueId: QueueId | null
  condition: BindingCondition | null
}

export interface Binding extends BindingInput {
  id: FlowBindingId
  flowId: FlowId
}

export interface BindingFacts {
  channelId: ChannelId
  queueId: QueueId
  message: string
}

/**
 * Why the operator or the value doesn't fit the variable's type, or `null` when it does.
 */
export function conditionProblem(condition: BindingCondition): string | null {
  const type = BINDING_VARIABLES[condition.variable]
  const operator = operatorsFor(type).find(({ id }) => id === condition.operator)

  if (!operator) return `${condition.operator} doesn't apply to a ${type}`

  return operator.operand && parseValue(type, condition.value ?? '') === null
    ? `the value must be a ${type}`
    : null
}

/**
 * The binding that picks the flow: the first, by priority, whose scope and condition hold.
 */
export function matchBinding<B extends Binding>(bindings: B[], facts: BindingFacts): B | null {
  const ordered = bindings.toSorted((a, b) => b.priority - a.priority || a.id - b.id)

  return (
    ordered.find(
      binding =>
        (binding.channelId === null || binding.channelId === facts.channelId) &&
        (binding.queueId === null || binding.queueId === facts.queueId) &&
        (binding.condition === null ||
          compare(
            parseValue(
              BINDING_VARIABLES[binding.condition.variable],
              facts[binding.condition.variable],
            ),
            binding.condition.operator,
            binding.condition.value,
          )),
    ) ?? null
  )
}
