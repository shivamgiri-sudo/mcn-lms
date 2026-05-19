# MCN LMS — Supabase (PostgreSQL) → MySQL Migration Guide

This guide covers everything needed to migrate the MCN LMS platform from Supabase (PostgreSQL) to a self-hosted or cloud MySQL 8.0+ database.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [MySQL Database Setup](#2-mysql-database-setup)
3. [Run the Migration SQL](#3-run-the-migration-sql)
4. [Update Prisma Schema for MySQL](#4-update-prisma-schema-for-mysql)
5. [Update Environment Variables](#5-update-environment-variables)
6. [Export Data from Supabase](#6-export-data-from-supabase)
7. [Import Data into MySQL](#7-import-data-into-mysql)
8. [Seed Demo Data](#8-seed-demo-data)
9. [Deploy Backend](#9-deploy-backend)
10. [Verify the Migration](#10-verify-the-migration)
11. [Table Reference](#11-table-reference)
12. [Key Differences: PostgreSQL vs MySQL](#12-key-differences-postgresql-vs-mysql)
13. [Rollback Plan](#13-rollback-plan)

---

## 1. Prerequisites

| Requirement | Version |
|-------------|---------|
| MySQL Server | **8.0.13 or higher** (required for `DEFAULT (UUID())`) |
| Node.js | 18 or 20 |
| npm | 8+ |
| MySQL client | `mysql` CLI or MySQL Workbench |

> **Why MySQL 8.0.13+?**  
> The migration SQL uses `DEFAULT (UUID())` as a column default. This expression syntax was introduced in MySQL 8.0.13. Earlier versions do not support it.

---

## 2. MySQL Database Setup

### Option A — Local MySQL

```bash
# Install MySQL 8 (Ubuntu/Debian)
sudo apt update && sudo apt install mysql-server-8.0

# Start the service
sudo systemctl start mysql

# Secure installation (set root password, remove test DB)
sudo mysql_secure_installation

# Log in
mysql -u root -p
```

```sql
-- Create the database and a dedicated user
CREATE DATABASE mcn_lms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'lms_user'@'%' IDENTIFIED BY 'YourStrongPassword123!';
GRANT ALL PRIVILEGES ON mcn_lms.* TO 'lms_user'@'%';
FLUSH PRIVILEGES;

EXIT;
```

### Option B — PlanetScale (Managed MySQL)

1. Create a free account at [planetscale.com](https://planetscale.com)
2. Create a database named `mcn-lms`
3. Go to **Connect** → choose **Prisma** → copy the `DATABASE_URL`
4. Note: PlanetScale does not support foreign key constraints — remove all `CONSTRAINT ... FOREIGN KEY` lines from the migration SQL before running, or use the `--no-foreign-keys` variant (ask your team)

### Option C — AWS RDS / Azure MySQL / GCP Cloud SQL

Follow your cloud provider's MySQL 8.0 setup guide. Make sure:
- Port `3306` is accessible from your backend server
- `utf8mb4` character set is configured as default
- The database user has `CREATE`, `ALTER`, `INSERT`, `UPDATE`, `DELETE`, `INDEX` privileges

---

## 3. Run the Migration SQL

The complete DDL for all 35 tables is in [`docs/mysql-migration.sql`](./mysql-migration.sql).

```bash
# From the repo root
mysql -u lms_user -p mcn_lms < docs/mysql-migration.sql
```

Or using MySQL Workbench:
1. Open MySQL Workbench → connect to your server
2. File → Open SQL Script → select `docs/mysql-migration.sql`
3. Click the lightning bolt ⚡ to execute

**Expected output:** No errors. All 35 tables created.

Verify:
```sql
USE mcn_lms;
SHOW TABLES;
-- Should list 35 tables
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'mcn_lms';
-- Should return 35
```

---

## 4. Update Prisma Schema for MySQL

Edit `backend/prisma/schema.prisma`. Change the `datasource` block:

**Before (PostgreSQL/Supabase):**
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

**After (MySQL):**
```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
```

> `directUrl` is a Supabase-specific field for connection pooling — remove it entirely for MySQL.

Then regenerate the Prisma client:

```bash
cd backend
npx prisma generate
```

---

## 5. Update Environment Variables

Edit `backend/.env`:

**Before:**
```env
DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"
```

**After:**
```env
DATABASE_URL="mysql://lms_user:YourStrongPassword123!@localhost:3306/mcn_lms"
# Remove the DIRECT_URL line entirely
```

### MySQL URL format

```
mysql://USER:PASSWORD@HOST:PORT/DATABASE
```

| Parameter | Description |
|-----------|-------------|
| `USER` | MySQL username |
| `PASSWORD` | MySQL password (URL-encode special chars, e.g. `@` → `%40`) |
| `HOST` | `localhost` for local, or your cloud host |
| `PORT` | `3306` (default) |
| `DATABASE` | `mcn_lms` |

### For production on Render

In Render dashboard → your backend service → **Environment**:
- Remove `DIRECT_URL`
- Update `DATABASE_URL` to your MySQL connection string

---

## 6. Export Data from Supabase

If you have live data in Supabase that you want to carry over:

### Method A — Supabase Dashboard CSV Export

1. Go to [app.supabase.com](https://app.supabase.com) → your project → **Table Editor**
2. For each table, click the table → **Export to CSV**
3. Save all CSVs locally

### Method B — pg_dump (recommended for full data)

```bash
# Install pg_dump if not present
# Ubuntu: sudo apt install postgresql-client

pg_dump \
  "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres" \
  --data-only \
  --column-inserts \
  --no-owner \
  --no-acl \
  -f supabase_data_export.sql
```

This creates SQL `INSERT` statements compatible with most databases.

> **Note:** The `--column-inserts` flag ensures column names are included in each INSERT, making the output portable. PostgreSQL-specific types (like `JSONB`) will be exported as text — MySQL's `JSON` type accepts the same format.

---

## 7. Import Data into MySQL

### If using pg_dump output

The exported SQL will contain PostgreSQL-specific syntax. Clean it up:

```bash
# Remove PostgreSQL-specific lines
grep -v "^SET " supabase_data_export.sql \
  | grep -v "^SELECT pg_catalog" \
  | grep -v "^--" \
  > mysql_import.sql

# Import
mysql -u lms_user -p mcn_lms < mysql_import.sql
```

### If using CSV files (per-table)

```sql
-- Example for trainee_master
LOAD DATA LOCAL INFILE '/path/to/trainee_master.csv'
INTO TABLE trainee_master
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS;  -- skip header row
```

Enable local infile if needed:
```sql
SET GLOBAL local_infile = 1;
```

### Import order (respect foreign keys)

Import tables in this exact order to avoid FK constraint violations:

```
1.  role_access_matrix
2.  branch_master
3.  designation_master
4.  department_master
5.  portal_sessions
6.  process_lob_master
7.  batch_master
8.  batch_classroom_map
9.  admin_user_master
10. trainee_master
11. user_master
12. classroom_master
13. module_master
14. content_master
15. faq_master
16. trainee_classroom_map
17. assessment_master
18. question_bank
19. assessment_attempts
20. assessment_results
21. content_progress
22. video_watch_log
23. trainee_query_log
24. attendance_inference
25. training_risk_log
26. pending_activity_log
27. certification_rule_master
28. certification_evidence
29. onboarding_log
30. assigned_modules
31. audit_log
32. login_session_log
33. course_completion_report
34. historical_training_kpi
35. drive_files
```

---

## 8. Seed Demo Data

If you are setting up a fresh MySQL instance (no data to import):

```bash
cd backend
node prisma/seed.js
```

This creates:

| Portal | Login ID | Credential | URL |
|--------|----------|------------|-----|
| Admin Console | `LMS-ADMIN` | `admin1234` | `/admin` |
| Coordinator | `COORD-TEST` | PIN: `1234` | `/coordinator` |
| Management | `CEO-001` | PIN: `ceo123` | `/management` |
| Trainee LMS | `EMP1001` | `1234` | `/lms` |

---

## 9. Deploy Backend

### Local

```bash
cd backend
npm install
node src/server.js
```

### Render

1. In Render dashboard → your backend service → **Environment**
2. Update `DATABASE_URL` to the MySQL connection string
3. Delete the `DIRECT_URL` variable
4. Trigger a manual deploy

### Railway

Railway natively supports MySQL. You can provision a MySQL plugin:

1. In your Railway project → **New** → **Database** → **MySQL**
2. Copy the `DATABASE_URL` from the MySQL service
3. Set it as an env var on your backend service
4. Deploy

---

## 10. Verify the Migration

Run these checks after migration:

```sql
-- Count rows in key tables (compare with Supabase)
SELECT 'trainee_master'         AS tbl, COUNT(*) AS rows FROM trainee_master
UNION ALL
SELECT 'batch_master',                  COUNT(*) FROM batch_master
UNION ALL
SELECT 'classroom_master',              COUNT(*) FROM classroom_master
UNION ALL
SELECT 'assessment_master',             COUNT(*) FROM assessment_master
UNION ALL
SELECT 'content_progress',              COUNT(*) FROM content_progress
UNION ALL
SELECT 'trainee_query_log',             COUNT(*) FROM trainee_query_log
UNION ALL
SELECT 'training_risk_log',             COUNT(*) FROM training_risk_log;
```

Then test the application:

- [ ] Admin login works at `/admin`
- [ ] Coordinator login works at `/coordinator`
- [ ] Trainee login works at `/lms`
- [ ] Management login works at `/management`
- [ ] Curriculum loads (classrooms, modules, content)
- [ ] Trainee progress tracking works (video open/heartbeat/close)
- [ ] MCQ attempt and submission works
- [ ] Q&A raise and answer works
- [ ] Reports export downloads a CSV

---

## 11. Table Reference

| # | Table Name | Description |
|---|-----------|-------------|
| 1 | `role_access_matrix` | Coordinator & management login credentials and permissions |
| 2 | `branch_master` | Branch org master (name, code, city, state) |
| 3 | `designation_master` | Designation master |
| 4 | `department_master` | Department master |
| 5 | `portal_sessions` | Auth tokens for all portals (6-hour TTL) |
| 6 | `process_lob_master` | Process + LOB pairs |
| 7 | `batch_master` | Training batches with coordinator and classroom linkage |
| 8 | `batch_classroom_map` | Batch → classroom assignments |
| 9 | `admin_user_master` | Admin console user accounts |
| 10 | `trainee_master` | Trainee profiles with computed KPIs |
| 11 | `user_master` | Trainee LMS login accounts (hashed passwords) |
| 12 | `classroom_master` | Training classrooms (linked to Google Drive folder) |
| 13 | `module_master` | Modules within classrooms (day-based) |
| 14 | `content_master` | Videos, PDFs, documents within modules |
| 15 | `faq_master` | FAQs per module |
| 16 | `trainee_classroom_map` | Many-to-many: trainee ↔ classroom |
| 17 | `assessment_master` | MCQ assessments per module (unlimited per module) |
| 18 | `question_bank` | MCQ questions per assessment |
| 19 | `assessment_attempts` | Each MCQ attempt with full answer JSON |
| 20 | `assessment_results` | Best score per trainee per assessment |
| 21 | `content_progress` | Video/content watch progress per trainee |
| 22 | `video_watch_log` | Raw event log: open / heartbeat / close |
| 23 | `trainee_query_log` | Q&A queries raised by trainees |
| 24 | `attendance_inference` | Daily attendance inferred from content/MCQ activity |
| 25 | `training_risk_log` | Auto-detected risk flags (LOW_COURSE, LOW_MCQ, etc.) |
| 26 | `pending_activity_log` | Coordinator to-do items from risk engine |
| 27 | `certification_rule_master` | Certification criteria per process/LOB |
| 28 | `certification_evidence` | Evidence records (mock call, internal/external cert) |
| 29 | `onboarding_log` | Trainee onboarding history per batch |
| 30 | `assigned_modules` | Direct/broadcast module assignments |
| 31 | `audit_log` | Admin action audit trail |
| 32 | `login_session_log` | Login/logout event log |
| 33 | `course_completion_report` | Rollup: completion % per trainee per classroom |
| 34 | `historical_training_kpi` | Monthly KPI snapshots for management dashboard |
| 35 | `drive_files` | Google Drive file registry per folder sync |

---

## 12. Key Differences: PostgreSQL vs MySQL

| Feature | PostgreSQL (Supabase) | MySQL 8.0 |
|---------|----------------------|-----------|
| UUID default | `gen_random_uuid()` | `(UUID())` expression |
| Boolean | `BOOLEAN` → `true/false` | `TINYINT(1)` → `1/0` |
| Auto-update timestamp | Not native | `ON UPDATE CURRENT_TIMESTAMP(3)` |
| JSON type | `JSONB` (binary) | `JSON` (text-validated) |
| Text fields | `TEXT` unlimited | `TEXT` (65KB), `MEDIUMTEXT` (16MB), `LONGTEXT` (4GB) |
| String length limit | No limit on `VARCHAR` | `VARCHAR` max 65,535 bytes / row |
| `directUrl` in Prisma | Required for Supabase pooler | **Not used — remove it** |
| `@db.Text` annotation | May be needed for long fields | Handled by `TEXT` column type |
| Case sensitivity | Case-sensitive by default | Case-insensitive with `utf8mb4_unicode_ci` |

### Prisma model annotations (optional, for long text fields)

If you get "data too long" errors for fields like `question_text`, `answer`, or `details`, add `@db.Text` to those fields in `schema.prisma`:

```prisma
question  String  @db.Text
answer    String  @db.Text
details   String? @db.Text
```

Then run `npx prisma generate` again.

---

## 13. Rollback Plan

If the MySQL migration has issues and you need to revert to Supabase:

1. Restore `backend/prisma/schema.prisma` to use `provider = "postgresql"` and re-add `directUrl`
2. Restore `backend/.env` to the original Supabase `DATABASE_URL` and `DIRECT_URL`
3. Run `npx prisma generate`
4. Restart the backend — it will reconnect to Supabase

No data was deleted from Supabase during migration. The MySQL import is additive only.

---

## Support

For issues with this migration, check:
- Prisma MySQL docs: https://www.prisma.io/docs/concepts/database-connectors/mysql
- MySQL 8.0 reference: https://dev.mysql.com/doc/refman/8.0/en/
- Open an issue on this repository with the error output
