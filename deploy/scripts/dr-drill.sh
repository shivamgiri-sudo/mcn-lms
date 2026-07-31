#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env.staging}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/deploy/docker-compose.staging.yml}"
DR_RESTORE_ENV_FILE="${DR_RESTORE_ENV_FILE:-$ENV_FILE}"
DR_RESTORE_COMPOSE_FILE="${DR_RESTORE_COMPOSE_FILE:-$COMPOSE_FILE}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
DR_REPORT_DIR="${DR_REPORT_DIR:-$ROOT_DIR/backups/dr-reports}"
SLO_POLICY_FILE="${SLO_POLICY_FILE:-$ROOT_DIR/deploy/slo-policy.json}"
BACKUP_FILE="${1:-${BACKUP_FILE:-}}"

for command in node jq sha256sum gzip stat date; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "[DR] Required command is unavailable: $command" >&2
    exit 69
  }
done
for file in "$ENV_FILE" "$COMPOSE_FILE" "$DR_RESTORE_ENV_FILE" "$DR_RESTORE_COMPOSE_FILE" "$SLO_POLICY_FILE"; do
  [[ -f "$file" ]] || {
    echo "[DR] Required file is missing: $file" >&2
    exit 64
  }
done

node "$ROOT_DIR/deploy/scripts/validate-slo-policy.mjs" "$SLO_POLICY_FILE"
rto_seconds="$(node -e "const p=require(process.argv[1]); process.stdout.write(String(p.recovery.rtoMinutes*60))" "$SLO_POLICY_FILE")"
rpo_seconds="$(node -e "const p=require(process.argv[1]); process.stdout.write(String(p.recovery.rpoMinutes*60))" "$SLO_POLICY_FILE")"

mkdir -p "$BACKUP_DIR" "$DR_REPORT_DIR"
drill_id="dr-$(date -u +%Y%m%dT%H%M%SZ)-$$"
started_epoch="$(date -u +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ -z "$BACKUP_FILE" ]]; then
  marker="$(mktemp)"
  trap 'rm -f "${marker:-}"' EXIT
  COMPOSE_FILE="$COMPOSE_FILE" ENV_FILE="$ENV_FILE" BACKUP_DIR="$BACKUP_DIR" \
    bash "$ROOT_DIR/deploy/scripts/backup.sh"
  BACKUP_FILE="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'lms-*.sql.gz' -newer "$marker" -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
  rm -f "$marker"
  marker=""
fi

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "[DR] Backup archive was not found." >&2
  exit 1
fi
if [[ ! -f "$BACKUP_FILE.sha256" ]]; then
  echo "[DR] Backup checksum is missing: $BACKUP_FILE.sha256" >&2
  exit 1
fi

sha256sum --check "$BACKUP_FILE.sha256"
gzip -t "$BACKUP_FILE"
backup_bytes="$(stat -c %s "$BACKUP_FILE")"
backup_mtime="$(stat -c %Y "$BACKUP_FILE")"
backup_age_seconds=$(( started_epoch - backup_mtime ))
if (( backup_age_seconds < 0 )); then backup_age_seconds=0; fi
checksum="$(awk '{print $1}' "$BACKUP_FILE.sha256")"

restore_started_epoch="$(date -u +%s)"
set +e
ENV_FILE="$DR_RESTORE_ENV_FILE" COMPOSE_FILE="$DR_RESTORE_COMPOSE_FILE" \
  bash "$ROOT_DIR/deploy/scripts/restore-rehearsal.sh" "$BACKUP_FILE"
restore_exit_code=$?
set -e
restore_finished_epoch="$(date -u +%s)"
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
total_duration_seconds=$(( restore_finished_epoch - started_epoch ))
restore_duration_seconds=$(( restore_finished_epoch - restore_started_epoch ))

status="PASS"
reasons=()
if (( restore_exit_code != 0 )); then
  status="FAIL"
  reasons+=("restore-rehearsal-failed")
fi
if (( total_duration_seconds > rto_seconds )); then
  status="FAIL"
  reasons+=("rto-exceeded")
fi
if (( backup_age_seconds > rpo_seconds )); then
  status="FAIL"
  reasons+=("rpo-exceeded")
fi

report_file="$DR_REPORT_DIR/${drill_id}.json"
reasons_json="$(printf '%s\n' "${reasons[@]:-}" | jq -R . | jq -s 'map(select(length > 0))')"
jq -n \
  --arg drillId "$drill_id" \
  --arg status "$status" \
  --arg startedAt "$started_at" \
  --arg finishedAt "$finished_at" \
  --arg backupFile "$BACKUP_FILE" \
  --arg checksum "sha256:$checksum" \
  --argjson backupBytes "$backup_bytes" \
  --argjson backupAgeSeconds "$backup_age_seconds" \
  --argjson restoreExitCode "$restore_exit_code" \
  --argjson restoreDurationSeconds "$restore_duration_seconds" \
  --argjson totalDurationSeconds "$total_duration_seconds" \
  --argjson rtoTargetSeconds "$rto_seconds" \
  --argjson rpoTargetSeconds "$rpo_seconds" \
  --argjson reasons "$reasons_json" \
  --arg sourceEnvironment "$ENV_FILE" \
  --arg restoreEnvironment "$DR_RESTORE_ENV_FILE" \
  '{
    drillId: $drillId,
    status: $status,
    startedAt: $startedAt,
    finishedAt: $finishedAt,
    sourceEnvironment: $sourceEnvironment,
    restoreEnvironment: $restoreEnvironment,
    backup: {
      file: $backupFile,
      checksum: $checksum,
      bytes: $backupBytes,
      ageSecondsAtDrillStart: $backupAgeSeconds
    },
    recovery: {
      restoreExitCode: $restoreExitCode,
      restoreDurationSeconds: $restoreDurationSeconds,
      totalDurationSeconds: $totalDurationSeconds,
      rtoTargetSeconds: $rtoTargetSeconds,
      rpoTargetSeconds: $rpoTargetSeconds
    },
    failureReasons: $reasons
  }' > "$report_file"

jq -e '.status == "PASS" or .status == "FAIL"' "$report_file" >/dev/null
echo "[DR] Drill $status. Evidence: $report_file"
if [[ "$status" != "PASS" ]]; then
  jq '.failureReasons' "$report_file" >&2
  exit 1
fi
