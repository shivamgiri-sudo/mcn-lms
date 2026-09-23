# Typing Practice Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full Typing Practice module to MCN-LMS — two typing modes (Passage Test and Timed Drill), domain-specific passage library (MRZ, passport, addresses), keystroke-level session tracking, anti-cheat, leaderboard integration, and role-scoped analytics for trainees/coordinators/admins/super-admins.

**Architecture:** Mirrors the Voice & Accent pattern exactly — a new `TypingPrompt`/`TypingSession`/`TypingStreak` Prisma model group, a standalone controller + route file mounted at `/api/typing`, a new `TypingPracticeTab.jsx` wired into `DashboardView.jsx`, and a new `awardTypingSession` hook added to `leaderboardEngine.js`. Passages are code-seeded (no admin UI). Analytics use the same `scopeWhere` pattern from `voiceAccent.js`.

**Tech Stack:** Node.js ESM, Prisma ORM (MySQL), Express, React 18 (JSX), custom CSS (`.wrap`/`.card`/`.btn`/`.pill` classes), `api` util from `frontend/src/utils/api.js`.

## Global Constraints

- All backend files use ESM (`import`/`export`) — no `require()`
- All Prisma model fields use `@map("snake_case")` for DB column names
- `req.userId` = employeeId string; `req.userType` = `'trainee'|'coordinator'|'admin'`; `req.userBranch` = branch string or null
- Auth middleware: `requireSession` + `requireRole(...)` from `backend/src/middleware/auth.js`
- `prisma` imported from `../utils/db.js` (not a new PrismaClient)
- `audit(...)` imported from `../utils/audit.js` — always call on state-changing actions
- Frontend uses `api.get(path, role)` / `api.post(path, body, role)` from `../../utils/api.js`
- Frontend uses custom CSS classes: `.card`, `.btn`, `.pill`, `.row`, `.tab-btn`, `.kpi-card`, `.progress-shell`, `.progress-bar` — no Tailwind
- CSS variables for colour: `var(--ok)`, `var(--warn)`, `var(--bad)`, `var(--accent)`, `var(--muted)`, `var(--line)`
- Leaderboard hook: fire-and-forget via `.catch(console.error)` — never let it block the response
- Prisma model IDs: use `String @id @default(uuid())` — not autoincrement Int
- `isVoided` sessions are stored but excluded from all averages, points, and streak updates

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `backend/prisma/schema.prisma` | Add `TypingPrompt`, `TypingSession`, `TypingStreak` models |
| Modify | `backend/prisma/seed.js` | Add `seedTypingPrompts()` with 25 passages |
| Create | `backend/src/controllers/typingPractice.js` | All API handlers |
| Create | `backend/src/routes/typingPractice.js` | Route wiring |
| Modify | `backend/src/server.js` | Mount `/api/typing` |
| Modify | `backend/src/utils/leaderboardEngine.js` | Add `awardTypingSession()` + `TYPING_SESSION` to `categoryFor()` |
| Create | `frontend/src/pages/Trainee/TypingPracticeTab.jsx` | Full trainee typing UI + session history |
| Modify | `frontend/src/pages/Trainee/DashboardView.jsx` | Add tab + KPI widget |

---

## Task 1: Prisma Schema — Three New Models

**Files:**
- Modify: `backend/prisma/schema.prisma` (append after `voice_accent_submission` block, around line 1208)

**Interfaces:**
- Produces: `prisma.typingPrompt`, `prisma.typingSession`, `prisma.typingStreak` — all available to Task 3

- [ ] **Step 1: Append models to schema.prisma**

Open `backend/prisma/schema.prisma` and append at the very end:

```prisma
// ─── TYPING PRACTICE ──────────────────────────────────────────────────────────
// Built-in passage library — no admin UI, seeded via seed.js. mode PASSAGE means
// the trainee types the full body text until completion; TIMED_DRILL means they
// type continuously for durationSeconds. difficulty/tags help the UI group cards.
model TypingPrompt {
  id              String   @id @default(uuid())
  title           String
  body            String   @db.Text
  mode            String   @default("PASSAGE") // PASSAGE | TIMED_DRILL
  durationSeconds Int?     @map("duration_seconds")
  difficulty      String   @default("EASY") // EASY | MEDIUM | HARD
  tags            Json     @default("[]")
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([isActive, mode])
  @@map("typing_prompts")
}

// One row per completed session. All scope fields (batchNo/branch/process/lob)
// are denormalized from TraineeMaster at save time — same pattern as
// VoiceAccentSubmission — so analytics queries require zero joins.
// keystrokeLog is a JSON array of {t: ms_offset, k: char, correct: bool}.
// isVoided=true when cheat thresholds are exceeded; voided sessions are stored
// but excluded from all averages, points, and streak updates.
model TypingSession {
  id              String   @id @default(uuid())
  traineeId       String   @map("trainee_id")
  traineeName     String?  @map("trainee_name")
  batchNo         String?  @map("batch_no")
  branch          String?
  process         String?
  lob             String?
  promptId        String   @map("prompt_id")
  mode            String
  wpm             Int
  rawWpm          Int      @map("raw_wpm")
  accuracy        Float
  errorCount      Int      @map("error_count")
  durationSeconds Int      @map("duration_seconds")
  pasteEventCount Int      @default(0) @map("paste_event_count")
  focusLostCount  Int      @default(0) @map("focus_lost_count")
  isVoided        Boolean  @default(false) @map("is_voided")
  voidReason      String?  @map("void_reason")
  keystrokeLog    Json     @default("[]") @map("keystroke_log")
  leaderboardPts  Int      @default(0) @map("leaderboard_pts")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([traineeId])
  @@index([batchNo])
  @@index([branch])
  @@index([process])
  @@index([createdAt])
  @@index([isVoided])
  @@map("typing_sessions")
}

// Per-trainee streak state. Updated only on valid (non-voided) sessions.
// lastPracticedDate is stored as a UTC midnight string (YYYY-MM-DD) so streak
// comparison is date-only, timezone-independent.
model TypingStreak {
  id              String    @id @default(uuid())
  traineeId       String    @unique @map("trainee_id")
  currentStreak   Int       @default(0) @map("current_streak")
  longestStreak   Int       @default(0) @map("longest_streak")
  lastPracticedDate String? @map("last_practiced_date") // "YYYY-MM-DD"
  updatedAt       DateTime  @updatedAt @map("updated_at")

  @@map("typing_streaks")
}
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd backend
npx prisma migrate dev --name add_typing_practice
```

Expected output: `Your database is now in sync with your schema.`

- [ ] **Step 3: Verify tables exist**

```bash
npx prisma db pull --print 2>/dev/null | grep -E "typing_prompts|typing_sessions|typing_streaks"
```

