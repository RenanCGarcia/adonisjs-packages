import ts from 'typescript'

/**
 * What `toObject()` of the transformer an `InferData<Transformer>` alias names returns. The
 * mapped types of `InferData` drop the doc comments of its properties, and this type keeps them.
 */
function documented(checker: ts.TypeChecker, alias: ts.Symbol) {
  const declaration = alias.declarations?.find(ts.isTypeAliasDeclaration)

  const [transformer] =
    declaration && ts.isTypeReferenceNode(declaration.type)
      ? (declaration.type.typeArguments ?? [])
      : []

  const toObject =
    transformer && checker.getPropertyOfType(checker.getTypeFromTypeNode(transformer), 'toObject')

  const [signature] = toObject ? checker.getTypeOfSymbol(toObject).getCallSignatures() : []

  return signature && checker.getAwaitedType(checker.getReturnTypeOfSignature(signature))
}

/**
 * The types `node ace codegen` names in `Data`, keyed by their path below it (`Admin.User`), and
 * the type that documents the properties of each.
 */
export function transformerTypes(checker: ts.TypeChecker, dataFile: ts.SourceFile | undefined) {
  const module = dataFile && checker.getSymbolAtLocation(dataFile)
  const data = module && checker.tryGetMemberInModuleExports('Data', module)

  const walk = (namespace: ts.Symbol, path: string[]): [ts.Type, string, ts.Type | undefined][] =>
    checker.getExportsOfModule(namespace).flatMap(symbol => {
      if (symbol.name === 'Variants') return []

      const name = [...path, symbol.name]
      const nested = symbol.flags & ts.SymbolFlags.Namespace ? walk(symbol, name) : []

      if (!(symbol.flags & ts.SymbolFlags.TypeAlias)) return nested

      return [
        [checker.getDeclaredTypeOfSymbol(symbol), name.join('.'), documented(checker, symbol)],
        ...nested,
      ]
    })

  return data ? walk(data, []) : []
}
