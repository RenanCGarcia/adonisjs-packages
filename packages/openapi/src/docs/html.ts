import type { DocsPage, UiOptions } from '../types.ts'

const ENTITIES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
])

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => ENTITIES.get(char) ?? char)
}

/**
 * `<` is escaped so that a `</script>` inside a string cannot close the script it is embedded in.
 */
export function scriptJson(value: UiOptions | string) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function script(page: DocsPage, attributes: string, code = '') {
  const nonce = page.nonce ? ` nonce="${escapeHtml(page.nonce)}"` : ''

  return `<script${nonce}${attributes}>${code}</script>`
}

export function htmlPage(page: DocsPage, head: string[], body: string[]) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(page.title)}</title>`,
    ...head,
    '</head>',
    '<body>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
