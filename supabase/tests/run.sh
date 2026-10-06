#!/usr/bin/env bash
# Database tests: migrations, import_sheet() and RLS policies.
# Needs psql and an EMPTY, throwaway Postgres 15+ database:
#   TEST_DATABASE_URL=postgres://postgres@localhost:5432/cf_test npm run test:db
set -euo pipefail
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to an empty, throwaway Postgres database}"
here="$(cd "$(dirname "$0")" && pwd)"
run() { psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -X "$@"; }

if [ "$(run -Atc "select count(*) from pg_tables where schemaname = 'public'")" != "0" ]; then
  echo "TEST_DATABASE_URL must point at an empty database (public schema has tables)." >&2
  exit 1
fi
run -f "$here/supabase-shim.sql"
for f in "$here"/../migrations/*.sql; do run -f "$f"; done
run -o /dev/null -f "$here/import_rls.test.sql"
