---
'@enzopita/adonisjs-openapi': minor
---

An `error instanceof A && …` branch of the exception handler now adds its body to the responses of `A`, which still goes on to the next step, instead of joining the generic error body. `errors.throwers` keys now also match calls in the `handle()` of the route's middleware, and the response names that middleware as its source.
