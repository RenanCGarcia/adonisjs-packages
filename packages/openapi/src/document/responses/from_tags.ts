import type { ResponseTag } from '../../analysis/tags/response_tag.ts'
import { underivedResponse } from '../../diagnostics/route.ts'
import { addThrown, type ResponseContext } from './context.ts'

/**
 * The tags to document, a declared body first so a reason alone can describe the status it
 * declares, and the reasons for a status nothing documents.
 */
export function applicable(tags: ResponseTag[], documented: (code: string) => boolean) {
  const declared = tags.filter(({ body }) => body)
  const codes = new Set(declared.map(({ code }) => code))
  const described = tags.filter(({ body }) => !body)
  const derived = ({ code }: ResponseTag) => documented(code) || codes.has(code)

  return {
    apply: [...declared, ...described.filter(derived)],
    underived: described.filter(tag => !derived(tag)),
  }
}

/**
 * `@response {404} reason` describes a status the other sources document, and
 * `@response {502} {UpstreamError}` declares a status and its body.
 */
export function fromResponseTags(context: ResponseContext, tags: ResponseTag[]) {
  const { app, route, outcomes, diagnostics } = context
  const { apply, underived } = applicable(tags, code => outcomes.has(code))

  for (const { code, body, reason, tag } of apply)
    addThrown(
      context,
      { kind: 'tag', tag: '@response', location: app.locate(tag) },
      code,
      body ? [body] : [],
      { reason },
    )

  for (const { code, tag } of underived)
    diagnostics.push(underivedResponse(route.name, code, app.locate(tag)))
}