Expected: three table names printed.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(typing): add TypingPrompt, TypingSession, TypingStreak Prisma models"
```

---

## Task 2: Seed 25 Typing Passages

**Files:**
- Modify: `backend/prisma/seed.js`

**Interfaces:**
- Consumes: `prisma.typingPrompt` from Task 1
- Produces: 25 rows in `typing_prompts` table, all `isActive: true`

- [ ] **Step 1: Add `seedTypingPrompts()` function to seed.js**

After the existing imports and before `seedReferenceMasters`, add:

```js
async function seedTypingPrompts() {
  const prompts = [
    // ── EASY (8) ──────────────────────────────────────────────────────────────
    {
      title: 'Basic Name and DOB',
      body: 'SMITH, John Edward — Date of Birth: 15 January 1989 — Nationality: British',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['name', 'dob']),
    },
    {
      title: 'Simple UK Address',
      body: '42 Kensington Road, London, SW1A 2AA, United Kingdom',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['address', 'postcode']),
    },
    {
      title: 'Document Type Label',
      body: 'Document Type: PASSPORT — Issuing Country: UNITED KINGDOM — Status: VALID',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['document-type']),
    },
    {
      title: 'Nationality Field',
      body: 'Surname: PATEL — Given Names: PRIYA MEERA — Nationality: INDIAN — Sex: F',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['name', 'nationality']),
    },
    {
      title: 'Basic Timed Drill 1min',
      body: 'Type names and dates as they appear. JOHNSON, Mark David. Born 03 March 1992. Nationality: British.',
      mode: 'TIMED_DRILL', durationSeconds: 60, difficulty: 'EASY', tags: JSON.stringify(['name', 'dob']),
    },
    {
      title: 'Address Timed Drill 1min',
      body: 'Flat 2, 88 Baker Street, London NW1 6XE. Occupation: Customer Service Agent. Date: 12 April 2024.',
      mode: 'TIMED_DRILL', durationSeconds: 60, difficulty: 'EASY', tags: JSON.stringify(['address']),
    },
    {
      title: 'Simple Address 2',
      body: '17 Queen Victoria Street, Birmingham, B1 1BD — United Kingdom',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['address', 'postcode']),
    },
    {
      title: 'Personal Details Block',
      body: 'First Name: AISHA — Last Name: KHAN — Gender: Female — Date of Birth: 22/07/1995 — Nationality: Pakistani',
      mode: 'PASSAGE', difficulty: 'EASY', tags: JSON.stringify(['name', 'dob', 'nationality']),
    },
    // ── MEDIUM (10) ───────────────────────────────────────────────────────────
    {
      title: 'Document Number with Prefix',
      body: 'Passport Number: GBR1234567 — Issue Date: 09 DEC 2019 — Expiry Date: 09 DEC 2029',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['document-number', 'expiry']),
    },
    {
      title: 'Alphanumeric Postcode Address',
      body: 'Flat 3B, 17 Albemarle Street, London W1S 4HE — Previous: 9 Elgin Crescent, London W11 2JA',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['address', 'postcode']),
    },
    {
      title: 'Combined Identity Block',
      body: 'Name: BROWN, Sarah Louise — DOB: 31 MAR 1987 — Nationality: GBR — Doc No: P-UK-98765432 — Expiry: 31 MAR 2032',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['name', 'dob', 'document-number', 'expiry']),
    },
    {
      title: 'EU Identity Card',
      body: 'Cognome: ROSSI — Nome: MARCO LUIGI — Nazionalità: ITA — N. Documento: CA1234567B — Scadenza: 15/08/2028',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['document-number', 'name', 'expiry']),
    },
    {
      title: 'Medium Timed Drill 3min',
      body: 'Reference: GBR9876543 — Address: 44 Gloucester Place, London W1U 8EA — DOB: 07 FEB 1990 — Expiry: 07 FEB 2030 — Nationality: British',
      mode: 'TIMED_DRILL', durationSeconds: 180, difficulty: 'MEDIUM', tags: JSON.stringify(['document-number', 'address', 'expiry']),
    },
    {
      title: 'Address with County',
      body: '3 Highfield Lane, Sutton Coldfield, West Midlands, B73 5RA — Tel: 0121-355-9876 — Ref: UK/2024/00342',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['address', 'postcode']),
    },
    {
      title: 'Date Format Mix',
      body: 'Date of Issue: 01 JAN 2020 — Date of Expiry: 31 DEC 2030 — Date of Birth: 14-06-1988 — Verification Date: 2024/03/22',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['expiry', 'dob']),
    },
    {
      title: 'Multi-Doc Reference Block',
      body: 'Driving Licence: SMITH901155JA9IY — NI Number: NJ 45 67 89 C — Passport: 098765432 — UTR: 1234567890',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['document-number']),
    },
    {
      title: 'Employer and Address Verification',
      body: 'Employer: MCN Callnet Solutions Pvt Ltd — Reg No: 12345678 — Address: Sector 63, Noida, UP 201307 — GSTIN: 09ABCDE1234F1Z5',
      mode: 'PASSAGE', difficulty: 'MEDIUM', tags: JSON.stringify(['address', 'document-number']),
    },
    {
      title: 'Medium Timed Drill 5min',
      body: 'NGUYEN, Van Thanh — DOB: 03/09/1993 — Passport: VNM4512876 — Address: 18 Thanh Xuan Street, Hanoi 10000, Vietnam — Expiry: 03/09/2033 — Nationality: Vietnamese',
      mode: 'TIMED_DRILL', durationSeconds: 300, difficulty: 'MEDIUM', tags: JSON.stringify(['name', 'dob', 'document-number', 'address']),
    },
    // ── HARD (7) ──────────────────────────────────────────────────────────────
    {
      title: 'MRZ Line Pair — UK Passport',
      body: 'P<GBRSMITH<<JOHN<EDWARD<<<<<<<<<<<<<<<<<<<<\n9674523761GBR8901157M3012317<<<<<<<<<6',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport']),
    },
    {
      title: 'MRZ Line Pair — German Passport',
      body: 'P<DEUMUELLER<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nC3B154778DEU8504216F2902128<<<<<<<<<4',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport']),
    },
    {
      title: 'MRZ Line Pair — Indian Passport',
      body: 'P<INDPATEL<<PRIYA<MEERA<<<<<<<<<<<<<<<<<<<<\nZ1234567BIND9507223F2907221<<<<<<<<<2',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport']),
    },
    {
      title: 'Full Identity Doc with MRZ',
      body: 'Surname: CHEN — Given: WEI MING — DOB: 12 AUG 1991 — Passport: E12345678 — Country: CHN — Expiry: 12 AUG 2031\nP<CHNECHEN<<WEI<MING<<<<<<<<<<<<<<<<<<<<<<\nE12345678CHN9108125M3108126<<<<<<<<<8',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport', 'name', 'dob']),
    },
    {
      title: 'Hard Timed Drill 3min — Mixed Chars',
      body: 'Ref: GBR/2024-03/99887766 — Address: Flat 4/C, 22-24 Queen\'s Gate Terrace, London SW7 5PH — Doc: P<GBR<<JONES<<DAVID<PAUL<<<<<<<<<< — Expiry: 31/12/2029',
      mode: 'TIMED_DRILL', durationSeconds: 180, difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'address', 'document-number']),
    },
    {
      title: 'Address + MRZ Combined',
      body: 'Permanent Address: 77-B Rajouri Garden, New Delhi 110027 — Passport: J8901234 — MRZ:\nP<INDKUMAR<<RAHUL<SINGH<<<<<<<<<<<<<<<<<<\nJ8901234IND9302155M2902150<<<<<<<<<3',
      mode: 'PASSAGE', difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport', 'address']),
    },
    {
      title: 'Hard Timed Drill 5min — Full Verification',
      body: 'VERIFICATION RECORD — ID: VER/2024/UK/003342\nName: O\'SULLIVAN, Patrick James — DOB: 29-02-1988 — Nationality: IRL\nPassport: IA1234567 — Issue: 01/03/2020 — Expiry: 01/03/2030\nAddress: 14A Fitzwilliam Square, Dublin 2, D02 XH97, Ireland\nMRZ: P<IRLOSULLIVAN<<PATRICK<JAMES<<<<<<<<<<<\nIA1234567IRL8802295M3003013<<<<<<<<<2',
      mode: 'TIMED_DRILL', durationSeconds: 300, difficulty: 'HARD', tags: JSON.stringify(['MRZ', 'passport', 'address', 'document-number']),
    },
  ];

  for (const p of prompts) {
    await prisma.typingPrompt.upsert({
      where: { id: p.id || '__none__' },
      create: { ...p, isActive: true },
      update: {},
    }).catch(async () => {
      // upsert by title for idempotent re-runs (no id on first insert)
      const existing = await prisma.typingPrompt.findFirst({ where: { title: p.title } });
      if (!existing) await prisma.typingPrompt.create({ data: { ...p, isActive: true } });
    });
  }
  console.log(`[seed] typing_prompts: ${prompts.length} passages ensured.`);
}
```

- [ ] **Step 2: Call `seedTypingPrompts()` from the main seed function**

Find the `main()` function in `seed.js` (it calls things like `seedReferenceMasters()`). Add after the last existing seeder call:

```js
await seedTypingPrompts();
```

- [ ] **Step 3: Run seeder**

```bash
cd backend
NODE_ENV=development node prisma/seed.js
```

Expected: `[seed] typing_prompts: 25 passages ensured.`

- [ ] **Step 4: Verify row count**

```bash
npx prisma studio
```

Open `typing_prompts` table — confirm 25 rows exist across EASY/MEDIUM/HARD. (Or run: `node -e "import('./src/utils/db.js').then(m=>m.prisma.typingPrompt.count()).then(console.log)"`)

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/seed.js
git commit -m "feat(typing): seed 25 domain-specific typing passages (MRZ, passport, address)"
```

