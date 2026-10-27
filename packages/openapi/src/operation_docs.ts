import { STATUS_CODES } from 'node:http'
import ts from 'typescript'

export interface OperationDocs {
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: true
  /**
   * Status code to the response a `@throws` tag documents: `@throws {404} User not found`
   * or `@throws {SmsRejectedException}`, whose class carries the status and the body.
   */
  responses: Record<string, ThrownResponse>
  /**
   * The type a `@requestBody {TypeName}` tag names.
   */
  requestBody?: ts.Type
  /**
   * Why a `@throws` or `@requestBody` tag could not be documented.
   */
  problems: string[]
}

export interface ThrownResponse {
  description: string
  bodies: ts.Type[]
}

function jsDoc(node: ts.Node) {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1)
}

function tagText(tag: ts.JSDocTag) {
  return ts.getTextOfJSDocComment(tag.comment)?.trim() ?? ''
}

function tagsOf(doc: ts.JSDoc | undefined) {
  const tag = doc?.tags?.find(candidate => candidate.tagName.text === 'tags')

  return (
    tag &&
    tagText(tag)
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
  )
}

type Thrown = { code: string; bodies: ts.Type[] }

/**
 * The symbol of the module a specifier such as `#exceptions/user_disabled_exception` names,
 * resolved from the file that refers to it.
 */
export type ResolveModule = (specifier: string, from: ts.SourceFile) => ts.Symbol | undefined

function statusOf(type: ts.Type | undefined) {
  return type?.isNumberLiteral() && type.value >= 100 && type.value <= 599
    ? String(type.value)
    : undefined
}

function aliased(checker: ts.TypeChecker, symbol: ts.Symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

/**
 * The export `names` walks to, such as `default` or `E_ROW_NOT_FOUND`, in a module a JSDoc
 * `import('...')` names. The checker leaves those types unbound in a `.ts` file, so the module
 * is resolved by hand.
 */
function importedSymbol(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  specifier: string,
  names: string[],
  from: ts.SourceFile,
) {
  return names.reduce<ts.Symbol | undefined>(
    (symbol, name) => symbol && checker.tryGetMemberInModuleExports(name, aliased(checker, symbol)),
    resolveModule(specifier, from),
  )
}

function qualifiedNames(name: ts.EntityName): string[] {
  return ts.isIdentifier(name) ? [name.text] : [...qualifiedNames(name.left), name.right.text]
}

function property(checker: ts.TypeChecker, type: ts.Type, name: string) {
  const symbol = checker.getPropertyOfType(type, name)

  return symbol && checker.getTypeOfSymbol(symbol)
}

/**
 * The calls `methods` make on an `HttpResponse` and the exceptions they `throw new`, also inside
 * the functions of the app they call, such as a shared `renderError(ctx, error)`. Functions from
 * packages are not followed.
 */
function responseCalls(checker: ts.TypeChecker, instance: ts.Type, methods = ['handle']) {
  const calls: { name: string; call: ts.CallExpression }[] = []
  const throws: ts.NewExpression[] = []
  const visited = new Set<ts.Node>()

  const visit = (node: ts.Node) => {
    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression))
      throws.push(node.expression)

    if (ts.isCallExpression(node)) {
      const callee = node.expression

      const receiver =
        ts.isPropertyAccessExpression(callee) && checker.getTypeAtLocation(callee.expression)

      if (receiver && receiver.getSymbol()?.name === 'HttpResponse')
        calls.push({ name: callee.name.text, call: node })
      else follow(checker.getResolvedSignature(node)?.declaration)
    }

    ts.forEachChild(node, visit)
  }

  const follow = (declaration: ts.Declaration | undefined) => {
    const body =
      declaration &&
      (ts.isFunctionDeclaration(declaration) ||
        ts.isMethodDeclaration(declaration) ||
        ts.isFunctionExpression(declaration) ||
        ts.isArrowFunction(declaration))
        ? declaration.body
        : undefined

    const file = declaration?.getSourceFile()

    if (!body || !file || visited.has(body)) return

    if (file.isDeclarationFile || file.fileName.includes('/node_modules/')) return

    visited.add(body)
    visit(body)
  }

  for (const method of methods)
    follow(checker.getPropertyOfType(instance, method)?.valueDeclaration)

  return { calls, throws }
}

