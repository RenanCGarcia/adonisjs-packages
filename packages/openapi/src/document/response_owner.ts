import { basename, extname } from 'node:path'
import ts from 'typescript'
import { isAppSource } from '../analysis/symbols.ts'
import { jsDoc, reasonOf } from '../analysis/tags/tag_text.ts'

/**
 * The class a response comes from, a middleware or an exception, with the reason the first
 * paragraph of its doc comment gives the responses it produces. Only the app's own classes have one.
 */
export interface ResponseOwner {
  symbol: ts.Symbol
  name: string
  /**
   * The file that declares the class.
   */
  file: string
  reason?: string
}

/**
 * `limit_exception.ts` gives `LimitException`.
 */
function pascalCase(file: string) {
  return basename(file, extname(file))
    .split(/[^A-Za-z0-9]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

export function responseOwner(symbol: ts.Symbol | undefined): ResponseOwner | undefined {
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]

  if (!symbol || !declaration) return undefined

  const file = declaration.getSourceFile()
  const className = ts.isClassDeclaration(declaration) ? declaration.name?.text : undefined

  // A default export is named `default`: its class is named after the code's name for it, or its file.
  const name = className ?? (symbol.name === 'default' ? pascalCase(file.fileName) : symbol.name)

  const doc = isAppSource(file) ? jsDoc(declaration) : undefined
  const [summary = ''] = (ts.getTextOfJSDocComment(doc?.comment) ?? '').trim().split(/\n\s*\n/)
  const reason = reasonOf(summary)

  return { symbol, name, file: file.fileName, ...(reason && { reason }) }
}
