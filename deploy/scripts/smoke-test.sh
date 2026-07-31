#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-120}"
REQUEST_ID="rc-smoke-$(date -u +%s)"

wait_for() {
  local url="$1"
  local expected_status="$2"
  local started
  started="$(date +%s)"
  while true; do
    status="$(curl -sS -o /tmp/lms-smoke-body -w '%{http_code}' "$url" || true)"
    if [[ "$status" == "$expected_status" ]]; then
      return 0
    fi
    if (( $(date +%s) - started >= TIMEOUT_SECONDS )); then
      echo "[SMOKE] Timed out waiting for $url; last status=$status" >&2
      cat /tmp/lms-smoke-body >&2 2>/dev/null || true
      return 1
    fi
    sleep 3
  done
}

wait_for "$BASE_URL/api/runtime/health/live" 200
wait_for "$BASE_URL/api/runtime/health/ready" 200
wait_for "$BASE_URL/" 200

live_body="$(curl -fsS "$BASE_URL/api/runtime/health/live")"
ready_body="$(curl -fsS "$BASE_URL/api/runtime/health/ready")"
[[ "$live_body" == *'"ok":true'* ]] || { echo "[SMOKE] Liveness payload is not healthy." >&2; exit 1; }
[[ "$ready_body" == *'"ok":true'* ]] || { echo "[SMOKE] Readiness payload is not healthy." >&2; exit 1; }

unauth_status="$(curl -sS -o /tmp/lms-unauth-body -w '%{http_code}' "$BASE_URL/api/auth/me")"
[[ "$unauth_status" == "401" ]] || { echo "[SMOKE] /api/auth/me must reject unauthenticated access; got $unauth_status" >&2; exit 1; }

admin_status="$(curl -sS -o /tmp/lms-admin-body -w '%{http_code}' "$BASE_URL/api/runtime/admin/dashboard")"
[[ "$admin_status" == "401" ]] || { echo "[SMOKE] Runtime admin dashboard must reject unauthenticated access; got $admin_status" >&2; exit 1; }

headers="$(curl -sS -D - -o /dev/null -H "X-Request-Id: $REQUEST_ID" "$BASE_URL/api/runtime/health/live" | tr -d '\r')"
grep -qi '^x-content-type-options: nosniff$' <<<"$headers" || { echo "[SMOKE] nosniff header is missing." >&2; exit 1; }
grep -qi "^x-request-id: $REQUEST_ID$" <<<"$headers" || { echo "[SMOKE] request ID was not preserved." >&2; exit 1; }

root_body="$(curl -fsS "$BASE_URL/")"
[[ "$root_body" == *'<div id="root">'* || "$root_body" == *"LMS API is running"* ]] || {
  echo "[SMOKE] Root response is neither the frontend shell nor API fallback." >&2
  exit 1
}

echo "[SMOKE] Release candidate passed liveness, readiness, frontend, authorization and security-header checks."
