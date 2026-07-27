import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const migrationsRoot = join(root, 'backend', 'prisma', 'migrations');
const expectedPath = join(root, 'deploy', 'migrations.expected');
const errors = [];
const warnings = [];
const inventory = [];

function stripSqlComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ')
    .replace(/^\s*#.*$/gm, ' ');
}

const expected = readFileSync(expectedPath, 'utf8')
  .split(/\r?\n/)
  .map(value => value.trim())
  .filter(Boolean);
const actual = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
  errors.push('Migration directories do not match deploy/migrations.expected.');
}
if (actual[0] !== '20260630053213_init') {
  errors.push('The canonical baseline migration must remain 20260630053213_init.');
}

const forbidden = [
  [/\bDROP\s+(?:TEMPORARY\s+)?TABLE\b/i, 'DROP TABLE is forbidden in forward migrations'],
  [/\bTRUNCATE\s+(?:TABLE\s+)?/i, 'TRUNCATE is forbidden in forward migrations'],
  [/\bALTER\s+TABLE[\s\S]*?\bDROP\s+COLUMN\b/i, 'DROP COLUMN is forbidden in forward migrations'],
  [/\bALTER\s+TABLE[\s\S]*?\bDROP\s+FOREIGN\s+KEY\b/i, 'DROP FOREIGN KEY requires a separately reviewed replacement migration'],
  [/\bDROP\s+DATABASE\b/i, 'DROP DATABASE is forbidden'],
  [/\bSET\s+FOREIGN_KEY_CHECKS\s*=\s*0\b/i, 'Disabling foreign-key checks is forbidden'],
  [/\bDELIMITER\b/i, 'Client-specific DELIMITER directives are forbidden'],
  [/\bCREATE\s+(?:DEFINER\s*=\s*\S+\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i, 'Stored routines, triggers and events are forbidden in Prisma migrations'],
  [/\bDELETE\s+FROM\b/i, 'Destructive DELETE statements are forbidden in schema migrations'],
  [/\bRENAME\s+TABLE\b/i, 'RENAME TABLE requires an explicit compatibility plan'],
];

for (const migration of actual) {
  const file = join(migrationsRoot, migration, 'migration.sql');
  const sql = readFileSync(file, 'utf8');
  const normalized = stripSqlComments(sql);
  const isBaseline = migration === '20260630053213_init';

  const findings = [];
  if (!isBaseline) {
    for (const [pattern, message] of forbidden) {
      if (pattern.test(normalized)) findings.push(message);
    }
  }

  const dropIndexes = [...normalized.matchAll(/\bDROP\s+INDEX\s+`?([A-Za-z0-9_]+)`?/gi)].map(match => match[1]);
  if (dropIndexes.length) warnings.push(`${migration}: reviewed index removal(s): ${dropIndexes.join(', ')}`);

  if (!isBaseline && !/\b(?:CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|INSERT\s+INTO)\b/i.test(normalized)) {
    findings.push('Migration contains no recognised forward schema or seed operation.');
  }

  findings.forEach(message => errors.push(`${migration}: ${message}`));
  inventory.push({ migration, baseline: isBaseline, bytes: Buffer.byteLength(sql), dropIndexes, findings });
}

const summary = {
  ok: errors.length === 0,
  migrationCount: actual.length,
  baseline: actual[0] || null,
  errors,
  warnings,
  inventory,
};

if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
else if (summary.ok) {
  console.log(`[MIGRATION] ${summary.migrationCount} migrations satisfy forward-only safety policy.`);
  warnings.forEach(warning => console.warn(`[MIGRATION] ${warning}`));
} else {
  errors.forEach(error => console.error(`[MIGRATION] ${error}`));
}

process.exit(summary.ok ? 0 : 1);
