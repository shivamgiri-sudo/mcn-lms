# MCN LMS Service Levels and Incident Governance

## Scope

This policy governs the production LMS web application, background workers, MySQL dependency, notification delivery, public verification surfaces and release pipeline. The machine-readable source is `deploy/slo-policy.json`; this document explains how it is applied.

## Service objectives

The default 30-day objectives are:

| Measure | Objective |
|---|---:|
| User-facing availability | 99.9% |
| Dependency readiness | 99.95% |
| HTTP/application error rate | ≤1% |
| p95 response latency | ≤1,500 ms |
| p99 response latency | ≤3,000 ms |
| Notification backlog | ≤5,000 records |
| Healthy web capacity | At least 1 instance |
| Healthy worker capacity | At least 1 instance |
| Recovery time objective | 60 minutes |
| Recovery point objective | 15 minutes |
| Backup success | 100% |
| Restore drill | At least every 30 days |

Excluded time must be documented, approved maintenance only. Unexplained monitoring gaps are treated as unavailable time.

## Error budget

For a 99.9% monthly availability objective, the error budget is consumed by unexpected unavailability, failed readiness, material authentication failure, branch-scope failure, corrupt evidence chains or an unavailable required worker capability.

When 50% of the monthly error budget is consumed, non-essential releases are paused. At 75%, only security, compliance and reliability fixes may proceed. At 100%, release freeze remains until the incident review approves recovery.

## Burn-rate alerts

The machine-readable policy defines fast- and slow-burn windows. Fast burn is a critical incident because the monthly budget would be exhausted rapidly. Slow burn is a high-severity reliability issue and requires an owned corrective plan.

## Incident severity

### Severity 1 — Critical

Examples: authentication bypass, cross-branch data exposure, active credential compromise, database corruption, broad outage, public evidence leak, destructive migration, inability to restore.

- acknowledge within 15 minutes
- incident commander assigned immediately
- activate kill switches or traffic controls
- preserve logs, database state and release evidence
- leadership update at least every 30 minutes

### Severity 2 — High

Examples: major workflow unavailable, notification backlog above threshold, worker lease failure, repeated 5xx increase, significant latency breach, isolated authorization regression.

- acknowledge within 30 minutes
- named owner and mitigation plan
- update at least hourly until stable

### Severity 3 — Moderate

Examples: degraded non-critical feature, reporting defect with workaround, limited data delay, minor SLO breach.

- acknowledge within one business day
- schedule corrective work with measurable acceptance criteria

### Severity 4 — Low

Examples: cosmetic issue, documentation gap, minor usability defect without data or workflow impact.

- triage into normal backlog

## Incident roles

- **Incident Commander:** owns decisions, severity, timeline and communications.
- **Technical Lead:** coordinates diagnosis, containment and recovery.
- **Security Lead:** owns credential, authorization, evidence and disclosure decisions.
- **Database Lead:** owns backup, restore, data validation and migration safety.
- **Operations/Training & Quality Lead:** validates business workflow impact and recovery.
- **Communications Owner:** keeps stakeholders aligned without exposing sensitive details.
- **Scribe:** records decisions, timestamps, evidence and follow-up actions.

One person may hold multiple roles for a small incident, but Incident Commander and Technical Lead should be separate for Severity 1 when staffing allows.

## Containment order

1. Protect people and sensitive data.
2. Stop unsafe writes or public exposure.
3. Activate the narrowest applicable feature kill switch.
4. Preserve logs, runtime leases, database state and release evidence.
5. Revoke or rotate exposed credentials.
6. Restore service through a known immutable image or forward corrective release.
7. Validate authorization, branch scope, audit chains and user workflows before reopening rollout.

## Recovery and disaster readiness

`deploy/scripts/dr-drill.sh` creates or accepts a backup, verifies its checksum, restores it into an isolated database, validates critical tables and measures RPO and RTO against `deploy/slo-policy.json`.

The monthly GitHub Actions drill is evidence that the repository scripts and schema can recover in an isolated environment. It does not replace an infrastructure-level production drill. A production drill must additionally verify:

- access to encrypted backup storage
- restore permissions and network routing
- database capacity and character set
- DNS, TLS and reverse-proxy recovery
- secrets and encrypted Drive token restoration
- external HRMS, SMTP, MSG91 and Google integration recovery
- business validation by Operations and Training & Quality

## Release freeze and unfreeze

A release freeze begins automatically for:

- active Severity 1 incident
- exhausted error budget
- failed restore drill
- unapproved or invalid release manifest
- unresolved high-severity dependency vulnerability
- failed clean-install or upgrade rehearsal
- unavailable backup evidence

The Release Manager may end the freeze only after the Incident Commander, Engineering, Security, Operations and Training & Quality confirm that acceptance evidence is complete.

## Post-incident review

Severity 1 and Severity 2 incidents require a blameless review covering:

- impact and exact timeline
- detection source and detection gap
- technical and organizational causes
- containment and recovery decisions
- SLO and error-budget impact
- data and authorization validation
- corrective actions with owners and dates
- tests, monitors, kill switches or runbook changes added

Corrective actions are not complete until their validation is automated or attached as durable evidence.
