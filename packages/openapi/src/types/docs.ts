import type { HttpContext } from '@adonisjs/core/http'
import type { OpenApiDocument } from './document.ts'
import type { Json } from './json.ts'

/**
 * What a docs UI needs to render its page.
 */
export interface DocsPage {
  title: string
  /**
   * Relative to the page, so the page keeps working behind a proxy that adds a path prefix.
   */
  documentUrl: string
  /**
   * The CSP nonce Shield sets on the response, when CSP is enabled.
   */
  nonce?: string
}

/**
 * Serialized as JSON into the UI's own init call.
 */
export type UiOptions = { [key: string]: Json }

export type DocsUi =
  | { ui?: 'scalar'; uiOptions?: UiOptions; cdn?: { script?: string } }
  | { ui: 'swagger-ui'; uiOptions?: UiOptions; cdn?: { script?: string; style?: string } }
  | { ui: 'redoc'; uiOptions?: UiOptions; cdn?: { script?: string } }
  | { ui: (page: DocsPage) => string; uiOptions?: never; cdn?: never }

export type DocsOptions = DocsUi & {
  /**
   * Path of the page. The document is served at `<prefix>/openapi.json`.
   */
  prefix?: string
  title?: string
  /**
   * `live` generates the document on each request and needs the app's TypeScript
   * sources. `file` serves the file `node ace openapi:generate` wrote at the config `output`.
   */
  source?: 'live' | 'file'
  transform?: (
    document: OpenApiDocument,
    ctx: HttpContext,
  ) => OpenApiDocument | Promise<OpenApiDocument>
}
