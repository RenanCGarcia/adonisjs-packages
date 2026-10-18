import { test } from '@japa/runner'
import { renderPage } from '../src/docs/ui.ts'
import type { DocsPage, DocsUi } from '../src/types.ts'

const page: DocsPage = { title: 'Acme API', documentUrl: 'docs/openapi.json' }

test.group('docs page renderers', () => {
  test('renders {$i}')
    .with<{ options: DocsUi; assets: string[]; init: string }[]>([
      {
        options: {},
        assets: [
          '<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1/dist/browser/standalone.js"></script>',
        ],
        init: `Scalar.createApiReference('#app', {"url":"docs/openapi.json"})`,
      },
      {
        options: { ui: 'swagger-ui' },
        assets: [
          '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />',
          '<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>',
        ],
        init: 'SwaggerUIBundle({"url":"docs/openapi.json","dom_id":"#swagger-ui"})',
      },
      {
        options: { ui: 'redoc' },
        assets: [
          'import { init } from "https://cdn.jsdelivr.net/npm/redoc@3/bundles/redoc.standalone.js"',
        ],
        init: `init("docs/openapi.json", {}, document.getElementById('redoc'))`,
      },
    ])
    .run(({ assert }, { options, assets, init }) => {
      const html = renderPage(options, page)

      assert.isTrue(html.startsWith('<!doctype html>\n'))
      assert.include(html, '<title>Acme API</title>')

      for (const asset of assets) assert.include(html, asset)
      assert.include(html, init)
    })

  test('passes uiOptions to the init call and replaces the CDN assets', ({ assert }) => {
    const html = renderPage(
      {
        ui: 'swagger-ui',
        uiOptions: { deepLinking: true },
        cdn: { script: '/assets/swagger.js', style: '/assets/swagger.css' },
      },
      page,
    )

    assert.include(html, '<script src="/assets/swagger.js"></script>')
    assert.include(html, '<link rel="stylesheet" href="/assets/swagger.css" />')
    assert.notInclude(html, 'cdn.jsdelivr.net')
    assert.include(html, '"dom_id":"#swagger-ui","deepLinking":true')
  })

  test('serves the HTML a custom renderer returns', ({ assert }) => {
    const pages: DocsPage[] = []

    const html = renderPage(
      {
        ui: docsPage => {
          pages.push(docsPage)

          return `<h1>${docsPage.title}</h1>`
        },
      },
      page,
    )

    assert.equal(html, '<h1>Acme API</h1>')
    assert.deepEqual(pages, [page])
  })

  test('escapes < in the embedded JSON and HTML in the title', ({ assert }) => {
    const html = renderPage(
      { uiOptions: { customCss: '</script><script>alert(1)</script>' } },
      { ...page, title: '</title><script>alert(1)</script>' },
    )

    assert.notInclude(html, '<script>alert(1)')
    assert.include(html, '"customCss":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"')
    assert.include(html, '<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>')
  })

  test('sets the CSP nonce on every script', ({ assert }) => {
    const html = renderPage({}, { ...page, nonce: 'abc123' })
    const scripts = html.match(/<script[^>]*>/g) ?? []

    assert.lengthOf(scripts, 2)

    for (const tag of scripts) assert.include(tag, 'nonce="abc123"')
  })
})
