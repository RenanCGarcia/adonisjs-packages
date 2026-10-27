const TYPE = 'openapi:output'

/**
 * What `openapi:generate` sends over the IPC channel of the build hook that spawns it: the
 * absolute path of the document it wrote.
 */
export interface OutputMessage {
  type: typeof TYPE
  path: string
}

export function sendOutput(path: string) {
  process.send?.({ type: TYPE, path } satisfies OutputMessage)
}

/**
 * The type tells a message `sendOutput()` sent from any other on the channel.
 */
export function isOutputMessage(message: unknown): message is OutputMessage {
  return message instanceof Object && 'type' in message && message.type === TYPE
}
