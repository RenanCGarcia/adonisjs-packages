import ts from 'typescript'
import { defaultExport } from '../analysis/symbols.ts'
import type { RouteOperation } from '../types.ts'

export interface ControllerHandler {
  symbol: ts.Symbol
  declaration: ts.ClassDeclaration
  method: ts.MethodDeclaration
}

/**
 * The handler method of a route, in the class its controller file exports by default.
 */
export function controllerHandler(
  program: ts.Program,
  checker: ts.TypeChecker,
  { controller }: RouteOperation,
): ControllerHandler | undefined {
  const file = controller && program.getSourceFile(controller.path)
  const module = file && checker.getSymbolAtLocation(file)
  const symbol = module && defaultExport(checker, module)
  const declaration = symbol?.declarations?.find(ts.isClassDeclaration)

  const method = declaration?.members.find(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      ts.isIdentifier(member.name) &&
      member.name.text === controller?.method,
  )

  return symbol && declaration && method ? { symbol, declaration, method } : undefined
}