/**
 * What `handle()` answers with: a helper such as `response.conflict(body)` carries its status and
 * body, and `response.status(409).send(body)` gives them one call each.
 *
 * The status of `send()` and `json()` is the type of `static status`, so `422`, `422 as const`, a
 * constant or an enum member all resolve; a plain `static status = 422` widens to `number`, so its
 * initializer is read instead, and without either the `response.status(...)` call gives it. Their
 * body is the return type of `toResponse()` when the class has one.
 */
function exceptionResponse(
  checker: ts.TypeChecker,
  constructor: ts.Type,
  instance: ts.Type,
  problems: string[],
): Thrown[] {
  const { calls } = responseCalls(checker, instance)

  const called = (...names: string[]) =>
    calls.filter(({ name }) => names.includes(name)).map(({ call }) => call)

  const responses: Thrown[] = []

  for (const { call } of calls) {
    const type = checker.getTypeAtLocation(call)
    const code = statusOf(property(checker, type, '__status'))
    const body = call.arguments.length > 0 && property(checker, type, '__response')

    if (code) responses.push({ code, bodies: body ? [body] : [] })
  }

  const sends = called('send', 'json')
  const toResponse = checker.getPropertyOfType(instance, 'toResponse')
  const signature = toResponse && checker.getTypeOfSymbol(toResponse).getCallSignatures()[0]

  if (sends.length > 0 || signature || responses.length === 0) {
    const status = checker.getPropertyOfType(constructor, 'status')
    const declaration = status?.valueDeclaration

    const code =
      statusOf(status && checker.getTypeOfSymbol(status)) ??
      statusOf(
        declaration && ts.isPropertyDeclaration(declaration) && declaration.initializer
          ? checker.getTypeAtLocation(declaration.initializer)
          : undefined,
      ) ??
      called('status')
        .map(call => statusOf(checker.getTypeAtLocation(call.arguments[0]!)))
        .find(Boolean)

    const bodies = signature
      ? [checker.getAwaitedType(signature.getReturnType())!]
      : sends.flatMap(call =>
          call.arguments[0] ? [checker.getTypeAtLocation(call.arguments[0])] : [],
        )

    if (code) responses.push({ code, bodies })
    else
      problems.push(
        `@throws: ${checker.typeToString(instance)} has no status code: give it a literal \`static status\`, call \`response.status(...)\` with one in \`handle()\` or answer with a helper such as \`response.conflict(body)\``,
      )
  }

  return responses
}

/**
 * `@throws {404}` parses as a JSDoc type expression holding the literal type `404`,
 * `@throws {SmsRejectedException}` as a reference to the class, and
 * `@throws {AException | BException}` as a union of either.
 */
function thrownResponses(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  type: ts.TypeNode,
  problems: string[],
): Thrown[] {
  if (ts.isUnionTypeNode(type))
    return type.types.flatMap(member => thrownResponses(checker, resolveModule, member, problems))

  if (ts.isLiteralTypeNode(type)) {
    const code = statusOf(checker.getTypeFromTypeNode(type))

    if (code) return [{ code, bodies: [] }]

    problems.push(`@throws: ${type.getText()} is not a status code`)

    return []
  }

  let symbol: ts.Symbol | undefined

  if (ts.isTypeReferenceNode(type)) symbol = checker.getSymbolAtLocation(type.typeName)
  else if (
    ts.isImportTypeNode(type) &&
    ts.isLiteralTypeNode(type.argument) &&
    ts.isStringLiteral(type.argument.literal)
  )
    symbol = importedSymbol(
      checker,
      resolveModule,
      type.argument.literal.text,
      type.qualifier ? qualifiedNames(type.qualifier) : [],
      type.getSourceFile(),
    )

  const target = symbol && aliased(checker, symbol)
  // A class, or a constant holding one such as the `E_ROW_NOT_FOUND` of `@adonisjs/lucid/errors`.
  const constructor = target?.declarations?.length ? checker.getTypeOfSymbol(target) : undefined
  const instance = constructor?.getConstructSignatures()[0]?.getReturnType()

  if (constructor && instance) return exceptionResponse(checker, constructor, instance, problems)

  let problem = 'is not in scope, import it in the controller or name it as import(...).Export'

  if (target?.declarations?.length) problem = 'is not a class'
  else if (ts.isImportTypeNode(type)) problem = 'does not name an export of a module'

  problems.push(`@throws: ${type.getText()} ${problem}`)

  return []
}

