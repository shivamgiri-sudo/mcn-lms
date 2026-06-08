# LMS Production Stabilization Fixes

Date: 2026-06-08

## Purpose

This note records the production-stabilization fixes added to the LMS local deployment codebase.

The changes are intentionally additive and are mounted as route overrides before the legacy route handlers. Existing controllers are preserved so the deployed LMS can be stabilized without a destructive rewrite.

## Fixes included

### Backend

- Added `backend/src/routes/traineeStability.js`.
- Added `backend/src/routes/coordinatorStability.js`.
- Added `backend/src/routes/diagnostics.js`.
- Mounted the stabilization routes in `backend/src/server.js` before legacy trainee/coordinator/admin handlers.

### Trainee LMS fixes

- Assessment loader returns both `totalAttempts` and `attemptsUsed` to support different frontend builds.
- Document/download/PDF/proxy content can now be marked complete from the trainee content viewer.
- Course completion, assessment attempt percentage, and pass percentage are recalculated after content completion.
- Trainee profile updates are synchronized to both `trainee_master` and `user_master` safely.
- Frontend now re-checks `/auth/me` after refresh so first-login / force password reset remains enforced.
- Frontend API handling now includes timeout and clearer network/server failure messaging.

### Coordinator fixes

- Risk action update is guarded so a coordinator can update only risks linked to their own batch.
- Certification is idempotent and race-safe so batch certified count increments only once per trainee.
- OPS handover is idempotent and race-safe so batch handover count increments only once per trainee.

### Admin / deployment support

- Added `GET /api/admin/diagnostics` for admin users.
- Diagnostics check database connectivity, key environment flags, upload folder write access, frontend build presence, and important table counts.

## Required validation before production restart

Run locally after pulling the latest code:

```bash
cd backend
npm install
npx prisma generate
node src/server.js
```

```bash
cd frontend
npm install
npm run build
npm run dev
```

## Functional test checklist

| Area | Test | Expected result |
|---|---|---|
| Trainee login | First-login user refreshes page before changing password | Password reset remains enforced |
| Assessment | Open MCQ assessment | Attempt count displays correctly |
| Assessment | Submit MCQ and reopen | Attempt count updates correctly |
| Content | Open/download PDF, PPT, document, or other non-video content | Viewer shows Mark Complete and content becomes 100% |
| Profile | Update trainee name/email/mobile | Data updates in `trainee_master` and `user_master` |
| Coordinator | Certify same trainee twice | Batch certified count increments only once |
| Coordinator | Handover same trainee twice | Batch handover count increments only once |
| Coordinator | Update own-batch risk | Allowed |
| Coordinator | Update another coordinator batch risk | Blocked |
| Admin | Open `/api/admin/diagnostics` with admin token | Health JSON is returned |

## Notes

- These fixes do not remove existing LMS workflows.
- Local build/test is still required before production restart because commits were applied directly through GitHub and were not executed in this environment.
