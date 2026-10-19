import { InboxError } from '../errors.ts'
import { CAPABILITIES, type Capability, type ChannelAdapter, type NormalizedEvent } from './port.ts'

const REQUIRED: Partial<Record<NormalizedEvent['type'], Capability>> = {
  message_echoed: 'outbound_echo',
}

export class AdapterRegistry {
  readonly #adapters: ReadonlyMap<string, ChannelAdapter>

  constructor(adapters: ReadonlyMap<string, ChannelAdapter>) {
    const catalog = new Set<string>(CAPABILITIES)

    for (const [provider, adapter] of adapters) {
      const unknown = adapter.capabilities.filter(capability => !catalog.has(capability))

      if (unknown.length > 0) {
        throw new InboxError(
          'E_INBOX_INVALID_CONFIG',
          `inbox: the ${provider} adapter declares unknown capabilities ${unknown.join(', ')}`,
        )
      }
    }

    this.#adapters = adapters
  }

  get(provider: string) {
    const adapter = this.#adapters.get(provider)

    if (adapter === undefined) {
      throw new InboxError(
        'E_INBOX_UNKNOWN_PROVIDER',
        `inbox: a channel has provider "${provider}", which config.channels doesn't have`,
      )
    }

    return adapter
  }

  /**
   * The events of a stored body the inbox acts on.
   */
  eventsOf(provider: string, rawBody: string) {
    const adapter = this.get(provider)

    return adapter.parse(rawBody).filter(event => {
      if (event.type === 'unsupported') return false

      const required = REQUIRED[event.type]

      return required === undefined || adapter.capabilities.includes(required)
    })
  }
}
