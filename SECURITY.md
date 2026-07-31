# Security Policy

## Supported versions

Security fixes are applied to the latest production release and the active release-candidate branch. Older branches are not supported unless an incident response decision explicitly restores them.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, exposed credential, authorization bypass, data leak or supply-chain concern.

Use GitHub's **Report a vulnerability** function in the repository Security tab so the report is handled privately. Include:

- affected endpoint, page, workflow or component
- clear reproduction steps
- expected and observed behaviour
- affected role, branch, process or data scope
- impact and exploitability assessment
- screenshots, logs or proof-of-concept material with sensitive values redacted
- suggested remediation when available

Do not access, modify, download or retain data beyond the minimum needed to demonstrate the issue.

## Response targets

| Severity | Initial triage | Containment target | Remediation target |
|---|---:|---:|---:|
| Critical | 4 hours | 8 hours | 24 hours or immediate kill switch |
| High | 1 business day | 2 business days | 7 calendar days |
| Moderate | 3 business days | As required | 30 calendar days |
| Low | 5 business days | As required | Next planned release |

Targets begin when the report is received and may be adjusted after evidence-based severity review.

## Security release rules

- Rotate exposed credentials before code remediation is considered complete.
- Preserve audit and incident evidence.
- Use feature kill switches for unsafe capabilities.
- Never reverse production migrations destructively.
- Require successful clean-install, upgrade, backup/restore, authorization, image and smoke gates before a security release.
- Publish no technical detail that would increase exploitability until remediation is deployed.

## Out of scope

The following are normally out of scope unless they demonstrate material impact:

- automated scans without a reproducible security consequence
- missing headers on responses that contain no sensitive content
- clickjacking claims against pages intentionally isolated for approved embedding
- denial-of-service tests that create material load or disruption
- social engineering, physical attacks or attacks against third-party services
