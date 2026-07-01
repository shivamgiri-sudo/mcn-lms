const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'frontend/src/pages/Admin/QuestionsTab.jsx'), 'utf8');
try {
  const esbuild = require(path.join(__dirname, 'frontend/node_modules/esbuild'));
  esbuild.transformSync(src, { loader: 'jsx', jsx: 'automatic' });
  console.log('OK');
} catch (e) {
  console.log('ERROR:', e.message);
}
