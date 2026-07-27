# MCN LMS Release Candidate Runbook

## Purpose

This runbook converts the stacked LMS programme into one controlled release candidate. It does not authorize a production deployment. Production cutover requires the approvals recorded in `deploy/release-manifest.json` and matching attested publication evidence in `deploy/release-image-evidence.json`.

## Required merge order

Merge the stacked pull requests in dependency order:

1. PR #4 — secure foundation and enterprise talent architecture
2. PR #5 — coaching and certification renewal
3. PR #6 — instructor-led training
4. PR #7 — notifications and calendar feeds
5. PR #8 — practical assessments
6. PR #9 — evaluator calibration and reliability
7. PR #10 — evaluator-quality operations and credentials
8. PR #11 — appeals and governance evidence packs
9. PR #12 — runtime leases and rollout governance
10. PR #13 — release candidate rehearsal and guarded deployment
11. PR #14 — master release governance, provenance and recovery evidence
12. PR #15 — continuous security assurance and protected learning content
13. PR #16 — governed assessment intelligence and adaptive remediation

Do not squash or reorder database migrations independently of the application commits that consume them.

The canonical release chain contains **16 migrations**, beginning with `20260630053213_init` and ending with `20260727120000_assessment_intelligence`. `deploy/migrations.expected` is the machine-readable order used by CI.

## Release prerequisites

- Rotate every previously exposed HRMS or LMS credential.
- Create protected staging and production environment files from `deploy/.env.staging.example` and `deploy/.env.production.example`.
- Use unique 32+ character values for session, OAuth, bridge, HR API and token-encryption secrets.
- Configure a separate HTTPS SCORM origin.
- Assign stable `LMS_INSTANCE_ID`, `LMS_INSTANCE_ROLE`, `APP_VERSION` and `DEPLOYMENT_ID` values.
- Keep scheduler execution enabled only on designated worker processes. Database leases provide a second safety layer, not a reason to enable schedulers everywhere.
- Confirm MySQL 8 backup storage, retention and restore access.
- Fill in `deploy/release-manifest.json` from the example and obtain Engineering, Security, Training & Quality, Operations and Release Manager approvals.
- Publish the release image through `.github/workflows/lms-publish-attested-image.yml` and download its `release-image-evidence.json` artifact.

## Publish the immutable image

Create and publish a semantic release or run the protected publishing workflow against an existing immutable semantic Git tag. The workflow:

- checks out the exact tag and records its full source commit;
- builds one non-root image for migration, web and worker roles;
- publishes semantic-version and source-commit tags to GHCR;
- includes a BuildKit SBOM and maximum provenance;
- creates and verifies the GitHub image attestation;
- creates, attests and verifies `release-image-evidence.json`.

Do not publish or deploy `latest`.

For local staging-only builds:

```bash
docker build \
  --build-arg VITE_API_URL= \
  --label org.opencontainers.image.revision="$(git rev-parse HEAD)" \
  --label org.opencontainers.image.version="${APP_VERSION}" \
  -t "${LMS_IMAGE}" .
```

Local images are acceptable for isolated rehearsal only. Production requires an immutable GHCR digest reference and matching attested evidence.

## Verify publication evidence

Download the publishing workflow artifact and verify both attestations before preparing the release manifest:

```bash
gh attestation verify \
  "oci://ghcr.io/shivamgiri-sudo/mcn-lms@sha256:<digest>" \
  -R shivamgiri-sudo/mcn-lms

gh attestation verify release-image-evidence.json \
  -R shivamgiri-sudo/mcn-lms
```

Copy the verified file to `deploy/release-image-evidence.json`. Set the release manifest’s `commit` and digest-form `image` fields to the exact values from that evidence. Validate both records together:

```bash
EXPECTED_COMMIT_SHA=<full-40-character-sha> \
EXPECTED_IMAGE=ghcr.io/shivamgiri-sudo/mcn-lms@sha256:<digest> \
node deploy/scripts/validate-release-manifest.mjs deploy/release-manifest.json

EXPECTED_COMMIT_SHA=<full-40-character-sha> \
EXPECTED_IMAGE=ghcr.io/shivamgiri-sudo/mcn-lms@sha256:<digest> \
node deploy/scripts/validate-release-evidence.mjs \
  deploy/release-manifest.json \
  deploy/release-image-evidence.json
```

A release is blocked when the repository, semantic tag, source commit, image digest, workflow evidence or approval record differs.

## Staging preparation

```bash
cp deploy/.env.staging.example deploy/.env.staging
# Replace every CHANGE_ME value and configure real staging endpoints.
docker compose --env-file deploy/.env.staging -f deploy/docker-compose.staging.yml up -d mysql
```

Never commit `deploy/.env.staging`.

The staging topology includes MySQL for isolated rehearsal and publishes it on a configurable `127.0.0.1` port only. The production topology expects a separately governed external MySQL 8 service and exposes the LMS web process only on loopback for a reverse proxy or load balancer.

## Backup and restore proof

For staging’s Compose-managed database:

```bash
ENV_FILE=deploy/.env.staging \
COMPOSE_FILE=deploy/docker-compose.staging.yml \
bash deploy/scripts/backup.sh
```

For production’s external database, configure `LMS_BACKUP_MODE=remote` and the dedicated `MYSQL_BACKUP_*` values in `deploy/.env.production`. The backup script uses a temporary MySQL 8 client container, a protected credential file, encrypted transport and no application-write credentials.

Rehearse restore into an isolated temporary staging database:

```bash
ENV_FILE=deploy/.env.staging bash deploy/scripts/restore-rehearsal.sh backups/lms-YYYYMMDDTHHMMSSZ.sql.gz
```

Run the measured disaster-recovery drill:

