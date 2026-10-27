import ts from 'typescript'
import { aliased, bodyOf } from './operation_docs.ts'

/**
 * A class the app throws: its name in the code, and the symbol the code names it with, such as a
 * class or a constant holding one.
 */
export interface ExceptionType {
  name: string
  symbol?: ts.Symbol
  constructor: ts.Type
  instance: ts.Type
}

/**
 * The class a symbol names, or the class a constant such as `E_ROW_NOT_FOUND` holds.
 */
export function exceptionType(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ExceptionType | undefined {
  const target = symbol && aliased(checker, symbol)

  if (!target?.declarations?.length) return undefined

  const constructor = checker.getTypeOfSymbol(target)
  const instance = constructor.getConstructSignatures()[0]?.getReturnType()

  const declaration = target.valueDeclaration

  // A default export is named `default`: its class has the name the code knows it by.
  const name =
    (declaration && ts.isClassDeclaration(declaration) && declaration.name?.text) || target.name

  return instance && { name, symbol: target, constructor, instance }
}

/**
 * Whether the exception answers through a `handle()` of its own, which runs before the
 * `renderErrorAsJSON()` of the exception handler: `unread` when a package declares it, so its body
 * cannot be read.
 */
export function ownHandler(checker: ts.TypeChecker, instance: ts.Type) {
  const declaration = checker.getPropertyOfType(instance, 'handle')?.valueDeclaration

  if (!declaration) return 'none'

  return bodyOf(declaration) ? 'read' : 'unread'
}

/**
 * The symbols of a class and of the classes it extends, which an `instanceof` matches.
 */
export function lineage(checker: ts.TypeChecker, instance: ts.Type) {
  const symbols = new Set<ts.Symbol>()
  const pending = [instance]

  for (let type = pending.pop(); type; type = pending.pop()) {
    const symbol = type.getSymbol()

    if (!symbol || symbols.has(symbol)) continue

    symbols.add(symbol)

    if (type.isClassOrInterface()) pending.push(...checker.getBaseTypes(type))
  }

  return symbols
}
