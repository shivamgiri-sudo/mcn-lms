#!/usr/bin/env sh
set -eu

require_value() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "[ENTRYPOINT] Required environment variable is missing: $name" >&2
    exit 64
  fi
}

require_secret() {
  name="$1"
  eval "value=\${$name:-}"
  if [ "${#value}" -lt 32 ]; then
    echo "[ENTRYPOINT] $name must contain at least 32 characters." >&2
    exit 64
  fi
}

require_value DATABASE_URL
require_value FRONTEND_URL

if [ "${NODE_ENV:-production}" = "production" ]; then
  require_secret SESSION_SECRET
  require_secret OAUTH_STATE_SECRET
  require_secret BRIDGE_SECRET
  require_secret HR_API_KEY
  require_secret GOOGLE_TOKEN_ENCRYPTION_KEY
fi

mkdir -p "${UPLOAD_DIR:-uploads}/content" "${UPLOAD_DIR:-uploads}/scorm"

if [ "${LMS_RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "[ENTRYPOINT] Applying forward-only Prisma migrations."
  ./node_modules/.bin/prisma migrate deploy
fi

exec "$@"
