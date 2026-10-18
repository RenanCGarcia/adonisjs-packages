import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

// `node ace generate:key` boots the app, which needs the codegen output, which needs the key.
if (!existsSync('.env')) {
  const key = randomBytes(32).toString('base64url')
  writeFileSync(
    '.env',
    readFileSync('.env.example', 'utf8').replace(/^APP_KEY=$/m, `APP_KEY=${key}`),
  )
}
