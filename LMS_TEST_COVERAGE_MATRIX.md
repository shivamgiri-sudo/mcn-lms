# LMS Test Coverage Matrix
**Project:** MCN LMS Platform  
**Date:** 2026-05-21  
**QA Lead:** Claude Code (Senior Full Stack Engineer)

---

## Tech Stack Detected

| Layer | Technology |
|-------|-----------|
| Backend runtime | Node.js ESM (`"type": "module"`) |
| Backend framework | Express 4.19 |
| ORM | Prisma 5.14 (db push, no migrate dev) |
| Database | Supabase PostgreSQL (project `jspfzfvnkxugnlwfessy`) |
| Auth | UUID session tokens in `PortalSession` table, 6h TTL |
| Password hashing | bcryptjs |
| File uploads | multer, 200MB max, disk storage |
| Email | nodemailer (SMTP configurable) |
| Frontend framework | React 18 + Vite |
| Frontend router | react-router-dom v6 |
| Charts | chart.js 4 + react-chartjs-2 |
| Deployment | Render (backend) + Vercel/static (frontend) |

---

## Available npm Scripts

### Backend (`backend/`)
| Script | Command |
|--------|---------|
| `dev` | `nodemon --watch src --exec node src/server.js` |
| `start` | `npx prisma generate && node src/server.js` |
| `postinstall` | `prisma generate` |
| `db:push` | `prisma db push` |
| `db:generate` | `prisma generate` |
| `db:studio` | `prisma studio` |
| `db:seed` | `node prisma/seed.js` |

### Frontend (`frontend/`)
| Script | Command |
|--------|---------|
| `dev` | `vite` (port 5173, proxies /api → localhost:4000) |
| `build` | `vite build` |
| `preview` | `vite preview` |

**Note:** No test runner configured in either `package.json` (no jest/vitest/mocha). All testing is currently manual or integration-level.

---

## Main Entry Points

### Backend
| File | Purpose |
|------|---------|
| `backend/src/server.js` | Express app, all 11 route mounts, KPI cron on startup |
| `backend/prisma/schema.prisma` | 35+ Prisma models — source of truth for DB schema |
| `backend/prisma/seed.js` | Demo data seeder |

### Frontend
| File | Purpose |
|------|---------|
| `frontend/src/main.jsx` | React root, BrowserRouter |
| `frontend/src/App.jsx` | 4 route roots: `/lms`, `/coordinator`, `/admin`, `/management` |
| `frontend/src/pages/Trainee/TraineePage.jsx` | Trainee portal shell |
| `frontend/src/pages/Coordinator/CoordinatorPage.jsx` | Coordinator portal shell |
| `frontend/src/pages/Admin/AdminPage.jsx` | Admin page (renders AdminConsole) |
| `frontend/src/pages/Admin/AdminConsole.jsx` | Admin sidebar shell, NAV registry |
| `frontend/src/pages/Management/ManagementPage.jsx` | Management portal shell |

---

## Auth Flow Files

| File | Role |
|------|------|
| `backend/src/controllers/auth.js` | `coordinatorLogin`, `adminLogin`, `traineeLogin`, `traineeChangePassword`, `getMyProfile` |
| `backend/src/middleware/auth.js` | `requireSession` (Bearer token → PortalSession), `requireRole(...roles)` |
| `backend/src/routes/auth.js` | `/api/auth/*` mounts |
| `backend/src/routes/bridge.js` | Bridge auth for cross-portal token passing |
| `frontend/src/utils/api.js` | `getToken`, `setToken`, `clearToken`, 401 → `lms:session-expired` event |
| `frontend/src/pages/Trainee/LoginView.jsx` | Trainee login UI |
| `frontend/src/pages/Admin/AdminLogin.jsx` | Admin login UI |
| `frontend/src/pages/Coordinator/CoordLogin.jsx` | Coordinator login UI |
| `frontend/src/pages/Management/MgmtLogin.jsx` | Management login UI |

**Auth Mechanisms by Portal:**
- **Trainee:** bcrypt vs `UserMaster`, returns `forcePasswordReset` flag; must change password on first login
- **Coordinator:** PIN vs `RoleAccessMatrix`; lockout at 5 failed attempts
- **Admin:** bcrypt vs `AdminUserMaster`; lockout at 5 failed attempts
- **Management:** PIN vs `RoleAccessMatrix`