---

## Task 3: Leaderboard Engine — Add `awardTypingSession`

**Files:**
- Modify: `backend/src/utils/leaderboardEngine.js`

**Interfaces:**
- Consumes: `recordEvent(employeeId, eventType, refId, points, meta)` — internal function already in this file
- Consumes: `recomputeLeaderboardScore(employeeId)` — already exported from this file
- Produces: `awardTypingSession(employeeId, sessionId, wpm, accuracy, isPersonalBest, streakDay)` — called from Task 4 controller

- [ ] **Step 1: Add TYPING points to the constants object**

In `leaderboardEngine.js`, find `export const LEADERBOARD_POINTS = {` and add inside it:

```js
  TYPING_SESSION_BASE: 10,
  TYPING_SESSION_GOOD: 30,   // wpm >= 40 && accuracy >= 85
  TYPING_SESSION_GREAT: 50,  // wpm >= 60 && accuracy >= 95
  TYPING_PERSONAL_BEST: 15,
  TYPING_STREAK_7: 25,
```

- [ ] **Step 2: Update `categoryFor()` to handle TYPING events**

Find the `function categoryFor(eventType)` block and add before `return null;`:

```js
  if (eventType === 'TYPING_SESSION') return 'typingPoints';
```

- [ ] **Step 3: Update `recomputeLeaderboardScore` totals initializer**

Find `const totals = { coursePoints: 0, assessmentPoints: 0, attendancePoints: 0, certificationPoints: 0 };` and replace with:

```js
  const totals = { coursePoints: 0, assessmentPoints: 0, attendancePoints: 0, certificationPoints: 0, typingPoints: 0 };
```

- [ ] **Step 4: Update the `totalPoints` sum line**

Find `const totalPoints = totals.coursePoints + totals.assessmentPoints + totals.attendancePoints + totals.certificationPoints;` and replace with:

```js
  const totalPoints = totals.coursePoints + totals.assessmentPoints + totals.attendancePoints + totals.certificationPoints + totals.typingPoints;
```

- [ ] **Step 5: Update both `create` and `update` blocks in the `prisma.traineeLeaderboardScore.upsert` call**

Both `create: { ... }` and `update: { ... }` objects need `typingPoints: totals.typingPoints` added to them alongside the existing `...totals` spread. The spread already handles it since `totals` now includes `typingPoints` — verify the upsert uses `...totals` in both blocks (it does, no change needed here).

Verify the upsert schema accepts `typingPoints` — check `TraineeLeaderboardScore` model in schema.prisma:

```bash
grep -n "typingPoints\|typing_points" backend/prisma/schema.prisma
```

If the column doesn't exist, add it to the model:

```prisma
  typingPoints     Int      @default(0) @map("typing_points")
```

Then run: `npx prisma migrate dev --name add_typing_points_to_leaderboard`

- [ ] **Step 6: Add `awardTypingSession` export at the bottom of leaderboardEngine.js**

```js
// Called fire-and-forget from typingPractice controller after a valid session save.
// sessionId is used as refId so a retried save never double-counts.
// isPersonalBest and streakDay are booleans/numbers passed from the controller.
export async function awardTypingSession(employeeId, sessionId, wpm, accuracy, isPersonalBest, streakDay) {
  const base = (wpm >= 60 && accuracy >= 95)
    ? LEADERBOARD_POINTS.TYPING_SESSION_GREAT
    : (wpm >= 40 && accuracy >= 85)
      ? LEADERBOARD_POINTS.TYPING_SESSION_GOOD
      : LEADERBOARD_POINTS.TYPING_SESSION_BASE;

  await recordEvent(employeeId, 'TYPING_SESSION', sessionId, base, { wpm, accuracy });

  if (isPersonalBest) {
    await recordEvent(employeeId, 'TYPING_SESSION', `${sessionId}_pb`, LEADERBOARD_POINTS.TYPING_PERSONAL_BEST, { wpm });
  }

  if (streakDay >= 7) {
    // One award per 7-day milestone; use the rounded-down milestone as refId
    const milestone = Math.floor(streakDay / 7) * 7;
    await recordEvent(employeeId, 'TYPING_SESSION', `streak_${milestone}`, LEADERBOARD_POINTS.TYPING_STREAK_7, { streak: streakDay });
  }

  await recomputeLeaderboardScore(employeeId);
}
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/utils/leaderboardEngine.js backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(typing): add awardTypingSession to leaderboard engine + typingPoints column"
```

---

## Task 4: Backend Controller + Route

**Files:**
- Create: `backend/src/controllers/typingPractice.js`
- Create: `backend/src/routes/typingPractice.js`
- Modify: `backend/src/server.js` (3 lines)

**Interfaces:**
- Consumes: `prisma` from `../utils/db.js`
- Consumes: `audit` from `../utils/audit.js`
- Consumes: `awardTypingSession` from `../utils/leaderboardEngine.js`
- Consumes: `requireSession`, `requireRole` from `../middleware/auth.js`
- Produces: REST endpoints at `/api/typing/*`

- [ ] **Step 1: Create `backend/src/controllers/typingPractice.js`**

