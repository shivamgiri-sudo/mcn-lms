import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('Phase 14 runs the permanent security matrix on every branch push', () => {
  const workflows = [
    '.github/workflows/lms-codeql.yml',
    '.github/workflows/lms-secret-scan.yml',
    '.github/workflows/lms-vulnerability-scan.yml',
    '.github/workflows/lms-security-assurance.yml',
  ];

  for (const path of workflows) {
    const workflow = read(path);
    assert.match(workflow, /push:[\s\S]*?branches:[\s\S]*?- agent\/lms-assessment-intelligence/);
  }
});

test('exact-image assurance derives migration count from canonical inventory', () => {
  const workflow = read('.github/workflows/lms-security-assurance.yml');
  const validator = read('deploy/scripts/validate-release-manifest.mjs');

  assert.match(workflow, /expected=\$\(grep -cv '\^\[\[:space:\]\]\*\$' deploy\/migrations\.expected\)/);
  assert.match(workflow, /test "\$applied" = "\$expected"/);
  assert.doesNotMatch(workflow, /test "\$applied" = "15"/);
  assert.match(validator, /migrationInventoryPath/);
  assert.match(validator, /canonicalMigrationCount/);
  assert.match(validator, /migrationCount must equal the canonical \$\{canonicalMigrationCount\} migrations/);
});
