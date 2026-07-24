# MCN LMS — World-Class Product and Engineering Blueprint

## Product vision

MCN LMS will be a secure, intelligent and measurable workforce-learning platform that connects employee capability, formal learning, coaching, certification and operational performance.

The platform must support the complete journey:

`Identity → Skill profile → Learning path → Content → Practice → Assessment → Coaching → Certification → Operations readiness → Renewal → Career growth`

Every important transition must be server-authorized, evidence-backed, auditable and measurable.

---

## Product principles

1. **Secure by default** — missing security configuration must disable the capability, never bypass validation.
2. **Role and scope aware** — every API enforces permission plus branch, process, LOB, classroom, batch and employee scope.
3. **Evidence over clicks** — completion, attendance and certification reflect verified activity and evidence.
4. **Mobile first** — core trainee and manager workflows work on low-bandwidth mobile devices.
5. **Accessible and inclusive** — target WCAG 2.2 AA, keyboard navigation, captions, transcripts and localization.
6. **Automation with control** — automation recommends and assists; high-impact people decisions retain human approval.
7. **One source of truth** — HRMS owns worker identity and organization; LMS owns learning evidence and capability.
8. **Explainable analytics** — every KPI has a definition, source, scope, timestamp and drill-down.
9. **Configuration before customization** — policies, thresholds, workflows and templates are data-driven.
10. **API first** — all user experiences are backed by versioned, documented services.

---

# Release programme

## Release 0 — Production safety and data integrity

Status: implementation in draft PR.

### Exit criteria

- No embedded credentials or insecure defaults.
- HRMS bridge fails closed and validates trusted assertions.
- Session tokens are not stored raw or accepted through URLs.
- Reports and administration are server-scoped.
- Uploaded and executable content is isolated.
- Assessment, completion, attendance, certification and handover are server-controlled.
- Prisma validation, frontend build, security tests and dependency audit pass.
- Production readiness and liveness checks are available.

---

## Release 1 — Identity, permissions and secure recovery

### Capabilities

- Permission catalogue and role templates.
- User-to-role and role-to-permission mapping.
- Branch, process, LOB, batch and employee scope assignments.
- Delegated temporary access with expiry.
- Approval workflow for privileged role changes.
- One-time password-reset tokens with verified delivery.
- Secure HttpOnly cookie sessions, CSRF protection and session-device management.
- OIDC/SAML SSO and SCIM provisioning.
- HRMS signed assertion verification and replay protection.
- Break-glass administrator access with mandatory justification.

### Required data models

- `Permission`
- `Role`
- `RolePermission`
- `UserRoleAssignment`
- `DataScopeAssignment`
- `PasswordResetToken`
- `SecurityEvent`
- `SsoReplayNonce`
- `AccessApproval`

### Exit criteria

- Automated authorization matrix passes for all roles and scopes.
- No frontend-only permission decision controls API access.
- All privileged access changes are approved and audited.

---

## Release 2 — Skills and competency intelligence

### Capabilities

- Company skill taxonomy with categories and proficiency levels.
- Role-to-skill competency framework.
- Employee skill profile from assessments, certifications and manager validation.
- Skill-gap heatmaps by employee, team, process and branch.
- Personal development plan with target role and target proficiency.
- Recommended learning based on verified gaps.
- Skill endorsements with evidence and expiry.
- Capability passport portable across internal roles.

### Required data models

- `Skill`
- `SkillLevel`
- `RoleCompetency`
- `EmployeeSkillEvidence`
- `EmployeeSkillProfile`
- `DevelopmentPlan`
- `DevelopmentGoal`

### Primary experiences

- Employee: My Skills and Career Path.
- Team leader: Team Capability Matrix.
- Manager: Succession and Readiness View.
- Training: Organization Skill-Gap Heatmap.

---

## Release 3 — Learning paths and curriculum lifecycle

### Capabilities

- Reusable learning paths with ordered stages and prerequisites.
- Mandatory, optional, recommended and remedial assignments.
- Conditional branching based on role, score, risk or prior learning.
- Curriculum templates and cohort-specific versions.
- Content versioning with effective dates.
- Draft, review, approval, publish, retire and archive lifecycle.
- SME review and compliance approval.
- Impact analysis before retiring referenced content.
- Equivalency and prior-learning credit.
- Due dates, grace periods and escalation ladders.

