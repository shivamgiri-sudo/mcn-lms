# MCN LMS — Local Express + MySQL Runbook

This runbook is for the local deployment model:

- Frontend: React/Vite
- Backend: Express
- Database: local MySQL 8.x through Prisma
- Default backend port: `4000`
- Default frontend port: `5173`

## 1. Safe branch

Production-safe corrections are staged on:

```bash
git checkout lms-corrections-20260604
```

Do not merge to `main` until local smoke testing is complete.

## 2. Required software

Install locally:

- Node.js 18+
- npm
- MySQL 8.x
- Git

Check versions:

```bash
node -v
npm -v
mysql --version
```

## 3. Create MySQL database

Login to MySQL and create the LMS database:

```sql
CREATE DATABASE IF NOT EXISTS lms_platform
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;
```

## 4. Configure backend `.env`

Create `backend/.env` from `backend/.env.example`.

Minimum local values:

```env
DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/lms_platform"
PORT=4000
API_URL=http://localhost:4000
FRONTEND_URL=http://localhost:5173
SESSION_SECRET=local-session-secret-change-this
NODE_ENV=development
SERVE_FRONTEND=false
LMS_SEQUENTIAL_UNLOCK_DISABLED=false
SESSION_TTL_SECONDS=21600
BRIDGE_SECRET=local-bridge-secret-change-this
```

## 5. Install dependencies

```bash
cd backend
npm install
cd ../frontend
npm install
```

## 6. Push Prisma schema and seed demo data

```bash
cd backend
npx prisma generate
npx prisma db push
npm run db:seed
```

## 7. Start locally

Terminal 1:

```bash
cd backend
npm run dev
```

Terminal 2:

```bash
cd frontend
npm run dev
```

Open:

- Frontend: http://localhost:5173
- Backend health: http://localhost:4000/api/health

## 8. Demo logins

| Portal | URL | Login |
|---|---|---|
| Trainee | `/lms` | `EMP1001` / `1234` |
| Coordinator | `/coordinator` | `COORD-TEST` / `1234` |
| Admin | `/admin` | `LMS-ADMIN` / `admin1234` |
| Management | `/management` | `CEO-001` / `ceo123` |

## 9. Safe migration for coordinator/management PINs

The current production data may have coordinator/management PINs in plain text. The code supports a safe migration utility.

First test all logins. Then run:

```bash
cd backend
npm run db:migrate-role-pins
```

After running it, test coordinator and management login again.

## 10. Production safety checks before merge

Run these checks before merging this branch into `main`:

```bash
cd backend
npm run db:generate
npm run start
```

In another terminal:

```bash
cd frontend
npm run build
```

Then verify:

- Backend health opens correctly
- Trainee login works
- Coordinator login works
- Admin login works
- Management login works
- Trainee cannot open future content before completing previous required content
- Trainee cannot attempt assessment before completing required content
- Existing batch and onboarding flows still work

## 11. Rollback plan

Because this branch does not alter existing production tables by default, rollback is simple:

```bash
git checkout main
cd backend
npm run dev
```

If you already ran `npm run db:migrate-role-pins`, the PINs are hashed but should still work through the updated code. Keep a database backup before running migration if you want a full database-level rollback.

Recommended backup command:

```bash
mysqldump -u root -p lms_platform > lms_platform_backup_before_lms_corrections.sql
```
