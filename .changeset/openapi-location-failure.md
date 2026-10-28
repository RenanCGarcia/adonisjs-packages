---
'@enzopita/adonisjs-openapi': patch
---

A failure while locating the functions passed to `.use()` no longer hides its cause. Generation still succeeds, and reports `OA-R005` once with the error message, instead of leaving only `OA-R003` on the functions the lookup could not place. An unreadable source map fails only the functions of its script: the functions of other scripts are still located, and the diagnostic names the first error and how many more there were.
