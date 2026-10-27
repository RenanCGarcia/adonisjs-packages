import type { Diagnostic, SourceLocation } from '../types.ts'

const THROWS_STATUS_FIX = (code: string) =>
  `use \`@response {${code}} reason\` to describe a derived status, \`@response {${code}} {Type}\` to declare a body, or \`@throws {Class}\``

const IMPORT_FIX = 'import it in the controller or name it as import(...).Export'

export function throwsNamesSeveralClasses(location: SourceLocation, type: string): Diagnostic {
  return {
    code: 'OA-T001',
    severity: 'error',
    message: `@throws: ${type} names several classes`,
    fix: 'write one @throws tag per class',
    location,
  }
}

export function throwsNamesStatus(
  location: SourceLocation,
  type: string,
  code: string,
): Diagnostic {
  return {
    code: 'OA-T001',
    severity: 'error',
    message: `@throws: ${type} names a status code, not an exception class`,
    fix: THROWS_STATUS_FIX(code),
    location,
  }
}

export function throwsStatusWithoutBraces(location: SourceLocation, code: string): Diagnostic {
  return {
    code: 'OA-T001',
    severity: 'error',
    message: `@throws ${code} names a status code, not an exception class`,
    fix: THROWS_STATUS_FIX(code),
    location,
  }
}

export function throwsWithoutBraces(location: SourceLocation, word: string): Diagnostic {
  return {
    code: 'OA-T001',
    severity: 'error',
    message: word ? `@throws ${word} has no braces around the class` : '@throws names no class',
    fix: `write it as \`@throws {${word || 'Class'}} reason\``,
    location,
  }
}

export function throwsClassUnresolved(
  location: SourceLocation,
  type: string,
  name: string,
  files: string[],
  candidates: string[],
): Diagnostic {
  const message = `@throws: ${type}`

  return {
    code: 'OA-T002',
    severity: 'error',
    message: files.length
      ? `${message}: several exception classes are named ${name}: ${files.join(', ')}`
      : `${message}: no exception class of the app is named ${name}${candidates.length ? ` (found ${candidates.join(', ')})` : ''}`,
    fix: files.length ? `name one as import('...').default` : IMPORT_FIX,
    location,
  }
}

export function responseStatusInvalid(
  location: SourceLocation,
  status: string | undefined,
): Diagnostic {
  return {
    code: 'OA-T004',
    severity: 'warning',
    message: `@response: ${status === undefined ? 'expected a status code' : `${status} is not a status code`}`,
    fix: 'write it as @response {404} reason or @response {404} {Type} reason',
    location,
  }
}

export function throwsNotAClass(location: SourceLocation, type: string): Diagnostic {
  return {
    code: 'OA-T005',
    severity: 'warning',
    message: `@throws: ${type} is not a class`,
    location,
  }
}

export function throwsTypeUnresolved(
  location: SourceLocation,
  type: string,
  imported: boolean,
): Diagnostic {
  return {
    code: 'OA-T005',
    severity: 'warning',
    message: imported
      ? `@throws: ${type} does not name an export of a module`
      : `@throws: ${type} is not in scope`,
    ...(!imported && { fix: IMPORT_FIX }),
    location,
  }
}

export function typeNotExported(
  location: SourceLocation,
  written: string,
  text: string,
): Diagnostic {
  return {
    code: 'OA-T007',
    severity: 'warning',
    message: `${written}: ${text.trim()} does not name an export of a module`,
    location,
  }
}

export function typeNotInScope(
  location: SourceLocation,
  written: string,
  name: string,
): Diagnostic {
  return {
    code: 'OA-T007',
    severity: 'warning',
    message: `${written}: ${name} is not in scope`,
    fix: `import it in the controller or name it as import('...').${name}`,
    location,
  }
}

export function typeNameExpected(location: SourceLocation, written: string): Diagnostic {
  return {
    code: 'OA-T007',
    severity: 'warning',
    message: `${written}: expected a type name`,
    fix: 'name a type, such as {MailEvent}',
    location,
  }
}

export function inlineObjectType(
  location: SourceLocation,
  code: string,
  inner: string,
): Diagnostic {
  return {
    code: 'OA-T007',
    severity: 'error',
    message: `@response {${code}} {${inner}}: an inline object type is not read`,
    fix: `declare it as a type, such as \`type Body = ${inner}\`, and write \`@response {${code}} {Body}\``,
    location,
  }
}

export function tagNotRead(location: SourceLocation, name: string, fix: string): Diagnostic {
  return {
    code: 'OA-T008',
    severity: 'warning',
    message: `@${name} is not a tag the generator reads`,
    fix,
    location,
  }
}

export function exampleInvalid(location: SourceLocation, written: string, why: string): Diagnostic {
  return {
    code: 'OA-T009',
    severity: 'warning',
    message: `${written}: ${why}`,
    fix: 'name a const whose initializer is JSON, such as `@example {200} userExample`',
    location,
  }
}
