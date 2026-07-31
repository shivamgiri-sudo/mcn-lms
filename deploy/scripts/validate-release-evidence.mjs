import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [manifestArg = 'deploy/release-manifest.json', evidenceArg = 'deploy/release-image-evidence.json'] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const jsonOutput = process.argv.includes('--json');
const manifestPath = resolve(process.cwd(), manifestArg);
const evidencePath = resolve(process.cwd(), evidenceArg);
const errors = [];

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`[PROVENANCE] Cannot read ${label} JSON at ${path}: ${error.message}`);
    process.exit(64);
  }
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

const manifest = readJson(manifestPath, 'release manifest');
const evidence = readJson(evidencePath, 'release image evidence');
const expectedRepository = process.env.EXPECTED_REPOSITORY || 'shivamgiri-sudo/mcn-lms';
const expectedImageBase = `ghcr.io/${expectedRepository.toLowerCase()}`;

if (evidence.repository !== expectedRepository) errors.push(`Evidence repository must be ${expectedRepository}.`);
if (!/^v?[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/.test(evidence.releaseTag || '')) {
  errors.push('Evidence releaseTag must be a semantic version tag.');
}
if (!/^[0-9a-f]{40}$/.test(evidence.commit || '')) errors.push('Evidence commit must be a full lowercase Git SHA.');
if (evidence.image !== expectedImageBase) errors.push(`Evidence image must be ${expectedImageBase}.`);
if (!/^sha256:[0-9a-f]{64}$/.test(evidence.digest || '')) errors.push('Evidence digest must be a SHA-256 image digest.');
if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+$/.test(evidence.workflowRun || '')) {
  errors.push('Evidence workflowRun must identify a GitHub Actions run.');
}
if (!isIsoTimestamp(evidence.builtAt)) {
  errors.push('Evidence builtAt must be an ISO-8601 UTC timestamp.');
} else {
  const builtAt = Date.parse(evidence.builtAt);
  const now = Date.now();
  if (builtAt > now + 5 * 60_000) errors.push('Evidence builtAt cannot be in the future.');
  if (builtAt < now - 90 * 24 * 60 * 60_000) errors.push('Evidence is older than the 90-day release window.');
}

const evidenceDigestReference = `${evidence.image}@${evidence.digest}`;
if (manifest.commit !== evidence.commit) errors.push('Manifest commit does not match published image evidence.');
if (manifest.image !== evidenceDigestReference) errors.push('Manifest image digest does not match published image evidence.');
if (typeof manifest.release !== 'string' || !manifest.release.endsWith(evidence.releaseTag || '')) {
  errors.push('Manifest release does not correspond to the published release tag.');
}

const expectedCommit = process.env.EXPECTED_COMMIT_SHA;
const expectedImage = process.env.EXPECTED_IMAGE;
if (expectedCommit && evidence.commit !== expectedCommit) errors.push('Evidence commit does not match EXPECTED_COMMIT_SHA.');
if (expectedImage && evidenceDigestReference !== expectedImage) errors.push('Evidence digest reference does not match EXPECTED_IMAGE.');

const summary = {
  ok: errors.length === 0,
  manifestPath,
  evidencePath,
  repository: evidence.repository || null,
  releaseTag: evidence.releaseTag || null,
  commit: evidence.commit || null,
  image: evidenceDigestReference,
  workflowRun: evidence.workflowRun || null,
  errors,
};

if (jsonOutput) console.log(JSON.stringify(summary, null, 2));
else if (summary.ok) console.log(`[PROVENANCE] Evidence valid for ${summary.image} from ${summary.commit}.`);
else errors.forEach(error => console.error(`[PROVENANCE] ${error}`));

process.exit(summary.ok ? 0 : 1);
