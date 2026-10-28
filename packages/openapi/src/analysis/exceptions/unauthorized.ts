import ts from 'typescript'
import { exceptionType } from './exception_class.ts'
import { aliased } from '../symbols.ts'

/**
 * Package exceptions whose own `handle()` sends a client that accepts JSON
 * `{ errors: [{ message }] }`, which their declaration files do not carry.
 */
const selfRendered = {
  '@adonisjs/auth': ['E_UNAUTHORIZED_ACCESS'],
  '@adonisjs/ally': [
    'E_OAUTH_MISSING_CODE',
    'E_OAUTH_STATE_MISMATCH',
    'E_UNKNOWN_ALLY_PROVIDER',
    'E_LOCAL_SIGNUP_DISALLOWED',
  ],
}

export function unauthorizedException(
  program: ts.Program,
  checker: ts.TypeChecker,
  from: ts.SourceFile,
  { options, body }: { options: ts.CompilerOptions; body: ts.Type },
) {
  const exceptionOf = (specifier: string, name: string) => {
    const { resolvedModule } = ts.resolveModuleName(specifier, from.fileName, options, ts.sys)
    const file = resolvedModule && program.getSourceFile(resolvedModule.resolvedFileName)
    const module = file && checker.getSymbolAtLocation(file)
    const errors = module && checker.tryGetMemberInModuleExports('errors', module)

    return exceptionType(
      checker,
      errors && checker.tryGetMemberInModuleExports(name, aliased(checker, errors)),
    )
  }

  const packaged = new Map<ts.Symbol, ts.Type[]>()

  for (const [specifier, names] of Object.entries(selfRendered)) {
    for (const name of names) {
      const exception = exceptionOf(specifier, name)

      if (exception?.symbol) packaged.set(exception.symbol, [body])
    }
  }

  return { exception: exceptionOf('@adonisjs/auth', 'E_UNAUTHORIZED_ACCESS'), packaged }
}
