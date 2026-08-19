import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHttpSecurityPolicy, securityPolicySummary } from '../src/security/httpSecurity.js';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

function runNode(path, args = []) {
  const script = new URL(path, root);
  return spawnSync(process.execPath, [fileURLToPath(script), ...args], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  });
}

test('production HTTP policy enforces CSP framing HSTS and safe defaults', () => {
  const policy = buildHttpSecurityPolicy({
    NODE_ENV: 'production',
    SCORM_CONTENT_ORIGIN: 'https://scorm.example.com',
    CSP_FRAME_ANCESTORS: '',
  });
  const directives = policy.contentSecurityPolicy.directives;
  assert.deepEqual(directives.defaultSrc, ["'self'"]);
  assert.deepEqual(directives.objectSrc, ["'none'"]);
  assert.deepEqual(directives.frameAncestors, ["'self'"]);
  assert.ok(directives.frameSrc.some(source => source === 'https://www.youtube.com'));
  assert.ok(directives.frameSrc.some(source => source === 'https://scorm.example.com'));
  assert.ok(Array.isArray(directives.upgradeInsecureRequests));
  assert.deepEqual(policy.frameguard, { action: 'sameorigin' });
  assert.equal(policy.strictTransportSecurity.maxAge, 31536000);

  const external = securityPolicySummary({ NODE_ENV: 'production', CSP_FRAME_ANCESTORS: 'https://hrms.example.com' });
  assert.deepEqual(external.frameAncestors, ["'self'", 'https://hrms.example.com']);
  assert.equal(external.frameguard, false);

  assert.throws(
    () => buildHttpSecurityPolicy({ NODE_ENV: 'production', CSP_CONNECT_SRC: 'javascript:alert(1)' }),
    /invalid CSP sources/i,
  );
});

test('server mounts governed headers and protects production content delivery', () => {
  const server = read('backend/src/server.js');
  const content = read('backend/src/routes/contentFiles.js');
  const upload = read('backend/src/routes/upload.js');

  assert.match(server, /helmet\(buildHttpSecurityPolicy\(process\.env\)\)/);
  assert.match(server, /validateSessionSecurityConfig\(process\.env\)/);
  assert.match(server, /if \(!isProduction\)[\s\S]*?\/uploads\/content/);
  assert.match(server, /app\.use\('\/api\/content', contentFilesRoutes\)/);
  assert.match(server, /app\.use\('\/api', browserAuthRoutes\)[\s\S]*app\.use\('\/api\/auth', authRoutes\)/);
  assert.doesNotMatch(server, /contentSecurityPolicy:\s*false/);
  assert.doesNotMatch(server, /frameguard:\s*false/);

  assert.match(content, /router\.get\('\/files\/:filename', contentFileLimiter, requireSession/);
  assert.match(content, /traineeCanAccess/);
  assert.match(content, /traineeClassroomMap/);
  assert.match(content, /path\.basename/);
  assert.match(content, /Cache-Control', 'private, no-store/);
  assert.match(upload, /\/api\/content\/files\//);
  assert.match(upload, /protected:\s*true/);
});

test('learner media uses cookie-authenticated blobs and never browser bearer credentials', () => {
  const learning = read('frontend/src/pages/Trainee/LearningTab.jsx');
  const api = read('frontend/src/utils/api.js');

  assert.match(api, /fetchAuthenticatedBlobUrl/);
  assert.match(api, /credentials:\s*'include'/);
  assert.match(api, /X-LMS-Role/);
  assert.match(api, /X-CSRF-Token/);
  assert.match(api, /URL\.createObjectURL/);
  assert.doesNotMatch(api, /Authorization:\s*`Bearer/);
  assert.doesNotMatch(api, /localStorage\.setItem\([^\n]*token\s*\)/i);
  assert.match(learning, /fetchAuthenticatedBlobUrl/);
  assert.match(learning, /URL\.revokeObjectURL/);
  assert.match(learning, /protectedLocalUrl/);
  assert.doesNotMatch(learning, /[?&]token=/);
  assert.doesNotMatch(learning, /encodeURIComponent\(token\)/);
});

test('migration and route security validators pass the complete repository', () => {
  const migration = runNode('deploy/scripts/validate-migration-safety.mjs', ['--json']);
  assert.equal(migration.status, 0, migration.stderr || migration.stdout);
  const migrationSummary = JSON.parse(migration.stdout);
  assert.equal(migrationSummary.ok, true);
  assert.equal(migrationSummary.migrationCount, 21);

  const routes = runNode('deploy/scripts/validate-route-security.mjs', ['--json']);
  assert.equal(routes.status, 0, routes.stderr || routes.stdout);
  const routeSummary = JSON.parse(routes.stdout);
  assert.equal(routeSummary.ok, true);
  assert.ok(routeSummary.routeCount >= 28);
  assert.ok(routeSummary.protectedOrMixedCount >= 23);
});

test('continuous security workflows are pinned scoped and fail closed', () => {
  const codeql = read('.github/workflows/lms-codeql.yml');
  const secrets = read('.github/workflows/lms-secret-scan.yml');
  const vulnerability = read('.github/workflows/lms-vulnerability-scan.yml');

  assert.match(codeql, /github\/codeql-action\/init@v4/);
  assert.match(codeql, /security-extended/);
  assert.match(codeql, /security-events:\s*write/);

  assert.match(secrets, /gitleaks\/gitleaks:v8\.30\.1/);
  assert.match(secrets, /--redact=100/);
  assert.match(secrets, /--exit-code 1/);
  assert.match(secrets, /upload-sarif@v4/);

  assert.match(vulnerability, /aquasec\/trivy:0\.70\.0/);
  assert.match(vulnerability, /(?:HIGH,CRITICAL|CRITICAL,HIGH)/);
  assert.match(vulnerability, /exit-code 1/);
  assert.match(vulnerability, /cyclonedx/);
  assert.match(vulnerability, /docker build/);
});

test('multipart upload dependency remains on the fully remediated release', () => {
  const manifest = JSON.parse(read('backend/package.json'));
  const lock = JSON.parse(read('backend/package-lock.json'));
  assert.equal(manifest.dependencies.multer, '2.2.0');
  assert.equal(lock.packages[''].dependencies.multer, '2.2.0');
  assert.equal(lock.packages['node_modules/multer'].version, '2.2.0');
});

test('production environment templates expose CSP and browser-session controls', () => {
  const keys = [
    'CSP_FRAME_ANCESTORS=', 'CSP_CONNECT_SRC=', 'CSP_FRAME_SRC=', 'CSP_MEDIA_SRC=', 'CSP_IMG_SRC=',
    'SESSION_ABSOLUTE_TTL_SECONDS=', 'CSRF_SECRET=', 'SESSION_FINGERPRINT_SECRET=',
    'SESSION_COOKIE_SAME_SITE=', 'SESSION_COOKIE_SECURE=', 'LMS_ALLOW_BEARER_SESSION_COMPAT=false',
    'HRMS_ASSERTION_SECRET=', 'HRMS_ASSERTION_ISSUER=', 'HRMS_ASSERTION_AUDIENCE=',
    'SSO_HANDOFF_TTL_SECONDS=', 'BRIDGE_ALLOW_LEGACY_SECRET=false', 'SECURITY_ELEVATION_MINUTES=',
  ];
  for (const path of ['backend/.env.example', 'deploy/.env.staging.example', 'deploy/.env.production.example']) {
    const env = read(path);
    for (const key of keys) {
      assert.match(env, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});
