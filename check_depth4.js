const fs = require('fs');
const x = fs.readFileSync('frontend/src/pages/Admin/QuestionsTab.jsx', 'utf8');

// Track depth considering template literals properly
function computeDepth(src) {
  let d = 0;
  let inStr = false, strCh = '';
  let inTmplExpr = 0; // depth of template expressions
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i+1];
    const p = src[i-1];
    
    // If in template literal and we see `${`, that starts an expression
    if (inStr && strCh === '`' && c === '$' && n === '{') {
      inTmplExpr++;
      i += 2;
      continue;
    }
    
    if (inStr) {
      if (c === strCh && p !== '\\') {
        inStr = false;
        // If we were in a template expression, finish it
        if (inTmplExpr > 0 && strCh === '`') {
          inTmplExpr--;
        }
      }
      i++;
      continue;
    }
    
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; i++; continue; }
    if (c === '/' && n === '/') { i+=2; while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i+=2; while (i < src.length && !(src[i]==='*' && src[i+1]==='/')) i++; i+=2; continue; }
    
    // Skip JSX double braces {{ }}
    if (c === '{' && n === '{') { i+=2; continue; }
    if (c === '}' && p === '}') { i++; continue; }
    
    if (c === '{') { d++; i++; continue; }
    if (c === '}') { d--; i++; continue; }
    
    i++;
  }
  return d;
}

console.log('depth:', computeDepth(x));
