const fs = require('fs');
const x = fs.readFileSync('frontend/src/pages/Admin/QuestionsTab.jsx', 'utf8');
let d = 0;
let inStr = false, strCh = '';
const lines = x.split('\n');
let cumulative = '';
for (let li = 0; li < lines.length; li++) {
  const line = lines[li];
  cumulative += line + '\n';
  // calculate depth at end of this line
  let ld = 0;
  let ls = false, lc = '';
  for (let i = 0; i < cumulative.length; i++) {
    const c = cumulative[i];
    if (ls) {
      if (c === lc && cumulative[i-1] !== '\\') ls = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { ls = true; lc = c; continue; }
    if (c === '/' && cumulative[i+1] === '/') { break; }
    if (c === '/' && cumulative[i+1] === '*') { i+=2; while (i < cumulative.length && !(cumulative[i]==='*' && cumulative[i+1]==='/')) i++; i++; continue; }
    if (c === '{' && cumulative[i+1] !== '{') ld++;
    if (c === '}' && cumulative[i-1] !== '}') ld--;
  }
  if (ld > 0) {
    const stripped = line.trim();
    if (stripped.length > 80) {
      console.log(`Line ${li+1}: depth ${ld} -- ${stripped.substring(0,80)}...`);
    } else {
      console.log(`Line ${li+1}: depth ${ld} -- ${stripped}`);
    }
  }
}
console.log('\nFinal depth:', d);
