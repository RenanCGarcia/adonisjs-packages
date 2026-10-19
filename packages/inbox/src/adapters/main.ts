import { configProvider } from '@adonisjs/core'

import { FakeChannelAdapter } from './fake.ts'
import type { AdapterProvider } from './port.ts'

export const adapters = {
  /**
   * Pass your own instance to read what it recorded.
   */
  fake(adapter: FakeChannelAdapter = new FakeChannelAdapter()): AdapterProvider {
    return configProvider.create(async () => adapter)
  },
}
