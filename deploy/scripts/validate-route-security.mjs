import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const routesRoot = join(root, 'backend', 'src', 'routes');
const policy = JSON.parse(readFileSync(join(root, 'deploy', 'route-security-policy.json'), 'utf8'));
const errors = [];
const inventory = [];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const routeFiles = readdirSync(routesRoot)
  .filter(name => name.endsWith('.js'))
  .sort();
const alternative = policy.alternativeAuthentication || {};

for (const name of routeFiles) {
  const content = readFileSync(join(routesRoot, name), 'utf8');
  const hasSessionGuard = /\brequireSession\b/.test(content);
  const hasRouter = /\bRouter\s*\(/.test(content);
  const classification = hasSessionGuard
    ? 'session-protected-or-mixed'
    : alternative[name]
      ? 'alternative-auth'
      : 'unclassified';

  if (hasRouter && !hasSessionGuard && !alternative[name]) {
    errors.push(`${name}: route module has no requireSession guard and no documented alternative authentication.`);
  }
  inventory.push({ file: name, hasRouter, hasSessionGuard, classification, reason: alternative[name] || null });
}

for (const required of policy.requiredProtectedRoutes || []) {
  const row = inventory.find(item => item.file === required);
  if (!row) errors.push(`${required}: required protected route module is missing.`);
  else if (!row.hasSessionGuard) errors.push(`${required}: required protected route does not reference requireSession.`);
}

const sourceFiles = [
  ...walk(join(root, 'backend', 'src')),
  ...walk(join(root, 'frontend', 'src')),
].filter(file => /\.(?:js|jsx|mjs|ts|tsx)$/.test(file));

for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const pattern of policy.forbiddenUrlTokenPatterns || []) {
    if (content.includes(pattern)) {
      errors.push(`${relative(root, file)}: forbidden URL token pattern detected: ${pattern}`);
    }
  }
  if (/localStorage\.getItem\([^\n]{0,100}token[^\n]{0,300}[?&]token=/is.test(content)) {
    errors.push(`${relative(root, file)}: localStorage session material is serialised into a URL.`);
  }
}

const server = readFileSync(join(root, 'backend', 'src', 'server.js'), 'utf8');
const contentRoute = readFileSync(join(routesRoot, 'contentFiles.js'), 'utf8');
const uploadRoute = readFileSync(join(routesRoot, 'upload.js'), 'utf8');
const traineeLearning = readFileSync(join(root, 'frontend', 'src', 'pages', 'Trainee', 'LearningTab.jsx'), 'utf8');
const apiUtility = readFileSync(join(root, 'frontend', 'src', 'utils', 'api.js'), 'utf8');

const requiredContracts = [
  [server, /helmet\(buildHttpSecurityPolicy\(process\.env\)\)/, 'server must mount the governed Helmet policy'],
  [server, /if \(!isProduction\)[\s\S]*?\/uploads\/content/, 'direct content static hosting must be development-only'],
  [server, /app\.use\('\/api\/content', contentFilesRoutes\)/, 'protected content router must be mounted'],
  [contentRoute, /router\.get\('\/files\/:filename', requireSession/, 'content files must require a session'],
  [contentRoute, /traineeCanAccess/, 'trainee content must be classroom scoped'],
  [uploadRoute, /\/api\/content\/files\//, 'new uploads must return protected URLs'],
  [apiUtility, /fetchAuthenticatedBlobUrl/, 'frontend must support bearer-authenticated blob delivery'],
  [traineeLearning, /fetchAuthenticatedBlobUrl/, 'learner player must use authenticated blob delivery'],
];
for (const [content, expression, message] of requiredContracts) {
  if (!expression.test(content)) errors.push(message);
}

const summary = {
  ok: errors.length === 0,
  routeCount: routeFiles.length,
  protectedOrMixedCount: inventory.filter(item => item.hasSessionGuard).length,
  alternativeAuthCount: inventory.filter(item => item.classification === 'alternative-auth').length,
  scannedSourceFiles: sourceFiles.length,
  errors,
  inventory,
};

if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
else if (summary.ok) {
  console.log(`[ROUTES] ${summary.routeCount} route modules and ${summary.scannedSourceFiles} source files satisfy route security policy.`);
} else {
  errors.forEach(error => console.error(`[ROUTES] ${error}`));
}

process.exit(summary.ok ? 0 : 1);
