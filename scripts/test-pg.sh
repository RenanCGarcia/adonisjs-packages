#!/usr/bin/env sh
# Runs the inbox and inbox-flows suites against the compose Postgres, each on a database of its
# own, since their fixture apps migrate different tables. One suite at a time: Lucid refuses a
# migration run while another holds the pg migration lock. The openapi fixture is sqlite only.
set -eu

export DB_CONNECTION=pg DB_HOST=127.0.0.1 DB_PORT=55432 DB_USER=postgres DB_PASSWORD=postgres

pnpm db:up
pnpm turbo build --filter='./packages/*'

for package in inbox inbox-flows; do
  database="$(echo "$package" | tr - _)_test"

  docker compose exec -T pgsql psql -U postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = '$database'" | grep -q 1 ||
    docker compose exec -T pgsql createdb -U postgres "$database"

  DB_DATABASE="$database" pnpm --filter "@enzopita/adonisjs-$package" test
done
