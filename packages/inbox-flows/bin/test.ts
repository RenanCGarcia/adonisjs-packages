import { assert } from '@japa/assert'
import { configure, processCLIArgs, run } from '@japa/runner'

// The specs load the playground's `.env`, which sets TZ=UTC. Set it before any DateTime exists,
// or luxon moves the zone under the DateTimes made before the load.
process.env.TZ = 'UTC'

processCLIArgs(process.argv.splice(2))

configure({
  files: ['tests/**/*.spec.ts'],
  plugins: [assert()],
  timeout: 30_000,
})

void run()