```js
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';
import { awardTypingSession } from '../utils/leaderboardEngine.js';

// ── Scope helpers ─────────────────────────────────────────────────────────────
// Mirrors voiceAccent.js scopeWhere exactly.
async function scopeWhere(req) {
  if (req.userType === 'coordinator') {
    const owned = await prisma.batchMaster.findMany({
      where: { coordinatorLoginId: req.userId },
      select: { batchNo: true },
    });
    const batchNos = owned.map(b => b.batchNo);
    return { batchNo: { in: batchNos.length ? batchNos : ['__none__'] } };
  }
  if (req.userType === 'admin' && req.userBranch) {
    return { branch: req.userBranch };
  }
  return {};
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function clampFloat(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// ── Trainee: list active prompts ─────────────────────────────────────────────
export async function listPrompts(req, res) {
  try {
    const q = req.query || {};
    const where = { isActive: true };
    if (q.mode && ['PASSAGE', 'TIMED_DRILL'].includes(q.mode.toUpperCase())) {
      where.mode = q.mode.toUpperCase();
    }
    if (q.difficulty && ['EASY', 'MEDIUM', 'HARD'].includes(q.difficulty.toUpperCase())) {
      where.difficulty = q.difficulty.toUpperCase();
    }
    const rows = await prisma.typingPrompt.findMany({ where, orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }] });
    return res.json({ ok: true, data: rows.map(p => ({
      id: p.id, title: p.title, mode: p.mode, durationSeconds: p.durationSeconds,
      difficulty: p.difficulty, tags: p.tags, wordCount: p.body.trim().split(/\s+/).length,
    })) });
  } catch (err) {
    console.error('[Typing] listPrompts failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load typing prompts.' });
  }
}

// ── Trainee: fetch prompt body (called on session start only) ─────────────────
export async function getPrompt(req, res) {
  try {
    const row = await prisma.typingPrompt.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!row) return res.status(404).json({ ok: false, message: 'Prompt not found.' });
    return res.json({ ok: true, data: { id: row.id, title: row.title, body: row.body, mode: row.mode, durationSeconds: row.durationSeconds, difficulty: row.difficulty, tags: row.tags } });
  } catch (err) {
    console.error('[Typing] getPrompt failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load prompt.' });
  }
}

// ── Trainee: save completed session ──────────────────────────────────────────
export async function saveSession(req, res) {
  try {
    const b = req.body || {};

    // Sanity checks — reject impossible values
    const wpm = clampInt(b.wpm, 0, 250, -1);
    if (wpm < 0) return res.status(400).json({ ok: false, message: 'wpm must be 0–250.' });

    const durationSeconds = clampInt(b.durationSeconds, 0, 7200, -1);
    if (durationSeconds < 5) return res.status(400).json({ ok: false, message: 'Session too short (minimum 5 seconds).' });

    const rawWpm = clampInt(b.rawWpm, 0, 400, wpm);
    const accuracy = clampFloat(b.accuracy, 0, 100, 0);
    const errorCount = clampInt(b.errorCount, 0, 99999, 0);
    const pasteEventCount = clampInt(b.pasteEventCount, 0, 999, 0);
    const focusLostCount = clampInt(b.focusLostCount, 0, 999, 0);
    const mode = ['PASSAGE', 'TIMED_DRILL'].includes(String(b.mode || '').toUpperCase())
      ? String(b.mode).toUpperCase() : 'PASSAGE';
    const promptId = String(b.promptId || '').trim();
    if (!promptId) return res.status(400).json({ ok: false, message: 'promptId is required.' });

    const prompt = await prisma.typingPrompt.findFirst({ where: { id: promptId, isActive: true } });
    if (!prompt) return res.status(404).json({ ok: false, message: 'Prompt not found.' });

    const trainee = await prisma.traineeMaster.findFirst({
      where: { employeeId: req.userId, status: 'Active' },
      select: { employeeId: true, traineeName: true, batchNo: true, branch: true, process: true, lob: true },
    });
    if (!trainee) return res.status(404).json({ ok: false, message: 'Active trainee record not found.' });

    // Cheat detection
    let isVoided = false;
    let voidReason = null;
    if (pasteEventCount >= 3) { isVoided = true; voidReason = 'paste_attempts'; }
    else if (focusLostCount >= 5) { isVoided = true; voidReason = 'focus_lost'; }

    // Keystroke log — stored as-is, max 50KB of chars
    let keystrokeLog = [];
    if (Array.isArray(b.keystrokeLog)) {
      keystrokeLog = b.keystrokeLog.slice(0, 5000).map(k => ({
        t: Number(k.t) || 0, k: String(k.k || '').slice(0, 8), correct: Boolean(k.correct),
      }));
    }

    const session = await prisma.typingSession.create({
      data: {
        traineeId: trainee.employeeId,
        traineeName: trainee.traineeName,
        batchNo: trainee.batchNo,
        branch: trainee.branch,
        process: trainee.process,
        lob: trainee.lob,
        promptId,
        mode,
        wpm,
        rawWpm,
        accuracy,
        errorCount,
        durationSeconds,
        pasteEventCount,
        focusLostCount,
        isVoided,
        voidReason,
        keystrokeLog,
        leaderboardPts: 0,
      },
    });

    let streakDay = 0;
    let isPersonalBest = false;
    let newStreak = 0;

    if (!isVoided) {
      // Personal best check
      const best = await prisma.typingSession.findFirst({
        where: { traineeId: trainee.employeeId, isVoided: false, id: { not: session.id } },
        orderBy: { wpm: 'desc' },
        select: { wpm: true },
      });
      isPersonalBest = !best || wpm > best.wpm;

      // Streak update
      const streak = await prisma.typingStreak.findUnique({ where: { traineeId: trainee.employeeId } });
      const today = todayStr();
      if (!streak) {
        await prisma.typingStreak.create({ data: { traineeId: trainee.employeeId, currentStreak: 1, longestStreak: 1, lastPracticedDate: today } });
        newStreak = 1;
      } else {
        const last = streak.lastPracticedDate;
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let current;
        if (last === today) {
          current = streak.currentStreak; // already practiced today
        } else if (last === yesterday) {
          current = streak.currentStreak + 1; // extending streak
        } else {
          current = 1; // streak broken
        }
        const longest = Math.max(current, streak.longestStreak);
        await prisma.typingStreak.update({ where: { traineeId: trainee.employeeId }, data: { currentStreak: current, longestStreak: longest, lastPracticedDate: today } });
        newStreak = current;
      }
      streakDay = newStreak;

      // Calculate leaderboard points
      const basePts = (wpm >= 60 && accuracy >= 95) ? 50 : (wpm >= 40 && accuracy >= 85) ? 30 : 10;
      const pbPts = isPersonalBest ? 15 : 0;
      const streakPts = streakDay >= 7 ? 25 : 0;
      const totalPts = basePts + pbPts + streakPts;

      await prisma.typingSession.update({ where: { id: session.id }, data: { leaderboardPts: totalPts } });

      // Fire leaderboard award fire-and-forget
      awardTypingSession(trainee.employeeId, session.id, wpm, accuracy, isPersonalBest, streakDay).catch(console.error);
    }

    await audit({ userIdentity: req.userId, userRole: 'Trainee', action: 'SAVE_TYPING_SESSION', module: 'TypingPractice', referenceId: session.id, newValue: { wpm, accuracy, isVoided } });

    return res.status(201).json({ ok: true, data: {
      id: session.id, wpm, accuracy, errorCount, durationSeconds, isVoided, voidReason,
      leaderboardPts: session.leaderboardPts, isPersonalBest, streak: streakDay,
    }});
  } catch (err) {
    console.error('[Typing] saveSession failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not save typing session.' });
  }
}

// ── Trainee: my session history ───────────────────────────────────────────────
export async function getMySessions(req, res) {
  try {
    const take = Math.min(parseInt(req.query?.limit || '50', 10), 200);
    const rows = await prisma.typingSession.findMany({
      where: { traineeId: req.userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true, promptId: true, mode: true, wpm: true, accuracy: true,
        errorCount: true, durationSeconds: true, isVoided: true, voidReason: true,
        leaderboardPts: true, createdAt: true,
      },
    });
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[Typing] getMySessions failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load sessions.' });
  }
}

// ── Trainee: dashboard widget stats ──────────────────────────────────────────
export async function getMyStats(req, res) {
  try {
    const traineeId = req.userId;
    const today = todayStr();

    const [streak, todaySessions, last7Sessions] = await Promise.all([
      prisma.typingStreak.findUnique({ where: { traineeId } }),
      prisma.typingSession.findMany({
        where: { traineeId, isVoided: false, createdAt: { gte: new Date(today) } },
        orderBy: { wpm: 'desc' }, take: 1,
        select: { wpm: true },
      }),
      prisma.typingSession.findMany({
        where: { traineeId, isVoided: false },
        orderBy: { createdAt: 'desc' }, take: 7,
        select: { wpm: true, createdAt: true },
      }),
    ]);

    const weekStart = new Date(Date.now() - 7 * 86400000);
    const weekCount = await prisma.typingSession.count({
      where: { traineeId, isVoided: false, createdAt: { gte: weekStart } },
    });

    return res.json({ ok: true, data: {
      todayBestWpm: todaySessions[0]?.wpm ?? null,
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      sessionsThisWeek: weekCount,
      sparkline: last7Sessions.reverse().map(s => ({ wpm: s.wpm, date: s.createdAt.toISOString().slice(0, 10) })),
    }});
  } catch (err) {
    console.error('[Typing] getMyStats failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load stats.' });
  }
}

// ── Analytics: summary (coordinator/admin/superAdmin) ────────────────────────
export async function getAnalytics(req, res) {
  try {
    const scope = await scopeWhere(req);
    const baseWhere = { ...scope, isVoided: false };
    const q = req.query || {};
    if (q.batchNo) baseWhere.batchNo = q.batchNo;
    if (q.branch) baseWhere.branch = q.branch;
    if (q.process) baseWhere.process = q.process;

    const [sessions, voidCount, total] = await Promise.all([
      prisma.typingSession.findMany({ where: baseWhere, select: { wpm: true, accuracy: true, traineeId: true, batchNo: true, branch: true, process: true } }),
      prisma.typingSession.count({ where: { ...scope, isVoided: true } }),
      prisma.typingSession.count({ where: scope }),
    ]);

    const todayStr_ = todayStr();
    const todayCount = await prisma.typingSession.count({ where: { ...baseWhere, createdAt: { gte: new Date(todayStr_) } } });

    const avgWpm = sessions.length ? Math.round(sessions.reduce((s, r) => s + r.wpm, 0) / sessions.length) : 0;
    const avgAccuracy = sessions.length ? parseFloat((sessions.reduce((s, r) => s + r.accuracy, 0) / sessions.length).toFixed(1)) : 0;
    const voidRate = total > 0 ? parseFloat(((voidCount / total) * 100).toFixed(1)) : 0;

    const dist = { '<20': 0, '20-40': 0, '40-60': 0, '60+': 0 };
    for (const s of sessions) {
      if (s.wpm < 20) dist['<20']++;
      else if (s.wpm < 40) dist['20-40']++;
      else if (s.wpm < 60) dist['40-60']++;
      else dist['60+']++;
    }

    return res.json({ ok: true, data: { avgWpm, avgAccuracy, totalSessions: sessions.length, sessionsToday: todayCount, voidRate, wpmDistribution: dist } });
  } catch (err) {
    console.error('[Typing] getAnalytics failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load analytics.' });
  }
}

// ── Analytics: per-trainee table ─────────────────────────────────────────────
export async function getAnalyticsTrainees(req, res) {
  try {
    const scope = await scopeWhere(req);
    const q = req.query || {};
    const where = { ...scope, isVoided: false };
    if (q.batchNo) where.batchNo = q.batchNo;
    if (q.branch) where.branch = q.branch;

    const rows = await prisma.typingSession.findMany({
      where,
      select: { traineeId: true, traineeName: true, batchNo: true, wpm: true, accuracy: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });

    // Group by traineeId
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.traineeId)) map.set(r.traineeId, { traineeId: r.traineeId, traineeName: r.traineeName, batchNo: r.batchNo, sessions: [] });
      map.get(r.traineeId).sessions.push(r);
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const result = [...map.values()].map(t => {
      const wpms = t.sessions.map(s => s.wpm);
      const bestWpm = Math.max(...wpms);
      const avgWpm = Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length);
      const avgAcc = parseFloat((t.sessions.reduce((a, s) => a + s.accuracy, 0) / t.sessions.length).toFixed(1));
      const lastPracticed = t.sessions[0]?.createdAt || null;
      const recent7 = t.sessions.filter(s => new Date(s.createdAt) >= sevenDaysAgo).map(s => s.wpm);
      const older7 = t.sessions.filter(s => new Date(s.createdAt) < sevenDaysAgo).slice(0, 7).map(s => s.wpm);
      const recentAvg = recent7.length ? recent7.reduce((a, b) => a + b, 0) / recent7.length : 0;
      const olderAvg = older7.length ? older7.reduce((a, b) => a + b, 0) / older7.length : recentAvg;
      const trend = recentAvg > olderAvg ? 'up' : recentAvg < olderAvg ? 'down' : 'flat';
      return { traineeId: t.traineeId, traineeName: t.traineeName, batchNo: t.batchNo, bestWpm, avgWpm, avgAccuracy: avgAcc, totalSessions: t.sessions.length, lastPracticed, trend };
    });

    result.sort((a, b) => b.bestWpm - a.bestWpm);
    return res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[Typing] getAnalyticsTrainees failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load trainee analytics.' });
  }
}

// ── Analytics: trainee drill-down ────────────────────────────────────────────
export async function getAnalyticsTrainee(req, res) {
  try {
    const scope = await scopeWhere(req);
    const traineeId = req.params.traineeId;

    const [sessions, streak] = await Promise.all([
      prisma.typingSession.findMany({
        where: { ...scope, traineeId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, mode: true, wpm: true, rawWpm: true, accuracy: true, errorCount: true, durationSeconds: true, isVoided: true, voidReason: true, leaderboardPts: true, createdAt: true },
      }),
      prisma.typingStreak.findUnique({ where: { traineeId } }),
    ]);

    // Day-wise aggregation for chart
    const dayMap = new Map();
    for (const s of sessions.filter(s => !s.isVoided)) {
      const d = s.createdAt.toISOString().slice(0, 10);
      if (!dayMap.has(d)) dayMap.set(d, { wpms: [], accs: [] });
      dayMap.get(d).wpms.push(s.wpm);
      dayMap.get(d).accs.push(s.accuracy);
    }
    const dayTrend = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
      date,
      avgWpm: Math.round(v.wpms.reduce((a, b) => a + b, 0) / v.wpms.length),
      avgAccuracy: parseFloat((v.accs.reduce((a, b) => a + b, 0) / v.accs.length).toFixed(1)),
    }));

    return res.json({ ok: true, data: { sessions, streak, dayTrend } });
  } catch (err) {
    console.error('[Typing] getAnalyticsTrainee failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load trainee drill-down.' });
  }
}

// ── Analytics: character error heatmap ───────────────────────────────────────
export async function getHeatmap(req, res) {
  try {
    const scope = await scopeWhere(req);
    const q = req.query || {};
    const where = { ...scope, isVoided: false };
    if (q.batchNo) where.batchNo = q.batchNo;

    // Only fetch the keystroke log — can be large; limit to recent 500 sessions
    const rows = await prisma.typingSession.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { keystrokeLog: true },
    });

    // Aggregate per character: total attempts and error count
    const charStats = new Map();
    for (const row of rows) {
      const log = Array.isArray(row.keystrokeLog) ? row.keystrokeLog : [];
      for (const entry of log) {
        const ch = String(entry.k || '').slice(0, 1).toLowerCase();
        if (!ch) continue;
        if (!charStats.has(ch)) charStats.set(ch, { total: 0, errors: 0 });
        const stat = charStats.get(ch);
        stat.total++;
        if (!entry.correct) stat.errors++;
      }
    }

    const heatmap = {};
    for (const [ch, stat] of charStats.entries()) {
      heatmap[ch] = { total: stat.total, errors: stat.errors, errorRate: stat.total > 0 ? parseFloat(((stat.errors / stat.total) * 100).toFixed(1)) : 0 };
    }

    return res.json({ ok: true, data: heatmap });
  } catch (err) {
    console.error('[Typing] getHeatmap failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not compute heatmap.' });
  }
}

// ── Analytics: 30-day trend ───────────────────────────────────────────────────
export async function getTrend(req, res) {
  try {
    const scope = await scopeWhere(req);
    const q = req.query || {};
    const where = { ...scope, isVoided: false, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } };
    if (q.batchNo) where.batchNo = q.batchNo;
    if (q.traineeId) where.traineeId = q.traineeId;

    const rows = await prisma.typingSession.findMany({ where, select: { wpm: true, accuracy: true, createdAt: true } });

    const dayMap = new Map();
    for (const r of rows) {
      const d = r.createdAt.toISOString().slice(0, 10);
      if (!dayMap.has(d)) dayMap.set(d, { wpms: [], accs: [] });
      dayMap.get(d).wpms.push(r.wpm);
      dayMap.get(d).accs.push(r.accuracy);
    }

    const trend = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({
      date,
      avgWpm: Math.round(v.wpms.reduce((a, b) => a + b, 0) / v.wpms.length),
      avgAccuracy: parseFloat((v.accs.reduce((a, b) => a + b, 0) / v.accs.length).toFixed(1)),
    }));

    return res.json({ ok: true, data: trend });
  } catch (err) {
    console.error('[Typing] getTrend failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Could not load trend data.' });
  }
}
```

