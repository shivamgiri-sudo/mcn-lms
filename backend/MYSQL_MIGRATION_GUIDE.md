# MySQL Migration Guide — LMS 2.0

Complete step-by-step guide to export data from Supabase (PostgreSQL) and run
the LMS backend locally against a MySQL 8.x database.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| MySQL Server | 8.0+ | https://dev.mysql.com/downloads/mysql/ |
| MySQL Workbench (optional GUI) | any | https://dev.mysql.com/downloads/workbench/ |
| Node.js | 18+ | https://nodejs.org |
| Git | any | https://git-scm.com |

---

## Part 1 — Export data from Supabase

### Step 1 — Open your Supabase project

1. Go to https://supabase.com and log in.
2. Open your LMS project.

### Step 2 — Export each table as CSV

Go to **Table Editor** in the left sidebar.

For each table listed below, click the table name → click **Export** (top right)
→ **Export to CSV**.

Save each file with the exact filename shown:

```
role_access_matrix.csv
branch_master.csv
designation_master.csv
department_master.csv
process_lob_master.csv
batch_master.csv
batch_classroom_map.csv
trainee_master.csv
admin_user_master.csv
user_master.csv
classroom_master.csv
module_master.csv
content_master.csv
faq_master.csv
trainee_classroom_map.csv
assessment_master.csv
question_bank.csv
assessment_attempts.csv
assessment_results.csv
content_progress.csv
video_watch_log.csv
trainee_query_log.csv
attendance_inference.csv
training_risk_log.csv
pending_activity_log.csv
certification_rule_master.csv
certification_evidence.csv
onboarding_log.csv
assigned_modules.csv
audit_log.csv
login_session_log.csv
course_completion_report.csv
historical_training_kpi.csv
drive_files.csv
sequence_counter.csv
portal_sessions.csv
```

> **Tip:** You only need to export tables that have data.
> Empty tables will be created automatically by the migration SQL.

### Step 3 (Alternative) — Export via Supabase SQL Editor

If you prefer a full SQL dump instead of CSVs, go to
**SQL Editor** → **New Query** and run:

```sql
-- Run this for each table to get INSERT statements
-- Replace 'table_name' with actual table name
SELECT * FROM table_name;
```

Or use the Supabase CLI for a full dump:

```bash
# Install Supabase CLI
npm install -g supabase

# Login and link project
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Dump data only (no schema — we use our own MySQL schema)
supabase db dump --data-only -f supabase_data.sql
```

---

## Part 2 — Set up MySQL locally

### Step 4 — Install and start MySQL

**Windows:**
- Download MySQL Installer from https://dev.mysql.com/downloads/installer/
- Run installer → choose "Developer Default"
- Set root password when prompted (remember it)
- MySQL service starts automatically

**macOS (Homebrew):**
```bash
brew install mysql
brew services start mysql
mysql_secure_installation   # set root password
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install mysql-server -y
sudo systemctl start mysql
sudo mysql_secure_installation
```

### Step 5 — Create the database

Open a terminal and connect to MySQL:

```bash
mysql -u root -p
```

Then run:

```sql
CREATE DATABASE lms_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'lms_user'@'localhost' IDENTIFIED BY 'your_strong_password';
GRANT ALL PRIVILEGES ON lms_db.* TO 'lms_user'@'localhost';
FLUSH PRIVILEGES;

EXIT;
```

> You can also just use `root` directly for local development.
> The separate user is recommended for security.

---

## Part 3 — Clone and configure the backend

### Step 6 — Clone the repository

```bash
git clone https://github.com/shivamgiri-sudo/mcn-lms.git
cd mcn-lms/backend
```

### Step 7 — Install dependencies

```bash
npm install
```

This installs `mysql2` (the MySQL driver) along with all other packages.

### Step 8 — Configure .env

```bash
cp .env.example .env
```

Open `.env` and set these values:

```env
# MySQL connection string
DATABASE_URL="mysql://lms_user:your_strong_password@localhost:3306/lms_db"

# Server
PORT=4000
FRONTEND_URL=http://localhost:5173
SESSION_SECRET=any-random-secret-string-here

# Google Drive (only needed if using Drive sync feature)
GOOGLE_SERVICE_ACCOUNT_JSON=''

SERVE_FRONTEND=false

# HRMS Bridge (only needed if using Supabase bridge auth)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# HR API key (optional)
HR_API_KEY=any-local-key
```

---

## Part 4 — Run the migration SQL

### Step 9 — Create all tables

This single command creates all 30 tables with indexes and foreign keys:

```bash
mysql -u lms_user -p lms_db < prisma/migrations/mysql/001_initial_schema.sql
```

Enter your password when prompted.

**Verify it worked:**
```bash
mysql -u lms_user -p lms_db -e "SHOW TABLES;"
```

You should see all 30 table names listed.

### Step 10 — Generate the Prisma client

```bash
npx prisma generate
```

This regenerates the Prisma client for MySQL. Run this once after schema changes.

---

## Part 5 — Import Supabase data into MySQL

### Step 11 — Import CSVs via MySQL Workbench (easiest)

1. Open MySQL Workbench → connect to your local MySQL.
2. Expand `lms_db` in the left panel.
3. Right-click any table → **Table Data Import Wizard**.
4. Browse to the CSV file for that table.
5. Map columns (they should auto-match since names are the same).
6. Click **Next → Next → Finish**.
7. Repeat for each table.

**Import order matters** (parent tables before child tables):