/**
 * `@requestBody {TypeName}` is not a tag TypeScript parses, so its comment holds the name to
 * resolve, or an `import('...').TypeName` to resolve without importing it.
 */
function requestBodyType(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  method: ts.MethodDeclaration,
  tag: ts.JSDocTag,
  problems: string[],
) {
  const text = tagText(tag)
  const name = /^\{\s*([\w$]+)\s*\}$/.exec(text)?.[1]
  const imported = /^\{\s*import\(\s*(['"])(.+?)\1\s*\)((?:\.[\w$]+)+)\s*\}$/.exec(text)

  const symbol = imported
    ? importedSymbol(
        checker,
        resolveModule,
        imported[2]!,
        imported[3]!.slice(1).split('.'),
        method.getSourceFile(),
      )
    : name &&
      checker
        .getSymbolsInScope(method, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
        .find(candidate => candidate.name === name)

  if (symbol) return checker.getDeclaredTypeOfSymbol(aliased(checker, symbol))

  let problem = 'expected a type name, such as {MailEvent}'

  if (imported) problem = `${text.slice(1, -1).trim()} does not name an export of a module`
  else if (name)
    problem = `${name} is not in scope, import it in the controller or name it as import('...').${name}`

  problems.push(`@requestBody ${text}: ${problem}`)

  return undefined
}

export interface Answer {
  /**
   * Absent when the status is the one already set, as in `response.status(error.status).send(body)`.
   */
  code?: string
  body?: ts.Type
  /**
   * The bytes of a file or a stream, from `download()`, `attachment()` or `stream()`.
   */
  binary?: true
  headers?: string[]
}

function chainedStatus(checker: ts.TypeChecker, call: ts.CallExpression) {
  const receiver = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.expression
    : undefined

  return receiver &&
    ts.isCallExpression(receiver) &&
    ts.isPropertyAccessExpression(receiver.expression) &&
    receiver.expression.name.text === 'status' &&
    receiver.arguments[0]
    ? statusOf(checker.getTypeAtLocation(receiver.arguments[0]))
    : undefined
}

/**
 * `abort()` and `redirect()` default to `400` and `302`, as `HttpResponse` does.
 */
function answerOf(checker: ts.TypeChecker, name: string, call: ts.CallExpression): Answer[] {
  const args = call.arguments
  const typeOf = (index: number) => args[index] && checker.getTypeAtLocation(args[index])

  switch (name) {
    case 'send':
    case 'json': {
      const code = chainedStatus(checker, call)

      return args[0] ? [{ ...(code && { code }), body: typeOf(0) }] : []
    }

    case 'abort':
      return [{ code: statusOf(typeOf(1)) ?? '400', body: typeOf(0) }]
    case 'abortIf':
    case 'abortUnless':
      return [{ code: statusOf(typeOf(2)) ?? '400', body: typeOf(1) }]
    case 'redirect':
      return [{ code: statusOf(typeOf(2)) ?? '302', headers: ['Location'] }]
    case 'stream':
    case 'download':
      return [{ binary: true }]
    case 'attachment':
      return [{ binary: true, headers: ['Content-Disposition'] }]
  }

  const type = checker.getTypeAtLocation(call)
  const code = statusOf(property(checker, type, '__status'))
  const body = args[0] && property(checker, type, '__response')

  return code ? [{ code, ...(body && { body }) }] : []
}

function thrownAnswers(checker: ts.TypeChecker, throws: ts.NewExpression[]): Answer[] {
  return throws.flatMap(expression => {
    const constructor = checker.getTypeAtLocation(expression.expression)
    const instance = checker.getTypeAtLocation(expression)

    // A thrown class without a status, such as a plain `Error`, is left to the exception handler.
    return exceptionResponse(checker, constructor, instance, []).flatMap(({ code, bodies }) =>
      bodies.length ? bodies.map(body => ({ code, body })) : [{ code }],
    )
  })
}

/**
 * What `methods` of a middleware or exception handler answer with: a helper such as
 * `response.forbidden(body)`, `send()` and `json()`, whose status is the literal of a
 * `response.status(403)` they are chained to, `abort()`, `redirect()`, or an exception they throw.
 */
export function answers(checker: ts.TypeChecker, instance: ts.Type, methods: string[]): Answer[] {
  const { calls, throws } = responseCalls(checker, instance, methods)

  return [
    ...calls.flatMap(({ name, call }) => answerOf(checker, name, call)),
    ...thrownAnswers(checker, throws),
  ]
}

export interface HandlerResponses {
  answers: Answer[]
  /**
   * The responses of the exceptions the handler throws, which the headers it sets do not reach.
   */
  thrown: Answer[]
  /**
   * The names of the headers set with a literal name, such as `response.header('Retry-After', ...)`.
   */
  headers: string[]
  /**
   * The literal `content-type` the handler sets, which every body it sends has.
   */
  contentType?: string
  /**
   * The literal of a `response.status(201)` call of its own, which a returned body is sent with.
   */
  status?: string
}

export function handlerResponses(
  checker: ts.TypeChecker,
  controller: ts.Type,
  method: string,
): HandlerResponses {
  const { calls, throws } = responseCalls(checker, controller, [method])

  const handler: HandlerResponses = {
    answers: [],
    thrown: thrownAnswers(checker, throws),
    headers: [],
  }

  for (const { name, call } of calls) {
    const [first, second] = call.arguments

    if (name === 'header' || name === 'append' || name === 'safeHeader') {
      if (!first || !ts.isStringLiteralLike(first)) continue

      const value = second && checker.getTypeAtLocation(second)

      if (first.text.toLowerCase() !== 'content-type') handler.headers.push(first.text)
      else if (value?.isStringLiteral()) handler.contentType = value.value
    } else if (name === 'status' && ts.isExpressionStatement(call.parent)) {
      handler.status = first && statusOf(checker.getTypeAtLocation(first))
    } else handler.answers.push(...answerOf(checker, name, call))
  }

  return handler
}

export function operationDocs(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  controller: ts.ClassDeclaration,
  method: ts.MethodDeclaration,
): OperationDocs {
  const doc = jsDoc(method)
  const responses: Record<string, ThrownResponse> = {}
  // Several tags can document one status code, such as two exceptions that answer with a 403.
  const reasonsByCode = new Map<string, string[]>()
  let requestBody: ts.Type | undefined
  const tags = tagsOf(doc) ?? tagsOf(jsDoc(controller))
  let deprecated = false
  const problems: string[] = []

  const [summary, ...paragraphs] = (ts.getTextOfJSDocComment(doc?.comment) ?? '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  for (const tag of doc?.tags ?? []) {
    if (ts.isJSDocThrowsTag(tag)) {
      const thrownTypes = tag.typeExpression
        ? thrownResponses(checker, resolveModule, tag.typeExpression.type, problems)
        : []

      const reason = tagText(tag).replace(/\s*\n\s*/g, ' ')

      for (const thrown of thrownTypes) {
        const reasons = reasonsByCode.get(thrown.code) ?? []
        reasonsByCode.set(thrown.code, reasons)

        if (reason && !reasons.includes(reason)) reasons.push(reason)

        const response = (responses[thrown.code] ??= { description: '', bodies: [] })
        response.description =
          reasons.join('; ') || (STATUS_CODES[Number(thrown.code)] ?? thrown.code)
        response.bodies.push(...thrown.bodies)
      }
    } else if (tag.tagName.text === 'requestBody')
      requestBody = requestBodyType(checker, resolveModule, method, tag, problems)
    else if (ts.isJSDocDeprecatedTag(tag)) deprecated = true
    else if (tag.tagName.text === 'remarks' && tagText(tag)) paragraphs.push(tagText(tag))
  }

  return {
    ...(summary && { summary }),
    ...(paragraphs.length > 0 && { description: paragraphs.join('\n\n') }),
    ...(tags?.length && { tags }),
    ...(deprecated && { deprecated: true }),
    ...(requestBody && { requestBody }),
    responses,
    problems,
  }
}
