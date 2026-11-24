MIGRATIONS_DIR="database/migrations"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
    echo "⚠️  '$MIGRATIONS_DIR' directory not found."
    exit 0
fi

echo "📂  Migration files on disk:"
ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | xargs -I{} basename {} || echo "  (none)"

echo ""
echo "🗄️   Checking applied migrations in DB..."

# Query the tracking table — adjust connection vars to match your .env
APPLIED=$(psql "$DATABASE_URL" -t -c \
    "SELECT filename FROM schema_migrations ORDER BY filename;" 2>/dev/null \
    || echo "DB_QUERY_FAILED")

if [[ "$APPLIED" == "DB_QUERY_FAILED" ]]; then
    echo "⚠️  Could not connect to DB or schema_migrations table doesn't exist."
    echo "   Make sure DATABASE_URL is set and the container is running."
    exit 0
fi

echo "✅  Applied migrations:"
echo "$APPLIED"

echo ""
echo "🔍  Checking for pending (unapplied) files..."
PENDING=0
for FILE in "$MIGRATIONS_DIR"/*.sql; do
    BASENAME=$(basename "$FILE")
    if ! echo "$APPLIED" | grep -q "$BASENAME"; then
        echo "  ⏳ PENDING: $BASENAME"
        PENDING=$((PENDING + 1))
    fi
done

if [[ $PENDING -eq 0 ]]; then
    echo "  All migrations applied ✅"
fi
