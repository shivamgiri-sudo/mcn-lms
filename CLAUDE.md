# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack LMS (Learning Management System) for MCN T&Q training operations — rebuilt from Google Sheets/AppScript.

- **Backend**: Node.js + Express (ESM modules), Prisma ORM, **MySQL**
- **Frontend**: React 18 + Vite + `react-router-dom` — `App.jsx` declares the routes
- **Local checkout**: `C:\Users\ADMIN\Desktop\mcn-lms`
- **Production**: `/var/www/mcn-lms` on host `maslms` (192.168.11.225). Backend listens on **port 8000**; nginx serves `frontend/dist` for `mcnlms.teammas.in` and proxies `/api/` to it.

## Dev Commands

```bash
# Backend
cd backend && npm run dev

# Frontend (proxies /api to the backend)
cd frontend && npm run dev

# Tests — 200+ regression tests, all must stay green
cd backend && npm test

# Schema
cd backend && npx prisma db push
cd backend && npx prisma studio
```

## Deployment — manual, no CI/CD

`render.yaml`, Vercel and Railway references in this repo are **stale**. Nothing is deployed there. The real sequence is:

```bash
ssh masadmin@192.168.11.225
cd /var/www/mcn-lms
git status --short          # ALWAYS — the tree has held uncommitted hand-patches before
git pull --ff-only origin main
cd frontend && npm run build      # nginx serves dist directly, no restart needed
sudo kill <node pid>              # a watchdog respawns it within seconds; this is the restart
```

Find the pid with `pgrep -af 'node src/server.js'`. The backend runs as root, unmanaged by pm2.

## Environment

- `.env` lives at `backend/.env` — never commit
- `DATABASE_URL` is MySQL on the same box. `HRMS_DB_*` point at a **separate** MySQL (`mas_hrms`, 192.168.10.6) for employee sync
- Other required vars: `FRONTEND_URL` (CORS), `PORT`, `SESSION_TTL_SECONDS`, `HR_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- SMTP/SMS vars are **not set in production** — anything that relies on out-of-band delivery silently does not reach the user

## Architecture

```
backend/src/
  server.js               — Express app, 50 route mounts, schedulers
  middleware/auth.js      — requireSession, requireRole, requireSuperAdmin, requireRecentElevation
  middleware/permissions.js — requirePermission(key)
  utils/db.js             — Prisma singleton (import this everywhere)
  utils/hash.js           — bcrypt helpers + firstTimePassword(mobile)
  utils/session.js        — cookie-backed sessions in PortalSession
  services/formOptions.js — branch / process / LOB option lists for every form
  routes/                 — 60 route files
  controllers/            — handlers for the older route files

frontend/src/
  App.jsx                 — react-router routes
  components/OrgSelect.jsx — BranchSelect / ProcessSelect / LobSelect, used by every form
  utils/api.js            — fetch wrapper (cookies + CSRF), downloadCsv, uploadFile
  pages/{Trainee,Coordinator,Admin,Management,...}
