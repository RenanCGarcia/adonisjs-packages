import type { DocsPage, UiOptions } from '../types.ts'
import { htmlPage, script, scriptJson } from './html.ts'

const cdn = {
  script: 'https://cdn.jsdelivr.net/npm/redoc@3/bundles/redoc.standalone.js',
}

export const redoc = {
  cdn,

  /**
   * Redoc 3 ships its standalone bundle as an ES module, so `init` is imported instead of read from `window`.
   */
  render(page: DocsPage, assets: typeof cdn, uiOptions: UiOptions) {
    const init = [
      `import { init } from ${scriptJson(assets.script)}`,
      `init(${scriptJson(page.documentUrl)}, ${scriptJson(uiOptions)}, document.getElementById('redoc'))`,
    ].join('\n')

    return htmlPage(page, [], ['<div id="redoc"></div>', script(page, ' type="module"', init)])
  },
}
