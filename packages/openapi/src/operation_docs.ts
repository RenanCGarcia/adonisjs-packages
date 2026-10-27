import ts from 'typescript'
import type { ExceptionType } from './exception_class.ts'
import { unknownTag } from './known_tags.ts'
import { fileType } from './media_type.ts'
import { responseTag, type ResponseTag } from './response_tag.ts'
import { throwsTag, type FindException, type ThrowsTag } from './throws_tag.ts'
import type { DiagnosticCode } from './types.ts'

export interface OperationDocs {
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: true
  /**
   * The classes `@throws {SmsRejectedException}` tags name, which carry the status and the body.
   */
  throws: ThrowsTag[]
  /**
   * `@response {404} reason` describes a status something else documents, and
   * `@response {502} {UpstreamError}` declares a status and its body.
   */
  responses: ResponseTag[]
  /**
   * The type a `@requestBody {TypeName}` tag names.
   */
  requestBody?: ts.Type
  /**
   * Why a tag could not be documented.
   */
  problems: Problem[]
}

export interface Problem {
  code: DiagnosticCode
  severity: 'error' | 'warning'
  message: string
  fix?: string
  node: ts.Node
}

/**
 * The symbol of the module a specifier such as `#exceptions/user_disabled_exception` names,
 * resolved from the file that refers to it.
 */
export type ResolveModule = (specifier: string, from: ts.SourceFile) => ts.Symbol | undefined

function jsDoc(node: ts.Node) {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1)
}

export function tagText(tag: ts.JSDocTag) {
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

export type Thrown = { code: string; bodies: ts.Type[] }

export function statusOf(type: ts.Type | undefined) {
  return type?.isNumberLiteral() && type.value >= 100 && type.value <= 599
    ? String(type.value)
    : undefined
}

export function aliased(checker: ts.TypeChecker, symbol: ts.Symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
}

/**
 * The export `names` walks to, such as `default` or `E_ROW_NOT_FOUND`, in a module a JSDoc
 * `import('...')` names. The checker leaves those types unbound in a `.ts` file, so the module
 * is resolved by hand.
 */
export function importedSymbol(
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

export function qualifiedNames(name: ts.EntityName): string[] {
  return ts.isIdentifier(name) ? [name.text] : [...qualifiedNames(name.left), name.right.text]
}

function property(checker: ts.TypeChecker, type: ts.Type, name: string) {
  const symbol = checker.getPropertyOfType(type, name)

  return symbol && checker.getTypeOfSymbol(symbol)
}

export interface ResponseCalls {
  calls: { name: string; call: ts.CallExpression }[]
  throws: ts.NewExpression[]
  /**
   * Every other call, which an `errors.throwers` key can name.
   */
  invoked: ts.CallExpression[]
}

/**
 * The calls `roots` make on an `HttpResponse` and the exceptions they `throw new`, also inside the
 * functions of the app they call, such as a shared `renderError(ctx, error)`. Functions from
 * packages are not followed, and neither are the nodes in `skip`.
 */
export function responseCalls(
  checker: ts.TypeChecker,
  roots: ts.Node[],
  skip = new Set<ts.Node>(),
): ResponseCalls {
  const found: ResponseCalls = { calls: [], throws: [], invoked: [] }
  const visited = new Set<ts.Node>(roots)

  const visit = (node: ts.Node) => {
    if (skip.has(node)) return

    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression))
      found.throws.push(node.expression)

    if (ts.isCallExpression(node)) {
      const callee = node.expression

      const receiver =
        ts.isPropertyAccessExpression(callee) && checker.getTypeAtLocation(callee.expression)

      if (receiver && receiver.getSymbol()?.name === 'HttpResponse')
        found.calls.push({ name: callee.name.text, call: node })
      else {
        found.invoked.push(node)
        follow(checker.getResolvedSignature(node)?.declaration)
      }
    }

    ts.forEachChild(node, visit)
  }

  const follow = (declaration: ts.Declaration | undefined) => {
    const body = declaration && bodyOf(declaration)

    if (!body || visited.has(body)) return

    visited.add(body)
    visit(body)
  }

  for (const root of roots) visit(root)

  return found
}