- [ ] **Step 2: Create `backend/src/routes/typingPractice.js`**

```js
import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import {
  listPrompts, getPrompt, saveSession, getMySessions, getMyStats,
  getAnalytics, getAnalyticsTrainees, getAnalyticsTrainee,
  getHeatmap, getTrend,
} from '../controllers/typingPractice.js';

const router = Router();
const traineeAuth = [requireSession, requireRole('trainee')];
const reviewerAuth = [requireSession, requireRole('admin', 'coordinator')];

// Trainee
router.get('/prompts', ...traineeAuth, listPrompts);
router.get('/prompts/:id', ...traineeAuth, getPrompt);
router.post('/sessions', ...traineeAuth, saveSession);
router.get('/me/sessions', ...traineeAuth, getMySessions);
router.get('/me/stats', ...traineeAuth, getMyStats);

// Analytics (coordinator / admin / super admin)
router.get('/analytics', ...reviewerAuth, getAnalytics);
router.get('/analytics/trainees', ...reviewerAuth, getAnalyticsTrainees);
router.get('/analytics/trainee/:traineeId', ...reviewerAuth, getAnalyticsTrainee);
router.get('/analytics/heatmap', ...reviewerAuth, getHeatmap);
router.get('/analytics/trend', ...reviewerAuth, getTrend);

export default router;
```

