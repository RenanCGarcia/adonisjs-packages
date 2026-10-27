import ts from 'typescript'

/**
 * The types `node ace codegen` names in `Data`, keyed by their path below it (`Admin.User`).
 */
export function transformerTypes(checker: ts.TypeChecker, dataFile: ts.SourceFile | undefined) {
  const module = dataFile && checker.getSymbolAtLocation(dataFile)
  const data = module && checker.tryGetMemberInModuleExports('Data', module)

  const walk = (namespace: ts.Symbol, path: string[]): [ts.Type, string][] =>
    checker.getExportsOfModule(namespace).flatMap(symbol => {
      if (symbol.name === 'Variants') return []

      const name = [...path, symbol.name]
      const nested = symbol.flags & ts.SymbolFlags.Namespace ? walk(symbol, name) : []

      if (!(symbol.flags & ts.SymbolFlags.TypeAlias)) return nested

      return [[checker.getDeclaredTypeOfSymbol(symbol), name.join('.')], ...nested]
    })

  return data ? walk(data, []) : []
}
