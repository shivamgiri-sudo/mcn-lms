#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env.staging}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[BACKUP] Missing environment file: $ENV_FILE" >&2
  exit 64
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$BACKUP_DIR/lms-${timestamp}.sql.gz"
checksum="$archive.sha256"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"

umask 077

echo "[BACKUP] Creating transaction-consistent backup for $MYSQL_DATABASE."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF "$MYSQL_DATABASE"' \
  | gzip -9 > "$archive"

if [[ ! -s "$archive" ]]; then
  echo "[BACKUP] Backup archive is empty." >&2
  exit 1
fi

sha256sum "$archive" > "$checksum"
gzip -t "$archive"

echo "[BACKUP] Created $archive"
echo "[BACKUP] Checksum $checksum"
