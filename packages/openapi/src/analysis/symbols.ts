import ts from 'typescript'

/**
 * The symbol of the module a specifier such as `#exceptions/user_disabled_exception` names,
 * resolved from the file that refers to it.
 */
export type ResolveModule = (specifier: string, from: ts.SourceFile) => ts.Symbol | undefined

export function statusOf(type: ts.Type | undefined) {
  return type?.isNumberLiteral() ? statusCode(type.value) : undefined
}

export function statusCode(value: number) {
  return value >= 100 && value <= 599 ? String(value) : undefined
}

export function aliased(checker: ts.TypeChecker, symbol: ts.Symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

/**
 * Package code and declaration files are not read: only the app's own sources are.
 */
export function isAppSource(file: ts.SourceFile) {
  return !file.isDeclarationFile && !file.fileName.includes('/node_modules/')
}

/**
 * The class a module exports by default, through the alias an `export default` of an identifier makes.
 */
export function defaultExport(checker: ts.TypeChecker, module: ts.Symbol) {
  const exported = checker.tryGetMemberInModuleExports('default', module)

  return exported && aliased(checker, exported)
}

/**
 * The export `names` walks to, such as `default` or `E_ROW_NOT_FOUND`, in a module a JSDoc
 * `import('...')` names. The checker leaves those types unbound in a `.ts` file, so the module
 * is resolved by hand.
 */
export function importedSymbol(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  specifier: string,
  names: string[],
  from: ts.SourceFile,
) {
  return names.reduce<ts.Symbol | undefined>(
    (symbol, name) => symbol && checker.tryGetMemberInModuleExports(name, aliased(checker, symbol)),
    resolveModule(specifier, from),
  )
}

export function qualifiedNames(name: ts.EntityName): string[] {
  return ts.isIdentifier(name) ? [name.text] : [...qualifiedNames(name.left), name.right.text]
}

export function property(checker: ts.TypeChecker, type: ts.Type | undefined, name: string) {
  const symbol = type && checker.getPropertyOfType(type, name)

  return symbol && checker.getTypeOfSymbol(symbol)
}
