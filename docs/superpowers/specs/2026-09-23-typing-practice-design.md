# Typing Practice Module — Design Spec
**Date:** 2026-09-23  
**Project:** MCN-LMS  
**Status:** Approved — ready for implementation

---

## 1. Overview

A Typing Practice module embedded in the MCN-LMS for all processes. Trainees practice typing with domain-specific passages (identity documents, MRZ strings, passport numbers, addresses). Sessions are tracked, scored, and feed into the existing leaderboard. Coordinators, Admins, and Super Admins get role-scoped analytics with full drill-down.

---

## 2. Data Models (Prisma)

### `TypingPrompt`
Table: `typing_prompts`

| Field | Type | Notes |
|-------|------|-------|
| id | Int @id @default(autoincrement()) | |
| title | String | Short label, e.g. "MRZ Line Pair" |
| body | String @db.Text | The full text the trainee must type |
| mode | Enum: PASSAGE, TIMED_DRILL | PASSAGE = type to end; TIMED_DRILL = type for fixed duration |
| durationSeconds | Int? | null for PASSAGE; 60/180/300 for TIMED_DRILL |
| difficulty | Enum: EASY, MEDIUM, HARD | |
| tags | Json | String array e.g. ["MRZ", "passport", "address"] |
| isActive | Boolean @default(true) | |
| createdAt | DateTime @default(now()) | |

### `TypingSession`
Table: `typing_sessions`

Denormalized fields copied from TraineeMaster at save time — same pattern as `VoiceAccentSubmission` — so analytics queries require zero joins.

| Field | Type | Notes |
|-------|------|-------|
| id | Int @id @default(autoincrement()) | |
| traineeId | Int | FK → trainee_master.id |
| batchNo | String | Denormalized at save |
| branch | String | Denormalized at save |
| process | String | Denormalized at save |
| lob | String? | Denormalized at save |
| promptId | Int | FK → typing_prompts.id |
| mode | Enum: PASSAGE, TIMED_DRILL | |
| wpm | Int | Net WPM (corrected) |
| rawWpm | Int | Gross WPM (before error correction) |
| accuracy | Float | 0–100 |
| errorCount | Int | Total incorrect keystrokes |
| durationSeconds | Int | Actual time taken |
| pasteEventCount | Int @default(0) | Blocked paste attempts |
| focusLostCount | Int @default(0) | Tab/window blur events |
| isVoided | Boolean @default(false) | true if cheat thresholds exceeded |
| voidReason | String? | e.g. "paste_attempts" or "focus_lost" |
| keystrokeLog | Json | Array of {t: ms, k: char, correct: bool} |
| leaderboardPoints | Int @default(0) | Points awarded for this session |
| createdAt | DateTime @default(now()) | |

Indexes: `(traineeId)`, `(batchNo)`, `(branch)`, `(process)`, `(createdAt)`, `(isVoided)`

### `TypingStreak`
Table: `typing_streaks`

| Field | Type | Notes |
|-------|------|-------|
| id | Int @id @default(autoincrement()) | |
| traineeId | Int @unique | |
| currentStreak | Int @default(0) | Consecutive days with ≥1 valid session |
| longestStreak | Int @default(0) | |
| lastPracticedDate | DateTime? | Used for streak calculation |
| updatedAt | DateTime @updatedAt | |

---

## 3. Backend API

### Controller: `backend/src/controllers/typingPractice.js`
### Route file: `backend/src/routes/typingPractice.js`
### Mounted at: `/api/typing`

#### Trainee Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/typing/prompts | List active prompts (mode, difficulty, tags filters) |
| GET | /api/typing/prompts/:id | Single prompt body (fetched on session start) |
| POST | /api/typing/sessions | Save completed session |
| GET | /api/typing/my-sessions | Trainee's own session history (paginated) |
| GET | /api/typing/my-stats | Dashboard widget data: today WPM, streak, 7-day sparkline |

