#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env.staging}"
requested_previous_image="${PREVIOUS_IMAGE:-}"
requested_allow_rollback="${ALLOW_APPLICATION_ROLLBACK:-}"
requested_compatibility="${MIGRATION_COMPATIBILITY:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ROLLBACK] Missing environment file: $ENV_FILE" >&2
  exit 64
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

PREVIOUS_IMAGE="${requested_previous_image:-${PREVIOUS_IMAGE:-}}"
ALLOW_APPLICATION_ROLLBACK="${requested_allow_rollback:-${ALLOW_APPLICATION_ROLLBACK:-false}}"
MIGRATION_COMPATIBILITY="${requested_compatibility:-${MIGRATION_COMPATIBILITY:-unknown}}"
LMS_IMAGE="$PREVIOUS_IMAGE"
LMS_SERVICE_ENV_FILE="$ENV_FILE"
export PREVIOUS_IMAGE ALLOW_APPLICATION_ROLLBACK MIGRATION_COMPATIBILITY LMS_IMAGE LMS_SERVICE_ENV_FILE COMPOSE_FILE ENV_FILE
rollback_base_url="${BASE_URL:-${LMS_RELEASE_BASE_URL:-http://127.0.0.1:${LMS_HTTP_PORT:-4000}}}"

if [[ -z "$PREVIOUS_IMAGE" ]]; then
  echo "[ROLLBACK] PREVIOUS_IMAGE is required." >&2
  exit 64
fi
if [[ "$ALLOW_APPLICATION_ROLLBACK" != "true" ]]; then
  echo "[ROLLBACK] Set ALLOW_APPLICATION_ROLLBACK=true after an authorised rollback decision." >&2
  exit 65
fi
if [[ "$MIGRATION_COMPATIBILITY" != "backward-compatible" ]]; then
  echo "[ROLLBACK] Application rollback is blocked because the deployed migration set is not declared backward-compatible." >&2
  exit 65
fi

docker pull "$PREVIOUS_IMAGE"

echo "[ROLLBACK] Rolling back application containers only. Database migrations remain forward-only."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps app worker

BASE_URL="$rollback_base_url" bash "$ROOT_DIR/deploy/scripts/smoke-test.sh"
echo "[ROLLBACK] Application rollback succeeded. Database state was not reversed."
