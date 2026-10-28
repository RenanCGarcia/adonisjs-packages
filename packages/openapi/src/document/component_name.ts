/**
 * Joins the runs of characters a component name cannot hold with a dot: OpenAPI 3.1 names match
 * `^[a-zA-Z0-9._-]+$`, and a `$ref` to any other name is no valid JSON pointer.
 */
export function componentName(text: string) {
  return text.replace(/[^A-Za-z0-9_-]+/g, '.')
}
