import type { Diagnostic, SourceLocation } from '../types.ts'

export function closureRoute(route: string): Diagnostic {
  return {
    code: 'OA-R001',
    severity: 'warning',
    route,
    message: 'closure handlers have no types to read, the route is skipped',
  }
}

export function unknownReturnType(route: string, location?: SourceLocation): Diagnostic {
  return {
    code: 'OA-R002',
    severity: 'warning',
    route,
    message: "the handler's return type is unknown",
    fix: 'return serialize(...) to make it typed',
    ...(location && { location }),
  }
}

export function unmatchedInlineMiddleware(route: string, name: string): Diagnostic {
  return {
    code: 'OA-R003',
    severity: 'warning',
    route,
    message: `the middleware ${name} passed to .use() is not a function of the app's sources, its responses are not documented`,
    fix: 'pass an arrow function or a function the app declares, or register it as a named middleware',
  }
}

export function ambiguousInlineMiddleware(
  route: string,
  name: string,
  candidates: SourceLocation[],
): Diagnostic {
  const where = candidates.map(({ file, line }) => `${file}:${line}`).join(', ')

  return {
    code: 'OA-R004',
    severity: 'warning',
    route,
    message: `the middleware ${name} passed to .use() has the same source as several functions of the app (${where}), its responses are not documented`,
    fix: 'make the functions differ, or register the middleware as a named middleware',
  }
}

export function unreadableValidator(
  route: string,
  specifier: string,
  exportName: string,
  reason: string,
): Diagnostic {
  return {
    code: 'OA-V001',
    severity: 'warning',
    route,
    message: `cannot read the JSON Schema of ${specifier}#${exportName} (${reason})`,
  }
}

export function underivedResponse(
  route: string,
  code: string,
  location: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-T003',
    severity: 'error',
    route,
    message: `@response {${code}}: nothing documents a ${code} for this route`,
    fix: `declare its body with \`@response {${code}} {Type}\`, or remove the tag`,
    location,
  }
}

export function exampleWithoutBody(
  route: string,
  code: string,
  location: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-T009',
    severity: 'warning',
    route,
    message: `@example {${code}}: no ${code} with a body is documented for this route`,
    fix: 'name a status whose response has a body, or remove the tag',
    location,
  }
}

export function statuslessException(
  route: string,
  name: string,
  location: SourceLocation,
): Diagnostic {
  return {
    code: 'OA-T006',
    severity: 'warning',
    route,
    message: `@throws: ${name} has no status code`,
    fix: 'give it a literal `static status`, call `response.status(...)` with one in `handle()` or answer with a helper such as `response.conflict(body)`',
    location,
  }
}

export function noJsonSchema(type: string): Diagnostic {
  return {
    code: 'OA-J001',
    severity: 'warning',
    message: `no JSON Schema for the type ${type}, emitted {}`,
  }
}

export function lucidModel(model: string): Diagnostic {
  return {
    code: 'OA-J002',
    severity: 'warning',
    message: `${model} is a Lucid model, emitted {}`,
    fix: 'return it through a transformer',
  }
}
