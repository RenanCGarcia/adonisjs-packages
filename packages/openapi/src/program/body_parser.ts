import ts from 'typescript'
import { existsSync, readFileSync } from 'node:fs'

export interface BodyParser {
  methods: Set<string>
  mediaTypes: (pattern: string) => string[]
  fileMediaType: string
}

/**
 * The defaults of `defineConfig()` from `@adonisjs/core/bodyparser`.
 */
const DEFAULTS = {
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  json: [
    'application/json',
    'application/json-patch+json',
    'application/vnd.api+json',
    'application/csp-report',
  ],
  form: ['application/x-www-form-urlencoded'],
  multipart: ['multipart/form-data'],
}

function member(object: ts.ObjectLiteralExpression | undefined, name: string) {
  const entry = object?.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === name,
  )

  return entry?.initializer
}

function strings(node: ts.Expression | undefined) {
  if (!node || !ts.isArrayLiteralExpression(node)) return undefined

  const values = node.elements.flatMap(element =>
    ts.isStringLiteralLike(element) ? [element.text] : [],
  )

  return values.length === node.elements.length ? values : undefined
}

export function readBodyParser(file: string): BodyParser {
  let config: ts.ObjectLiteralExpression | undefined

  const visit = (node: ts.Node) => {
    if (config) return

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const [argument] = node.arguments

      if (
        node.expression.text === 'defineConfig' &&
        argument &&
        ts.isObjectLiteralExpression(argument)
      ) {
        config = argument

        return
      }
    }

    ts.forEachChild(node, visit)
  }

  if (existsSync(file))
    visit(ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest))

  const types = (parser: 'json' | 'form' | 'multipart') => {
    const settings = member(config, parser)

    return (
      strings(
        settings && ts.isObjectLiteralExpression(settings) ? member(settings, 'types') : undefined,
      ) ?? DEFAULTS[parser]
    )
  }

  const canonical = (parser: 'json' | 'form' | 'multipart') => {
    const accepted = types(parser)

    return accepted.includes(DEFAULTS[parser][0]!) ? DEFAULTS[parser][0] : accepted[0]
  }

  const multipart = canonical('multipart')

  const multipartSettings = member(config, 'multipart')

  const multipartSetting = (name: string) =>
    multipartSettings && ts.isObjectLiteralExpression(multipartSettings)
      ? member(multipartSettings, name)
      : undefined

  const autoProcess = multipartSetting('autoProcess')
  const autoProcessed = strings(autoProcess)
  const processManually = strings(multipartSetting('processManually')) ?? []

  // The validator only sees the fields of a multipart body the bodyparser processed itself.
  const processesMultipart = (pattern: string) =>
    autoProcess?.kind !== ts.SyntaxKind.FalseKeyword &&
    (autoProcessed?.includes(pattern) ?? true) &&
    !processManually.includes(pattern)

  return {
    methods: new Set(strings(member(config, 'allowedMethods')) ?? DEFAULTS.allowedMethods),
    mediaTypes: pattern => {
      const mediaTypes = [
        canonical('json'),
        canonical('form'),
        processesMultipart(pattern) ? multipart : undefined,
      ].filter((type): type is string => type !== undefined)

      return mediaTypes.length ? mediaTypes : [DEFAULTS.json[0]!]
    },
    fileMediaType: multipart ?? DEFAULTS.multipart[0]!,
  }
}
