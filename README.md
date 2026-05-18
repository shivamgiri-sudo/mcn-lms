# LMS 2.0 Platform

A full-stack Learning Management System rebuilt from Google Sheets/AppScript to **React + Express + Supabase (PostgreSQL)**.

## Architecture

```
lms-platform/
├── backend/          Express API + Prisma ORM
│   ├── prisma/       Database schema + seed
│   └── src/
│       ├── routes/   API routes (auth, coordinator, trainee, admin, management, drive)
│       ├── controllers/
│       ├── middleware/
│       ├── utils/    session, hash, audit, riskEngine, batchNaming
│       └── services/ drive.js (Google Drive API)
└── frontend/         React + Vite
    └── src/pages/
        ├── Trainee/    /lms — Day-wise classroom, MCQ, Q&A, heartbeat tracking
        ├── Coordinator/ /coordinator — Batch mgmt, trainee onboarding, pending activities
        ├── Admin/      /admin — Curriculum builder, accounts, questions, Drive sync
        └── Management/ /management — KPI dashboard, branch/process analytics, charts
```

## Portals

| Portal | URL | Login | Default Demo |
|--------|-----|-------|--------------|
| Trainee Classroom | `/lms` | Employee ID + password | `EMP1001` / `1234` |
| Coordinator Portal | `/coordinator` | Login ID + PIN | `COORD-TEST` / `1234` |
| Admin Console | `/admin` | Admin ID + password | `LMS-ADMIN` / `admin1234` |
| Management Dashboard | `/management` | Login ID + PIN | `CEO-001` / `ceo123` |

## Quick Start

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd lms-platform

# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Database — Supabase Setup