```bash
ENV_FILE=deploy/.env.staging \
COMPOSE_FILE=deploy/docker-compose.staging.yml \
bash deploy/scripts/dr-drill.sh
```

The drill verifies checksum, backup age against RPO, isolated restore, critical table health and total recovery duration against RTO. It drops only the temporary rehearsal database and produces a JSON evidence report.

## Migration rehearsal

Run the one-shot migration service before starting the new application:

```bash
LMS_IMAGE="${LMS_IMAGE}" \
  docker compose --env-file deploy/.env.staging -f deploy/docker-compose.staging.yml run --rm migrate
```

CI proves two paths:

- all 15 migrations against empty MySQL 8 for a clean installation;
- the init baseline with preserved sentinel data, followed by the remaining feature migrations, for an in-place upgrade.

Migrations are forward-only. Do not attempt destructive SQL rollback. Application rollback is permitted only when the release manifest declares the migration set backward-compatible.

## Start the candidate

```bash
LMS_IMAGE="${LMS_IMAGE}" \
  docker compose --env-file deploy/.env.staging -f deploy/docker-compose.staging.yml up -d app worker
```

Run smoke tests:

```bash
BASE_URL=https://staging-lms.example.com bash deploy/scripts/smoke-test.sh
```

The smoke gate validates:

- process liveness
- dependency readiness
- frontend shell
- unauthenticated route rejection
- runtime-admin authorization
- request-ID propagation
- security headers

Run the bounded concurrency gate:

```bash
BASE_URL=https://staging-lms.example.com \
LOAD_CONCURRENCY=25 \
LOAD_REQUESTS=500 \
LOAD_P95_LIMIT_MS=1500 \
LOAD_MAX_ERROR_PCT=1 \
node deploy/scripts/load-smoke.mjs
```

The load gate reports p50, p95, p99, throughput, total duration and error rate. It fails when the configured p95 or error-rate guardrail is exceeded. Increase load gradually only after the default release-candidate gate passes; this is a bounded smoke test, not a substitute for a full production-capacity model.

## Production topology

`deploy/docker-compose.production.yml` provides separate one-shot migration, web and worker services against an external database. Its application containers use:

- read-only root filesystems
- all Linux capabilities dropped
- `no-new-privileges`
- writable volumes only for uploads and encrypted runtime state
- loopback-only web port binding
- readiness and liveness health checks
- controlled shutdown grace periods

Render and review the final configuration before cutover:

```bash
LMS_SERVICE_ENV_FILE="$(pwd)/deploy/.env.production" \
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.production.yml config
```

## Controlled rollout

Use the Super Admin **Runtime & Rollout** console and the machine-readable release manifest.

Recommended sequence:

1. company administrators and release team
2. one pilot branch
3. one pilot process
4. 10% deterministic user rollout
5. 25%
6. 50%
7. 100%

Hold or reverse rollout if any guardrail is breached:

- error rate above the approved threshold
- p95 latency above the approved threshold
- readiness endpoint returns 503
- notification backlog exceeds the configured limit
- no healthy worker instance
- authentication or branch-scope regression
- data-integrity or evidence-chain failure

A matching kill switch overrides all enabled rollout records.

## Rollback policy

Database migrations are never automatically reversed.

Application rollback is allowed only when all conditions are true:

- an authorized incident decision exists
- `ALLOW_APPLICATION_ROLLBACK=true`
- `MIGRATION_COMPATIBILITY=backward-compatible`
- the previous image is immutable and already validated
- the database is healthy

```bash
PREVIOUS_IMAGE=ghcr.io/shivamgiri-sudo/mcn-lms@sha256:<previous-digest> \
ALLOW_APPLICATION_ROLLBACK=true \
MIGRATION_COMPATIBILITY=backward-compatible \
ENV_FILE=deploy/.env.production \
COMPOSE_FILE=deploy/docker-compose.production.yml \
bash deploy/scripts/rollback.sh
```

If migration compatibility is unknown or incompatible, stop rollout through feature flags and kill switches, preserve the current schema, and deploy a forward corrective release.

## Production release command

The guarded orchestrator validates approvals and provenance before any database action, then performs remote backup, immutable image pull, migration, web/worker cutover, smoke testing, bounded load testing and optional authorized application rollback:

```bash
NEW_IMAGE=ghcr.io/shivamgiri-sudo/mcn-lms@sha256:<new-digest> \
PREVIOUS_IMAGE=ghcr.io/shivamgiri-sudo/mcn-lms@sha256:<previous-digest> \
RELEASE_COMMIT_SHA=<full-40-character-sha> \
RELEASE_MANIFEST_FILE=deploy/release-manifest.json \
RELEASE_IMAGE_EVIDENCE_FILE=deploy/release-image-evidence.json \
ENV_FILE=deploy/.env.production \
COMPOSE_FILE=deploy/docker-compose.production.yml \
bash deploy/scripts/release.sh
```

`LMS_RELEASE_BASE_URL` in the protected environment selects the post-cutover smoke/load endpoint. `LMS_HTTP_PORT` is used for local staging when no explicit release URL is configured.

## Post-release verification

- Confirm `/api/runtime/health/live` and `/api/runtime/health/ready` return HTTP 200.
- Confirm one healthy web instance and at least one healthy worker instance.
- Confirm notification and calibration leases have only one active owner each.
- Confirm login, learner journey, assessment, certification, coaching, ILT, practical assessment, calibration, appeal and evidence-pack workflows.
- Confirm branch administrators cannot access company-scoped records.
- Confirm public certificate verification exposes no private identity or contact fields.
- Confirm notification backlog and dead-letter counts are within guardrails.
- Archive the approved manifest, attested image evidence, backup checksum, DR report, smoke output, load report and approval record.
