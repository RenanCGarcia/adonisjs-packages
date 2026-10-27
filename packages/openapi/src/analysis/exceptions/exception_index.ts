import ts from 'typescript'
import { relative, sep } from 'node:path'
import { exceptionType, lineage, type ExceptionType } from './exception_class.ts'

/**
 * The exception classes of the app with this name, with the file of each, and the names of all of them.
 */
export type FindException = (name: string) => {
  found: { exception: ExceptionType; file: string }[]
  names: string[]
}

const EXCEPTIONS_FOLDER = /^app\/(?:.+\/)?exceptions\//

/**
 * Finds the classes extending `Exception` in the app's `app/**\/exceptions/` folders by name, so
 * `@throws {EmailTakenException}` needs no import.
 */
export function exceptionIndex(
  program: ts.Program,
  checker: ts.TypeChecker,
  appRoot: string,
): FindException {
  let index: Map<string, { exception: ExceptionType; file: string }[]> | undefined

  const read = () => {
    const found = new Map<string, { exception: ExceptionType; file: string }[]>()

    for (const file of program.getSourceFiles()) {
      const path = relative(appRoot, file.fileName).split(sep).join('/')

      if (file.isDeclarationFile || !EXCEPTIONS_FOLDER.test(path)) continue

      for (const statement of file.statements) {
        const exception =
          ts.isClassDeclaration(statement) &&
          statement.name &&
          exceptionType(checker, checker.getSymbolAtLocation(statement.name))

        if (
          !exception ||
          ![...lineage(checker, exception.instance)].some(({ name }) => name === 'Exception')
        )
          continue

        found.set(exception.name, [...(found.get(exception.name) ?? []), { exception, file: path }])
      }
    }

    return found
  }

  return name => {
    index ??= read()

    return { found: index.get(name) ?? [], names: [...index.keys()].sort() }
  }
}