---

## LMS Module Files

| Module | Backend Controller | Backend Route | Frontend Pages |
|--------|--------------------|---------------|----------------|
| Auth / Login | `auth.js` | `routes/auth.js` | `LoginView.jsx`, `AdminLogin.jsx`, `CoordLogin.jsx`, `MgmtLogin.jsx` |
| Trainee LMS / Content | `trainee.js` | `routes/trainee.js` | `LearningTab.jsx`, `DashboardView.jsx`, `AssessmentModal.jsx` |
| Q&A | `trainee.js` | `routes/trainee.js` | `QATab.jsx` |
| Assigned Modules | `trainee.js` | `routes/trainee.js` | `AssignedTab.jsx` |
| Trainee Profile | `trainee.js` | `routes/trainee.js` | `ProfileTab.jsx` |
| Coordinator Dashboard | `coordinator.js` | `routes/coordinator.js` | `CoordDashboard.jsx` |
| Batch Management | `coordinator.js` | `routes/coordinator.js` | `BatchList.jsx`, `BatchDetail.jsx` |
| Trainee Onboarding | `coordinator.js` | `routes/coordinator.js` | (part of BatchDetail) |
| Certification | `coordinator.js` | `routes/coordinator.js` | (part of BatchDetail) |
| Pending Activities | `coordinator.js` | `routes/coordinator.js` | `PendingActivities.jsx` |
| Q&A (coord view) | `coordinator.js` | `routes/coordinator.js` | `QueryLog.jsx` |
| Coord Reports | `coordinator.js` | `routes/coordinator.js` | `CoordReportsTab.jsx` |
| Admin Dashboard | `admin.js` | `routes/admin.js` | `DashboardPage.jsx` |
| Admin Users / Accounts | `admin.js` | `routes/admin.js` | `UsersTab.jsx`, `AccountsTab.jsx` |
| Classroom Management | `admin.js` | `routes/admin.js` | `CurriculumTab.jsx`, `ClassroomWizard.jsx` |
| Batch (admin) | `admin.js` | `routes/admin.js` | `BatchesPage.jsx`, `BatchCreationWizard.jsx` |
| Broadcast / Assign | `admin.js` | `routes/admin.js` | `BroadcastTab.jsx` |
| Reports (admin) | `admin.js`, `reports.js` | `routes/admin.js`, `routes/reports.js` | `ReportsTab.jsx` |
| Compliance Audit | `compliance.js` | `routes/compliance.js` | `ComplianceExport.jsx` |
| EmpId Mapping | `admin.js` + `utils/empIdMapping.js` | `routes/empMapping.js` | `EmpIdMappingUpload.jsx` |
| Risk Engine | `utils/riskEngine.js` | (auto-triggered, no route) | `RiskDrilldownPage.jsx` |
| Management Dashboard | `management.js` | `routes/management.js` | `MgmtDashboard.jsx` |
| Drive Integration | `drive.js` | `routes/drive.js` | `DriveTab.jsx` |
| File Upload | (multer) | `routes/upload.js` | (used in curriculum) |

---

## Email / Report / Reminder Files

| File | Capability |
|------|-----------|
| `backend/src/controllers/reports.js` | `sendDailySummary(to)` — manual trigger via POST `/api/reports/send-summary`, sends plain-text email via nodemailer |
| `backend/src/server.js` | `runKpiSnapshot()` — runs on startup + every 24h, writes to `HistoricalTrainingKpi` |

**Missing/Not Implemented:**
- No automated daily email cron (only manual trigger via API)
- No SMS/WhatsApp reminders
- No Pending Activity email alerts
- No Q&A SLA breach notifications (breach is flagged in DB but no email fires)
- No batch completion email
- SMTP env vars required: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (not in .env currently)

---

## Database / Schema Files

| File | Content |
|------|---------|
| `backend/prisma/schema.prisma` | 35+ models |
| `backend/prisma/seed.js` | Demo data (trainees, batches, classrooms, assessments, coordinator/admin/management accounts) |

**Key Models (by functional area):**

