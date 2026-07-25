import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(process.cwd());
const workflowDir = join(root, '.github', 'workflows');
const errors = [];
const inventory = [];
const mutableRefs = new Set(['main', 'master', 'latest', 'head', 'develop', 'development']);
const fullSha = /^[0-9a-f]{40}$/;
const officialMajor = /^v[1-9][0-9]*$/;

function addError(file, message) {
  errors.push(`${file}: ${message}`);
}

function workflowFiles() {
  return readdirSync(workflowDir)
    .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();
}

for (const name of workflowFiles()) {
  const path = join(workflowDir, name);
  const content = readFileSync(path, 'utf8');
  const usesPattern = /^\s*-?\s*uses:\s*['"]?([^'"\s#]+)['"]?/gm;
  let match;
  while ((match = usesPattern.exec(content)) !== null) {
    const value = match[1];
    if (value.startsWith('./') || value.startsWith('docker://')) {
      inventory.push({ file: name, dependency: value, kind: 'local-or-container', policy: 'allowed' });
      continue;
    }

    const at = value.lastIndexOf('@');
    if (at <= 0 || at === value.length - 1) {
      addError(name, `workflow dependency must include an explicit ref: ${value}`);
      continue;
    }
    const action = value.slice(0, at);
    const ref = value.slice(at + 1);
    const normalizedRef = ref.toLowerCase();
    const isGitHubOfficial = action.startsWith('actions/');
    const isPinned = fullSha.test(normalizedRef);
    const allowedOfficialTag = isGitHubOfficial && officialMajor.test(normalizedRef);

    inventory.push({
      file: name,
      dependency: action,
      ref,
      kind: isGitHubOfficial ? 'github-official' : 'third-party',
      policy: isPinned ? 'commit-pinned' : allowedOfficialTag ? 'controlled-major' : 'rejected',
    });

    if (mutableRefs.has(normalizedRef)) {
      addError(name, `mutable workflow ref is forbidden: ${value}`);
    } else if (!isPinned && !allowedOfficialTag) {
      addError(name, `third-party actions must be pinned to a full 40-character commit SHA: ${value}`);
    }
  }
}

function validateImageReferences(relativePath) {
  const content = readFileSync(join(root, relativePath), 'utf8');
  const imagePatterns = relativePath === 'Dockerfile'
    ? /^\s*FROM\s+([^\s]+)(?:\s+AS\s+\S+)?/gmi
    : /^\s*image:\s*['"]?([^'"\s#]+)['"]?/gmi;
  let match;
  while ((match = imagePatterns.exec(content)) !== null) {
    const image = match[1];
    if (image.includes('${')) continue;
    const lower = image.toLowerCase();
    inventory.push({ file: relativePath, dependency: image, kind: 'container-image' });
    if (lower === 'latest' || lower.endsWith(':latest')) {
      addError(relativePath, `latest container image is forbidden: ${image}`);
    }
    const finalSegment = image.split('/').at(-1) || '';
    if (!image.includes('@sha256:') && !finalSegment.includes(':')) {
      addError(relativePath, `container image must include a version tag or digest: ${image}`);
    }
  }
}

validateImageReferences('Dockerfile');
for (const compose of ['deploy/docker-compose.staging.yml', 'deploy/docker-compose.production.yml']) {
  validateImageReferences(compose);
}

const duplicateMutable = inventory.filter(item => item.policy === 'rejected');
if (duplicateMutable.length && errors.length === 0) {
  errors.push('Rejected workflow dependencies were detected without a detailed validation error.');
}

const summary = {
  ok: errors.length === 0,
  workflowCount: workflowFiles().length,
  dependencyCount: inventory.length,
  commitPinnedCount: inventory.filter(item => item.policy === 'commit-pinned').length,
  controlledMajorCount: inventory.filter(item => item.policy === 'controlled-major').length,
  errors,
  inventory,
};

if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
else if (summary.ok) {
  console.log(`[DEPENDENCY] Policy valid across ${summary.workflowCount} workflows and ${summary.dependencyCount} references.`);
} else {
  errors.forEach(error => console.error(`[DEPENDENCY] ${error}`));
}

process.exit(summary.ok ? 0 : 1);
