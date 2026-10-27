import { extname } from 'node:path'
import mime from 'mime-types'
import ts from 'typescript'

/**
 * `download()` sends the type of the file's extension, read here from a path that is a string
 * literal or a template literal that ends with one.
 */
export function fileType(checker: ts.TypeChecker, path: ts.Expression | undefined) {
  if (!path) return 'application/octet-stream'

  const type = checker.getTypeAtLocation(path)
  let text = type.isStringLiteral() ? type.value : ''

  if (ts.isTemplateExpression(path)) text = path.templateSpans.at(-1)!.literal.text

  // The tail of `${name}.csv` is `.csv`, which `extname()` reads as a file name with no extension.
  return mime.lookup(extname(`file${text}`)) || 'application/octet-stream'
}
