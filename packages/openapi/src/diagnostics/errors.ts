import type { Diagnostic, SourceLocation } from '../types.ts'

export type ErrorsKind = 'throwers' | 'middleware'

export function entryStatusUnreadable(
  kind: ErrorsKind,
  key: string,
  name: string,
  location?: SourceLocation,
  index?: number,
): Diagnostic {
  return {
    code: 'OA-E001',
    severity: 'warning',
    message: `errors.${kind}['${key}']${index === undefined ? '' : `[${index}]`}: the status of ${name} cannot be read, the entry is ignored`,
    fix: 'name an exception class with a numeric `status` field or `static status`',
    ...(location && { location }),
  }
}

export function spreadUnreadable(
  kind: ErrorsKind,
  key: string,
  location: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-E001',
    severity: 'warning',
    message: `errors.${kind}['${key}'] spreads an array the generator cannot read, the classes it adds are ignored`,
    fix: 'spread an array literal or a const that holds one, or write the classes in the entry',
    location,
  }
}

export function ownBodyUndeclared(name: string): Diagnostic {
  return {
    code: 'OA-E002',
    severity: 'warning',
    message: `${name} renders its own body, which its package does not declare: it is documented without one`,
    fix: "render it in an `instanceof` branch of the exception handler's handle()",
  }
}

export function unknownPresetKey(
  kind: ErrorsKind,
  key: string,
  location?: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-E003',
    severity: 'warning',
    message: `errors.${kind}['${key}'] is false but names no preset of a first-party package`,
    fix: 'name the preset key to turn off, such as `bouncer.authorize` or `limiter.define`',
    ...(location && { location }),
  }
}

export function emptyEntry(kind: ErrorsKind, key: string, location?: SourceLocation): Diagnostic {
  return {
    code: 'OA-E003',
    severity: 'warning',
    message: `errors.${kind}['${key}'] is an empty array, which documents nothing and turns off the preset of that key`,
    fix: 'name the exception classes, or use `false` to turn the preset off',
    ...(location && { location }),
  }
}

export function unmatchedKey(kind: ErrorsKind, key: string, location?: SourceLocation): Diagnostic {
  const throwers = kind === 'throwers'

  return {
    code: 'OA-E003',
    severity: 'warning',
    message: throwers
      ? `errors.throwers['${key}'] matches no call of the documented routes`
      : `errors.middleware['${key}'] matches no middleware of the documented routes`,
    fix: throwers
      ? 'name the method, such as `findOrFail`, or the names the call goes through, such as `bouncer.authorize`'
      : 'name the middleware as `node ace list:routes` shows it, such as `auth` or `globalThrottle`, or its specifier in start/kernel.ts',
    ...(location && { location }),
  }
}
