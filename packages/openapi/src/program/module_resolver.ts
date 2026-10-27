import ts from 'typescript'
import { defaultExport, isAppSource, type ResolveModule } from '../analysis/symbols.ts'

export function moduleResolver(program: ts.Program, checker: ts.TypeChecker): ResolveModule {
  return (specifier, from) => {
    const { resolvedModule } = ts.resolveModuleName(
      specifier,
      from.fileName,
      program.getCompilerOptions(),
      ts.sys,
    )

    const file = resolvedModule && program.getSourceFile(resolvedModule.resolvedFileName)

    return file && checker.getSymbolAtLocation(file)
  }
}

/**
 * The instance type of the class a module of the app exports by default, such as a middleware.
 * Package modules are left out: only the app's own code is read.
 */
export function defaultInstance(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  specifier: string,
  from: ts.SourceFile,
) {
  const module = resolveModule(specifier, from)
  const file = module?.valueDeclaration?.getSourceFile()

  if (!module || !file || !isAppSource(file)) return undefined

  const symbol = defaultExport(checker, module)

  return symbol && symbol.flags & ts.SymbolFlags.Class
    ? checker.getDeclaredTypeOfSymbol(symbol)
    : undefined
}
