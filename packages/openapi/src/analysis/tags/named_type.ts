import ts from 'typescript'
import { typeNameExpected, typeNotExported, typeNotInScope } from '../../diagnostics/tags.ts'
import { aliased, importedSymbol } from '../symbols.ts'
import type { TagContext } from './tag_context.ts'

/**
 * The type a tag such as `@requestBody {TypeName}` names, which TypeScript does not parse: a name
 * in scope, or an `import('...').TypeName` to resolve without importing it.
 */
export function namedType(
  { checker, resolveModule, method, locate, problems }: TagContext,
  tag: ts.JSDocTag,
  text: string,
) {
  const name = /^\s*([\w$]+)\s*$/.exec(text)?.[1]
  const imported = /^\s*import\(\s*(['"])(.+?)\1\s*\)((?:\.[\w$]+)+)\s*$/.exec(text)

  const symbol = imported
    ? importedSymbol(
        checker,
        resolveModule,
        imported[2]!,
        imported[3]!.slice(1).split('.'),
        method.getSourceFile(),
      )
    : name &&
      checker
        .getSymbolsInScope(method, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
        .find(candidate => candidate.name === name)

  // The scope holds the local side of an exported type, which has no declared type of its own.
  if (symbol)
    return checker.getDeclaredTypeOfSymbol(
      aliased(checker, checker.getExportSymbolOfSymbol(symbol)),
    )

  const written = `@${tag.tagName.text} {${text}}`
  const location = locate(tag)

  if (imported) problems.push(typeNotExported(location, written, text))
  else if (name) problems.push(typeNotInScope(location, written, name))
  else problems.push(typeNameExpected(location, written))

  return undefined
}
