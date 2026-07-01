const fs = require('fs');
const x = fs.readFileSync('frontend/src/pages/Admin/QuestionsTab.jsx', 'utf8');
let d = 0;
let inStr = false, strCh = '';
let lastDepth = 0;
for (let i = 0; i < x.length; i++) {
  const c = x[i];
  const p = x[i-1] || '';
  const n = x[i+1] || '';
  if (inStr) {
    if (c === strCh && p !== '\\') inStr = false;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
  if (c === '/' && n === '/') { while (i < x.length && x[i] !== '\n') i++; continue; }
  if (c === '/' && n === '*') { i+=2; while (i < x.length && !(x[i]==='*' && x[i+1]==='/')) i++; i++; continue; }
  if (c === '{' && n !== '{') {
    d++;
    lastDepth = d;
  }
  if (c === '}' && p !== '}') {
    d--;
  }
}
console.log('FINAL DEPTH:', d);

// Now find exactly where the braces are
d = 0; inStr = false; strCh = '';
let lineNum = 1;
for (let i = 0; i < x.length; i++) {
  const c = x[i];
  const p = x[i-1] || '';
  const n = x[i+1] || '';
  if (c === '\n') lineNum++;
  if (inStr) {
    if (c === strCh && p !== '\\') inStr = false;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
  if (c === '/' && n === '/') { while (i < x.length && x[i] !== '\n') i++; continue; }
  if (c === '/' && n === '*') { i+=2; while (i < x.length && !(x[i]==='*' && x[i+1]==='/')) i++; i++; continue; }
  if (c === '{' && n !== '{') {
    d++;
  }
  if (c === '}' && p !== '}') {
    d--;
    if (d === 0) {
      console.log('DEPTH 0 at line', lineNum, 'char', i);
    }
  }
}
