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

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

backup_mode="${LMS_BACKUP_MODE:-compose}"
mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$BACKUP_DIR/lms-${timestamp}.sql.gz"
checksum="$archive.sha256"
credential_file=""

cleanup() {
  if [[ -n "$credential_file" ]]; then rm -f "$credential_file"; fi
}
trap cleanup EXIT
umask 077

common_options=(--single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF --hex-blob)

if [[ "$backup_mode" == "compose" ]]; then
  : "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required for compose backup mode}"
  : "${MYSQL_DATABASE:?MYSQL_DATABASE is required for compose backup mode}"
  echo "[BACKUP] Creating transaction-consistent compose backup for $MYSQL_DATABASE."
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T mysql \
    sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF --hex-blob "$MYSQL_DATABASE"' \
    | gzip -9 > "$archive"
elif [[ "$backup_mode" == "remote" ]]; then
  : "${MYSQL_BACKUP_HOST:?MYSQL_BACKUP_HOST is required for remote backup mode}"
  : "${MYSQL_BACKUP_USER:?MYSQL_BACKUP_USER is required for remote backup mode}"
  : "${MYSQL_BACKUP_PASSWORD:?MYSQL_BACKUP_PASSWORD is required for remote backup mode}"
  : "${MYSQL_BACKUP_DATABASE:?MYSQL_BACKUP_DATABASE is required for remote backup mode}"
  backup_port="${MYSQL_BACKUP_PORT:-3306}"
  ssl_mode="${MYSQL_BACKUP_SSL_MODE:-REQUIRED}"
  case "$ssl_mode" in
    DISABLED|PREFERRED|REQUIRED|VERIFY_CA|VERIFY_IDENTITY) ;;
    *) echo "[BACKUP] Unsupported MYSQL_BACKUP_SSL_MODE: $ssl_mode" >&2; exit 64 ;;
  esac
  credential_file="$(mktemp)"
  chmod 600 "$credential_file"
  printf '[client]\npassword=%s\n' "$MYSQL_BACKUP_PASSWORD" > "$credential_file"
  echo "[BACKUP] Creating encrypted remote backup for $MYSQL_BACKUP_DATABASE at $MYSQL_BACKUP_HOST:$backup_port."
  docker run --rm --network host \
    -v "$credential_file:/run/secrets/mysql-backup.cnf:ro" \
    mysql:8.0 mysqldump \
      --defaults-extra-file=/run/secrets/mysql-backup.cnf \
      --host="$MYSQL_BACKUP_HOST" --port="$backup_port" --user="$MYSQL_BACKUP_USER" \
      --ssl-mode="$ssl_mode" "${common_options[@]}" "$MYSQL_BACKUP_DATABASE" \
    | gzip -9 > "$archive"
else
  echo "[BACKUP] LMS_BACKUP_MODE must be compose or remote." >&2
  exit 64
fi

if [[ ! -s "$archive" ]]; then
  echo "[BACKUP] Backup archive is empty." >&2
  exit 1
fi

sha256sum "$archive" > "$checksum"
gzip -t "$archive"

echo "[BACKUP] Created $archive"
echo "[BACKUP] Checksum $checksum"
