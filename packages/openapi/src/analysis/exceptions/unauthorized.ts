import ts from 'typescript'
import { exceptionType } from './exception_class.ts'
import { aliased } from '../symbols.ts'

/**
 * `E_UNAUTHORIZED_ACCESS` of `@adonisjs/auth`, which the auth middleware of a secured route throws,
 * when the app has the package. `packaged` gives it `body`, the `{ errors: [{ message }] }` its
 * own `handle()` sends a client that accepts JSON, which its declaration file does not carry.
 */
export function unauthorizedException(
  program: ts.Program,
  checker: ts.TypeChecker,
  from: ts.SourceFile,
  { options, body }: { options: ts.CompilerOptions; body: ts.Type },
) {
  const { resolvedModule } = ts.resolveModuleName('@adonisjs/auth', from.fileName, options, ts.sys)
  const file = resolvedModule && program.getSourceFile(resolvedModule.resolvedFileName)
  const module = file && checker.getSymbolAtLocation(file)
  const errors = module && checker.tryGetMemberInModuleExports('errors', module)

  const exception = exceptionType(
    checker,
    errors &&
      checker.tryGetMemberInModuleExports('E_UNAUTHORIZED_ACCESS', aliased(checker, errors)),
  )

  const packaged = new Map<ts.Symbol, ts.Type[]>()

  if (exception?.symbol) packaged.set(exception.symbol, [body])

  return { exception, packaged }
}
