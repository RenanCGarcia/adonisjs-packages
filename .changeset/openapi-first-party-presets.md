---
'@enzopita/adonisjs-openapi': minor
---

Document what the installed first-party packages throw without an `errors` entry: the `401` of `@adonisjs/auth` calls, the `400` of `verifyCredentials` and of `ally.user`, the `403` of `bouncer.authorize`, the `404` of Lucid's `findOrFail`, `findByOrFail` and `firstOrFail`, and the `429` of `limiter.consume` and of every throttle `limiter.define()` creates. An `errors` key replaces a preset, `false` turns it off (a `false` key that names no preset gets `OA-E003`), and `--explain` names the package.
