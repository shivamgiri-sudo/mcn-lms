const fs = require('fs');
const x = fs.readFileSync('frontend/src/pages/Admin/QuestionsTab.jsx', 'utf8');
let d = 0;
let inStr = false, strCh = '';
for (let i = 0; i < x.length; i++) {
  const c = x[i];
  if (inStr) {
    if (c === strCh && x[i-1] !== '\\') inStr = false;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
  if (c === '/' && x[i+1] === '/') { while (i < x.length && x[i] !== '\n') i++; continue; }
  if (c === '/' && x[i+1] === '*') { i+=2; while (i < x.length && !(x[i]==='*' && x[i+1]==='/')) i++; i++; continue; }
  if (c === '{' && x[i+1] !== '{') d++;
  if (c === '}' && x[i-1] !== '}') d--;
}
console.log('depth:', d);
