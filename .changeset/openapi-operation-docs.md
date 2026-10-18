---
'@enzopita/adonisjs-openapi': minor
---

Operations and responses now carry more of what the app already says, still with no annotations to import:

- The doc comment on a controller method gives the operation its `summary`, `description` and `deprecated` flag. `@tags` sets its tags, on the method or on the class, and `@throws {404} User not found` adds a response.
- Status codes come from the response helper the handler returns, such as `response.created()` or `response.noContent()`, with or without Tuyau installed. Bodyless responses such as `204` have no `content`.
- Routes behind a middleware mapped in `middlewareSecurity` get a `401` response.
- The transformer types in `.adonisjs/client/data.d.ts` become named schemas in `components.schemas`, referenced with `$ref`. The `422` body is the shared `ValidationError` schema.
- The config accepts top-level `tags` and the full OpenAPI Info Object (`summary`, `termsOfService`, `contact`, `license`).
