# MCN LMS Continuous Security Assurance

## Scope

This layer supplements the release-candidate and master-hardening controls with continuous source, secret, dependency, container, route and migration assurance. It does not authorise production deployment by itself.

## Security gates

### CodeQL

- JavaScript and TypeScript analysis through CodeQL v4.
- `security-extended` query suite.
- Pull-request, branch-push and weekly scheduled execution.
- Results are published to GitHub code scanning.

### Secret detection

- Gitleaks 8.30.1 scans the current repository tree.
- Findings are redacted before SARIF and evidence upload.
- Any detected secret fails the workflow.
- Historical credentials must still be rotated even when removed from the latest tree.

### Vulnerability and SBOM scanning

- Trivy 0.70.0 scans source, configuration, secrets and the exact production image.
- HIGH and CRITICAL findings with available fixes fail the workflow.
- The exact image produces CycloneDX SBOM evidence.
- Runtime dependency audits remain independently enforced for backend and frontend.

### HTTP and content security

- Production Content Security Policy is active.
- Framing defaults to same origin; additional HRMS frame ancestors require an exact environment allowlist.
- YouTube and isolated SCORM origins are the only default learning iframe exceptions.
- HSTS, `nosniff`, referrer and cross-origin policies are active.
- Direct local upload hosting is development-only.
- Production local content is delivered through a bearer-authenticated endpoint.
- Trainee access is restricted to content referenced by an assigned classroom.
- Drive and local content are converted to short-lived browser blob URLs, not URL session tokens.

### Migration safety

`deploy/scripts/validate-migration-safety.mjs` verifies:

- the canonical 15-migration manifest;
- the immutable init baseline position;
- no table/column/database destruction in feature migrations;
- no foreign-key disabling;
- no client-specific delimiter logic;
- no stored routines, triggers or events;
- no destructive migration deletes.

Reviewed index replacements remain inventoried as warnings.

### Route security

`deploy/scripts/validate-route-security.mjs` verifies:

- every route module is session-protected or has documented alternative authentication;
- critical content, upload, reporting, Drive, SCORM, runtime and governance routes reference `requireSession`;
- session material is not serialised into query strings;
- the protected-content and governed-Helmet wiring remains mounted.

## Deployment configuration

The following environment variables accept space- or comma-separated **origins only**:

- `CSP_FRAME_ANCESTORS`
- `CSP_CONNECT_SRC`
- `CSP_FRAME_SRC`
- `CSP_MEDIA_SRC`
- `CSP_IMG_SRC`

Do not configure paths, credentials, `javascript:` sources, wildcard schemes or `unsafe-eval`.

## Required review order

This security-assurance change is stacked above the master-hardening PR. Review and merge the complete dependency stack in its documented order before generating an immutable release tag or production manifest.
