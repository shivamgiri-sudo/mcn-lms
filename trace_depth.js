const fs = require('fs');
const x = fs.readFileSync('frontend/src/pages/Admin/QuestionsTab.jsx', 'utf8');
let d = 0;
let inStr = false, strCh = '';
let lineNum = 1;
for (let i = 0; i < x.length; i++) {
  const c = x[i];
  const p = x[i-1] || '';
  const n = x[i+1] || '';
  if (c === '\n') { lineNum++; continue; }
  if (inStr) {
    if (c === strCh && p !== '\\') inStr = false;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
  if (c === '/' && n === '/') { while (i < x.length && x[i] !== '\n') i++; continue; }
  if (c === '/' && n === '*') { i+=2; while (i < x.length && !(x[i]==='*' && x[i+1]==='/')) i++; i++; continue; }
  if (c === '{' && n !== '{') { d++; }
  if (c === '}' && p !== '}') { d--; }
}
console.log('line count:', lineNum, 'final depth:', d);

// Track depth per line
d = 0; inStr = false; strCh = '';
lineNum = 1;
let lineDepths = [];
let currentLineDepth = 0;
for (let i = 0; i < x.length; i++) {
  const c = x[i];
  const p = x[i-1] || '';
  const n = x[i+1] || '';
  if (c === '\n') { 
    lineDepths.push({ line: lineNum, depth: d });
    lineNum++; 
    continue; 
  }
  if (inStr) {
    if (c === strCh && p !== '\\') inStr = false;
    continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
  if (c === '/' && n === '/') { while (i < x.length && x[i] !== '\n') i++; continue; }
  if (c === '/' && n === '*') { i+=2; while (i < x.length && !(x[i]==='*' && x[i+1]==='/')) i++; i++; continue; }
  if (c === '{' && n !== '{') { d++; }
  if (c === '}' && p !== '}') { d--; }
}
lineDepths.push({ line: lineNum, depth: d });

// Show lines where depth changes significantly
function showAround(lines, targetLine) {
  for (let i = Math.max(0, targetLine-3); i < Math.min(lines.length, targetLine+3); i++) {
    const l = lines[i];
    if (!l) continue;
    const prefix = l.line === targetLine ? '>>>' : '   ';
    console.log(prefix, `L${l.line}: depth ${l.depth}`);
  }
}

for (const ld of lineDepths) {
  if (ld.depth > 0 && ld.line > 38) {
    console.log(`L${ld.line}: depth ${ld.depth}`);
  }
}
