const fs = require('fs');
const x = fs.readFileSync('frontend/src/pages/Admin/QuestionsTab.jsx', 'utf8');
let d = 0;
for (let i = 0; i < x.length; i++) {
  const c = x[i];
  if (c === '{' && x[i+1] !== '{') d++;
  if (c === '}' && x[i-1] !== '}') d--;
}
console.log('depth:', d);
