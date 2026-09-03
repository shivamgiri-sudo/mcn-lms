import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Twelve route files sat on disk unmounted for months while their own regression
// tests passed, because those tests readFileSync the route file and assert on its
// source text without ever booting the app. A router that is never mounted is
// indistinguishable from one that does not exist: the request falls through to the
// SPA catch-all and the page silently renders nothing.
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const routeFiles = readdirSync(new URL('../src/routes/', import.meta.url)).filter(name => name.endsWith('.js'));

test('every route file is imported and mounted in server.js', () => {
  assert.ok(routeFiles.length > 30, 'route directory should not be empty');
  const unmounted = routeFiles.filter(name => !server.includes(`./routes/${name}`));
  assert.deepEqual(unmounted, [], `route files never imported by server.js: ${unmounted.join(', ')}`);

  const imported = [...server.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([\w.]+\.js)'/g)];
  assert.equal(imported.length, routeFiles.length, 'every route file needs exactly one import binding');
  const mounted = new Set([...server.matchAll(/app\.use\((?:[^,()]*,\s*)?(\w+)\s*\)/g)].map(match => match[1]));
  for (const [, binding, file] of imported) {
    assert.ok(mounted.has(binding), `${file} is imported as ${binding} but never passed to app.use`);
  }
});

test('every route module the security policy marks required is mounted', () => {
  const policy = JSON.parse(readFileSync(new URL('../../deploy/route-security-policy.json', import.meta.url), 'utf8'));
  for (const file of policy.requiredProtectedRoutes) {
    assert.ok(server.includes(`./routes/${file}`), `${file} is listed in requiredProtectedRoutes but is not mounted`);
  }
});

test('the feature prefixes the frontend calls are actually mounted', () => {
  for (const prefix of [
    '/api/calibration', '/api/practical', '/api/notifications',
    '/api/calendar', '/api/assessment-intelligence',
  ]) assert.ok(server.includes(`app.use('${prefix}'`), `no router mounted at ${prefix}`);
  // runtimeGovernance self-prefixes its paths with /runtime, so it mounts on /api.
  assert.match(server, /app\.use\('\/api',\s*runtimeGovernanceRoutes\)/);
});
