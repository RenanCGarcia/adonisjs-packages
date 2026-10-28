---
'@enzopita/adonisjs-openapi': minor
---

Accept an array of exception classes as an `errors.throwers` or `errors.middleware` value, and document one response per class. The `ally.user` preset now documents the `500` of `E_OAUTH_MISSING_CODE` next to the `400` of `E_OAUTH_STATE_MISMATCH`. An `OA-E001` for an array names the item. The value type accepts a `readonly` array, so `as const` typechecks, and a spread of an array literal or const adds its classes. A spread the generator cannot read gets an `OA-E001` on its own.

A const that holds the array is followed to its initializer, and an empty array gets `OA-E003`.
