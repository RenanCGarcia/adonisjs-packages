import ts from 'typescript'
import { isAppSource } from '../analysis/symbols.ts'

type FunctionNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration

/**
 * The function of the app an inline route middleware was created from, by its runtime source. It
 * is missing when no function of the app has that source, and ambiguous when several have it.
 */
export type InlineMatch =
  | { kind: 'found'; body: ts.ConciseBody }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; candidates: FunctionNode[] }

// Compilers print these differently: swc adds `;`, drops a trailing `,` and the parens of `(x as T)`.
const LAYOUT = new Set([
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.CloseParenToken,
])

function isFunction(node: ts.Node): node is FunctionNode {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)
}

function isTypeOnly(node: ts.Node) {
  return (
    ts.isTypeNode(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === 'this')
  )
}

function word(node: ts.Node) {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text

  if (ts.isLiteralExpression(node) || ts.isTemplateLiteralToken(node))
    return `${node.kind}:${JSON.stringify(ts.isNumericLiteral(node) ? String(Number(node.text)) : node.text)}`

  return undefined
}

/**
 * The names and literals of the parameters and the body of `fn` outside its types. They are the
 * same in the TypeScript of the app and in the JavaScript it runs as, which makes them a cheap key
 * to index every function of the app by.
 */
function names(fn: FunctionNode) {
  const words: string[] = []

  const visit = (node: ts.Node) => {
    if (isTypeOnly(node)) return

    const found = word(node)

    if (found) words.push(found)
    else ts.forEachChild(node, visit)
  }

  for (const parameter of fn.parameters) visit(parameter)

  if (fn.body) visit(fn.body)

  return words.join(' ')
}

/**
 * Every token of the parameters and the body of a JavaScript function, operators and keywords
 * included, but the layout ones.
 */
function tokens(fn: FunctionNode, sourceFile: ts.SourceFile) {
  const found: string[] = []

  const visit = (node: ts.Node) => {
    if (ts.isJSDoc(node)) return

    const text = word(node)

    if (text) found.push(text)
    else if (node.kind > ts.SyntaxKind.LastToken)
      for (const child of node.getChildren(sourceFile)) visit(child)
    else if (!LAYOUT.has(node.kind) && node.kind !== ts.SyntaxKind.EndOfFileToken)
      found.push(ts.tokenToString(node.kind) ?? String(node.kind))
  }

  for (const parameter of fn.parameters) visit(parameter)

  if (fn.body) visit(fn.body)

  return found.join(' ')
}

/**
 * The function the first expression statement of the JavaScript `text` holds.
 */
function parseFunction(text: string) {
  const sourceFile = ts.createSourceFile(
    'inline.js',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )

  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) continue

    let expression = statement.expression

    while (ts.isParenthesizedExpression(expression)) expression = expression.expression

    if (isFunction(expression)) return { fn: expression, sourceFile }
  }

  return undefined
}

/**
 * The tokens of an app function once the compiler erases its types, as in the JavaScript the app runs.
 */
function erasedTokens(fn: FunctionNode) {
  const text = fn.getText().replace(/^export\s+(default\s+)?/, '')

  const { outputText } = ts.transpileModule(`(${text})`, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  })

  const parsed = parseFunction(outputText)

  return parsed ? tokens(parsed.fn, parsed.sourceFile) : undefined
}

/**
 * Finds the function of the app an inline route middleware, such as
 * `.use(async (ctx, next) => {})`, was created from, by its runtime source: the app function with
 * the same tokens once its types are erased.
 */
export function inlineMiddleware(program: ts.Program) {
  let index: Map<string, FunctionNode[]> | undefined
  const erased = new Map<FunctionNode, string | undefined>()

  const read = () => {
    const found = new Map<string, FunctionNode[]>()

    const visit = (node: ts.Node) => {
      if (isFunction(node) && node.body) {
        const key = names(node)
        const bucket = found.get(key)

        if (bucket) bucket.push(node)
        else found.set(key, [node])
      }

      ts.forEachChild(node, visit)
    }

    for (const file of program.getSourceFiles()) if (isAppSource(file)) visit(file)

    return found
  }

  const erasedOf = (fn: FunctionNode) => {
    if (!erased.has(fn)) erased.set(fn, erasedTokens(fn))

    return erased.get(fn)
  }

  return (source: string): InlineMatch => {
    const runtime = parseFunction(`(${source})`)

    if (!runtime) return { kind: 'missing' }

    index ??= read()

    const key = tokens(runtime.fn, runtime.sourceFile)
    const candidates = (index.get(names(runtime.fn)) ?? []).filter(fn => erasedOf(fn) === key)
    const [only] = candidates

    if (candidates.length > 1) return { kind: 'ambiguous', candidates }

    return only?.body ? { kind: 'found', body: only.body } : { kind: 'missing' }
  }
}