- [ ] **Step 3: Mount route in `backend/src/server.js`**

Find line `import voiceAccentRoutes from './routes/voiceAccent.js';` and add after it:
```js
import typingPracticeRoutes from './routes/typingPractice.js';
```

Find line `app.use('/api/voice-accent', voiceAccentRoutes);` and add after it:
```js
app.use('/api/typing', typingPracticeRoutes);
```

- [ ] **Step 4: Start backend and smoke-test**

```bash
cd backend && npm run dev
```

In another terminal:
```bash
# Should return 25 prompts
curl -s http://localhost:3001/api/typing/prompts \
  -H "Cookie: trainee_session=<token>" | jq '.data | length'
```

Expected: `25`

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/typingPractice.js backend/src/routes/typingPractice.js backend/src/server.js
git commit -m "feat(typing): backend controller, routes, and server mount for /api/typing"
```

---

## Task 5: Frontend — `TypingPracticeTab.jsx`

**Files:**
- Create: `frontend/src/pages/Trainee/TypingPracticeTab.jsx`

**Interfaces:**
- Consumes: `api.get('/typing/prompts', 'trainee')` → `{ ok, data: Prompt[] }`
- Consumes: `api.get('/typing/prompts/:id', 'trainee')` → `{ ok, data: { id, body, durationSeconds, ... } }`
- Consumes: `api.post('/typing/sessions', body, 'trainee')` → `{ ok, data: { wpm, accuracy, isVoided, leaderboardPts, streak, isPersonalBest } }`
- Consumes: `api.get('/typing/me/sessions?limit=20', 'trainee')` → `{ ok, data: Session[] }`

- [ ] **Step 1: Create `frontend/src/pages/Trainee/TypingPracticeTab.jsx`**

```jsx
import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../../utils/api.js';

const DIFFICULTY_COLOR = { EASY: 'ok', MEDIUM: 'warn', HARD: 'bad' };
const DIFFICULTY_LABEL = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' };

// Compute net WPM: (chars typed / 5 - errors) / minutes
function calcWpm(charsTyped, errorCount, seconds) {
  if (seconds < 1) return 0;
  const minutes = seconds / 60;
  const gross = charsTyped / 5 / minutes;
  const net = gross - (errorCount / minutes);
  return Math.max(0, Math.round(net));
}

function calcRawWpm(charsTyped, seconds) {
  if (seconds < 1) return 0;
  return Math.max(0, Math.round((charsTyped / 5) / (seconds / 60)));
}

function calcAccuracy(correct, total) {
  if (!total) return 100;
  return parseFloat(((correct / total) * 100).toFixed(1));
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// SVG sparkline for session results
function Sparkline({ values, width = 80, height = 28 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - 4) + 2;
    const y = height - 2 - ((v / max) * (height - 4));
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// Character-highlighted passage display
function PassageDisplay({ body, typedChars, startIndex = 0 }) {
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 15, lineHeight: 1.7, letterSpacing: '.02em', padding: '14px 16px', background: 'var(--surface2, var(--line))', borderRadius: 8, userSelect: 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 180, overflowY: 'auto' }}>
      {body.split('').map((ch, i) => {
        const relIdx = i - startIndex;
        if (relIdx < 0) return <span key={i} style={{ color: 'var(--muted)', opacity: .4 }}>{ch}</span>;
        if (relIdx >= typedChars.length) return <span key={i}>{ch}</span>;
        const typed = typedChars[relIdx];
        const correct = typed === ch;
        return (
          <span key={i} style={{ color: correct ? 'var(--ok)' : 'var(--bad)', background: correct ? 'transparent' : 'var(--bad-soft, #fee2e2)', borderRadius: 2 }}>
            {ch}
          </span>
        );
      })}
    </div>
  );
}