### Required data models

- `LearningPath`
- `LearningPathVersion`
- `LearningPathStep`
- `PrerequisiteRule`
- `LearningAssignment`
- `ContentVersion`
- `ContentApproval`
- `LearningEquivalency`

### Exit criteria

- A learner cannot bypass prerequisites.
- Content updates do not rewrite historical completion evidence.
- Published learning has identifiable owner, reviewer, version and effective period.

---

## Release 4 — Instructor-led and blended learning

### Capabilities

- Virtual, classroom and hybrid sessions.
- Trainer availability and room/resource calendars.
- Capacity, waitlist and automatic promotion.
- Calendar invitations and reminders.
- Session attendance, late arrival and early departure.
- Trainer notes, learner participation and practical observations.
- Session recordings and post-session resources.
- Make-up sessions and transfer approvals.
- Trainer utilization and effectiveness analytics.

### Required data models

- `InstructorLedCourse`
- `TrainingSession`
- `SessionEnrollment`
- `SessionAttendance`
- `TrainingResource`
- `TrainerAvailability`
- `WaitlistEntry`

---

## Release 5 — Advanced assessment and practice

### Capabilities

- Question banks by skill, topic, difficulty and objective.
- Randomized blueprints rather than simple full-bank shuffling.
- Scenario, case-study, audio, video and practical assessment types.
- Adaptive assessment and remedial routing.
- Item difficulty, discrimination and distractor analytics.
- Question-quality alerts and review workflow.
- Secure attempt sessions and proctoring integrations.
- Plagiarism and anomaly signals with human review.
- Rubrics, assessor moderation and appeal workflow.
- Assessment accommodations.

### Required data models

- `AssessmentBlueprint`
- `BlueprintRule`
- `AssessmentSession`
- `QuestionResponse`
- `QuestionAnalytics`
- `PracticalEvaluation`
- `EvaluationRubric`
- `AssessmentAppeal`

---

## Release 6 — Coaching, social learning and engagement

### Capabilities

- Manager coaching plans linked to skill gaps and risks.
- Observation, action, commitment and follow-up workflow.
- Peer discussion spaces attached to learning objects.
- SME-verified answers and reusable knowledge articles.
- Peer review and group assignments.
- Cohort challenges and learning streaks.
- Badges based on verified outcomes, not clicks.
- Recognition and internal expert directory.
- Communities of practice.

### Guardrails

- Gamification must not reward excessive screen time.
- Public leaderboards must be configurable and privacy-aware.
- Coaching notes require visibility controls and retention policy.

---

## Release 7 — Certification, compliance and renewal

### Capabilities

- Certification templates and policy versions.
- Multi-stage review and approval.
- Digital certificate with verification URL and QR code.
- Expiry, renewal window and recertification path.
- Continuing professional development credits.
- Regulatory and policy acknowledgements.
- Electronic signature and immutable evidence package.
- Exception, waiver and compensating-control workflow.
- Compliance dashboards and regulator-ready exports.

### Required data models

- `CertificationDefinition`
- `CertificationAward`
- `CertificationRenewal`
- `ComplianceRequirement`
- `Acknowledgement`
- `Waiver`
- `EvidencePackage`

---

## Release 8 — AI learning intelligence

### Learner assistance

- Natural-language search across approved learning content.
- Contextual learning assistant with source citations.
- Personalized explanations and practice questions.
- Recommended next action based on learning path and verified gaps.
- Multilingual summaries and accessible reading modes.

### Author assistance

- Draft course outlines from approved source material.
- Generate question drafts with difficulty, answer and rationale.
- Detect duplicate, outdated or inconsistent content.
- Suggest accessibility improvements, captions and alt text.
- Map content to skills and learning objectives.

### Manager and training assistance

- Explain risk drivers using cited LMS evidence.
- Suggest coaching interventions.
- Summarize cohort performance and anomalies.
- Forecast completion and certification risk.

### AI governance

- Retrieval only from approved and scope-authorized content.
- No autonomous certification, disciplinary or employment decision.
- Human approval for generated learning and assessments.
- Prompt, model, source, output and reviewer audit trail.
- PII minimization and configurable retention.
- Evaluation suite for groundedness, bias and unsafe output.

---

