import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const templateMode = args.includes('--template');
const jsonOutput = args.includes('--json');
const manifestArg = args.find(arg => !arg.startsWith('--')) || 'deploy/release-manifest.json';
const manifestPath = resolve(process.cwd(), manifestArg);
const errors = [];

const requiredApprovalKeys = [
  'engineering',
  'security',
  'trainingQuality',
  'operations',
  'releaseManager',
];
const requiredEnvironment = [
  'DATABASE_URL',
  'FRONTEND_URL',
  'SESSION_SECRET',
  'OAUTH_STATE_SECRET',
  'BRIDGE_SECRET',
  'HR_API_KEY',
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
  'LMS_INSTANCE_ID',
  'LMS_INSTANCE_ROLE',
  'APP_VERSION',
  'DEPLOYMENT_ID',
];
const expectedRollout = [
  ['administrators', 100],
  ['pilot-branch', 10],
  ['pilot-process', 25],
  ['expanded', 50],
  ['general', 100],
];

function addError(message) {
  errors.push(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function containsPlaceholder(value) {
  return typeof value === 'string' && /REPLACE_|CHANGE_ME|example\.invalid/i.test(value);
}

function checkNumber(value, name, { min, max }) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    addError(`${name} must be a finite number between ${min} and ${max}.`);
  }
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`[RELEASE] Cannot read valid JSON manifest at ${manifestPath}: ${error.message}`);
  process.exit(64);
}

if (!isObject(manifest)) addError('Manifest root must be an object.');

if (typeof manifest.release !== 'string' || manifest.release.trim().length < 3) {
  addError('release must be a non-empty release identifier.');
}
if (!templateMode && containsPlaceholder(manifest.release)) addError('release still contains a placeholder.');

if (templateMode) {
  if (typeof manifest.commit !== 'string' || manifest.commit.length < 8) addError('commit template value is missing.');
} else if (!/^[0-9a-f]{40}$/.test(manifest.commit || '')) {
  addError('commit must be the full 40-character lowercase Git SHA.');
}

const image = String(manifest.image || '');
if (!image) addError('image is required.');
if (/:latest(?:@|$)/i.test(image)) addError('image must never use the latest tag.');
if (!templateMode && !/^ghcr\.io\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/.test(image)) {
  addError('image must be an immutable lowercase GHCR digest reference.');
}
if (!templateMode && containsPlaceholder(image)) addError('image still contains a placeholder.');

if (!isIsoTimestamp(manifest.createdAt)) {
  addError('createdAt must be an ISO-8601 UTC timestamp.');
} else if (!templateMode) {
  const createdAt = Date.parse(manifest.createdAt);
  const now = Date.now();
  if (createdAt > now + 5 * 60_000) addError('createdAt cannot be more than five minutes in the future.');
  if (createdAt < now - 90 * 24 * 60 * 60_000) addError('createdAt is older than the 90-day release window.');
}

if (manifest.migrationCount !== 15) addError('migrationCount must equal the canonical 15 migrations.');
if (!['backward-compatible', 'forward-only'].includes(manifest.migrationCompatibility)) {
  addError('migrationCompatibility must be backward-compatible or forward-only.');
}
if (manifest.databaseRollbackSupported !== false) addError('databaseRollbackSupported must be false.');
if (typeof manifest.applicationRollbackSupported !== 'boolean') addError('applicationRollbackSupported must be boolean.');
if (manifest.applicationRollbackSupported && manifest.migrationCompatibility !== 'backward-compatible') {
  addError('application rollback may be enabled only for a backward-compatible migration set.');
}

if (!Array.isArray(manifest.requiredEnvironment)) {
  addError('requiredEnvironment must be an array.');
} else {
  const unique = new Set(manifest.requiredEnvironment);
  if (unique.size !== manifest.requiredEnvironment.length) addError('requiredEnvironment contains duplicates.');
  for (const name of requiredEnvironment) {
    if (!unique.has(name)) addError(`requiredEnvironment is missing ${name}.`);
  }
}

