import type { HttpMethod } from '../types.ts'

/**
 * One named route as the generator sees it: where it lives, and the TypeScript
 * expressions the routes scanner extracted for its input and output.
 */
export interface RouteOperation {
  name: string
  /**
   * The route name, with a suffix on the path without an optional param, such as `users.show.without_id`.
   */
  operationId: string
  methods: HttpMethod[]
  path: string
  routerPattern: string
  pathParams: string[]
  middleware: string[]
  inlineMiddleware: { name: string; source: string; fn: Function }[]
  requestType?: string
  responseType?: string
  imports: string[]
  validator?: { specifier: string; exportName: string }
  controller?: { path: string; method: string }
}
