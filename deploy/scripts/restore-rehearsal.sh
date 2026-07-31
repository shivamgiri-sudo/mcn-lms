#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env.staging}"
BACKUP_FILE="${1:-}"

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Usage: $0 /path/to/lms-backup.sql.gz" >&2
  exit 64
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[RESTORE] Missing environment file: $ENV_FILE" >&2
  exit 64
fi
if [[ -f "$BACKUP_FILE.sha256" ]]; then
  sha256sum --check "$BACKUP_FILE.sha256"
fi
gzip -t "$BACKUP_FILE"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
rehearsal_db="lms_restore_$(date -u +%Y%m%d%H%M%S)_$RANDOM"

mysql_exec() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql \
    mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$@"
}

cleanup() {
  mysql_exec -e "DROP DATABASE IF EXISTS \`$rehearsal_db\`;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mysql_exec -e "CREATE DATABASE \`$rehearsal_db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
zcat "$BACKUP_FILE" | mysql_exec "$rehearsal_db"

table_count="$(mysql_exec -N "$rehearsal_db" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$rehearsal_db';")"
runtime_table_count="$(mysql_exec -N "$rehearsal_db" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$rehearsal_db' AND table_name IN ('platform_runtime_lease','platform_runtime_instance','platform_feature_flag');")"
audit_table_count="$(mysql_exec -N "$rehearsal_db" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$rehearsal_db' AND table_name='audit_log';")"

if (( table_count < 30 )); then
  echo "[RESTORE] Restored schema has too few tables: $table_count" >&2
  exit 1
fi
[[ "$runtime_table_count" == "3" ]] || { echo "[RESTORE] Runtime governance tables are incomplete." >&2; exit 1; }
[[ "$audit_table_count" == "1" ]] || { echo "[RESTORE] Audit table is missing." >&2; exit 1; }

mysql_exec "$rehearsal_db" -e "CHECK TABLE platform_runtime_lease, platform_runtime_instance, platform_feature_flag, audit_log;" >/dev/null

echo "[RESTORE] Rehearsal succeeded in isolated database $rehearsal_db with $table_count tables."