| Model | Purpose |
|-------|---------|
| `UserMaster` | Trainee login credentials (bcrypt) |
| `TraineeMaster` | Trainee profile + KPI denormalized fields (courseCompletionPct, assessmentPassPct, attendancePct, riskStatus) |
| `BatchMaster` | Batch lifecycle (Active/Completed) |
| `ClassroomMaster` | Curriculum containers |
| `ModuleMaster` | Modules within classrooms (dayNo, moduleOrder) |
| `ContentMaster` | Video/PDF/embed content (completionRulePct, estimatedMins, locked flag) |
| `ContentProgress` | Per-trainee content watch state (totalSecondsSpent, completionStatus) |
| `VideoWatchLog` | Heartbeat event log (OPEN, HEARTBEAT, CLOSE events) |
| `AssessmentMaster` | MCQ assessments (passingPct, attemptLimit, timeLimitMins) |
| `QuestionBank` | Questions with correctOption + negativeMarks |
| `AssessmentAttempt` | Each attempt with full answer JSON |
| `AssessmentResult` | Best result per trainee per assessment |
| `TraineeQueryLog` | Q&A queries (Open/Answered status, TAT tracking) |
| `TrainingRiskLog` | Risk flags (riskKey unique, Open/Closed, CRITICAL/HIGH/WATCH) |
| `PendingActivityLog` | Action items for coordinators (activityKey unique) |
| `AttendanceInference` | Inferred attendance from content activity |
| `CourseCompletionReport` | Aggregate completion per trainee per classroom |
| `CertificationEvidence` | Mock call / internal / external cert proof |
| `CertificationRuleMaster` | Per-process+LOB cert thresholds |
| `PortalSession` | Auth tokens (UUID, 6h TTL) |
| `RoleAccessMatrix` | Coordinator/Management login, PIN, role-based permissions |
| `AdminUserMaster` | Admin login credentials |
| `AuditLog` | Write-only audit trail |
| `SequenceCounter` | Atomic counters for batch naming + temp EmpId generation |
| `HistoricalTrainingKpi` | Monthly KPI snapshots for trend charts |
| `AssignedModule` | Broadcast assignments (individual/batch/process/branch/company scope) |
| `OnboardingLog` | Audit trail for trainee onboarding events |
| `LoginSessionLog` | Login event log (userId field stores employeeId) |
| `ProcessLobMaster` | Reference data for process+LOB combinations |
| `BranchMaster` | Branch reference data |
| `TraineeClassroomMap` | Trainee ↔ Classroom mapping |
| `BatchClassroomMap` | Batch ↔ Classroom audit trail |

---

## Test Coverage Matrix

### Section A: Project Setup & Health

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| A-01 | `npm install` in backend completes without error | Exit 0, prisma generate runs via postinstall | HIGH |
| A-02 | `npm install` in frontend completes without error | Exit 0 | HIGH |
| A-03 | `backend/.env` exists with `DATABASE_URL`, `DIRECT_URL`, `FRONTEND_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON` | All 4 vars present | HIGH |
| A-04 | `npm run dev` in backend starts on port 4000 | `LMS running on http://localhost:4000` in stdout | HIGH |
| A-05 | `npm run dev` in frontend starts on port 5173 | Vite ready on 5173, /api proxied | HIGH |
| A-06 | `GET /api/health` returns `{ ok: true }` | 200 with service, mode, time | HIGH |
| A-07 | KPI snapshot runs on server startup without error | `[KPI] Snapshot saved for YYYY-MM` in log | MEDIUM |
| A-08 | Prisma client is in `dependencies` (not devDependencies) | `"prisma": "^5.14.0"` in `dependencies` | HIGH |
| A-09 | `HR_API_KEY` env var set on Render | emp-mapping routes accessible without 500 | MEDIUM |

---

