import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import type { ExceptionType } from './exception_class.ts'
import { aliased, statusCode, statusOf } from '../symbols.ts'

/**
 * Finds what an identifier in a class or a constant refers to: through the checker in the app's
 * files, by top-level name in a package's JavaScript.
 */
type Resolve = (name: ts.Identifier) => ts.Node | undefined

type Read = (node: ts.Node | undefined) => string | undefined

const numeric: Read = node => {
  return node && ts.isNumericLiteral(node) ? statusCode(Number(node.text)) : undefined
}

function named(member: ts.ClassElement | ts.ObjectLiteralElementLike, name: string) {
  return member.name !== undefined && ts.isIdentifier(member.name) && member.name.text === name
}

/**
 * The `options.status` the constructor passes to `super()`, and the `this.status` it assigns after.
 */
function constructorStatus(constructor: ts.ConstructorDeclaration, read: Read) {
  let passed: string | undefined
  let assigned: string | undefined

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.SuperKeyword &&
      node.arguments[1] &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      const status = node.arguments[1].properties.find(property => named(property, 'status'))

      if (status && ts.isPropertyAssignment(status)) passed = read(status.initializer) ?? passed
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.left.name.text === 'status'
    )
      assigned = read(node.right) ?? assigned

    ts.forEachChild(node, visit)
  }

  if (constructor.body) visit(constructor.body)

  return { passed, assigned }
}

function classStatus(
  node: ts.ClassLikeDeclaration,
  read: Read,
  resolve: Resolve,
  seen: Set<ts.Node>,
): string | undefined {
  const field = (isStatic: boolean) =>
    node.members.find(
      (member): member is ts.PropertyDeclaration =>
        ts.isPropertyDeclaration(member) &&
        named(member, 'status') &&
        Boolean(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) === isStatic,
    )?.initializer

  const constructor = node.members.find(ts.isConstructorDeclaration)

  const { passed, assigned } = constructor ? constructorStatus(constructor, read) : {}

  // The order they apply in: `super()` sets the status, a field initializer overrides it, then the constructor body does.
  const own = assigned ?? read(field(false)) ?? passed ?? read(field(true))

  if (own) return own

  const base = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)
    ?.types[0]?.expression

  return base && ts.isIdentifier(base) ? statusAt(resolve(base), read, resolve, seen) : undefined
}

function statusAt(
  node: ts.Node | undefined,
  read: Read,
  resolve: Resolve,
  seen: Set<ts.Node>,
): string | undefined {
  if (!node || seen.has(node)) return undefined

  seen.add(node)

  if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
    return classStatus(node, read, resolve, seen)

  if (ts.isParenthesizedExpression(node)) return statusAt(node.expression, read, resolve, seen)

  if (ts.isVariableDeclaration(node)) return statusAt(node.initializer, read, resolve, seen)

  if (ts.isIdentifier(node)) return statusAt(resolve(node), read, resolve, seen)

  // `createError(message, code, status)` from `@adonisjs/core/exceptions`, as `@adonisjs/lucid` makes most of its errors.
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'createError'
  )
    return read(node.arguments[2])

  return undefined
}

/**
 * The top-level declaration named `name` in a package's JavaScript, where its `.d.ts` only says
 * `status: number`. The file next to the declaration file is tried first, then the package's
 * other files, which a bundler may have merged it into.
 */
function* implementations(declarationFile: string, name: string) {
  let root = dirname(declarationFile)

  while (!existsSync(join(root, 'package.json')) && dirname(root) !== root) root = dirname(root)

  const sibling = declarationFile.replace(/\.d\.(m|c)?ts$/, '.$1js')

  const others = () =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter(file => /\.(m|c)?js$/.test(file) && !file.split(/[\\/]/).includes('node_modules'))
      .map(file => join(root, file))
      .filter(file => file !== sibling)

  for (const file of [...(existsSync(sibling) ? [sibling] : []), ...others()]) {
    const text = readFileSync(file, 'utf8')

    if (!text.includes(name)) continue

    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

    const topLevel = (wanted: string) =>
      source.statements.flatMap((statement): ts.Node[] => {
        if (ts.isClassDeclaration(statement) && statement.name?.text === wanted) return [statement]

        if (!ts.isVariableStatement(statement)) return []

        return statement.declarationList.declarations.filter(
          declaration => ts.isIdentifier(declaration.name) && declaration.name.text === wanted,
        )
      })[0]

    const found = topLevel(name)

    if (found) yield { found, resolve: (identifier: ts.Identifier) => topLevel(identifier.text) }
  }
}

/**
 * The status an exception of the class has when nothing overrides it, read from its source and
 * never by running it: a `status` field or `static status`, the `status` its constructor sets, or
 * the one of a class it extends. An app class is read with the checker, so a constant or an enum
 * member resolves. A package class only declares `status: number`, so its JavaScript is parsed
 * for a numeric literal.
 */
export function declaredStatus(checker: ts.TypeChecker, exception: ExceptionType) {
  const { symbol } = exception
  const declaration = symbol?.valueDeclaration

  if (!symbol || !declaration) return undefined

  const file = declaration.getSourceFile()

  if (!file.isDeclarationFile) {
    const resolve: Resolve = identifier => {
      const symbol = checker.getSymbolAtLocation(identifier)
      const target = symbol && aliased(checker, symbol).valueDeclaration

      return target && !target.getSourceFile().isDeclarationFile ? target : undefined
    }

    const read: Read = node => node && (statusOf(checker.getTypeAtLocation(node)) ?? numeric(node))

    return statusAt(declaration, read, resolve, new Set())
  }

  const name = symbol.name === 'default' ? exception.name : symbol.name

  for (const { found, resolve } of implementations(file.fileName, name)) {
    const status = statusAt(found, numeric, resolve, new Set())

    if (status) return status
  }

  return undefined
}