```
1.  sequence_counter
2.  branch_master
3.  designation_master
4.  department_master
5.  process_lob_master
6.  classroom_master
7.  batch_master
8.  admin_user_master
9.  role_access_matrix
10. trainee_master
11. user_master
12. module_master
13. content_master
14. faq_master
15. assessment_master
16. question_bank
17. batch_classroom_map
18. trainee_classroom_map
19. assessment_attempts
20. assessment_results
21. content_progress
22. video_watch_log
23. attendance_inference
24. onboarding_log
25. trainee_query_log
26. training_risk_log
27. pending_activity_log
28. certification_rule_master
29. certification_evidence
30. assigned_modules
31. audit_log
32. login_session_log
33. course_completion_report
34. historical_training_kpi
35. drive_files
36. portal_sessions
```

### Step 12 — Import CSVs via MySQL command line

If you prefer the command line, use `LOAD DATA INFILE`.
First, move all CSVs to a folder MySQL can read (e.g. `C:/mysql-imports/`).

Then for each table:

```sql
USE lms_db;

-- Example for batch_master
LOAD DATA INFILE 'C:/mysql-imports/batch_master.csv'
INTO TABLE batch_master
FIELDS TERMINATED BY ','
OPTIONALLY ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 ROWS;
```

Repeat for each CSV in the import order listed above.

> **Windows path note:** Use forward slashes `/` in the path, not backslashes.
> Or enable `LOCAL` keyword: `LOAD DATA LOCAL INFILE 'path/to/file.csv' ...`
> and connect with: `mysql --local-infile=1 -u lms_user -p lms_db`

### Step 13 — Handle datetime format differences

Supabase exports datetimes as ISO 8601 (`2024-01-15T10:30:00.000Z`).
MySQL `LOAD DATA INFILE` expects `YYYY-MM-DD HH:MM:SS`.

If you get datetime errors, convert the CSV first using this Node script:

```bash
# Save as fix-dates.js in the backend folder
node fix-dates.js path/to/your_table.csv
```

```js
// fix-dates.js  — run once per CSV if you get date import errors
import { readFileSync, writeFileSync } from 'fs';

const file = process.argv[2];
const content = readFileSync(file, 'utf8');
const fixed = content.replace(
  /(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z/g,
  '$1 $2'
);
writeFileSync(file.replace('.csv', '_fixed.csv'), fixed);
console.log('Written:', file.replace('.csv', '_fixed.csv'));
```

---

## Part 6 — Start the server

### Step 14 — Run the backend

```bash
npm run dev
```

You should see:

```
🚀 LMS Backend running on port 4000
✅ Database connected
```

### Step 15 — Verify the setup

Open your browser or Postman and test:

```
GET http://localhost:4000/api/health
```

Expected response:
```json
{ "ok": true, "message": "LMS API is running" }
```

Test admin login:
```
POST http://localhost:4000/api/auth/admin/login
Body: { "adminId": "admin", "password": "your_password" }
```

---

## Part 7 — Run the frontend locally (optional)

```bash
cd ../frontend
npm install

# Create .env.local
echo 'VITE_API_URL=http://localhost:4000' > .env.local

npm run dev
```

Frontend runs at: http://localhost:5173

---

## Troubleshooting

### "Access denied for user" error
```bash
# Re-grant privileges
mysql -u root -p -e "GRANT ALL PRIVILEGES ON lms_db.* TO 'lms_user'@'localhost'; FLUSH PRIVILEGES;"
```

### "Table doesn't exist" error
The migration SQL didn't complete. Re-run:
```bash
mysql -u root -p lms_db < prisma/migrations/mysql/001_initial_schema.sql
```

### "Cannot find module 'mysql2'" error
```bash
npm install mysql2
```

### Foreign key constraint errors during CSV import
Temporarily disable FK checks:
```sql
SET FOREIGN_KEY_CHECKS = 0;
-- ... run your LOAD DATA statements ...
SET FOREIGN_KEY_CHECKS = 1;
```

### Prisma "P1001: Can't reach database server" error
Check MySQL is running:
```bash
# Windows
net start mysql80

# macOS
brew services start mysql

# Linux
sudo systemctl start mysql
```

Then verify your `DATABASE_URL` in `.env` has the correct host, port, user, and password.

### "Character set" or emoji storage errors
Ensure the database was created with `utf8mb4`:
```sql
ALTER DATABASE lms_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### Supabase CSV has extra columns not in MySQL schema
This can happen if Supabase added internal columns. In MySQL Workbench's
import wizard, simply uncheck/skip any columns that don't exist in the target table.

---

## Quick Reference — All commands in order

```bash
# 1. Clone
git clone https://github.com/shivamgiri-sudo/mcn-lms.git
cd mcn-lms/backend

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env with your MySQL credentials

# 4. Create DB
mysql -u root -p -e "CREATE DATABASE lms_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 5. Run migration (creates all 30 tables)
mysql -u root -p lms_db < prisma/migrations/mysql/001_initial_schema.sql

# 6. Generate Prisma client
npx prisma generate

# 7. (Optional) Import Supabase CSVs via Workbench or LOAD DATA INFILE

# 8. Start server
npm run dev
```

---

## Need help?

- Prisma MySQL docs: https://www.prisma.io/docs/concepts/database-connectors/mysql
- MySQL 8 download: https://dev.mysql.com/downloads/mysql/
- MySQL Workbench: https://dev.mysql.com/downloads/workbench/