### Section B: Role-wise Login & Access

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| B-01 | Trainee login with `EMP1001` / `1234` | 200, token in response, `forcePasswordReset: false` (after seed) | HIGH |
| B-02 | Trainee login with wrong password | 401, `Invalid credentials` | HIGH |
| B-03 | Trainee login 5 wrong attempts → lockout | After 5th fail, account locked | MEDIUM |
| B-04 | Trainee with `forcePasswordReset: true` must change password | Frontend shows password reset screen | HIGH |
| B-05 | Coordinator login with `COORD-TEST` / `1234` | 200, token returned | HIGH |
| B-06 | Admin login with `LMS-ADMIN` / `admin1234` | 200, token returned | HIGH |
| B-07 | Management login with `CEO-001` / `ceo123` | 200, token returned | HIGH |
| B-08 | Admin token rejected on `/api/coordinator` route | 403, `Access denied` | HIGH |
| B-09 | Coordinator token rejected on `/api/admin` route | 403 | HIGH |
| B-10 | Expired token returns 401 | `Session expired. Please login again.` | HIGH |
| B-11 | 401 on frontend auto-dispatches `lms:session-expired` event | User sees login screen, token cleared | HIGH |
| B-12 | Missing Authorization header on protected route | 401, `Unauthorized` | MEDIUM |

---

