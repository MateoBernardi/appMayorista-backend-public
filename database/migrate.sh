#!/bin/sh
set -eu

_run_migrations() {
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

    # Load .env if present
    if [ -f "$SCRIPT_DIR/.env" ]; then
        while IFS= read -r line; do
            case "$line" in '#'*|'') continue ;; esac
            key="${line%%=*}"
            val="${line#*=}"
            val="${val#\"}" ; val="${val%\"}"
            val="${val#\'}" ; val="${val%\'}"
            export "$key=$val" 2>/dev/null || true
        done < "$SCRIPT_DIR/.env"
    fi

    if [ -z "${DATABASE_URL:-}" ] && [ -n "${PG_USER:-}" ]; then
        DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@/${PG_DB}?host=/var/run/postgresql"
    fi
    if [ -z "${DATABASE_URL:-}" ]; then
        echo "❌  DATABASE_URL is not set."
        return 1
    fi

    echo "🔌 Connecting to Postgres..."

    psql "$DATABASE_URL" -c "
        CREATE TABLE IF NOT EXISTS migration_history (
            filename   VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    "

    MIGRATIONS_DIR="$SCRIPT_DIR/../migrations"
    if [ ! -d "$MIGRATIONS_DIR" ]; then
        echo "ℹ️  No migrations directory found — nothing to apply."
        return 0
    fi

    FOUND=0
    for FILE in $(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" | sort); do
        FOUND=1
        FILENAME="$(basename "$FILE")"

        APPLIED="$(psql "$DATABASE_URL" -t -c "SELECT 1 FROM migration_history WHERE filename = '$FILENAME'" | tr -d '[:space:]')"

        if [ -z "$APPLIED" ]; then
            echo "=> Applying $FILENAME..."
            psql "$DATABASE_URL" --single-transaction \
                -f "$FILE" \
                -c "INSERT INTO migration_history (filename) VALUES ('$FILENAME')"
            echo "✅ $FILENAME applied successfully."
        else
            echo "=> Skipping $FILENAME (already applied)."
        fi
    done

    if [ "$FOUND" -eq 0 ]; then
        echo "ℹ️  No .sql migration files found."
    fi

    echo "🎉 All migrations are up to date."
}

_run_migrations