#### Admin/Coordinator Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/typing/analytics | Role-scoped: batch/branch/all summary |
| GET | /api/typing/analytics/trainees | Per-trainee breakdown (scoped) |
| GET | /api/typing/analytics/trainee/:traineeId | Full drill-down for one trainee |
| GET | /api/typing/analytics/heatmap | Character error heatmap data (scoped) |
| GET | /api/typing/analytics/trend | Day-wise WPM + accuracy trend (scoped) |

#### Session Save Logic (`POST /api/typing/sessions`)

1. Validate traineeId from JWT.
2. Load TraineeMaster to denormalize batchNo/branch/process/lob.
3. Sanity checks:
   - Reject if `wpm > 250` (physically impossible)
   - Reject if `durationSeconds < 5`
4. Cheat detection:
   - `isVoided = true` if `pasteEventCount >= 3`
   - `isVoided = true` if `focusLostCount >= 5`
   - Set `voidReason` accordingly
5. If not voided: calculate leaderboard points (see §6), fire leaderboard event via existing hook. Update `TypingStreak` for trainee.
6. If voided: streak is NOT updated.
7. Save `TypingSession`.

#### Scope Filter (`scopeWhere`)
Same pattern as `voiceAccent.js`:
- `coordinator` → sessions in their owned batches only
- `admin` with branch → sessions for that branch only
- `superAdmin` / `admin` without branch → all sessions

---

## 4. Trainee UI

### Location
New tab in `DashboardView.jsx`:
```js
{ id: 'typing', label: '⌨️ Typing Practice' }
```
New file: `frontend/src/pages/Trainee/TypingPracticeTab.jsx`

### Tab Structure

**Mode selector** — two buttons: `Passage Test` | `Timed Drill`

#### Passage Test Flow
1. Prompt card shows: title, difficulty badge, tag chips, word count. "Start" button.
2. On Start: full prompt body loaded, textarea enabled. Timer counts up (MM:SS).
3. Typing area: the passage renders above as styled spans — each character highlights **green** when typed correctly, **red** on error, **grey** for untyped.
4. Input textarea below — `onPaste`, `onDrop`, `onContextMenu` all prevented.
5. Session auto-submits when all characters are typed.
6. Results card: WPM, Accuracy %, Time, Errors, Points earned, personal best flag.

#### Timed Drill Flow
1. Duration picker: 1 min / 3 min / 5 min buttons.
2. On Start: first prompt loads, countdown timer starts top-right.
3. On completing a passage: next passage auto-loads seamlessly (no gap).
4. On timer end: session auto-submits. Results card shows same metrics.

### Anti-Cheat (Client Side)
```js
textarea.addEventListener('paste', e => { e.preventDefault(); pasteCount++; });
textarea.addEventListener('drop', e => e.preventDefault());
textarea.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.hidden) focusCount++; });
window.addEventListener('blur', () => focusCount++);
```
- Warning banner shown at `focusCount >= 3`: "Session may be voided — keep this window active."
- All counts sent with session payload. Server makes the void decision.

### Session History (within tab)
Table: date, mode, WPM, accuracy, duration, status (Valid / Voided), points. Paginated, newest first.

---

## 5. Dashboard Widget

File: `frontend/src/pages/Trainee/DashboardView.jsx` — add a typing KPI card alongside existing KPIs.

Widget shows:
- Today's best WPM (or "—" if no session today)
- Current streak (N days)
- Total sessions this week
- Sparkline: WPM for last 7 sessions (simple SVG bar chart, 7 bars)

Data source: `GET /api/typing/my-stats`

---

## 6. Leaderboard Integration

Points awarded per valid (non-voided) session:

| Condition | Points |
|-----------|--------|
| Any completed valid session | 10 pts |
| WPM ≥ 40 AND accuracy ≥ 85% | 30 pts (replaces base 10) |
| WPM ≥ 60 AND accuracy ≥ 95% | 50 pts (replaces above) |
| Personal best WPM (new record) | +15 bonus on top |
| 7-day streak achieved | +25 bonus (once per streak reset) |

Implementation: fire via existing `TraineeLeaderboardEvent` insert after session save. No changes to leaderboard infrastructure.

---

## 7. Analytics Views

