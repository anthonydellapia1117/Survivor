#!/usr/bin/env bash
# Apply every migration file not yet recorded in production as ONE
# transaction for the whole pending batch: for each file, the migration, a
# savepoint, the smoke check (scripts/db/smoke.sql), rollback to the
# savepoint, the tracking row; then a single commit at the end. If anything
# raises - a later file or its smoke check included - psql stops before the
# commit and the connection closes with the transaction open, so nothing in
# the batch is applied. Production carries every pending file or none of
# them, never the first few with the rest missing.
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

pending=()
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  base="$(basename "$f" .sql)"
  name="${base#*_}"
  if grep -qx -- "$name" <<<"$applied"; then
    continue
  fi
  pending+=("$f")
done

if [ "${#pending[@]}" = 0 ]; then
  echo "Nothing to apply: every migration file is recorded in production."
  exit 0
fi

echo "== batch of ${#pending[@]} migration(s), one transaction:"
for f in "${pending[@]}"; do echo "   $(basename "$f" .sql)"; done

{
  echo "begin;"
  for f in "${pending[@]}"; do
    base="$(basename "$f" .sql)"
    version="${base%%_*}"
    name="${base#*_}"
    echo "\\echo == applying $base"
    cat "$f"
    echo
    echo "savepoint smoke;"
    cat "$SMOKE"
    echo "rollback to savepoint smoke;"
    echo "insert into supabase_migrations.schema_migrations (version, name, statements)"
    echo "values ('$version', '$name', array[\$migration_body\$"
    cat "$f"
    echo "\$migration_body\$]);"
    echo "\\echo == applied $base, smoke check passed, not yet committed"
  done
  echo "commit;"
  echo "\\echo == committed ${#pending[@]} migration(s)"
} | psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f -