if (!isObject(manifest.healthEndpoints)) {
  addError('healthEndpoints must be an object.');
} else {
  if (manifest.healthEndpoints.liveness !== '/api/runtime/health/live') addError('Unexpected liveness endpoint.');
  if (manifest.healthEndpoints.readiness !== '/api/runtime/health/ready') addError('Unexpected readiness endpoint.');
}

if (!Array.isArray(manifest.rollout) || manifest.rollout.length !== expectedRollout.length) {
  addError(`rollout must contain exactly ${expectedRollout.length} controlled stages.`);
} else {
  manifest.rollout.forEach((stage, index) => {
    const [expectedStage, expectedPercentage] = expectedRollout[index];
    if (!isObject(stage)) {
      addError(`rollout[${index}] must be an object.`);
      return;
    }
    if (stage.stage !== expectedStage) addError(`rollout[${index}].stage must be ${expectedStage}.`);
    if (stage.percentage !== expectedPercentage) addError(`rollout[${index}].percentage must be ${expectedPercentage}.`);
  });
}

if (!isObject(manifest.rollbackGuardrails)) {
  addError('rollbackGuardrails must be an object.');
} else {
  checkNumber(manifest.rollbackGuardrails.maximumErrorRatePct, 'maximumErrorRatePct', { min: 0, max: 5 });
  checkNumber(manifest.rollbackGuardrails.maximumP95LatencyMs, 'maximumP95LatencyMs', { min: 50, max: 5000 });
  checkNumber(manifest.rollbackGuardrails.maximumNotificationBacklog, 'maximumNotificationBacklog', { min: 0, max: 100_000 });
  checkNumber(manifest.rollbackGuardrails.minimumHealthyInstances, 'minimumHealthyInstances', { min: 2, max: 100 });
}

if (!isObject(manifest.approvals)) {
  addError('approvals must be an object.');
} else {
  for (const key of requiredApprovalKeys) {
    const approval = manifest.approvals[key];
    if (templateMode && approval === null) continue;
    if (!isObject(approval)) {
      addError(`approvals.${key} must contain approval evidence.`);
      continue;
    }
    if (typeof approval.name !== 'string' || approval.name.trim().length < 2) addError(`approvals.${key}.name is required.`);
    if (approval.decision !== 'APPROVED') addError(`approvals.${key}.decision must be APPROVED.`);
    if (!isIsoTimestamp(approval.approvedAt)) addError(`approvals.${key}.approvedAt must be an ISO-8601 UTC timestamp.`);
    if (typeof approval.evidence !== 'string' || approval.evidence.trim().length < 5) addError(`approvals.${key}.evidence is required.`);
    if (!templateMode && containsPlaceholder(approval.name + approval.evidence)) addError(`approvals.${key} contains a placeholder.`);
  }
}

if (!templateMode) {
  const expectedCommit = process.env.EXPECTED_COMMIT_SHA;
  const expectedImage = process.env.EXPECTED_IMAGE;
  const expectedRelease = process.env.EXPECTED_RELEASE;
  if (expectedCommit && manifest.commit !== expectedCommit) addError(`Manifest commit does not match EXPECTED_COMMIT_SHA (${expectedCommit}).`);
  if (expectedImage && manifest.image !== expectedImage) addError(`Manifest image does not match EXPECTED_IMAGE (${expectedImage}).`);
  if (expectedRelease && manifest.release !== expectedRelease) addError(`Manifest release does not match EXPECTED_RELEASE (${expectedRelease}).`);
}

const summary = {
  ok: errors.length === 0,
  mode: templateMode ? 'template' : 'release',
  manifestPath,
  release: manifest?.release ?? null,
  commit: manifest?.commit ?? null,
  image: manifest?.image ?? null,
  migrationCount: manifest?.migrationCount ?? null,
  approvalCount: isObject(manifest?.approvals)
    ? requiredApprovalKeys.filter(key => isObject(manifest.approvals[key]) && manifest.approvals[key].decision === 'APPROVED').length
    : 0,
  errors,
};

if (jsonOutput) console.log(JSON.stringify(summary, null, 2));
else if (summary.ok) console.log(`[RELEASE] Manifest valid for ${summary.release} (${summary.commit}).`);
else errors.forEach(error => console.error(`[RELEASE] ${error}`));

process.exit(summary.ok ? 0 : 1);
