import ts from 'typescript'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The app's own program, with the in-memory `entryFile` added: its sources are the ones the app
 * compiles, so the module augmentations (container bindings, auth guards) the types depend on apply.
 */
export function createProgram(appRoot: string, entryFile: string, entrySource: string) {
  const dataFile = join(appRoot, '.adonisjs/client/data.d.ts')

  const config = ts.getParsedCommandLineOfConfigFile(
    join(appRoot, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: diagnostic => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )

  if (!config) throw new Error(`openapi: cannot read ${join(appRoot, 'tsconfig.json')}`)

  const host = ts.createCompilerHost(config.options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === entryFile
      ? ts.createSourceFile(fileName, entrySource, languageVersion)
      : getSourceFile(fileName, languageVersion, ...rest)
  const fileExists = host.fileExists.bind(host)
  host.fileExists = fileName => fileName === entryFile || fileExists(fileName)

  const program = ts.createProgram({
    rootNames: [...config.fileNames, entryFile, ...(existsSync(dataFile) ? [dataFile] : [])],
    options: { ...config.options, noEmit: true },
    host,
  })

  return { program, options: config.options, dataFile }
}
