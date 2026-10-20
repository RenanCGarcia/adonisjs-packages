import logger from '@adonisjs/core/services/logger'
import type { Bot, BotReply, BotTurn } from '@enzopita/adonisjs-inbox'

type TriageState = { greeted: boolean }

/**
 * Greets the contact and asks what they need, then hands the ticket to the queue with the answer
 * as the note.
 */
export default class TriageBot implements Bot<TriageState> {
  debounce = { seconds: 1 }

  initialState(): TriageState {
    return { greeted: false }
  }

  async turn({ ticket, state, unanswered }: BotTurn<TriageState>): Promise<BotReply<TriageState>> {
    if (!state.greeted) {
      return {
        kind: 'reply',
        messages: [{ kind: 'text', text: 'Hi! What do you need help with?' }],
        state: { greeted: true },
      }
    }

    logger.info({ ticketId: ticket.id }, 'triage: handing the ticket to the team')

    return {
      kind: 'reply',
      messages: [{ kind: 'text', text: 'Thanks! Someone from the team will take it from here.' }],
      state,
      handoff: {
        gesture: 'return',
        note: unanswered.map(({ content }) => content.text).join('\n'),
      },
    }
  }
}
