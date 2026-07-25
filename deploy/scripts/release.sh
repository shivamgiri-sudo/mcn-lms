#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env.staging}"
NEW_IMAGE="${NEW_IMAGE:-}"
PREVIOUS_IMAGE="${PREVIOUS_IMAGE:-}"

if [[ -z "$NEW_IMAGE" ]]; then
  echo "[RELEASE] NEW_IMAGE is required." >&2
  exit 64
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[RELEASE] Missing environment file: $ENV_FILE" >&2
  exit 64
fi

export LMS_IMAGE="$NEW_IMAGE"

"$ROOT_DIR/deploy/scripts/backup.sh"

echo "[RELEASE] Pulling immutable image $NEW_IMAGE."
docker pull "$NEW_IMAGE"

echo "[RELEASE] Running forward-only migrations before application cutover."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrate

echo "[RELEASE] Starting web and worker services."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps app worker

if BASE_URL="${BASE_URL:-http://127.0.0.1:${LMS_HTTP_PORT:-4000}}" "$ROOT_DIR/deploy/scripts/smoke-test.sh"; then
  echo "[RELEASE] Release candidate is healthy."
  exit 0
fi

echo "[RELEASE] Smoke tests failed." >&2
if [[ -n "$PREVIOUS_IMAGE" ]]; then
  echo "[RELEASE] Attempting application rollback to $PREVIOUS_IMAGE." >&2
  PREVIOUS_IMAGE="$PREVIOUS_IMAGE" "$ROOT_DIR/deploy/scripts/rollback.sh"
fi
exit 1
