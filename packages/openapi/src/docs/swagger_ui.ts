import type { DocsPage, UiOptions } from '../types.ts'
import { escapeHtml, htmlPage, script, scriptJson } from './html.ts'

const cdn = {
  script: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js',
  style: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css',
}

export const swaggerUi = {
  cdn,

  render(page: DocsPage, assets: typeof cdn, uiOptions: UiOptions) {
    const config = scriptJson({ url: page.documentUrl, dom_id: '#swagger-ui', ...uiOptions })

    return htmlPage(
      page,
      [`<link rel="stylesheet" href="${escapeHtml(assets.style)}" />`],
      [
        '<div id="swagger-ui"></div>',
        script(page, ` src="${escapeHtml(assets.script)}"`),
        script(page, '', `window.ui = SwaggerUIBundle(${config})`),
      ],
    )
  },
}