```

### Route mounting — read this before editing any handler

`server.js` mounts ~50 routers and **mount order decides which handler serves a path**. 28 routes are currently defined in two places; the second definition is dead code. Notably:

| Path | Actually served by | Dead copy in |
|------|--------------------|--------------|
| `/api/auth/me` | `routes/passwordStability.js` | `controllers/auth.js` |
| all four `/api/auth/*/login` | `routes/browserAuth.js` | `routes/auth.js` |
| `/api/admin/reset-password` | `routes/browserAuth.js` | `passwordStability.js`, `admin.js` |
| coordinator certification, onboarding, Q&A, risks | `routes/coordinatorStability.js` | `routes/coordinator.js` |
| trainee dashboard, heartbeat, assessment | `routes/traineeStability.js` | `routes/trainee.js` |

**Before editing a handler, confirm it is the one that serves.** `test/route-mounting-regressions.test.js` guarantees every route file is at least mounted — it was added after twelve routers sat unmounted for months while their own tests passed.

`routes/certificationHooks.js` matches some of these paths but calls `next()` — it is a hook layer, not a shadow.

### Auth

- Sessions are **cookie + CSRF**, not `Authorization: Bearer`. `utils/api.js` sends `credentials: 'include'` plus `X-LMS-Role` and `X-CSRF-Token`.
- `requireSuperAdmin` needs role `Super Admin` **and** no branch. The admin sidebar's `isSuper` mirrors that — keep the two in step or admins see pages that 403 on save.
- `requireRecentElevation` demands a password re-entry with a ≥20-character justification. It is deliberately reserved for portal-user creation, role changes, org masters, comms and HRMS config. **Do not put it on routine admin work** — it fails with a bare 403 that the UI cannot prompt for.
- `/api/emp-mapping` uses `X-HR-API-Key` instead of a session.

### API response shape

All endpoints: `{ ok: boolean, data?: any, message?: string }`

### Frontend API calls

```js
import { api, downloadCsv, uploadFile } from '../../utils/api.js';
api.get('/admin/something', 'admin')   // 'admin' | 'coordinator' | 'trainee' | 'management'
```

### Forms must use dropdowns

Branch, process and LOB are **never** free-text. Use `BranchSelect` / `ProcessSelect` / `LobSelect` from `components/OrgSelect.jsx`, backed by `GET /api/admin/form-options` and `GET /api/coordinator/form-options`. Access control keys on the branch string, so a typo revokes access.

### Admin Console navigation

`AdminConsole.jsx` is the sidebar shell. `NAV` is `[{ section, items: [{ id, label, icon }] }]`; each `id` maps to a conditional render. `SUPER_ONLY` hides org, comms, notification, system-health and runtime pages from non-super admins.

## Key Business Logic

### First-time passwords

Every creation path — HRMS sync, coordinator onboarding, admin batch onboard, bulk import — calls `firstTimePassword(mobile)`: **last 4 digits of the mobile, else `1234`**, with `forcePasswordReset: true`. Do not reintroduce per-path random credentials; SMTP/SMS are not configured, so a randomly generated password is a password nobody can ever learn.

### Employee ID lifecycle

Trainees without a permanent HRMS code get temp IDs (`EMP0001`…) from `SequenceCounter`. `mapEmployeeId()` in `utils/empIdMapping.js` atomically replaces a temp ID across 15 tables.

### Coordinator scope

Coordinators reach **every batch in their assigned branch**, not only ones where they are the named `coordinatorLoginId`. A coordinator with no branch on record stays owner-scoped. See `batchScopeWhere` / `coordinatorBatchWhere`.

### Batch auto-naming

`PRO_LOB_MON'YY_###` — e.g. `ONF_KYC_MAY'26_001`, sequence per month in `SequenceCounter`.

### Content heartbeat

Frontend fires every 30s while playing; delta capped 0–30s per call. `completionPct = totalSecondsSpent / requiredSeconds × 100`.

### Risk engine (`utils/riskEngine.js`)

`LOW_COURSE` <60% → WATCH · `LOW_MCQ` <60% → HIGH · `LOW_ATTENDANCE` <70% → HIGH · `QA_BREACH` open >24h → CRITICAL

### Certification rules

Per process+LOB in `CertificationRuleMaster`. Editable by any admin (`...auth`), deliberately not elevation-gated.

### Compliance exports

`/api/admin/compliance/*` — 5 categories, no `status` filter on `TraineeMaster` (intentional: auditors need every record).

### Email / SMS

`utils/mailer.js` builds a transporter on demand. If SMTP vars are unset, it throws and the error is logged — **the API call still succeeds**, so never treat "notification sent" as delivery.

## Important Notes

- All backend files are ESM — no `require()`
- Uploads land in `backend/uploads/content/` (gitignored). **nginx caps request bodies**; if `client_max_body_size` is missing from the site config the default 1 MB silently 413s every real upload, and the HTML error surfaces in the UI as "Invalid server response"
- `deleted` trainees are soft-deleted — filter `status: { not: 'Deleted' }`
- Several tests assert on **source text** (`readFileSync` of a route file). They pass whether or not the code is reachable — never read a green suite as proof a feature works end to end
- Demo credentials are deliberately not listed here
