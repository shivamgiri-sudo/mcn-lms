# LMS Hardening + HRMS-Ready Plan

Branch: `lms-hardening-hrms-ready-20260604`

This phase is built for the current local deployment model:

- Backend: Express
- Database: local MySQL via Prisma
- Frontend: React/Vite
- Call Master: explicitly excluded from this phase

## What this phase corrects

### 1. Coordinator / Management PIN safety

A new dedicated controller was added:

```text
backend/src/controllers/coordinatorAuth.js
```

It supports both old plain PIN values and new hashed PIN values through the shared credential helper.

This makes the existing PIN migration safe after testing.

### 2. HRMS-ready LMS data foundation

The following migration runner was added:

```text
backend/prisma/hardeningHrmsReady.js
```

Run it from the backend folder:

```bash
node prisma/hardeningHrmsReady.js
```

It creates LMS-owned HRMS bridge/staging tables only. It does not connect to Call Master.

### 3. SQL reference script

A raw SQL reference file was added:

```text
backend/sql/20260604_lms_hardening_hrms_ready.sql
```

Use the Node migration runner first because it handles duplicate-table/duplicate-column cases more safely in local MySQL.

## New database areas

| Area | Tables |
|---|---|
| Target vs actual | `management_targets` |
| Notification center | `notification_log` |
| Trainer cockpit | `trainer_daily_log`, `trainee_coaching_log` |
| Certification command center | `certification_workflow` |
| HRMS bridge staging | `hrms_employee_sync_staging`, `hrms_lms_employee_map` |
| Batch lifecycle | `batch_lifecycle_log` |
| Soft-delete readiness | delete metadata columns on critical LMS master tables |

## Local safe execution order

### 1. Pull branch

```bash
git fetch origin
git checkout lms-hardening-hrms-ready-20260604
```

### 2. Backup DB first

```bash
mysqldump -u root -p lms_platform > lms_platform_backup_before_hardening.sql
```

### 3. Start backend and test existing login first

```bash
cd backend
npm run dev
```

Test all four portals:

- Trainee
- Coordinator
- Admin
- Management

### 4. Run HRMS-ready hardening migration

```bash
cd backend
node prisma/hardeningHrmsReady.js
```

### 5. Retest backend

```bash
npm run dev
```

### 6. Only after successful login testing, run PIN migration

```bash
npm run db:migrate-role-pins
```

Then test Coordinator and Management login again.

## What is intentionally not included

- No Call Master integration
- No call audit data linkage
- No production call quality correlation
- No destructive rewrite of existing LMS flows
- No forced cloud deployment changes

## Recommended next build phase

After this branch is tested locally, the next implementation layer should be:

1. Management target CRUD APIs and UI
2. KPI drilldown APIs using the same filter contract
3. Notification center APIs and trainee/coordinator UI
4. Trainer cockpit APIs and UI
5. Certification workflow evaluator and UI
6. HRMS employee sync endpoint using the staging tables