### Coordinator View
- KPI tiles: Avg WPM, Avg Accuracy, Total Sessions, Sessions Today, Void Rate %
- Trainee table: name, batch, best WPM, avg accuracy, sessions count, last practiced, 7-day WPM trend arrow
- Row click → trainee drill-down drawer: full session history + per-day WPM/accuracy line chart
- WPM distribution bar chart: <20 / 20–40 / 40–60 / 60+ buckets
- Character error heatmap for batch

### Admin View
Same as Coordinator + branch-level summary + batch comparison bar chart.

### Super Admin View
All of the above + branch comparison + process-wise breakdown + top/bottom 10 performers table.

### Character Error Heatmap
- Source: aggregate `keystrokeLog` JSON across all sessions in scope
- Output: per-character error rate (errorCount / totalAttempts for that char)
- Rendered as a QWERTY keyboard grid — each key cell colored:
  - Light blue: < 5% error rate
  - Amber: 5–15%
  - Red: > 15%
- Special characters (`<`, `/`, `-`, `+`, digits) shown prominently as they are the domain-critical chars

### Day-wise Trend Chart
- X-axis: last 30 calendar days
- Y-axis left: avg WPM (solid line, blue)
- Y-axis right: avg accuracy % (dashed line, green)
- Rendered with a lightweight SVG chart (same approach used elsewhere in LMS)

---

## 8. Built-in Passage Library

25 passages seeded via `prisma/seed.js`. No admin UI needed — library is code-managed.

### Easy (8 passages)
- Full name + date of birth formatting: `SMITH, John Edward — 15 Jan 1989`
- Simple UK addresses: `42 Kensington Road, London, SW1A 2AA`
- Document type and nationality labels
- Single-line passport data fields

### Medium (10 passages)
- Mixed alphanumeric document numbers: `GBR1234567`, `P-UK-98765432`
- Expiry date strings: `09 DEC 2027`, `31 MAR 2026`
- Multi-line addresses with alphanumeric postcodes: `Flat 3B, 17 Albemarle Street, London W1S 4HE`
- Combined name + DOB + nationality + document number blocks

### Hard (7 passages)
Full MRZ pairs and combined identity document blocks:
```
P<GBRSMITH<<JOHN<EDWARD<<<<<<<<<<<<<<<<<<<<
9674523761GBR8901157M3012317<<<<<<<<<6
```
- Passages mixing `<`, `/`, `-`, `+`, uppercase, lowercase, digits
- Address + MRZ + document validity date combined
- Multi-document reference strings as seen in identity verification workflows

---

## 9. File List

### New files
```
backend/src/controllers/typingPractice.js
backend/src/routes/typingPractice.js
frontend/src/pages/Trainee/TypingPracticeTab.jsx
```

### Modified files
```
backend/prisma/schema.prisma          — add TypingPrompt, TypingSession, TypingStreak models
backend/prisma/seed.js                — add 25 typing prompts
backend/src/app.js                    — mount /api/typing router
frontend/src/pages/Trainee/DashboardView.jsx  — add ⌨️ Typing Practice tab + dashboard widget
```

### New migration
```
backend/prisma/migrations/YYYYMMDD_add_typing_practice/
```

---

## 10. Anti-Cheat Summary

| Layer | Mechanism | Threshold |
|-------|-----------|-----------|
| Client | Block paste/drop/contextmenu | Always |
| Client | Track blur/visibilitychange | Warning at ≥3 |
| Client | Send counts with session | Always |
| Server | Void if paste count ≥ 3 | isVoided = true |
| Server | Void if focus lost ≥ 5 | isVoided = true |
| Server | Reject impossible WPM | > 250 WPM → 400 error |
| Server | Reject trivial sessions | < 5 seconds → 400 error |

Voided sessions: stored with `isVoided = true`, visible in history with "Voided" badge, excluded from all score calculations, leaderboard points, and analytics averages.

---

## 11. Out of Scope

- Admin UI for managing prompts (library is code-managed)
- Multiplayer / race mode
- Custom difficulty configuration per batch
- PDF export of typing certificates
