# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack LMS (Learning Management System) for MCN T&Q training operations — rebuilt from Google Sheets/AppScript.

- **Backend**: Node.js + Express (ESM modules), Prisma ORM, Supabase PostgreSQL
- **Frontend**: React 18 + Vite (no framework router — single-page, client-side view switching)
- **Location**: `C:\Users\shivamg\lms-platform`

## Dev Commands

```bash
# Backend (port 4000)
cd backend && npm run dev

# Frontend (port 5173 — proxies /api to localhost:4000)
cd frontend && npm run dev

# Schema changes — always use db push, never migrate dev in production
cd backend && npx prisma db push
cd backend && npx prisma studio    # browse data
cd backend && node prisma/seed.js  # re-seed demo data
```

## Deployment (Render)

- Backend deployed as a Node service on Render; config in `render.yaml` at root
- Build: `npm install` (root dir: `backend`); Start: `node src/server.js`
- The `start` script in `package.json` runs `npx prisma generate && node src/server.js` — **`prisma` must be in `dependencies`, not `devDependencies`**, otherwise Render's production install will skip it and the start command fails
- Frontend is deployed separately (Vercel/static host); set `VITE_API_URL` to the Render backend URL
- `SERVE_FRONTEND=false` in Render env vars

## Environment

- `.env` lives at `backend/.env` — never commit
- Required env vars: `DATABASE_URL` (pooler), `DIRECT_URL` (direct — Prisma migrations), `FRONTEND_URL` (CORS), `GOOGLE_SERVICE_ACCOUNT_JSON`, `HR_API_KEY`, `SESSION_TTL_SECONDS` (default 21600)
- Supabase project: `jspfzfvnkxugnlwfessy`, region `ap-northeast-1` (Tokyo)

## Architecture

```
backend/
  prisma/schema.prisma    — 35+ Prisma models
  prisma/seed.js          — demo data seeder
  src/server.js           — Express app, all route mounts, KPI cron on startup
  src/middleware/auth.js  — requireSession, requireRole(role)
  src/utils/
    db.js                 — Prisma singleton (globalThis caching, import this everywhere)
    session.js            — UUID token, 6h TTL in PortalSession table
    hash.js               — bcrypt + salt helpers
    audit.js              — writes to AuditLog silently
    batchNaming.js        — PRO_LOB_MON'YY_### auto-naming
    riskEngine.js         — detectAndSyncRisks(employeeId)
    empIdMapping.js       — generateTempEmpId(), mapEmployeeId() (atomic, 15-table)
    upload.js             — multer disk storage, 200MB max
  src/services/drive.js   — Google Drive API (service account + OAuth2)
  src/controllers/        — auth, trainee, coordinator, admin, management, compliance, drive, reports
  src/routes/             — one route file per controller

frontend/src/
  App.jsx                 — 4 route roots (/lms, /coordinator, /admin, /management)
  pages/Trainee/          — trainee portal
  pages/Coordinator/      — coordinator portal
  pages/Admin/            — admin console (AdminConsole.jsx = sidebar shell)
  pages/Management/       — management dashboard
  utils/api.js            — fetch wrapper + downloadCsv + uploadFile
  utils/format.js         — formatSeconds, formatDate, pct(), riskColor()
  context/ThemeContext.jsx — light/dark toggle, persists to localStorage
  index.css               — full design system (CSS variables, component classes)
```

## Route Mounts (server.js)

| Path | File |
|------|------|
| `/api/auth` | routes/auth.js |
| `/api/auth/bridge` | routes/bridge.js |
| `/api/coordinator` | routes/coordinator.js |
| `/api/trainee` | routes/trainee.js |
| `/api/admin` | routes/admin.js |
| `/api/admin/compliance` | routes/compliance.js |
| `/api/management` | routes/management.js |
| `/api/reports` | routes/reports.js |
| `/api/emp-mapping` | routes/empMapping.js (HR API key auth, no portal session) |
| `/api/drive` | routes/drive.js |
| `/api/upload` | routes/upload.js |

## Portal URLs & Demo Credentials

| Portal | URL | Login |
|--------|-----|-------|
| Trainee | `/lms` | `EMP1001` / `1234` |
| Coordinator | `/coordinator` | `COORD-TEST` / `1234` |
| Admin | `/admin` | `LMS-ADMIN` / `admin1234` |
| Management | `/management` | `CEO-001` / `ceo123` |

## Key Patterns

### Auth Middleware
- `requireSession` — validates `Authorization: Bearer <token>` against `PortalSession` table; attaches `req.userId`, `req.userType`, `req.session`
- `requireRole('admin')` — checks `req.userType`; use on every protected route
- HR API endpoint uses `x-hr-api-key` header instead of portal sessions

