# Assessment Intelligence

Phase 14 adds a governed assessment layer above the existing secure LMS attempt engine. Existing assessments remain compatible; advanced controls are activated only when a published blueprint exists.

## Core capabilities

- Versioned assessment blueprints with draft, review, publish and retire states.
- Rule-based question selection by topic, objective, skill, difficulty, type, cognitive level and language.
- Approved question metadata, exposure limits and retirement without rewriting historic attempts.
- Server-generated immutable attempt forms with HMAC integrity validation.
- Server-controlled timing, attempt limits, prerequisites and classroom assignment checks.
- Approved learner accommodations for additional time, breaks, display preferences and language support.
- Per-question response evidence, distractor distribution and response-time analytics.
- Difficulty, blank-rate and discrimination-based question-quality alerts.
- Evidence-based remedial recommendations linked to skills and learning content where available.
- Branch-scoped administrator governance and own-batch coordinator analytics.

## Learner flow

1. Opening an assessment creates or resumes one active server attempt.
2. The server applies any current approved accommodation.
3. A published blueprint generates the exact question form. Without a blueprint, all approved active legacy questions are used.
4. The question order and option order are securely shuffled and stored as an immutable snapshot.
5. The server signs the snapshot, accommodation and effective time limit.
6. Submission is accepted only for the active learner, assessment and attempt ID and only within the server deadline.
7. Correct answers remain hidden until the learner passes or exhausts the attempt limit.
8. Missed concepts generate remediation evidence for the learner.

## Blueprint lifecycle

### Draft

Administrators define the total question count and one or more selection rules. Only one active draft may exist per assessment.

### Review

Submitting a draft for review validates that:

- at least one rule exists;
- rule question counts exactly equal the blueprint total;
- enough approved, active and non-exhausted questions satisfy every rule;
- no question is selected twice within the generated form.

### Published

Only one published blueprint may be active for an assessment. Publishing a reviewed version retires the previous published version transactionally. Existing attempt forms continue using their original snapshots.

### Retired

Retired blueprints cannot generate new attempts but remain available as historical governance evidence.

### Parent-record retention

Assessment blueprints and open quality alerts use foreign-key deletion restriction rather than cascading deletion. They also use indexed stored generated columns to enforce one active draft, one active published blueprint and one open alert key. MySQL does not permit cascading referential actions when the referenced child column is also a base column for that indexed generated state. More importantly, governance evidence should never disappear because an assessment master is deleted accidentally. Assessments with retained blueprint or alert evidence must be retired or archived through the governed lifecycle instead of being physically removed.

## Question governance

Question metadata includes:

- topic and objective code;
- mapped competency/skill;
- governed difficulty;
- question type;
- cognitive level;
- language;
- version;
- source reference;
- exposure limit;
- review status and notes.

Only approved, active questions below their exposure limit may be selected.

## Accommodations

An accommodation affects delivery, not the passing standard. Only one approved accommodation may be active for an employee. Creating a replacement revokes the previous approval transactionally.

Supported controls include:

- time multiplier from 1.00× to 3.00×;
- up to 120 additional break minutes;
- language preference;
- font scaling and high-contrast display preferences;
- effective-from and effective-to dates;
- mandatory approval reason and audit evidence.

New attempt forms snapshot the current approval. Revoking an accommodation does not alter an already issued attempt form.

## Item analytics

Analytics use finalized Pass/Fail attempts only. For each question the platform calculates:

- sample size;
- percentage correct;
- blank percentage;
- average response seconds;
- option/distractor distribution;
- top-versus-bottom-group discrimination when the sample is sufficient.

Quality states:

- `INSUFFICIENT_DATA`
- `HEALTHY`
- `TOO_EASY`
- `TOO_HARD`
- `LOW_DISCRIMINATION`
- `HIGH_BLANK_RATE`

Non-healthy states create or refresh a single open quality alert. Alerts are auto-resolved when current evidence returns to a healthy or insufficient-data state.

## Permissions and scope

- `assessment.blueprint.manage` — branch-scoped administrator authoring and publication.
- `assessment.question.review` — branch-scoped question governance and alert resolution.
- `assessment.analytics.view` — branch-scoped administrator analytics and own-batch coordinator evidence.
- `assessment.accommodation.manage` — branch-scoped administrator accommodation approval and revocation.

Every Phase 14 route requires an LMS session, role guard and the relevant permission. The route-security inventory treats both Phase 14 route modules as critical protected routes.

## Deployment

1. Merge and deploy the PR stack in order.
2. Run `prisma migrate deploy`; the Phase 14 migration is the sixteenth canonical migration.
3. Keep `APP_ENCRYPTION_KEY` configured with at least 32 characters. The service falls back to `SESSION_SECRET`, but a dedicated encryption key is preferred.
4. Confirm role grants match the intended branch and own-batch scopes.
5. Publish blueprints only after question metadata and supply validation are complete.
6. Recalculate item analytics after sufficient finalized attempt data exists.

## Validation gate

The Phase 14 workflow proves:

- upgrade from the first 15 migrations with legacy assessment data present;
- automatic governance metadata seeding for existing questions;
- all 16 migrations and nine new tables;
- permissions and generated uniqueness keys;
- invalid blueprint totals and accommodation multipliers are rejected;
- duplicate published blueprints and duplicate approved accommodations are rejected;
- route and migration policy validators;
- complete backend regressions and JavaScript syntax;
- backend/frontend production dependency audits;
- frontend production build.
