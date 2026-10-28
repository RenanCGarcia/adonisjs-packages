---
'@enzopita/adonisjs-openapi': minor
---

List a validated request body under one media type for each parser of the app's bodyparser: `application/json`, `application/x-www-form-urlencoded` and `multipart/form-data`, or the parser's first configured type. The media types reference one schema in `components.schemas`. The generator reads the parser types and `allowedMethods` from `config/bodyparser.ts`, and uses the bodyparser defaults for a setting it cannot read. A body with a file field is listed only under the multipart type. On a method missing from `allowedMethods`, the validator fields become query parameters.
