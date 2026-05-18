# LMS 2.0 Platform — Claude Instructions

## Project Overview
Full-stack Learning Management System rebuilt from Google Sheets/AppScript.
- **Backend**: Node.js + Express (ESM), Prisma ORM, Supabase (PostgreSQL)
- **Frontend**: React 18 + Vite, React Router v6, Chart.js
- **Location**: `C:\Users\shivamg\lms-platform`

## Dev Commands

```bash
# Backend (port 4000)
cd backend && npm run dev

# Frontend (port 5173)
cd frontend && npm run dev

# Database
cd backend
npx prisma db push        # push schema changes
npx prisma studio         # browse data in browser
node prisma/seed.js       # re-seed demo data
node prisma/drop_tables.js  # drop all tables (destructive)
```

## Environment
- `.env` is at `backend/.env` — never commit this file
- Database: Supabase project "HRMS" (being renamed to LMS)
  - Project ID: `jspfzfvnkxugnlwfessy`
  - Region: ap-northeast-1 (Tokyo)
  - Pooler host: `aws-1-ap-northeast-1.pooler.supabase.com`
- Google Drive: Service Account `lms-11@sinuous-ally-496514-a2.iam.gserviceaccount.com`

## Architecture

```
backend/
  prisma/schema.prisma    — 32 Prisma models (all tables)
  prisma/seed.js          — demo data seeder
  src/server.js           — Express app entry point
  src/middleware/auth.js  — requireSession, requireRole
  src/utils/
    db.js                 — Prisma singleton
    session.js            — UUID token, 6h TTL in PortalSession table
    hash.js               — bcrypt + salt helpers
    audit.js              — writes to AuditLog silently
    batchNaming.js        — PRO_LOB_MON'YY_### format
    riskEngine.js         — detectAndSyncRisks(employeeId)
    upload.js             — multer disk storage, 200MB max
  src/services/drive.js   — Google Drive API (service account + OAuth2)
  src/controllers/        — auth, trainee, coordinator, admin, management, drive, reports
  src/routes/             — matching route files

frontend/src/
  pages/Trainee/          — /lms portal
  pages/Coordinator/      — /coordinator portal
  pages/Admin/            — /admin portal
  pages/Management/       — /management portal
  utils/api.js            — fetch wrapper, token per portal type
  utils/format.js         — pct(), riskColor()
  index.css               — full design system (CSS variables, components)
```

## Portal URLs & Demo Credentials

| Portal | URL | Login |
|--------|-----|-------|
| Trainee | `/lms` | `EMP1001` / `1234` |
| Coordinator | `/coordinator` | `COORD-TEST` / `1234` |
| Admin | `/admin` | `LMS-ADMIN` / `admin1234` |
| Management | `/management` | `CEO-001` / `ceo123` |

## Key Business Logic

### Batch Auto-Naming
Format: `PRO_LOB_MON'YY_###` — e.g. `ONF_KYC_MAY'26_001`
- PRO = first 3 chars of process (uppercase alphanumeric)
- LOB = first 3 chars of lob
- Sequential ### per month

### Content Heartbeat
- Fires every 30 seconds from frontend
- Delta capped at 0–120s (prevents cheating on inactive tabs)
- Delta = 0 when video paused or `document.hidden`
- Completion % = totalSecondsSpent / requiredSeconds × 100

### Risk Engine (`riskEngine.js`)
Auto-triggered after every heartbeat, MCQ submission, Q&A event:
- `LOW_COURSE` < 60% → WATCH
- `LOW_MCQ` < 60% → HIGH
- `LOW_ATTENDANCE` < 70% → HIGH
- `QA_BREACH` open > 24h → CRITICAL

### Content Player Logic
- Direct non-Drive URL → HTML5 `<video>` player
- Drive File ID present OR URL contains `drive.google.com` → iframe with `/preview`

### Auth Flow
- Coordinators/Management: PIN login → `RoleAccessMatrix` table
- Trainees: employeeId + password → `UserMaster` table (bcrypt)
- Admins: adminId + password → `AdminUserMaster` table (bcrypt)
- Sessions: UUID token stored in `PortalSession` table, 6h TTL
- Trainee first login: temp password = last 4 digits of mobile, forced reset

### MySQL Migration
Change `backend/prisma/schema.prisma`:
```
provider = "postgresql"  →  provider = "mysql"
```
Remove `directUrl` line. Run `npx prisma db push`.

## API Response Format
All endpoints return: `{ ok: boolean, data?: any, message?: string }`

## Important Notes
- All backend files use ESM (`import`/`export`), not CommonJS
- Prisma client is a singleton via `globalThis` caching in `utils/db.js`
- Uploaded files go to `backend/uploads/content/` (gitignored)
- Session tokens stored as `lms_token_trainee`, `lms_token_coordinator`, `lms_token_admin`, `lms_token_management` in localStorage
- 401 responses dispatch `lms:session-expired` CustomEvent to trigger auto-logout
