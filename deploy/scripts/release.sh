#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.staging.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env.staging}"
RELEASE_MANIFEST_FILE="${RELEASE_MANIFEST_FILE:-$ROOT_DIR/deploy/release-manifest.json}"
requested_new_image="${NEW_IMAGE:-}"
requested_previous_image="${PREVIOUS_IMAGE:-}"

if [[ -z "$requested_new_image" ]]; then
  echo "[RELEASE] NEW_IMAGE is required." >&2
  exit 64
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[RELEASE] Missing environment file: $ENV_FILE" >&2
  exit 64
fi
if [[ ! -f "$RELEASE_MANIFEST_FILE" ]]; then
  echo "[RELEASE] Missing approved release manifest: $RELEASE_MANIFEST_FILE" >&2
  exit 64
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

NEW_IMAGE="$requested_new_image"
PREVIOUS_IMAGE="$requested_previous_image"
LMS_IMAGE="$NEW_IMAGE"
LMS_SERVICE_ENV_FILE="$ENV_FILE"
release_commit_sha="${RELEASE_COMMIT_SHA:-$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)}"
if [[ ! "$release_commit_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[RELEASE] RELEASE_COMMIT_SHA must be the exact 40-character release commit." >&2
  exit 64
fi

export NEW_IMAGE PREVIOUS_IMAGE LMS_IMAGE LMS_SERVICE_ENV_FILE COMPOSE_FILE ENV_FILE RELEASE_MANIFEST_FILE
release_base_url="${BASE_URL:-${LMS_RELEASE_BASE_URL:-http://127.0.0.1:${LMS_HTTP_PORT:-4000}}}"

echo "[RELEASE] Validating immutable image, commit, approvals and guardrails."
EXPECTED_COMMIT_SHA="$release_commit_sha" EXPECTED_IMAGE="$NEW_IMAGE" \
  node "$ROOT_DIR/deploy/scripts/validate-release-manifest.mjs" "$RELEASE_MANIFEST_FILE"

COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" bash "$ROOT_DIR/deploy/scripts/backup.sh"

echo "[RELEASE] Pulling immutable image $NEW_IMAGE."
docker pull "$NEW_IMAGE"

echo "[RELEASE] Running forward-only migrations before application cutover."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrate

echo "[RELEASE] Starting web and worker services."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps app worker

if ! BASE_URL="$release_base_url" bash "$ROOT_DIR/deploy/scripts/smoke-test.sh"; then
  echo "[RELEASE] Smoke tests failed." >&2
  if [[ -n "$PREVIOUS_IMAGE" ]]; then
    echo "[RELEASE] Attempting authorized application rollback to $PREVIOUS_IMAGE." >&2
    PREVIOUS_IMAGE="$PREVIOUS_IMAGE" COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" BASE_URL="$release_base_url" \
      bash "$ROOT_DIR/deploy/scripts/rollback.sh"
  fi
  exit 1
fi

if [[ "${LMS_RUN_LOAD_SMOKE:-true}" == "true" ]]; then
  echo "[RELEASE] Running bounded post-cutover load smoke."
  if ! docker run --rm --network host --entrypoint node \
    -e BASE_URL="$release_base_url" \
    -e LOAD_CONCURRENCY="${LOAD_CONCURRENCY:-25}" \
    -e LOAD_REQUESTS="${LOAD_REQUESTS:-500}" \
    -e LOAD_P95_LIMIT_MS="${LOAD_P95_LIMIT_MS:-1500}" \
    -e LOAD_MAX_ERROR_PCT="${LOAD_MAX_ERROR_PCT:-1}" \
    -e LOAD_REQUEST_TIMEOUT_MS="${LOAD_REQUEST_TIMEOUT_MS:-5000}" \
    -v "$ROOT_DIR/deploy/scripts/load-smoke.mjs:/tmp/load-smoke.mjs:ro" \
    "$NEW_IMAGE" /tmp/load-smoke.mjs; then
    echo "[RELEASE] Load smoke failed; activate rollout kill switches before investigation." >&2
    exit 1
  fi
fi

echo "[RELEASE] Release candidate passed manifest, backup, migration, smoke and load guardrails."
