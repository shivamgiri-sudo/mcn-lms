import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const validatorPath = new URL('../../deploy/scripts/validate-release-manifest.mjs', import.meta.url);
const evidenceValidatorPath = new URL('../../deploy/scripts/validate-release-evidence.mjs', import.meta.url);
const sloValidatorPath = new URL('../../deploy/scripts/validate-slo-policy.mjs', import.meta.url);
const dependencyValidatorPath = new URL('../../deploy/scripts/validate-workflow-dependencies.mjs', import.meta.url);
const exampleManifest = JSON.parse(read('deploy/release-manifest.example.json'));

function runNode(scriptUrl, args = [], env = {}) {
  return spawnSync(process.execPath, [scriptUrl.pathname, ...args], {
    cwd: new URL('../../', import.meta.url).pathname,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function approvedManifest() {
  const approvedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const approval = role => ({
    name: `${role} Approver`,
    decision: 'APPROVED',
    approvedAt,
    evidence: `change-record-${role.toLowerCase().replaceAll(' ', '-')}`,
  });
  return {
    ...exampleManifest,
    release: 'mcn-lms-v1.2.3',
    commit: 'a'.repeat(40),
    image: `ghcr.io/shivamgiri-sudo/mcn-lms@sha256:${'b'.repeat(64)}`,
    createdAt: approvedAt,
    approvals: {
      engineering: approval('Engineering'),
      security: approval('Security'),
      trainingQuality: approval('Training Quality'),
      operations: approval('Operations'),
      releaseManager: approval('Release Manager'),
    },
  };
}

function publishedEvidence(manifest) {
  const [image, digest] = manifest.image.split('@');
  return {
    repository: 'shivamgiri-sudo/mcn-lms',
    releaseTag: 'v1.2.3',
    commit: manifest.commit,
    image,
    digest,
    workflowRun: 'https://github.com/shivamgiri-sudo/mcn-lms/actions/runs/123456789',
    builtAt: manifest.createdAt,
  };
}

test('release manifest template validates only in template mode', () => {
  const template = runNode(validatorPath, ['deploy/release-manifest.example.json', '--template']);
  assert.equal(template.status, 0, template.stderr);

  const strict = runNode(validatorPath, ['deploy/release-manifest.example.json']);
  assert.notEqual(strict.status, 0);
  assert.match(strict.stderr, /commit|image|approval/i);
});

test('strict release manifest binds approvals commit and immutable image', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lms-release-manifest-'));
  try {
    const manifest = approvedManifest();
    const path = join(directory, 'release.json');
    writeFileSync(path, JSON.stringify(manifest, null, 2));
    const valid = runNode(validatorPath, [path, '--json'], {
      EXPECTED_COMMIT_SHA: manifest.commit,
      EXPECTED_IMAGE: manifest.image,
    });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).approvalCount, 5);

    manifest.approvals.security = null;
    manifest.image = 'ghcr.io/shivamgiri-sudo/mcn-lms:latest';
    writeFileSync(path, JSON.stringify(manifest, null, 2));
    const invalid = runNode(validatorPath, [path]);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /latest/);
    assert.match(invalid.stderr, /security/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('published image evidence must match approved manifest commit and digest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lms-release-provenance-'));
  try {
    const manifest = approvedManifest();
    const evidence = publishedEvidence(manifest);
    const manifestPath = join(directory, 'release.json');
    const evidencePath = join(directory, 'evidence.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));

    const valid = runNode(evidenceValidatorPath, [manifestPath, evidencePath, '--json'], {
      EXPECTED_COMMIT_SHA: manifest.commit,
      EXPECTED_IMAGE: manifest.image,
    });
    assert.equal(valid.status, 0, valid.stderr);
    const summary = JSON.parse(valid.stdout);
    assert.equal(summary.ok, true);
    assert.equal(summary.image, manifest.image);

    evidence.commit = 'c'.repeat(40);
    evidence.digest = `sha256:${'d'.repeat(64)}`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    const invalid = runNode(evidenceValidatorPath, [manifestPath, evidencePath]);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /commit/);
    assert.match(invalid.stderr, /digest|image/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SLO policy validates and retains recovery objectives', () => {
  const result = runNode(sloValidatorPath, ['deploy/slo-policy.json']);
  assert.equal(result.status, 0, result.stderr);
  const policy = JSON.parse(read('deploy/slo-policy.json'));
  assert.equal(policy.objectives.availabilityPct, 99.9);
  assert.equal(policy.objectives.maximumP95LatencyMs, 1500);
  assert.equal(policy.recovery.rtoMinutes, 60);
  assert.equal(policy.recovery.rpoMinutes, 15);
  assert.equal(policy.releaseGates.requireApprovedManifest, true);
  assert.equal(policy.releaseGates.requireRestoreEvidence, true);
});

test('release validates approval and provenance before backup or migration', () => {
  const release = read('deploy/scripts/release.sh');
  const manifestIndex = release.indexOf('validate-release-manifest.mjs');
  const evidenceIndex = release.indexOf('validate-release-evidence.mjs');
  const backupIndex = release.indexOf('backup.sh');
  const migrationIndex = release.indexOf('run --rm migrate');
  assert.ok(manifestIndex > 0);
  assert.ok(evidenceIndex > manifestIndex);
  assert.ok(backupIndex > evidenceIndex);
  assert.ok(migrationIndex > backupIndex);
  assert.match(release, /EXPECTED_COMMIT_SHA/);
  assert.match(release, /EXPECTED_IMAGE/);
  assert.match(release, /RELEASE_MANIFEST_FILE/);
  assert.match(release, /RELEASE_IMAGE_EVIDENCE_FILE/);
});

test('disaster recovery drill measures checksum RTO and RPO', () => {
  const drill = read('deploy/scripts/dr-drill.sh');
  for (const contract of [
    'validate-slo-policy.mjs',
    'sha256sum --check',
    'restore-rehearsal.sh',
    'rtoTargetSeconds',
    'rpoTargetSeconds',
    'ageSecondsAtDrillStart',
    'failureReasons',
  ]) assert.match(drill, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(drill, /status="FAIL"/);
  assert.match(drill, /DR_RESTORE_ENV_FILE/);
  assert.match(drill, /DR_RESTORE_COMPOSE_FILE/);
});

test('repository governance and deterministic dependency policy protect critical changes', () => {
  const owners = read('.github/CODEOWNERS');
  const dependencyPolicy = read('.github/workflows/dependency-policy.yml');
  const dependabot = read('.github/dependabot.yml');
  const security = read('SECURITY.md');
  const validation = runNode(dependencyValidatorPath, ['--json']);
  assert.equal(validation.status, 0, validation.stderr);
  const summary = JSON.parse(validation.stdout);
  assert.equal(summary.ok, true);
  assert.ok(summary.dependencyCount > 0);
  assert.ok(summary.commitPinnedCount > 0);
  assert.match(owners, /backend\/prisma\/migrations/);
  assert.match(owners, /\.github\/workflows/);
  assert.match(dependencyPolicy, /validate-workflow-dependencies\.mjs/);
  assert.match(dependencyPolicy, /npm audit --omit=dev --audit-level=high/g);
  assert.match(dependabot, /package-ecosystem: npm/g);
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /package-ecosystem: docker/);
  assert.match(security, /Report a vulnerability/);
  assert.match(security, /Critical \| 4 hours/);
});

test('release publishing requires production environment SBOM and verified attestations', () => {
  const workflow = read('.github/workflows/lms-publish-attested-image.yml');
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /sbom: true/);
  assert.match(workflow, /provenance: mode=max/);
  assert.match(workflow, /actions\/attest@v4/);
  assert.match(workflow, /subject-digest/);
  assert.match(workflow, /subject-path: release-image-evidence\.json/);
  assert.match(workflow, /gh attestation verify/);
  assert.match(workflow, /steps\.source\.outputs\.commit/);
  assert.doesNotMatch(workflow, /:latest/);
});

test('monthly recovery workflow is isolated and preserves evidence', () => {
  const workflow = read('.github/workflows/lms-dr-readiness.yml');
  assert.match(workflow, /cron: '30 2 1 \* \*'/);
  assert.match(workflow, /docker-compose\.staging\.yml/);
  assert.match(workflow, /dr-drill\.sh/);
  assert.match(workflow, /down -v --remove-orphans/);
  assert.match(workflow, /retention-days: 90/);
});
