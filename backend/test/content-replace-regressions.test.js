import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// Source-text checks (see CLAUDE.md): they prove wiring, not behaviour.
test('replace-file is routed behind admin auth and the content upload filter', () => {
  const routes = read('../src/routes/admin.js');
  assert.match(routes, /router\.post\('\/contents\/:contentId\/replace-file', \.\.\.auth, contentUpload\.single\('file'\), replaceContentFile\)/);
});

test('replace-file swaps the file in place and never deletes or resets progress', () => {
  const src = read('../src/controllers/contentReplace.js');
  assert.match(src, /prisma\.contentMaster\.update\(\{ where: \{ contentId \}, data \}\)/);
  assert.match(src, /driveFileId: null/);
  assert.doesNotMatch(src, /\.(delete|deleteMany)\(/);
  assert.doesNotMatch(src, /contentProgress|moduleAcknowledgement/);
  assert.match(src, /REPLACE_CONTENT_FILE/);
});

test('curriculum content card offers Replace file and re-acknowledgement is opt-in', () => {
  const card = read('../../frontend/src/pages/Admin/curriculum/ContentCard.jsx');
  assert.match(card, /onReplaceFile/);
  assert.match(card, /const \[publish, setPublish\] = useState\(false\)/);
  const tab = read('../../frontend/src/pages/Admin/CurriculumTab.jsx');
  assert.match(tab, /\/admin\/contents\/\$\{c\.contentId\}\/replace-file/);
  assert.match(tab, /if \(publish\) await api\.post\(`\/admin\/contents\/\$\{c\.contentId\}\/publish-version`/);
});
