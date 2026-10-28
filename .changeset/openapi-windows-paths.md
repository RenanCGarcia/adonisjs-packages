---
'@enzopita/adonisjs-openapi': patch
---

Generate and check the document on Windows, where `path` gives `\` separators:

- `openapi:generate` and `openapi:check` failed with `Cannot read properties of undefined (reading 'statements')`, since the entry file's path never matched the `/` path TypeScript asks the compiler host for.
- The entry module imported the app's error body and `config/openapi.ts` through a `\` specifier, read as escapes, so every `errors.throwers` and `errors.middleware` entry got `OA-E001`.
- A function middleware a package creates, such as a `limiter.define()` throttle, got `OA-R003`, since its location kept `\` while the package directory resolved with `/`.
