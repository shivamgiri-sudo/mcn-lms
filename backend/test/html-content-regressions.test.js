import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

// Source-text checks (see CLAUDE.md): they prove wiring, not behaviour.
test('HTML content is served in a script-capable CSP sandbox without allow-same-origin', () => {
  const src = read('../src/routes/contentFiles.js');
  assert.match(src, /sandbox allow-scripts allow-forms/);
  assert.doesNotMatch(src.match(/HTML_CONTENT_CSP = \[[\s\S]*?\]\.join/)[0], /allow-same-origin/);
  assert.match(src, /\.html\?\$\/i\.test\(filename\)\) return await sendHtmlContent/);
  assert.match(src, /data-lms-section/);
});

test('viewer gates acknowledgement on HTML view progress and uses the HTML button label', () => {
  const src = read('../../frontend/src/pages/Trainee/useTrackedContentViewer.jsx');
  assert.match(src, /d\.source !== 'lms-html'/);
  assert.match(src, /!ackChecked \|\| !htmlViewed/);
  assert.match(src, /I Have Read & Understood/);
});
