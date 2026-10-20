import { Env } from '@adonisjs/core/env'

// Called during validation, once the `.env` files are loaded into `process.env`.
const sqlite = () => process.env.DB_CONNECTION !== 'pg'

export default await Env.create(new URL('../', import.meta.url), {
  DB_CONNECTION: Env.schema.enum.optional(['sqlite', 'pg'] as const),
  DB_HOST: Env.schema.string.optionalWhen(sqlite, { format: 'host' }),
  DB_PORT: Env.schema.number.optionalWhen(sqlite),
  DB_USER: Env.schema.string.optionalWhen(sqlite),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string.optionalWhen(sqlite),
})