/**
 * The body of a function or method of the app. Package code is not read.
 */
export function bodyOf(declaration: ts.Declaration) {
  const body =
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isFunctionExpression(declaration) ||
    ts.isArrowFunction(declaration)
      ? declaration.body
      : undefined

  const file = declaration.getSourceFile()

  return body && !file.isDeclarationFile && !file.fileName.includes('/node_modules/')
    ? body
    : undefined
}

export function methodBodies(checker: ts.TypeChecker, instance: ts.Type, methods: string[]) {
  return methods.flatMap(method => {
    const declaration = checker.getPropertyOfType(instance, method)?.valueDeclaration

    return declaration ? (bodyOf(declaration) ?? []) : []
  })
}

/**
 * What an exception answers with by itself: a helper such as `response.conflict(body)` in its
 * `handle()` carries its status and body, and `response.status(409).send(body)` gives them one
 * call each.
 *
 * The status of `send()` and `json()` is the type of `static status`, so `422`, `422 as const`, a
 * constant or an enum member all resolve; a plain `static status = 422` widens to `number`, so its
 * initializer is read instead, and without either the `response.status(...)` call gives it. Their
 * body is the return type of `toResponse()` when the class has one.
 */
export function exceptionResponse(
  checker: ts.TypeChecker,
  { constructor, instance }: ExceptionType,
): Thrown[] {
  const { calls } = responseCalls(checker, methodBodies(checker, instance, ['handle']))

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
  }

  return responses
}

/**
 * The type a tag such as `@requestBody {TypeName}` names, which TypeScript does not parse: a name
 * in scope, or an `import('...').TypeName` to resolve without importing it.
 */
