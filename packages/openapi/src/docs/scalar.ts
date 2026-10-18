import type { DocsPage, UiOptions } from '../types.ts'
import { escapeHtml, htmlPage, script, scriptJson } from './html.ts'

const cdn = {
  script: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1/dist/browser/standalone.js',
}

export const scalar = {
  cdn,

  render(page: DocsPage, assets: typeof cdn, uiOptions: UiOptions) {
    const config = scriptJson({ url: page.documentUrl, ...uiOptions })

    return htmlPage(
      page,
      [],
      [
        '<div id="app"></div>',
        script(page, ` src="${escapeHtml(assets.script)}"`),
        script(page, '', `Scalar.createApiReference('#app', ${config})`),
      ],
    )
  },
}