### API Response Shape
All endpoints: `{ ok: boolean, data?: any, message?: string }`

### Frontend API Calls
```js
import { api, downloadCsv } from '../../utils/api.js';
api.get('/admin/something', 'admin')        // type = 'admin' | 'coordinator' | 'trainee' | 'management'
api.post('/admin/something', body, 'admin')
downloadCsv('/admin/reports/csv', 'file.csv', 'admin')
```
Tokens stored as `lms_token_${type}` in localStorage. 401 auto-dispatches `lms:session-expired` event.

### Admin Console Navigation
`AdminConsole.jsx` is the sidebar shell. NAV is `[{ section, items: [{ id, label, icon }] }]`. Each `id` maps to a conditional render: `{activeId === 'X' && <ComponentX />}`. To add a page: import it, add a NAV item, add the render condition.

### Prisma — Always Use the Singleton
```js
import { prisma } from '../utils/db.js';  // correct — every controller
```
Never `new PrismaClient()` directly in a controller.

### Schema Changes
1. Edit `backend/prisma/schema.prisma`
2. `npx prisma db push` (pushes to Supabase, regenerates client)
3. Commit `schema.prisma` only — no migration SQL files needed (this project uses db push)

## Key Business Logic

### Employee ID Lifecycle
- Trainees onboarded without a permanent HRMS code get auto-generated temp IDs: `EMP0001`, `EMP0002`, … (atomic counter in `SequenceCounter` table, `empIdType = 'TEMP'`)
- `mapEmployeeId({ mobile, permanentEmpId })` in `utils/empIdMapping.js` atomically replaces temp ID across 15 dependent tables
- 4 trigger points: HR API push, admin bulk CSV, admin individual form, coordinator individual form

### Batch Auto-Naming
Format: `PRO_LOB_MON'YY_###` — e.g. `ONF_KYC_MAY'26_001`. Sequential `###` tracked in `SequenceCounter` table per month.

### Content Heartbeat
- Frontend fires every 30s while playing
- Delta capped 0–30s per heartbeat call (matches 30s frontend interval)
- `completionPct = totalSecondsSpent / requiredSeconds × 100`

### Risk Engine (`utils/riskEngine.js`)
Auto-triggered after every heartbeat, MCQ submit, Q&A event:
- `LOW_COURSE` < 60% → WATCH
- `LOW_MCQ` < 60% → HIGH
- `LOW_ATTENDANCE` < 70% → HIGH
- `QA_BREACH` open query > 24h → CRITICAL

### Compliance Audit Exports
`/api/admin/compliance/*` — 5 export categories, no `status` filter on `TraineeMaster` (intentional: auditors need all records regardless of active/inactive status).

### Certification Rules
Per process+LOB in `CertificationRuleMaster` — thresholds for course %, MCQ %, attendance %, mock call, internal/external certs. Auto-evaluated against trainee KPIs.

### KPI Snapshot (scheduled)
Runs on server startup + every 24h. Writes monthly aggregate to `HistoricalTrainingKpi`. Used by management dashboard trend charts.

### Email Notifications (`utils/mailer.js`)
Shared mailer — creates transporter on demand from env vars, no singleton (avoids startup crash when SMTP not configured).

| Function | Trigger | Recipients |
|----------|---------|------------|
| `sendDailySummaryEmail(recipients[])` | Daily cron at 07:00 IST (01:30 UTC) via `scheduleDailyEmail()` in server.js | `DAILY_SUMMARY_EMAILS` env var (comma-separated) |
| `sendCertificationEmail({...})` | `certifyTrainee` in coordinator.js, fire-and-forget `.catch()` | `trainee.email` if set |

Required env vars for email: `SMTP_HOST` (default `smtp.gmail.com`), `SMTP_PORT` (default `587`), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `DAILY_SUMMARY_EMAILS`.

If SMTP vars are not set, `createTransporter()` throws and the error is logged — the API call itself never fails.

### MySQL Migration
Change `provider = "postgresql"` to `"mysql"` in schema.prisma, remove `directUrl` line, run `npx prisma db push`. See `docs/MYSQL_MIGRATION_GUIDE.md`.

## Important Notes

- All backend files use ESM (`import`/`export`) — no `require()`
- Uploaded files go to `backend/uploads/content/` (gitignored)
- `deleted` trainees: queries that should exclude them need `where: { status: { not: 'Deleted' } }` — there is no hard delete
- `broadcastTitle` on `AssignedModule` is nullable — old rows have `null`, shows as blank in CSV
