#!/usr/bin/env sh
set -eu

read_env() {
  printenv "$1" 2>/dev/null || true
}

require_value() {
  name="$1"
  value="$(read_env "$name")"
  if [ -z "$value" ]; then
    echo "[ENTRYPOINT] Required environment variable is missing: $name" >&2
    exit 64
  fi
}

require_secret() {
  name="$1"
  value="$(read_env "$name")"
  if [ "${#value}" -lt 32 ]; then
    echo "[ENTRYPOINT] $name must contain at least 32 characters." >&2
    exit 64
  fi
}

require_value DATABASE_URL
require_value FRONTEND_URL

if [ "${NODE_ENV:-production}" = "production" ]; then
  require_secret SESSION_SECRET
  require_secret CSRF_SECRET
  require_secret SESSION_FINGERPRINT_SECRET
  require_secret OAUTH_STATE_SECRET
  require_secret HRMS_ASSERTION_SECRET
  require_value HRMS_ASSERTION_ISSUER
  require_value HRMS_ASSERTION_AUDIENCE
  require_secret HR_API_KEY
  require_secret GOOGLE_TOKEN_ENCRYPTION_KEY

  if [ "${BRIDGE_ALLOW_LEGACY_SECRET:-false}" = "true" ]; then
    require_secret BRIDGE_SECRET
  fi
  if [ "${SESSION_COOKIE_SAME_SITE:-lax}" = "none" ] && [ "${SESSION_COOKIE_SECURE:-true}" != "true" ]; then
    echo "[ENTRYPOINT] SameSite=None requires SESSION_COOKIE_SECURE=true." >&2
    exit 64
  fi
  if [ "${LMS_ALLOW_BEARER_SESSION_COMPAT:-false}" = "true" ]; then
    echo "[ENTRYPOINT] Warning: legacy Bearer session compatibility is enabled." >&2
  fi
fi

mkdir -p "${UPLOAD_DIR:-uploads}/content" "${UPLOAD_DIR:-uploads}/scorm"

if [ "${LMS_RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[ENTRYPOINT] Applying forward-only Prisma migrations."
  ./node_modules/.bin/prisma migrate deploy
fi

exec "$@"
