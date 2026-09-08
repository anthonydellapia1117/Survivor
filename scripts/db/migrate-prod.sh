#!/usr/bin/env bash
# Apply every migration file not yet recorded in production, one transaction
# each: the migration, a savepoint, the smoke check (scripts/db/smoke.sql),
# rollback to the savepoint, the tracking row, commit. If the smoke check
# raises, the whole transaction rolls back and the migration is not applied.
#
# "Applied" is judged by NAME against supabase_migrations.schema_migrations:
# the versions recorded there are the timestamps the Supabase tools applied
# at, not the file prefixes, so the name after the prefix is the identity.
#
#   SUPABASE_DB_URL=postgres://... bash scripts/db/migrate-prod.sh
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set. Add it as a repository secret (Settings > Secrets and variables > Actions): the Postgres connection string from the Supabase dashboard (Connect > Session pooler)." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SMOKE="$REPO_ROOT/scripts/db/smoke.sql"
applied="$(psql "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 -c "select name from supabase_migrations.schema_migrations")"

count=0
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$f" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  if grep -qx -- "$name" <<<"$applied"; then
    continue
  fi
  count=$((count + 1))
  echo "== applying $base"
  {
    echo "begin;"
    cat "$f"
    echo
    echo "savepoint smoke;"
    cat "$SMOKE"
    echo "rollback to savepoint smoke;"
    echo "insert into supabase_migrations.schema_migrations (version, name, statements)"
    echo "values ('$version', '$name', array[\$migration_body\$"
    cat "$f"
    echo "\$migration_body\$]);"
    echo "commit;"
  } | psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f -
  echo "== applied $base"
done

if [ "$count" = 0 ]; then
  echo "Nothing to apply: every migration file is recorded in production."
fi
