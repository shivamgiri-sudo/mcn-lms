# Phase 14 — Assessment Intelligence

This branch extends the existing secure assessment engine without breaking legacy assessments.

## Scope

- Versioned assessment blueprints with governed lifecycle.
- Blueprint rules by topic, objective, skill, difficulty and question type.
- Rich question metadata, review state, version and exposure limits.
- Server-generated immutable question forms per attempt.
- Learner accommodations for time, breaks, display and language support.
- Per-question response evidence and item analytics.
- Question-quality alerts with human review workflow.
- Evidence-based remedial recommendations after submission.
- Coordinator and administrator analytics with enforced data scope.
- Backward compatibility for existing assessment records.

## Security and integrity

- Blueprint publication validates rule totals and eligible question supply.
- Attempt forms are generated and persisted only by the server.
- Correct answers and protected analytics are never returned before submission.
- Accommodations affect delivery only and never alter passing standards unless an approved policy explicitly records it.
- Analytics use finalized attempts only.
- Question retirement never rewrites historical attempt snapshots.
- Every privileged change is audited.

## Delivery sequence

1. Forward-only migration and Prisma schema.
2. Blueprint, question-governance and analytics services.
3. Secure attempt generation and immutable response storage.
4. Learner delivery and accommodation handling.
5. Administrator authoring, review and analytics UI.
6. Migration, authorization, regression, build and security validation.
