import { assert } from '@japa/assert'
import { configure, processCLIArgs, run } from '@japa/runner'

// One zone for the specs and the fixture's ace commands, which inherit it, so they read back the
// timestamps the other wrote. Set before any DateTime exists, or luxon moves the zone under it.
process.env.TZ = 'UTC'

processCLIArgs(process.argv.splice(2))

configure({
  files: ['tests/**/*.spec.ts'],
  plugins: [assert()],
  timeout: 30_000,
})

void run()
