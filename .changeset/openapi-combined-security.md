---
'@enzopita/adonisjs-openapi': patch
---

A route behind several middleware mapped in `middlewareSecurity` now requires all their schemes together, in one Security Requirement Object. Before, each scheme was a separate entry of `security`, so the document listed them as alternatives.
