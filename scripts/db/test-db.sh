#!/usr/bin/env bash
# Spin up (or reuse) a throwaway local Postgres, build a fresh database from
# supabase/migrations, and optionally run SQL test files against it.
#
#   scripts/db/test-db.sh              # build schema, report OK
#   scripts/db/test-db.sh tests/*.sql  # build schema, run each SQL test file
#
# Requires postgresql-16 (present in CI image). DB name: survivor_test.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDIR="${SURVIVOR_PGDIR:-/tmp/pg}"
PGHOST_DIR="$PGDIR"
DB=survivor_test

run_as_pg() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -s /bin/bash -c "$1"
  else
    bash -c "$1"
  fi
}

if ! "$PGBIN/pg_isready" -h "$PGHOST_DIR" -U postgres -q 2>/dev/null; then
  mkdir -p "$PGDIR"
  [ "$(id -u)" = "0" ] && chown postgres:postgres "$PGDIR"
  if [ ! -d "$PGDIR/data" ]; then
    run_as_pg "$PGBIN/initdb -D $PGDIR/data -U postgres -A trust" >/dev/null
  fi
  run_as_pg "$PGBIN/pg_ctl -D $PGDIR/data -o '-k $PGHOST_DIR -c listen_addresses=\"\"' -l $PGDIR/log start" >/dev/null
fi

export PGHOST="$PGHOST_DIR" PGUSER=postgres

dropdb --if-exists "$DB" 2>/dev/null || true
createdb "$DB"

# The RLS migration runs `alter database postgres set app.admin_email`; mirror
# that on the test database since it is not named postgres.
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/scripts/db/supabase_stub.sql"

for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  sed "s/alter database postgres set/alter database $DB set/" "$f" \
    | psql -q -d "$DB" -v ON_ERROR_STOP=1 -f -
done

echo "migrations OK ($(ls "$REPO_ROOT"/supabase/migrations/*.sql | wc -l) files)"

# The section 9 roster is the test fixture.
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/seed.sql" >/dev/null
echo "seed OK"

status=0
for t in "$@"; do
  if psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$t" >/dev/null; then
    echo "PASS $t"
  else
    echo "FAIL $t"
    status=1
  fi
done
exit $status
