---
'@enzopita/adonisjs-inbox': minor
---

`inbox.model(role)` returns the model `config.models` maps to a role, so a package building on the inbox can read its rows. `bootApp` from `@enzopita/adonisjs-inbox/testing` takes a third argument with more providers and config files, so such a package's specs boot its provider next to the inbox's.
