import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

async function source(relativePath, root = backendRoot) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('evidence governance catalogs only branch-scoped LMS sources', async () => {
  const routes = await source('src/routes/talentEvidence.js');
  assert.match(routes, /requirePermission\('talent\.skills\.view'\)/);
  assert.match(routes, /cl\.branch = \?/);
  assert.match(routes, /visibleContentIds/);
  assert.match(routes, /visibleAssessmentIds/);
  assert.match(routes, /content_skill_map/);
  assert.match(routes, /assessment_skill_map/);
});

test('employee talent inspection and verification remain within admin data scope', async () => {
  const routes = await source('src/routes/talentEvidence.js');
  const talentRoutes = await source('src/routes/talent.js');
  assert.match(routes, /employeeInScope/);
  assert.match(routes, /String\(trainee\.branch \|\| ''\) !== String\(req\.userBranch \|\| ''\)/);
  assert.match(routes, /getTalentSnapshot/);
  assert.match(talentRoutes, /VERIFY_EMPLOYEE_SKILL/);
  assert.match(talentRoutes, /expiresAt/);
  assert.match(talentRoutes, /MANUAL_VERIFICATION/);
});

test('expired manual verification is removed before scheduled recalculation', async () => {
  const service = await source('src/services/talentGovernance.js');
  const server = await source('src/server.js');
  assert.match(service, /expireAllStaleVerifications/);
  assert.match(service, /evidence_status = 'EXPIRED'/);
  assert.match(service, /verified_by = NULL/);
  assert.match(service, /expires_at <= UTC_TIMESTAMP\(3\)/);
  assert.match(server, /runTalentGovernanceCleanup/);
  assert.match(server, /setInterval\(runTalentGovernanceCleanup/);
});

test('evidence mappings can be removed only for visible content or assessments', async () => {
  const routes = await source('src/routes/talentEvidence.js');
  assert.match(routes, /REMOVE_SKILL_EVIDENCE_MAP/);
  assert.match(routes, /Content mapping is outside your scope/);
  assert.match(routes, /Assessment mapping is outside your scope/);
  assert.match(routes, /UPDATE content_skill_map SET active = 0/);
  assert.match(routes, /UPDATE assessment_skill_map SET active = 0/);
});

test('learner talent portal displays skills, paths, evidence and prerequisites', async () => {
  const component = await source('frontend/src/pages/Trainee/SkillsPathsTab.jsx', repoRoot);
  const dashboard = await source('frontend/src/pages/Trainee/DashboardView.jsx', repoRoot);
  assert.match(component, /\/talent\/me/);
  assert.match(component, /\/talent\/me\/refresh/);
  assert.match(component, /Competency profile/);
  assert.match(component, /Learning paths/);
  assert.match(component, /Evidence ledger/);
  assert.match(component, /prerequisiteComplete/);
  assert.match(dashboard, /SkillsPathsTab/);
  assert.match(dashboard, /Skills & Paths/);
});

test('coordinator competency dashboard uses only owned-batch endpoint', async () => {
  const component = await source('frontend/src/pages/Coordinator/CompetencyGapsTab.jsx', repoRoot);
  const dashboard = await source('frontend/src/pages/Coordinator/CoordDashboard.jsx', repoRoot);
  const routes = await source('src/routes/talent.js');
  assert.match(component, /\/talent\/coordinator\/batches\//);
  assert.match(component, /Critical readiness blocker/);
  assert.match(component, /role ready/);
  assert.match(routes, /coordinatorLoginId: req\.userId/);
  assert.match(routes, /talent\.skills\.view_batch/);
  assert.match(dashboard, /CompetencyGapsTab/);
});

test('admin talent workspaces provide actual creation, mapping and verification actions', async () => {
  const architecture = await source('frontend/src/pages/Admin/TalentArchitectureTab.jsx', repoRoot);
  const evidence = await source('frontend/src/pages/Admin/EvidenceGovernanceTab.jsx', repoRoot);
  const consolePage = await source('frontend/src/pages/Admin/AdminConsole.jsx', repoRoot);
  assert.match(architecture, /\/talent\/admin\/skills/);
  assert.match(architecture, /\/talent\/admin\/requirements/);
  assert.match(architecture, /\/talent\/admin\/paths/);
  assert.match(architecture, /\/publish/);
  assert.match(architecture, /\/enrollments/);
  assert.match(evidence, /\/talent\/admin\/evidence\/catalog/);
  assert.match(evidence, /\/maps\//);
  assert.match(evidence, /employees\/\$\{encodeURIComponent\(employeeId\)\}\/talent/);
  assert.match(evidence, /Record verification/);
  assert.match(consolePage, /EvidenceGovernanceTab/);
  assert.match(consolePage, /Evidence & Verification/);
});

test('cross-employee skill matrix reuses existing skill tables with no fabricated cells', async () => {
  const routes = await source('src/routes/talent.js');
  const architecture = await source('frontend/src/pages/Admin/TalentArchitectureTab.jsx', repoRoot);
  assert.match(routes, /router\.get\(\s*\n\s*'\/admin\/skill-matrix'/);
  assert.match(routes, /requirePermission\('talent\.skills\.view'\)/);
  assert.match(routes, /prisma\.traineeMaster\.findMany/);
  assert.match(routes, /FROM employee_skill_profile/);
  assert.match(routes, /FROM role_skill_requirement/);
  assert.match(routes, /belowTargetEmployees/);
  assert.match(routes, /belowTargetPairs/);
  assert.match(architecture, /\/talent\/admin\/skill-matrix/);
  assert.match(architecture, /requiredOnly/);
  assert.match(architecture, /Missing cells mean no evidence has been recorded yet/);
});

test('talent evidence routes are mounted before the main talent router', async () => {
  const server = await source('src/server.js');
  const evidenceIndex = server.indexOf("app.use('/api/talent', talentEvidenceRoutes)");
  const mainIndex = server.indexOf("app.use('/api/talent', talentRoutes)");
  assert.ok(evidenceIndex >= 0, 'talent evidence router is not mounted');
  assert.ok(mainIndex > evidenceIndex, 'talent evidence router must be mounted before the main talent router');
});
