const fs = require('fs');
const x = fs.readFileSync('frontend/src/pages/Admin/QuestionsTab.jsx', 'utf8');
let d = 0;
let inStr = false, strCh = '';
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
    if (d > 1) console.log(`OPEN depth ${d} at char ${i}: ${x.substring(Math.max(0,i-30),i+30).replace(/\n/g,'\\n')}`);
  }
  if (c === '}' && p !== '}') {
    if (d === 1) console.log(`LAST CLOSE depth ${d}->${d-1} at char ${i}: ${x.substring(Math.max(0,i-30),i+30).replace(/\n/g,'\\n')}`);
    d--;
  }
}
console.log('FINAL DEPTH:', d);
