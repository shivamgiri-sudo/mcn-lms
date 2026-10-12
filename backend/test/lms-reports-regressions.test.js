import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { buildXlsx } from '../src/utils/xlsx.js';

test('buildXlsx produces a zip with a worksheet containing headers, numbers and escaped text', () => {
  const zip = new AdmZip(buildXlsx('Sheet', ['Name', 'Mins'], [['A & <B>', 12.5]]));
  const names = zip.getEntries().map(e => e.entryName);
  for (const n of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) assert.ok(names.includes(n), n);
  const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
  assert.match(sheet, /A &amp; &lt;B&gt;/);
  assert.match(sheet, /<v>12\.5<\/v>/);
});

// Source-text checks (see CLAUDE.md): these only prove wiring, not behaviour.
test('both reports are routed under /admin/reports with the admin auth chain', () => {
  const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  assert.match(routes, /router\.get\('\/reports\/training-completion', \.\.\.auth, exportTrainingCompletion\)/);
  assert.match(routes, /router\.get\('\/reports\/user-active-time', \.\.\.auth, exportUserActiveTime\)/);
});
