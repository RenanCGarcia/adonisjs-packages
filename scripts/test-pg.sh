#!/usr/bin/env sh
# Runs the package suites against the compose Postgres, on its playground_test database. One
# suite at a time: Lucid refuses a migration run while another holds the pg migration lock.
set -eu

export DB_CONNECTION=pg DB_HOST=127.0.0.1 DB_PORT=55432 DB_USER=postgres DB_PASSWORD=postgres
export DB_DATABASE=playground_test

pnpm db:up
pnpm turbo build --filter='./packages/*'
pnpm --filter playground exec node ace migration:run --force --no-schema-generate
pnpm turbo test --concurrency=1
