import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import ts from 'typescript'

test.group('@enzopita/adonisjs-openapi/types', () => {
  test('exports the public types and nothing else', ({ assert }) => {
    const entry = fileURLToPath(new URL('../src/types.ts', import.meta.url))

    const program = ts.createProgram([entry], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      noEmit: true,
      skipLibCheck: true,
    })

    const checker = program.getTypeChecker()
    const module = checker.getSymbolAtLocation(program.getSourceFile(entry)!)!

    assert.sameMembers(
      checker.getExportsOfModule(module).map(symbol => symbol.name),
      [
        'DocumentConfig',
        'DocumentInfo',
        'ErrorsConfig',
        'ExceptionClass',
        'OpenApiConfig',
        'OpenApiUserConfig',
        'RouteMatcher',
        'RulesConfig',
        'SecurityConfig',
        'SecurityScheme',
        'DocsOptions',
        'DocsPage',
        'DocsUi',
        'UiOptions',
        'HttpMethod',
        'OpenApiDocument',
        'OpenApiOperation',
        'OpenApiParameter',
        'OpenApiReference',
        'OpenApiResponse',
        'Diagnostic',
        'DiagnosticCode',
        'GeneratedDocument',
        'ResponseSource',
        'SourceLocation',
        'Json',
        'JsonSchema',
        'JsonValue',
      ],
    )
  })
})
