import { readFile } from 'node:fs/promises'
import { basename } from 'node:path/posix'
import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import { createError } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'
import { defineConfig } from '../define_config.ts'
import type { DocsOptions, OpenApiConfig, OpenApiDocument } from '../types.ts'
import { renderPage } from './ui.ts'

const E_OPENAPI_DOCUMENT_MISSING = createError<[string]>(
  'Cannot find the OpenAPI document at "%s". Run "node ace openapi:generate", or register the "@enzopita/adonisjs-openapi/build_hook" build hook so "node ace build" writes it',
  'E_OPENAPI_DOCUMENT_MISSING',
  500,
)

function openapiConfig() {
  return app.config.get<OpenApiConfig | undefined>('openapi') ?? defineConfig()
}

/**
 * The page is served at `<prefix>` and the document at `<prefix>/openapi.json`, so the
 * document URL only depends on the last segment of the URL the page was requested with.
 */
function documentUrl(pagePath: string) {
  return pagePath.endsWith('/') ? 'openapi.json' : `${basename(pagePath)}/openapi.json`
}

/**
 * Shield sets the nonce when CSP is enabled. This package does not depend on Shield, so its type is not augmented here.
 */
function cspNonce(response: HttpContext['response']) {
  return 'nonce' in response ? String(response.nonce) : undefined
}

async function generateLive() {
  // Loaded on demand: it pulls in the assembler, a dev dependency that a production install leaves out.
  const { generateDocument } = await import('../generate.ts')
  const { document } = await generateDocument(app, router, openapiConfig())

  return document
}

async function readGenerated(file: string): Promise<OpenApiDocument> {
  const path = app.makePath(file)

  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new E_OPENAPI_DOCUMENT_MISSING([app.relativePath(path)], { cause: error })
    }

    throw error
  }
}

function documentSource(options: DocsOptions): () => Promise<OpenApiDocument> {
  const source = options.source ?? (app.inProduction ? 'file' : 'live')

  if (source === 'live') return generateLive

  const file = () => options.file ?? openapiConfig().output

  if (!app.inProduction) return () => readGenerated(file())

  let cached: OpenApiDocument | undefined

  return async () => (cached ??= await readGenerated(file()))
}

/**
 * Registers the docs page and the document it renders, as closure routes so the
 * generator leaves them out of the document.
 */
export function openapiRoutes(options: DocsOptions = {}) {
  const loadDocument = documentSource(options)

  return router
    .group(() => {
      router
        .get('/', ({ request, response }) => {
          const page = renderPage(options, {
            title: options.title ?? openapiConfig().info.title,
            documentUrl: documentUrl(request.url()),
            nonce: cspNonce(response),
          })

          response.header('content-type', 'text/html; charset=utf-8')

          return page
        })
        .as('openapi.ui')

      router
        .get('/openapi.json', async ctx => {
          const document = await loadDocument()

          // A copy, so a transform that edits the document in place cannot leak into the cached one.
          return options.transform ? options.transform(structuredClone(document), ctx) : document
        })
        .as('openapi.document')
    })
    .prefix(options.prefix ?? '/docs')
}
