import type { DocsPage, DocsUi, UiOptions } from '../types.ts'
import { redoc } from './redoc.ts'
import { scalar } from './scalar.ts'
import { swaggerUi } from './swagger_ui.ts'

const renderers = { scalar, 'swagger-ui': swaggerUi, redoc }

type Assets = { [Ui in keyof typeof renderers]: (typeof renderers)[Ui]['cdn'] }

type Renderers = {
  [Ui in keyof Assets]: {
    cdn: Assets[Ui]
    render(page: DocsPage, assets: Assets[Ui], uiOptions: UiOptions): string
  }
}

function renderBuiltIn<Ui extends keyof Assets>(
  ui: Ui,
  page: DocsPage,
  cdn: Partial<Assets[Ui]> | undefined,
  uiOptions: UiOptions,
) {
  const renderer: Renderers[Ui] = renderers[ui]

  return renderer.render(page, { ...renderer.cdn, ...cdn }, uiOptions)
}

export function renderPage(options: DocsUi, page: DocsPage) {
  if (options.ui instanceof Function) return options.ui(page)

  return renderBuiltIn(options.ui ?? 'scalar', page, options.cdn, options.uiOptions ?? {})
}
