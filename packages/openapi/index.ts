import type { generateDocument as generate } from './src/document/generate.ts'

export { configure } from './configure.ts'

export { defineConfig } from './src/define_config.ts'

export { stubsRoot } from './stubs/main.ts'

/**
 * Loads the generator on call. `config/openapi.ts` imports this entry on every boot, and the
 * generator pulls in the TypeScript compiler, and the assembler that a production install leaves out.
 */
export async function generateDocument(...args: Parameters<typeof generate>) {
  const { generateDocument: run } = await import('./src/document/generate.ts')

  return run(...args)
}
