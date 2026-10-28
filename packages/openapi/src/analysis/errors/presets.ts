import ts from 'typescript'
import { exceptionType, type ExceptionType } from '../exceptions/exception_class.ts'
import { aliased } from '../symbols.ts'
import type { ErrorsKind } from '../../diagnostics/errors.ts'

interface PackagePreset {
  throwers?: Record<string, string | string[]>
  createdMiddleware?: { key: string; exception: string }
  /**
   * The exceptions whose own `handle()` sends `{ errors: [{ message }] }` to a client that accepts
   * JSON, which their declaration files do not carry.
   */
  ownBody?: string[]
}

/**
 * `@adonisjs/shield` is left out: `E_BAD_CSRF_TOKEN` depends on `csrf` in `config/shield.ts`,
 * which the API starter kit disables.
 */
const PRESETS = {
  '@adonisjs/auth': {
    throwers: {
      'auth.authenticate': 'E_UNAUTHORIZED_ACCESS',
      'auth.authenticateUsing': 'E_UNAUTHORIZED_ACCESS',
      'auth.getUserOrFail': 'E_UNAUTHORIZED_ACCESS',
      'verifyCredentials': 'E_INVALID_CREDENTIALS',
    },
    ownBody: ['E_UNAUTHORIZED_ACCESS', 'E_INVALID_CREDENTIALS'],
  },
  '@adonisjs/ally': {
    throwers: { 'ally.user': ['E_OAUTH_STATE_MISMATCH', 'E_OAUTH_MISSING_CODE'] },
    ownBody: [
      'E_OAUTH_MISSING_CODE',
      'E_OAUTH_STATE_MISMATCH',
      'E_UNKNOWN_ALLY_PROVIDER',
      'E_LOCAL_SIGNUP_DISALLOWED',
    ],
  },
  '@adonisjs/bouncer': {
    throwers: { 'bouncer.authorize': 'E_AUTHORIZATION_FAILURE' },
  },
  '@adonisjs/limiter': {
    throwers: { 'limiter.consume': 'E_TOO_MANY_REQUESTS' },
    createdMiddleware: { key: 'limiter.define', exception: 'E_TOO_MANY_REQUESTS' },
  },
  '@adonisjs/lucid': {
    throwers: {
      findOrFail: 'E_ROW_NOT_FOUND',
      findByOrFail: 'E_ROW_NOT_FOUND',
      firstOrFail: 'E_ROW_NOT_FOUND',
    },
  },
} satisfies Record<string, PackagePreset>

export function isPresetKey(kind: ErrorsKind, key: string) {
  return Object.values<PackagePreset>(PRESETS).some(preset =>
    kind === 'throwers' ? key in (preset.throwers ?? {}) : preset.createdMiddleware?.key === key,
  )
}

export interface PresetException {
  kind: ErrorsKind
  key: string
  package: string
  exception: ExceptionType
  packageDir?: string
}

interface Resolution {
  program: ts.Program
  checker: ts.TypeChecker
  from: ts.SourceFile
  options: ts.CompilerOptions
}

function resolvePackage({ program, checker, from, options }: Resolution, name: string) {
  const { resolvedModule } = ts.resolveModuleName(name, from.fileName, options, ts.sys)
  const file = resolvedModule && program.getSourceFile(resolvedModule.resolvedFileName)
  const module = file && checker.getSymbolAtLocation(file)
  const errors = module && checker.tryGetMemberInModuleExports('errors', module)

  if (!errors) return undefined

  const subModule = resolvedModule.packageId?.subModuleName

  return {
    packageDir: subModule && resolvedModule.resolvedFileName.slice(0, -subModule.length),
    exception: (exported: string) =>
      exceptionType(
        checker,
        checker.tryGetMemberInModuleExports(exported, aliased(checker, errors)),
      ),
  }
}

export function packageException(resolution: Resolution, name: string, exported: string) {
  return resolvePackage(resolution, name)?.exception(exported)
}

export function packagePresets(resolution: Resolution, ownBody: ts.Type) {
  const presets: PresetException[] = []
  const packaged = new Map<ts.Symbol, ts.Type[]>()

  for (const [name, preset] of Object.entries<PackagePreset>(PRESETS)) {
    const resolved = resolvePackage(resolution, name)

    if (!resolved) continue

    for (const [key, exported] of Object.entries(preset.throwers ?? {}))
      for (const className of [exported].flat()) {
        const exception = resolved.exception(className)

        if (exception) presets.push({ kind: 'throwers', key, package: name, exception })
      }

    const created =
      preset.createdMiddleware && resolved.exception(preset.createdMiddleware.exception)

    if (preset.createdMiddleware && created && resolved.packageDir)
      presets.push({
        kind: 'middleware',
        key: preset.createdMiddleware.key,
        package: name,
        exception: created,
        packageDir: resolved.packageDir,
      })

    for (const exported of preset.ownBody ?? []) {
      const symbol = resolved.exception(exported)?.symbol

      if (symbol) packaged.set(symbol, [ownBody])
    }
  }

  return { presets, packaged }
}