export function namedType(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  method: ts.MethodDeclaration,
  tag: ts.JSDocTag,
  text: string,
  problems: Problem[],
) {
  const name = /^\s*([\w$]+)\s*$/.exec(text)?.[1]
  const imported = /^\s*import\(\s*(['"])(.+?)\1\s*\)((?:\.[\w$]+)+)\s*$/.exec(text)

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

  // The scope holds the local side of an exported type, which has no declared type of its own.
  if (symbol)
    return checker.getDeclaredTypeOfSymbol(
      aliased(checker, checker.getExportSymbolOfSymbol(symbol)),
    )

  const message = `@${tag.tagName.text} {${text}}`

  if (imported)
    problems.push({
      code: 'OA-T007',
      severity: 'warning',
      message: `${message}: ${text.trim()} does not name an export of a module`,
      node: tag,
    })
  else if (name)
    problems.push({
      code: 'OA-T007',
      severity: 'warning',
      message: `${message}: ${name} is not in scope`,
      fix: `import it in the controller or name it as import('...').${name}`,
      node: tag,
    })
  else
    problems.push({
      code: 'OA-T007',
      severity: 'warning',
      message: `${message}: expected a type name`,
      fix: 'name a type, such as {MailEvent}',
      node: tag,
    })

  return undefined
}

export interface Answer {
  /**
   * Absent when the status is the one already set, as in `response.status(error.status).send(body)`.
   */
  code?: string
  body?: ts.Type
  /**
   * The media type of the bytes of a file or a stream, from `download()`, `attachment()` or `stream()`.
   */
  binary?: string
  headers?: string[]
  /**
   * The call or `throw new X()` the answer was read from.
   */
  node: ts.Node
  /**
   * The class of a thrown exception.
   */
  exception?: string
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
function answerOf(
  checker: ts.TypeChecker,
  name: string,
  call: ts.CallExpression,
): Omit<Answer, 'node'>[] {
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
      return [{ binary: 'application/octet-stream' }]
    case 'download':
      return [{ binary: fileType(checker, args[0]) }]
    case 'attachment':
      return [{ binary: fileType(checker, args[0]), headers: ['Content-Disposition'] }]
  }

  const type = checker.getTypeAtLocation(call)
  const code = statusOf(property(checker, type, '__status'))
  const body = args[0] && property(checker, type, '__response')

  return code ? [{ code, ...(body && { body }) }] : []
}

export function answersOf(checker: ts.TypeChecker, calls: ResponseCalls['calls']): Answer[] {
  return calls.flatMap(({ name, call }) =>
    answerOf(checker, name, call).map(answer => ({ ...answer, node: call })),
  )
}

/**
 * What `methods` of a middleware answer with: a helper such as `response.forbidden(body)`,
 * `send()` and `json()`, whose status is the literal of a `response.status(403)` they are chained
 * to, `abort()`, `redirect()`, and the exceptions they throw.
 */
export function answers(checker: ts.TypeChecker, instance: ts.Type, methods: string[]) {
  const { calls, throws } = responseCalls(checker, methodBodies(checker, instance, methods))

  return { answers: answersOf(checker, calls), throws }
}

export interface HandlerResponses {
  answers: Answer[]
  /**
   * The exceptions the handler throws, which the headers it sets do not reach.
   */
  throws: ts.NewExpression[]
  /**
   * The calls an `errors.throwers` key can name.
   */
  invoked: ts.CallExpression[]
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
  const { calls, throws, invoked } = responseCalls(
    checker,
    methodBodies(checker, controller, [method]),
  )

  const handler: HandlerResponses = { answers: [], throws, invoked, headers: [] }

  for (const { name, call } of calls) {
    const [first, second] = call.arguments

    if (name === 'header' || name === 'append' || name === 'safeHeader') {
      if (!first || !ts.isStringLiteralLike(first)) continue

      const value = second && checker.getTypeAtLocation(second)

      if (first.text.toLowerCase() !== 'content-type') handler.headers.push(first.text)
      else if (value?.isStringLiteral()) handler.contentType = value.value
    } else if (name === 'status' && ts.isExpressionStatement(call.parent)) {
      handler.status = first && statusOf(checker.getTypeAtLocation(first))
    } else
      handler.answers.push(
        ...answerOf(checker, name, call).map(answer => ({ ...answer, node: call })),
      )
  }

  return handler
}

export function operationDocs(
  checker: ts.TypeChecker,
  resolveModule: ResolveModule,
  findException: FindException,
  controller: ts.ClassDeclaration,
  method: ts.MethodDeclaration,
): OperationDocs {
  const doc = jsDoc(method)
  const throws: ThrowsTag[] = []
  const responses: ResponseTag[] = []
  let requestBody: ts.Type | undefined
  const tags = tagsOf(doc) ?? tagsOf(jsDoc(controller))
  let deprecated = false
  const problems: Problem[] = []

  const [summary, ...paragraphs] = (ts.getTextOfJSDocComment(doc?.comment) ?? '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  for (const tag of doc?.tags ?? []) {
    const name = tag.tagName.text

    if (ts.isJSDocThrowsTag(tag)) {
      const thrown = throwsTag(checker, resolveModule, findException, tag, problems)

      if (thrown) throws.push(thrown)
    } else if (name === 'response') {
      const response = responseTag(checker, resolveModule, method, tag, problems)

      if (response) responses.push(response)
    } else if (name === 'requestBody') {
      const text = /^\{(.*)\}$/s.exec(tagText(tag))?.[1] ?? ''
      requestBody = namedType(checker, resolveModule, method, tag, text, problems)
    } else if (ts.isJSDocDeprecatedTag(tag)) deprecated = true
    else if (name === 'remarks' && tagText(tag)) paragraphs.push(tagText(tag))
    else problems.push(...unknownTag(tag))
  }

  return {
    ...(summary && { summary }),
    ...(paragraphs.length > 0 && { description: paragraphs.join('\n\n') }),
    ...(tags?.length && { tags }),
    ...(deprecated && { deprecated: true }),
    ...(requestBody && { requestBody }),
    throws,
    responses,
    problems,
  }
}