### Section C: Admin Full Flow

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| C-01 | Admin dashboard loads KPI counts | Active batches, trainees, risk counts | HIGH |
| C-02 | Create classroom via ClassroomWizard | Classroom created, modules/content slots created | HIGH |
| C-03 | Add content to module (video URL, PDF) | Content visible in curriculum | HIGH |
| C-04 | Set `locked: true` on content | Sequential lock enforced for trainees | HIGH |
| C-05 | Create batch via admin BatchCreationWizard | Batch created with auto-generated batchNo (PRO_LOB_MON'YY_###) | HIGH |
| C-06 | Assign classroom to batch | `classroomId` set on batch, BatchClassroomMap created | HIGH |
| C-07 | Broadcast module to batch/process/company | `AssignedModule` row created, visible on trainee AssignedTab | HIGH |
| C-08 | Broadcast with `broadcastTitle` field | broadcastTitle saved, appears in broadcast-assignments export | HIGH |
| C-09 | Admin reports: export broadcast-assignments CSV | Contains "Broadcast Title" as first column | HIGH |
| C-10 | Admin reports: export trainees CSV | All trainee KPI fields present | HIGH |
| C-11 | Compliance Audit: preview without dates | 400 error shown | MEDIUM |
| C-12 | Compliance Audit: preview with date range | Counts displayed per category | HIGH |
| C-13 | Compliance Audit: export Full Trainee Register (no dates needed) | CSV downloaded, all trainees included | HIGH |
| C-14 | Compliance Audit: export Attendance & Login with date range | CSV downloaded with login session data | HIGH |
| C-15 | Compliance Audit: export Learning Progress with date range | CSV downloaded with content progress data | HIGH |
| C-16 | Compliance Audit: export Risk & Escalation | CSV downloaded | HIGH |
| C-17 | Compliance Audit: export Certification | CSV downloaded | HIGH |
| C-18 | Compliance Audit: branch/process filter narrows results | Counts and export scoped to selected branch/process | MEDIUM |
| C-19 | EmpId Mapping Upload: CSV with mobile + permanentEmpId | Temp ID atomically replaced across 15 tables | HIGH |
| C-20 | Admin add/edit coordinator account | RoleAccessMatrix row created/updated | MEDIUM |
| C-21 | Admin create admin user | AdminUserMaster row created | MEDIUM |
| C-22 | Admin risk drilldown page | Risk list loads with severity filter | MEDIUM |
| C-23 | Org/Process/LOB tab management | ProcessLobMaster CRUD works | LOW |

---

### Section D: Coordinator Full Flow

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| D-01 | Coordinator dashboard loads | Active batches, trainee count, pending count, critical risks | HIGH |
| D-02 | Create batch (coordinator) | batchNo auto-generated, batch in list | HIGH |
| D-03 | Create batch without `canCreateBatch` permission | 403, `No permission to create batches` | MEDIUM |
| D-04 | Onboard trainee with EmpId | Trainee created, UserMaster created, `forcePasswordReset: true` | HIGH |
| D-05 | Onboard trainee without EmpId (mobile only) | Temp EmpId `EMP0001` generated, `empIdType: TEMP` | HIGH |
| D-06 | Duplicate trainee onboard (same empId) | 400, `Duplicate trainee` error | HIGH |
| D-07 | Bulk onboard trainees via JSON array | Success count + error list returned | MEDIUM |
| D-08 | View batch detail: trainees, risks, queries, attendance | All 5 sub-sections load | HIGH |
| D-09 | Mark trainee Certified | `certificationStatus: Certified` set, batch certified counter incremented | HIGH |
| D-10 | Mark trainee Attrition | Status `Inactive`, batch counter decremented | HIGH |
| D-11 | Close batch: requires all trainees have final status | If any `Not Certified` remain, 400 error with count | HIGH |
| D-12 | Close batch: with all statuses resolved | batchStatus `Completed`, audit log written | HIGH |
| D-13 | Answer Q&A query | Status → `Answered`, TAT recorded | HIGH |
| D-14 | Resolve pending activity | Status → `Actioned` or `Closed` | MEDIUM |
| D-15 | Map permanent EmpId from coordinator form | mapEmployeeId() runs, 15-table update | HIGH |
| D-16 | Coordinator export: trainee progress CSV | CSV with KPI fields, filtered to own batches | MEDIUM |
| D-17 | Coordinator export: at-risk trainees CSV | Only CRITICAL/HIGH/WATCH included | MEDIUM |
| D-18 | Coordinator export: Q&A activity CSV | All queries for own batches | MEDIUM |

---

### Section E: Trainee / Mini LMS Full Flow

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| E-01 | Trainee login → sees dashboard | Classroom, days, modules listed | HIGH |
| E-02 | Trainee with no classroom assigned | Dashboard returns `classroom: null`, no error | MEDIUM |
| E-03 | Open content (first time) | `ContentProgress` created, `opened: true`, VideoWatchLog OPEN event, attendance inferred | HIGH |
| E-04 | Locked content (contentOrder > 1, locked=true) | 403, `locked: true`, prerequisite title returned | HIGH |
| E-05 | First content unlocks second after completion | Once content 1 is Completed, content 2 opens without 403 | HIGH |
| E-06 | Heartbeat fires every 30s (frontend) | `secondsDelta` capped at 30 on backend | HIGH |
| E-07 | Heartbeat accumulates total seconds | `totalSecondsSpent` increases correctly | HIGH |
| E-08 | Completion threshold reached | `completionStatus: Completed`, `completedAt` set | HIGH |
| E-09 | Course completion % updates on TraineeMaster | `courseCompletionPct` in sync after heartbeat | HIGH |
| E-10 | Heartbeat when `document.hidden` (tab not visible) | Frontend should NOT fire or send 0 delta | HIGH |
| E-11 | Negative seconds delta rejected | cappedDelta = 0, no negative accumulation | MEDIUM |
| E-12 | Delta > 30 capped to 30 | `secondsDelta: 120` → stored as 30 | HIGH |
| E-13 | Take MCQ assessment (first time) | Questions shuffled, attempt created | HIGH |
| E-14 | MCQ submit: correct/wrong answers scored | percentage, result (Pass/Fail), review data returned | HIGH |
| E-15 | MCQ negative marking | Wrong answer subtracts `negativeMarks` points | MEDIUM |
| E-16 | MCQ attempt limit reached | 400, `Attempt limit reached` after N attempts | HIGH |
| E-17 | MCQ pass → assessmentPassPct updates on TraineeMaster | Stat updated, risk re-evaluated | HIGH |
| E-18 | Raise Q&A question | `TraineeQueryLog` created, risk detection runs | HIGH |
| E-19 | Q&A unanswered >24h → CRITICAL risk | `riskStatus: CRITICAL`, `QA_BREACH` in TrainingRiskLog | HIGH |
| E-20 | Assigned module appears on AssignedTab | Modules assigned by scope (individual/batch/process/branch/company) visible | HIGH |
| E-21 | Trainee profile update (name/email/mobile) | TraineeMaster updated | LOW |
| E-22 | Password change: old password wrong | Error returned | MEDIUM |
| E-23 | Password change: success | `forcePasswordReset: false`, new hash stored | HIGH |
| E-24 | Attendance inferred on content open | `AttendanceInference` upserted with Present, attendancePct recalculated | HIGH |
| E-25 | LOW_COURSE risk: <60% completion → WATCH | `riskStatus: WATCH` on TraineeMaster | HIGH |
| E-26 | LOW_MCQ risk: <60% MCQ pass → HIGH | `riskStatus: HIGH` | HIGH |
| E-27 | LOW_ATTENDANCE risk: <70% attendance → HIGH | `riskStatus: HIGH` | HIGH |

---

### Section F: Reports & Dashboards

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| F-01 | Management dashboard loads all KPI tiles | activeBatches, totalActiveTrainees, certPct, throughputPct, attritionPct | HIGH |
| F-02 | Management batch summaries table | All batches with cert/attrition/handover counts | HIGH |
| F-03 | Management coordinator performance | Ranked by throughputPct | MEDIUM |
| F-04 | Management branch summaries | Per-branch averages | MEDIUM |
| F-05 | Management process summaries | Per-process/LOB averages | MEDIUM |
| F-06 | Historical KPI trend chart | 12 months data from HistoricalTrainingKpi | MEDIUM |
| F-07 | Management risk list with severity filter | CRITICAL/HIGH/WATCH/ALL filter works | MEDIUM |
| F-08 | Management export: full trainee progress | CSV with all fields, branch/process filter works | MEDIUM |
| F-09 | Management export: batch KPI summary | CSV with all batch-level metrics | MEDIUM |
| F-10 | Management export: cert evidence audit | Evidence rows with trainee name/batch | MEDIUM |
| F-11 | Reports API: batch report by batchNo | `getBatchReport` returns trainee rows | MEDIUM |
| F-12 | Reports API: export trainees CSV | Streaming CSV download | MEDIUM |
| F-13 | Reports API: send daily summary email | `POST /api/reports/send-summary` with valid SMTP | LOW |

---

### Section G: Auto Reports, Emails, Alerts, Reminders

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| G-01 | KPI snapshot cron runs at server start | `[KPI] Snapshot saved` in log | HIGH |
| G-02 | KPI snapshot cron runs again after 24h | upsert overwrites with fresh aggregate | MEDIUM |
| G-03 | Manual daily summary email endpoint | `POST /api/reports/send-summary { to: "..." }` sends email | LOW |
| G-04 | Q&A breach detection: 24h window | Risk fires after `createdAt < now - 24h` | HIGH |
| G-05 | No automated Q&A breach email exists | **CONFIRMED GAP** — no email fires on QA_BREACH | ⚠️ GAP |
| G-06 | No daily risk alert email exists | **CONFIRMED GAP** — risk detection writes DB but no email | ⚠️ GAP |
| G-07 | No batch close reminder email exists | **CONFIRMED GAP** | ⚠️ GAP |

---

### Section H: UI/UX

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| H-01 | Trainee portal: dark/light theme toggle persists | ThemeContext saves to localStorage | MEDIUM |
| H-02 | Admin console: sidebar navigation all sections load | No blank renders for any NAV item | HIGH |
| H-03 | ComplianceExport: "Export" buttons disabled until date range valid | Except Full Trainee Register (always enabled) | HIGH |
| H-04 | ComplianceExport: error shown on failed export | `setError(...)` called, error banner visible | HIGH |
| H-05 | MCQ timer countdown works (if timeLimitMins set) | Timer visible, auto-submits on expiry | MEDIUM |
| H-06 | Video player respects locked content (UI disables click) | Lock icon shown, click not allowed | HIGH |
| H-07 | Responsive: admin console usable on tablet | Sidebar collapses or scrolls | LOW |
| H-08 | Session expiry: login modal appears, user redirected | `lms:session-expired` event handled | HIGH |
| H-09 | BroadcastTab: broadcastTitle input visible, max 120 chars | Field present, char limit enforced | HIGH |
| H-10 | Loading states on async operations | Spinners/disabled states while fetching | MEDIUM |

---

### Section I: Negative & Edge Testing

| ID | Test Case | Expected | Priority |
|----|-----------|----------|----------|
| I-01 | Heartbeat with no prior OPEN logged | Returns `{ ok: true }`, no crash | HIGH |
| I-02 | Submit assessment for unknown assessmentId | 404 | MEDIUM |
| I-03 | MCQ submit with empty answers `{}` | All blank, 0 score, Fail | MEDIUM |
| I-04 | Compliance export with invalid date format | 400, `Invalid date format` | MEDIUM |
| I-05 | Compliance export with `dateTo` before `dateFrom` | Results may be empty set (no 400, but 0 rows) | LOW |
| I-06 | onboard trainee: no mobile AND no empId | 400, `Mobile number required when Employee ID is not provided` | HIGH |
| I-07 | Close batch with open queries (soft check) | Warning returned but closure succeeds | MEDIUM |
| I-08 | mapEmployeeId with non-existent mobile | Error returned, no partial update | HIGH |
| I-09 | Create batch without `canCreateBatch` permission | 403 | HIGH |
| I-10 | Compliance export: 5000+ trainee batch (large data) | No timeout, CSV streams correctly | MEDIUM |
| I-11 | Upload file > 200MB | multer rejects with error | MEDIUM |
| I-12 | Management `closedBatches` query uses `Closed` status but coordinator sets `Completed` | **POTENTIAL BUG** — management shows 0 closed batches | HIGH |
| I-13 | `downloadCsv` when backend returns non-ok | Silent failure in `api.js` (line 55: `if (!res.ok) return`) | ⚠️ BUG |
| I-14 | `TraineeQueryLog.raisedAt` vs `createdAt` field naming inconsistency | coordExportQAActivity uses `raisedAt` — verify schema field exists | MEDIUM |
| I-15 | `TraineeQueryLog.queryText` vs `question` field naming inconsistency | coordExportQAActivity uses `queryText`, raiseQuestion uses `question` | ⚠️ BUG |
| I-16 | `CertificationEvidence.score` vs `scorePct` field naming inconsistency | mgmtExportCertEvidence uses `e.score`, saveCertificationEvidence stores `scorePct` | ⚠️ BUG |
| I-17 | `LoginSessionLog.userId` field: compliance export uses `userId` to store employeeId | Verify the query is correct against schema | MEDIUM |
| I-18 | `AssessmentResult` has no `createdAt` filter in compliance export | Intentional (snapshot record design) | INFO |

---

## First Testing Plan (Execution Order)

```
Phase 1 — Environment Baseline (A section)
  → Verify setup, env vars, server starts cleanly

Phase 2 — Auth Gates (B section)
  → Login + token validation for all 4 portals
  → Test 401/403 cross-role access

Phase 3 — Critical Path: Trainee LMS (E section)
  → Login → Dashboard → Open content → Heartbeat → Complete → MCQ → Q&A
  → Verify KPI denormalization in TraineeMaster after each step

Phase 4 — Coordinator Flow (D section)
  → Create batch → Onboard trainees → Review progress → Certify → Close

Phase 5 — Admin Flow (C section)
  → Classroom/content setup → Broadcast → Reports → Compliance exports

Phase 6 — Management & Reports (F section)
  → Dashboard metrics → CSV exports

Phase 7 — Bug Verification (I-12 through I-18)
  → Focus on identified schema field name mismatches

Phase 8 — Edge Cases & Negative Tests (I section)
  → Lockout, duplicate, permission denials, invalid dates
```

---

## Summary Statistics

| Category | Total Tests | HIGH | MEDIUM | LOW | Known Bugs/Gaps |
|----------|-------------|------|--------|-----|-----------------|
| A — Setup | 9 | 6 | 3 | 0 | 0 |
| B — Auth | 12 | 9 | 3 | 0 | 0 |
| C — Admin | 23 | 17 | 5 | 1 | 0 |
| D — Coordinator | 18 | 12 | 6 | 0 | 0 |
| E — Trainee LMS | 27 | 20 | 6 | 1 | 0 |
| F — Reports | 13 | 4 | 8 | 1 | 0 |
| G — Auto/Email | 7 | 2 | 1 | 1 | 3 gaps |
| H — UI/UX | 10 | 5 | 4 | 1 | 0 |
| I — Negative/Edge | 18 | 7 | 7 | 2 | 4 bugs |
| **Total** | **137** | **82** | **43** | **7** | **7** |

**Pre-identified bugs requiring code fix (before test run):** I-12, I-13, I-15, I-16