1. Go to [supabase.com](https://supabase.com) → New Project
2. Copy your **Connection String** (Settings → Database → Connection string → URI mode)
3. Create `backend/.env` from `backend/.env.example`:

```env
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"
DIRECT_URL="postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres"
PORT=4000
FRONTEND_URL=http://localhost:5173
SESSION_SECRET=your-random-secret-here
```

### 3. Run Database Migrations

```bash
cd backend
npx prisma db push          # Push schema to Supabase
npx prisma generate         # Generate Prisma client
node prisma/seed.js         # Seed demo data
```

### 4. Start Development

```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Frontend: http://localhost:5173  
Backend API: http://localhost:4000

---

## Google Drive Integration

### Option A: Service Account (Recommended for production)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable Drive API
3. Create Service Account → Download JSON key
4. Share your Drive folders with the service account email
5. In `.env`:
```env
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
```

### Option B: OAuth2 (For admin to connect their own Drive)

1. Create OAuth2 credentials in Google Cloud Console
2. Add `http://localhost:4000/api/drive/oauth2callback` as redirect URI
3. In `.env`:
```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/drive/oauth2callback
```
4. In Admin Console → Drive Sync tab → "Connect via OAuth"

### Using Drive in Classrooms

1. Admin Console → Curriculum tab → Create Classroom
2. Enter your Google Drive Folder ID (from the folder URL: `drive.google.com/drive/folders/[FOLDER_ID]`)
3. Admin Console → Drive Sync tab → Browse/Sync the folder
4. For each content item, paste the Drive File ID into the "Drive File ID" field
5. System auto-generates: `https://drive.google.com/file/d/[FILE_ID]/preview`

---

## MySQL Migration

The Prisma schema is MySQL-compatible. To migrate:

1. In `backend/prisma/schema.prisma`, change:
   ```
   provider = "postgresql"  →  provider = "mysql"
   url       = ...          →  url = "mysql://user:pass@localhost:3306/lms"
   ```
2. Remove `directUrl` line (MySQL doesn't need it)
3. Run `npx prisma db push` against MySQL

---

## Key Features

### Trainee Classroom (`/lms`)
- PIN-less login (Employee ID + password)
- Forced password reset on first login (temp = mobile last 4 digits)
- Day-wise curriculum with module/content/FAQ structure
- Content tracking: 30-second heartbeat, progress %, completion status
- Video playback: HTML5 player OR Google Drive preview (auto-detected)
- MCQ assessments with timer, attempt limits, score review
- Q&A system with category/priority/status tracking
- Assigned modules from admin

### Coordinator Portal (`/coordinator`)
- PIN login — no Google Workspace needed
- Dashboard KPIs (batches, trainees, pending, critical risks)
- Batch creation with auto-naming: `PRO_LOB_MON'YY_###` (e.g. `ONF_KYC_MAY'26_001`)
- Single or bulk CSV trainee onboarding with duplicate blocking
- Classroom assignment to batch at creation
- Pending activities queue with action tracking
- Trainee Q&A answering
- Certification flow with evidence (mock call, internal, external cert)
- OPS handover tracking

### Admin Console (`/admin`)
- Curriculum builder: Classrooms → Days → Modules → Contents → FAQs
- Content sources: local file upload, Google Drive ID, direct URL
- Question bank: JSON bulk upload, per-assessment management
- Certification rule engine: per-process/LOB thresholds
- Trainee account management: search, reset password, unlock, delete
- Google Drive sync: browse folder, import files to classroom
- Module assignment: push modules to individual trainees or whole batches

### Management Dashboard (`/management`)
- 6 KPI cards: batches, trainees, course%, MCQ%, attendance%, cert%
- Branch-wise performance table + bar chart
- Process/LOB performance with health status (HEALTHY/WATCH/CRITICAL)
- Critical risk tracker
- Historical training trends (Chart.js line charts)
- Risk detection thresholds: Course <60%, MCQ <60%, Attendance <70%, QA >24h

---

## Auto Risk Detection

Risks are automatically detected and synced after:
- Any heartbeat update (course completion changes)
- MCQ submission
- Q&A raised/answered

Risk thresholds:
| Risk Type | Trigger | Severity |
|-----------|---------|----------|
| LOW_COURSE | Course completion < 60% | WATCH |
| LOW_MCQ | MCQ pass % < 60% (after attempt) | HIGH |
| LOW_ATTENDANCE | Attendance < 70% | HIGH |
| QA_BREACH | Open question > 24 hours | CRITICAL |

---

## Deployment (Supabase + Vercel/Railway)

### Backend on Railway
1. Push to GitHub
2. New Railway project → Deploy from GitHub
3. Add all environment variables from `.env`
4. Railway auto-detects Node.js, runs `npm start`

### Frontend on Vercel
1. New Vercel project → Import frontend folder
2. Set `VITE_API_URL` if needed, or configure reverse proxy
3. Update `FRONTEND_URL` in backend `.env` to your Vercel domain

### Supabase
- No extra setup needed — your Supabase project is already the database
- Enable Row Level Security if you want to restrict direct DB access
- Connection pooling: use `?pgbouncer=true&connection_limit=1` for serverless

---

## Seed Data Credentials

| Role | ID | PIN/Password |
|------|-----|--------------|
| Coordinator | COORD-TEST | 1234 |
| Super Admin Coord | ADMIN-COORD | admin@123 |
| CEO | CEO-001 | ceo123 |
| LMS Admin | LMS-ADMIN | admin1234 |
| Demo Trainee | EMP1001 | 1234 (then must reset) |

---

## API Reference

All endpoints return `{ ok: boolean, data?: any, message?: string }`.

```
POST /api/auth/coordinator/login     { loginId, pin }
POST /api/auth/admin/login           { adminId, password }
POST /api/auth/trainee/login         { employeeId, password }

GET  /api/trainee/dashboard
POST /api/trainee/content/:id/open
POST /api/trainee/content/:id/heartbeat  { secondsDelta, positionSeconds, ... }
POST /api/trainee/content/:id/close
GET  /api/trainee/assessment/:id
POST /api/trainee/assessment/:id/submit  { answers, timeTakenSeconds }
GET  /api/trainee/questions
POST /api/trainee/questions

GET  /api/coordinator/dashboard
GET  /api/coordinator/batches
POST /api/coordinator/batches
GET  /api/coordinator/batches/:batchNo
POST /api/coordinator/batches/:batchNo/trainees
POST /api/coordinator/batches/:batchNo/trainees/bulk
GET  /api/coordinator/pending-activities
PATCH /api/coordinator/pending-activities/:id
GET  /api/coordinator/queries
PATCH /api/coordinator/queries/:id

GET  /api/admin/classrooms
POST /api/admin/classrooms
POST /api/admin/classrooms/:id/modules
POST /api/admin/modules/:id/contents
POST /api/admin/modules/:id/faqs
POST /api/admin/assessments
POST /api/admin/assessments/:id/questions/upload
POST /api/admin/classrooms/:id/sync-drive

GET  /api/management/dashboard
GET  /api/management/branch-summaries
GET  /api/management/process-summaries
GET  /api/management/risk-list
GET  /api/management/historical-kpis
```