## Release 9 — Analytics and operational excellence

### Executive scorecard

- Active learners and cohorts.
- On-time completion.
- Assessment mastery.
- Attendance and verified engagement.
- Certification and operations-readiness conversion.
- Attrition and intervention effectiveness.
- Time to proficiency.
- Skill-gap closure.
- Training cost and productivity impact.

### Diagnostic analytics

- Funnel from onboarding to operations handover.
- Cohort and trainer comparison with minimum sample safeguards.
- Content effectiveness and drop-off analysis.
- Question item analytics.
- Risk drivers and intervention outcomes.
- Learning-to-production correlation.
- Branch, process, LOB, role, tenure and demographic fairness views where lawful.

### Measurement rules

- Every metric has a semantic definition and owner.
- Numerator, denominator, exclusions and data freshness are visible.
- Historical data is version-aware.
- Small groups are protected from accidental identification.

---

## Release 10 — Mobile, offline, accessibility and localization

### Capabilities

- Installable PWA.
- Offline download of authorized content.
- Encrypted offline storage and expiry.
- Offline progress queue with conflict resolution.
- Low-data media modes.
- Push notifications with user preferences.
- Responsive learner and manager flows.
- Keyboard and screen-reader support.
- Captions, transcripts and playback controls.
- Localization of UI, content and notifications.
- Right-to-left layout support where required.

### Exit criteria

- Core learner journey passes mobile viewport testing.
- Critical flows pass keyboard-only and screen-reader review.
- Offline completion cannot bypass server validation.

---

## Release 11 — Enterprise integration and extensibility

### Standards and APIs

- Versioned REST API with OpenAPI specification.
- Webhooks with signatures, retries and replay protection.
- OIDC and SAML SSO.
- SCIM user and group provisioning.
- xAPI statement generation and external LRS integration.
- SCORM 1.2 and 2004 conformance testing.
- Calendar, meeting and virtual-classroom integrations.
- HRMS, performance, quality and workforce-management events.

### Platform controls

- API clients with least-privilege scopes.
- Rate limits and quotas.
- Idempotency keys.
- Sandbox environment.
- Integration delivery logs and replay tools.

---

# Engineering foundation

## Target service boundaries

- Identity and access.
- Organization and scope.
- Content and curriculum.
- Learning assignments and progress.
- Assessments.
- Attendance and sessions.
- Risks and interventions.
- Certification and compliance.
- Skills and development.
- Notifications.
- Reporting and analytics.
- Integrations.

The initial implementation can remain a modular monolith, but each domain must have its own routes, policies, services, repositories, schemas and tests.

## Required platform services

- Redis-backed cache and rate limiting.
- Queue-backed worker with distributed locks.
- Object storage and CDN for course files.
- Isolated SCORM origin.
- Secret manager.
- Central logs, metrics, tracing and error monitoring.
- Backup, restore and migration verification.

## Required quality gates

- Prisma schema validation.
- Migration test against a production-like MySQL version.
- Backend unit and API integration tests.
- Authorization matrix tests.
- Frontend production build.
- End-to-end tests for each portal.
- Accessibility checks.
- Dependency and secret scanning.
- Upload and archive adversarial tests.
- Performance budgets and API latency tests.

---

# Product KPI framework

## North-star outcome

**Verified time to role proficiency** — elapsed time from assignment or onboarding to demonstrated, certified and operationally accepted capability.

## Driver metrics

- Assignment activation rate.
- On-time learning completion.
- Practice frequency and mastery growth.
- First-attempt and eventual assessment mastery.
- Coaching completion and intervention effectiveness.
- Certification conversion.
- Skill-gap closure.

## Guardrail metrics

- Assessment anomaly rate.
- Support and accessibility issues.
- Learner complaint rate.
- Content freshness breaches.
- Notification opt-out and delivery failure.
- Security and privacy incidents.
- Performance and availability.

---

# Delivery governance

Each release must include:

1. Approved product requirements.
2. Threat model and privacy impact assessment.
3. Data model and migration plan.
4. API contract and authorization matrix.
5. UX states for loading, empty, error, unauthorized and mobile.
6. Unit, integration and end-to-end tests.
7. Observability and support runbook.
8. Deployment and rollback plan.
9. Adoption and KPI measurement plan.
10. Post-release review and backlog decisions.