export default function TypingPracticeTab() {
  const [mode, setMode] = useState('PASSAGE'); // 'PASSAGE' | 'TIMED_DRILL'
  const [prompts, setPrompts] = useState(null);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [promptBody, setPromptBody] = useState('');
  const [drillDuration, setDrillDuration] = useState(60);

  // Session state
  const [phase, setPhase] = useState('pick'); // 'pick' | 'active' | 'result'
  const [typedChars, setTypedChars] = useState([]);
  const [startIndex, setStartIndex] = useState(0); // for timed drill: offset into current passage body
  const [elapsed, setElapsed] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [totalTyped, setTotalTyped] = useState(0);
  const [keystrokeLog, setKeystrokeLog] = useState([]);
  const [pasteCount, setPasteCount] = useState(0);
  const [focusCount, setFocusCount] = useState(0);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [warnFocus, setWarnFocus] = useState(false);
  const [history, setHistory] = useState(null);

  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const textareaRef = useRef(null);
  const pasteRef = useRef(0);
  const focusRef = useRef(0);
  const keystrokeRef = useRef([]);

  useEffect(() => {
    api.get('/typing/prompts', 'trainee').then(res => {
      setPrompts(res.ok ? (res.data || []) : []);
      setLoadingPrompts(false);
    });
    api.get('/typing/me/sessions?limit=20', 'trainee').then(res => {
      if (res.ok) setHistory(res.data || []);
    });
  }, []);

  // Anti-cheat listeners
  useEffect(() => {
    function onVisChange() { if (document.hidden) { focusRef.current++; setFocusCount(c => c + 1); if (focusRef.current >= 3) setWarnFocus(true); } }
    function onBlur() { focusRef.current++; setFocusCount(c => c + 1); if (focusRef.current >= 3) setWarnFocus(true); }
    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('blur', onBlur);
    return () => { document.removeEventListener('visibilitychange', onVisChange); window.removeEventListener('blur', onBlur); };
  }, []);

  async function startSession(prompt) {
    const res = await api.get(`/typing/prompts/${prompt.id}`, 'trainee');
    if (!res.ok) return;
    setSelectedPrompt(prompt);
    setPromptBody(res.data.body);
    setTypedChars([]);
    setStartIndex(0);
    setElapsed(0);
    setRemaining(mode === 'TIMED_DRILL' ? drillDuration : 0);
    setErrorCount(0);
    setTotalTyped(0);
    setKeystrokeLog([]);
    keystrokeRef.current = [];
    pasteRef.current = 0;
    focusRef.current = 0;
    setPasteCount(0);
    setFocusCount(0);
    setWarnFocus(false);
    setResult(null);
    setPhase('active');
    startTimeRef.current = Date.now();

    clearInterval(timerRef.current);
    if (mode === 'TIMED_DRILL') {
      let rem = drillDuration;
      timerRef.current = setInterval(() => {
        rem--;
        setRemaining(rem);
        setElapsed(e => e + 1);
        if (rem <= 0) { clearInterval(timerRef.current); finishSession(); }
      }, 1000);
    } else {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    }
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  const finishSession = useCallback(async (override = {}) => {
    clearInterval(timerRef.current);
    const durationSeconds = Math.round((Date.now() - (startTimeRef.current || Date.now())) / 1000);
    const log = keystrokeRef.current;
    const correctCount = log.filter(k => k.correct).length;
    const errCount = override.errorCount ?? log.filter(k => !k.correct).length;
    const charsTyped = log.length;
    const wpm = calcWpm(charsTyped, errCount, durationSeconds);
    const rawWpm = calcRawWpm(charsTyped, durationSeconds);
    const accuracy = calcAccuracy(correctCount, charsTyped);

    setSaving(true);
    setPhase('result');
    const res = await api.post('/typing/sessions', {
      promptId: selectedPrompt?.id,
      mode,
      wpm,
      rawWpm,
      accuracy,
      errorCount: errCount,
      durationSeconds,
      pasteEventCount: pasteRef.current,
      focusLostCount: focusRef.current,
      keystrokeLog: log.slice(0, 2000),
    }, 'trainee');
    setSaving(false);

    if (res.ok) {
      setResult(res.data);
      // Refresh history
      api.get('/typing/me/sessions?limit=20', 'trainee').then(r => { if (r.ok) setHistory(r.data || []); });
    }
  }, [mode, selectedPrompt]);

  function handleKeyDown(e) {
    if (phase !== 'active') return;
    const body = promptBody;
    const currentPos = startIndex + typedChars.length;
    if (currentPos >= body.length && mode === 'PASSAGE') { finishSession(); return; }
    if (e.key === 'Backspace') { setTypedChars(tc => tc.slice(0, -1)); return; }
    if (e.key.length !== 1) return;

    const expected = body[currentPos] ?? '';
    const correct = e.key === expected;
    const t = Date.now() - (startTimeRef.current || Date.now());
    keystrokeRef.current = [...keystrokeRef.current, { t, k: e.key, correct }];
    setKeystrokeLog(keystrokeRef.current);
    if (!correct) setErrorCount(ec => ec + 1);
    setTotalTyped(tt => tt + 1);
    setTypedChars(tc => [...tc, e.key]);

    // PASSAGE: auto-finish when all chars typed
    if (mode === 'PASSAGE' && currentPos + 1 >= body.length) {
      finishSession();
    }
  }

  const activePrompts = prompts ? prompts.filter(p => p.mode === mode) : [];

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase === 'active') {
    return (
      <div>
        {warnFocus && (
          <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid var(--warn)', background: 'var(--warn-soft, #fef3c7)' }}>
            <b style={{ color: 'var(--warn)' }}>⚠ Warning:</b> <span style={{ fontSize: 13 }}>Keep this window active or your session may be voided.</span>
          </div>
        )}

        <div className="row between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <span className={`pill ${DIFFICULTY_COLOR[selectedPrompt?.difficulty]}`}>{DIFFICULTY_LABEL[selectedPrompt?.difficulty]}</span>
            <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 700 }}>{selectedPrompt?.title}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {mode === 'TIMED_DRILL' ? (
              <span style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 900, color: remaining <= 10 ? 'var(--bad)' : 'var(--accent)' }}>{formatTime(remaining)}</span>
            ) : (
              <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--muted)' }}>{formatTime(elapsed)}</span>
            )}
            <button className="btn small secondary" onClick={() => { clearInterval(timerRef.current); setPhase('pick'); }}>✕ Cancel</button>
          </div>
        </div>

        <PassageDisplay body={promptBody} typedChars={typedChars} startIndex={startIndex} />

        <textarea
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          onPaste={e => { e.preventDefault(); pasteRef.current++; setPasteCount(pasteRef.current); }}
          onDrop={e => e.preventDefault()}
          onContextMenu={e => e.preventDefault()}
          value=""
          onChange={() => {}}
          placeholder="Start typing here…"
          style={{ width: '100%', minHeight: 80, marginTop: 12, fontFamily: 'monospace', fontSize: 15, padding: '10px 12px', borderRadius: 8, border: '1.5px solid var(--line)', background: 'var(--bg, #fff)', resize: 'none', outline: 'none', boxSizing: 'border-box' }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        <div className="row" style={{ marginTop: 10, gap: 18, fontSize: 13, color: 'var(--muted)' }}>
          <span>Typed: <b style={{ color: 'var(--fg)' }}>{startIndex + typedChars.length}</b></span>
          <span>Errors: <b style={{ color: errorCount > 0 ? 'var(--bad)' : 'var(--ok)' }}>{errorCount}</b></span>
          {mode === 'TIMED_DRILL' && <button className="btn small" onClick={() => finishSession()}>Submit Now</button>}
        </div>
      </div>
    );
  }

  if (phase === 'result') {
    const r = result || {};
    return (
      <div>
        <h3 style={{ marginBottom: 16 }}>Session Complete {r.isVoided ? '— Voided' : '✓'}</h3>
        {r.isVoided && (
          <div className="card" style={{ marginBottom: 14, borderLeft: '4px solid var(--bad)', background: 'var(--bad-soft, #fee2e2)' }}>
            <b style={{ color: 'var(--bad)' }}>Session Voided</b>
            <p style={{ fontSize: 13, margin: '4px 0 0', color: 'var(--muted)' }}>
              {r.voidReason === 'paste_attempts' ? 'Copy-paste was detected.' : 'Window focus was lost too many times.'} This session will not count toward your score or streak.
            </p>
          </div>
        )}
        <div className="trainee-kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'WPM', value: r.wpm ?? '—', cls: r.wpm >= 60 ? 'ok' : r.wpm >= 40 ? 'warn' : '' },
            { label: 'Accuracy', value: r.accuracy != null ? `${r.accuracy}%` : '—', cls: r.accuracy >= 95 ? 'ok' : r.accuracy >= 80 ? 'warn' : 'bad' },
            { label: 'Points', value: r.isVoided ? '0' : (r.leaderboardPts ?? '—'), cls: 'accent' },
            { label: 'Streak', value: r.isVoided ? '—' : `${r.streak ?? 0} days`, cls: r.streak >= 7 ? 'ok' : '' },
          ].map(kpi => (
            <div key={kpi.label} className="kpi-card">
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value" style={{ color: `var(--${kpi.cls === 'ok' ? 'ok' : kpi.cls === 'warn' ? 'warn' : kpi.cls === 'bad' ? 'bad' : kpi.cls === 'accent' ? 'accent' : 'fg'})` }}>{saving ? '…' : kpi.value}</div>
            </div>
          ))}
        </div>
        {r.isPersonalBest && !r.isVoided && <div className="card" style={{ marginBottom: 12, borderLeft: '4px solid var(--ok)' }}><b>🏆 New Personal Best!</b></div>}
        <div className="row" style={{ gap: 10, marginTop: 8 }}>
          <button className="btn accent" onClick={() => setPhase('pick')}>Practice Again</button>
        </div>
      </div>
    );
  }

  // ── Pick phase ─────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="row between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>⌨️ Typing Practice</h3>
        <div className="row" style={{ gap: 8 }}>
          <button className={`btn small${mode === 'PASSAGE' ? ' accent' : ' secondary'}`} onClick={() => setMode('PASSAGE')}>Passage Test</button>
          <button className={`btn small${mode === 'TIMED_DRILL' ? ' accent' : ' secondary'}`} onClick={() => setMode('TIMED_DRILL')}>Timed Drill</button>
        </div>
      </div>

      {mode === 'TIMED_DRILL' && (
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)', marginRight: 4 }}>Duration:</span>
          {[60, 180, 300].map(d => (
            <button key={d} className={`btn small${drillDuration === d ? ' accent' : ' secondary'}`} onClick={() => setDrillDuration(d)}>
              {d === 60 ? '1 min' : d === 180 ? '3 min' : '5 min'}
            </button>
          ))}
        </div>
      )}

      {loadingPrompts ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton skeleton-card" style={{ height: 90 }} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, marginBottom: 20 }}>
          {activePrompts.map(p => (
            <div key={p.id} className="card" style={{ cursor: 'pointer', padding: '14px 16px' }} onClick={() => startSession(p)}>
              <div className="row between" style={{ marginBottom: 6 }}>
                <span className={`pill ${DIFFICULTY_COLOR[p.difficulty]}`}>{DIFFICULTY_LABEL[p.difficulty]}</span>
                {p.mode === 'TIMED_DRILL' && <span className="pill info">{p.durationSeconds / 60}m</span>}
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{p.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.wordCount} words · {(p.tags || []).slice(0, 2).join(', ')}</div>
              <div style={{ marginTop: 10 }}>
                <span className="btn small accent" style={{ pointerEvents: 'none' }}>Start →</span>
              </div>
            </div>
          ))}
          {activePrompts.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>No prompts available for this mode.</p>}
        </div>
      )}

      {history && history.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>My Recent Sessions</div>
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Date', 'Mode', 'WPM', 'Accuracy', 'Duration', 'Status', 'Pts'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '7px 8px' }}>{new Date(s.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                    <td style={{ padding: '7px 8px' }}><span className="pill">{s.mode === 'TIMED_DRILL' ? 'Drill' : 'Passage'}</span></td>
                    <td style={{ padding: '7px 8px', fontWeight: 700 }}>{s.wpm}</td>
                    <td style={{ padding: '7px 8px' }}>{s.accuracy}%</td>
                    <td style={{ padding: '7px 8px' }}>{s.durationSeconds}s</td>
                    <td style={{ padding: '7px 8px' }}>
                      {s.isVoided
                        ? <span className="pill bad">Voided</span>
                        : <span className="pill ok">Valid</span>}
                    </td>
                    <td style={{ padding: '7px 8px', fontWeight: 700, color: 'var(--accent)' }}>{s.isVoided ? 0 : s.leaderboardPts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Trainee/TypingPracticeTab.jsx
git commit -m "feat(typing): TypingPracticeTab with passage test, timed drill, anti-cheat, results, history"
```

---

## Task 6: Wire Tab + Dashboard Widget into `DashboardView.jsx`

**Files:**
- Modify: `frontend/src/pages/Trainee/DashboardView.jsx`

**Interfaces:**
- Consumes: `TypingPracticeTab` from `./TypingPracticeTab.jsx`
- Consumes: `api.get('/typing/me/stats', 'trainee')` → `{ ok, data: { todayBestWpm, currentStreak, sessionsThisWeek, sparkline } }`

- [ ] **Step 1: Add import at top of DashboardView.jsx**

After the existing `import VoiceAccentTab from './VoiceAccentTab.jsx';` line, add:

```js
import TypingPracticeTab from './TypingPracticeTab.jsx';
```

- [ ] **Step 2: Add the tab to the `tabs` array**

Find:
```js
{ id: 'voice-accent', label: '🎙️ Voice & Accent' },
```

Add after it:
```js
{ id: 'typing', label: '⌨️ Typing Practice' },
```

- [ ] **Step 3: Add tab render condition**

Find:
```js
{activeTab === 'voice-accent' && <VoiceAccentTab />}
```

Add after it:
```js
{activeTab === 'typing' && <TypingPracticeTab />}
```

- [ ] **Step 4: Add dashboard widget state + fetch**

In `DashboardView`, after the existing `useState` declarations, add:

```js
const [typingStats, setTypingStats] = useState(null);
useEffect(() => {
  api.get('/typing/me/stats', 'trainee').then(res => {
    if (res.ok) setTypingStats(res.data);
  });
}, []);
```

- [ ] **Step 5: Add typing KPI card to the KPI grid**

Find the `kpis` array definition and add a new entry:

```js
const typingKpi = typingStats
  ? { label: 'Typing (Today)', value: typingStats.todayBestWpm != null ? `${typingStats.todayBestWpm} WPM` : '—', note: `${typingStats.currentStreak}d streak · ${typingStats.sessionsThisWeek} this week`, cls: typingStats.todayBestWpm >= 60 ? 'ok' : typingStats.todayBestWpm >= 40 ? 'warn' : '', w: Math.min((typingStats.todayBestWpm || 0) / 100 * 100, 100) }
  : null;
```

Then in the KPI grid render, after the existing `{kpis.map(...)}` block, add:

```jsx
{typingKpi && (
  <div className="kpi-card" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('typing')}>
    <div className="kpi-label">{typingKpi.label}</div>
    <div className="kpi-value" style={{ color: `var(--${typingKpi.cls === 'ok' ? 'ok' : typingKpi.cls === 'warn' ? 'warn' : 'fg'})` }}>{typingKpi.value}</div>
    {typingKpi.note && <div className="kpi-note">{typingKpi.note}</div>}
    <div className="progress-shell" style={{ height: 5, marginTop: 8 }}><div className={`progress-bar ${typingKpi.cls}`} style={{ width: `${typingKpi.w}%` }} /></div>
  </div>
)}
```

- [ ] **Step 6: Build check**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Trainee/DashboardView.jsx
git commit -m "feat(typing): wire typing tab + KPI widget into trainee dashboard"
```

---

## Task 7: End-to-End Smoke Test + Deploy

**Files:** No new files.

- [ ] **Step 1: Full backend TypeScript check (if TS is used)**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (backend is plain JS — this step is a no-op if no tsconfig).

- [ ] **Step 2: Frontend build clean**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Manual flow test (trainee)**

1. Log in as a trainee.
2. Verify `⌨️ Typing Practice` tab appears in the sidebar.
3. Select `Passage Test` → pick an EASY prompt → click Start → type a few characters → verify green/red highlighting.
4. Try right-click → context menu should be blocked.
5. Try paste → should be silently blocked, counter increments.
6. Complete the passage → verify results card shows WPM, accuracy, points.
7. Switch to `Timed Drill` → pick 1 min → type → verify countdown timer.
8. Check My Journey dashboard — verify the Typing KPI card shows today's WPM.

- [ ] **Step 4: Manual flow test (coordinator)**

1. Log in as a coordinator.
2. Navigate to `/api/typing/analytics` with coordinator cookie — verify scoped response.
3. Navigate to `/api/typing/analytics/trainees` — verify trainee list.

- [ ] **Step 5: Push and deploy**

```bash
git push origin main
```

Then deploy per the project's `deploy-to-production.sh` script.

- [ ] **Step 6: Production smoke test**

```bash
curl -s https://<production-host>/api/typing/prompts \
  -H "Cookie: trainee_session=<token>" | jq '.data | length'
```

Expected: `25`

---

## Self-Review Against Spec

| Spec Section | Covered By Task |
|---|---|
| TypingPrompt model | Task 1 |
| TypingSession model (all fields incl. keystrokeLog, isVoided) | Task 1 |
| TypingStreak model | Task 1 |
| 25 seeded passages (EASY/MEDIUM/HARD, MRZ, address, passport) | Task 2 |
| Leaderboard integration (awardTypingSession, typingPoints column) | Task 3 |
| All trainee API endpoints | Task 4 |
| All analytics API endpoints (summary, trainees, drill-down, heatmap, trend) | Task 4 |
| scopeWhere (coordinator/admin/superAdmin) | Task 4 |
| Anti-cheat (paste block, focus track, server void logic, sanity checks) | Task 4 + Task 5 |
| Trainee typing UI (passage + timed drill, char highlighting, results) | Task 5 |
| Session history table | Task 5 |
| Dashboard widget (KPI card + click-to-tab) | Task 6 |
| Tab wired into DashboardView | Task 6 |
| Build verification | Task 7 |
| Production smoke test | Task 7 |

**Note on analytics UI (coordinator/admin views):** The spec describes analytics pages for coordinators and admins. The backend endpoints are fully built in Task 4. A dedicated analytics UI tab for coordinator/admin role is **not yet implemented** in this plan — it would be a natural Task 8 in a follow-up plan, once the trainee-side flow is confirmed working. The API is ready and testable independently.
