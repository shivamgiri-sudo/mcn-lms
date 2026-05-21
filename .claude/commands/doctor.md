Run a health check on the MCN LMS project and report status for each area.

Check the following and report with ✅ / ❌ / ⚠️:

## 1. Dependencies

- Does `backend/package.json` have `prisma` in `dependencies` (not `devDependencies`)?
- Does `backend/node_modules/@prisma/client` exist?
- Does `frontend/node_modules` exist?

## 2. Environment

- Does `backend/.env` exist?
- Does `backend/.env` contain `DATABASE_URL`?
- Does `backend/.env` contain `HR_API_KEY`?
- Does `backend/.env` contain `GOOGLE_SERVICE_ACCOUNT_JSON`?

## 3. Prisma

- Is the Prisma client generated? Check `backend/node_modules/@prisma/client/index.js` exists.
- Does `backend/prisma/schema.prisma` have `broadcastTitle` on `AssignedModule`?
- Does `backend/prisma/schema.prisma` have `empIdType` on `TraineeMaster`?

## 4. Key Files Exist

Check these files exist:
- `backend/src/controllers/compliance.js`
- `backend/src/routes/compliance.js`
- `backend/src/utils/empIdMapping.js`
- `frontend/src/pages/Admin/ComplianceExport.jsx`
- `frontend/src/pages/Admin/EmpIdMappingUpload.jsx`
- `backend/CLAUDE.md` or `CLAUDE.md` at root

## 5. Git Status

- Run `git status --short` — are there uncommitted changes?
- Run `git log --oneline -5` — show last 5 commits

## 6. Route Registration

- Is `compliance` imported and mounted in `backend/src/server.js`?
- Is `empMapping` imported and mounted in `backend/src/server.js`?

Present results as a clean checklist. At the end, summarise: how many checks passed, how many failed, and what to fix first.
