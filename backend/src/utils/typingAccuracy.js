// Daily Typing Test — scoring engine.
//
// Compares what a trainee actually typed against the original paragraph using
// Levenshtein (edit-distance) alignment, character by character, rather than a
// naive same-index comparison. Same-index comparison has a well-known flaw: a
// single missed or extra keystroke shifts every character after it out of
// position, so the rest of an otherwise near-perfect paragraph gets marked wrong
// too. Levenshtein alignment finds the minimum-cost set of insertions, deletions
// and substitutions needed to turn the original into the typed text, so one slip
// only ever counts as one error.
//
// The alignment is case-sensitive and punctuation-sensitive by construction —
// every character position is compared literally — which is exactly how the
// spec wants capitalization errors and punctuation errors to count as mistakes
// without any special-casing.

/**
 * Character-level Levenshtein alignment between the original paragraph and the
 * trainee's typed text.
 *
 * Returns the full alignment as a sequence of ops:
 *   - 'match'      expected char === typed char
 *   - 'substitute' expected char, typed a different char (covers wrong letters,
 *                  wrong capitalization, wrong punctuation, spelling mistakes)
 *   - 'missing'    a character from the original that the trainee never typed
 *   - 'extra'      a character the trainee typed that isn't part of the original
 *                  at this position (extra keystrokes)
 *
 * plus the raw edit distance (substitutions + missing + extra combined).
 */
export function alignTypedText(original, typed) {
  const a = String(original ?? '');
  const b = String(typed ?? '');
  const n = a.length;
  const m = b.length;

  // dp[i][j] = edit distance between a[0..i) and b[0..j)
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      if (ai === b.charCodeAt(j - 1)) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        const del = dp[i - 1][j] + 1;     // char present in original, missing from typed
        const ins = dp[i][j - 1] + 1;     // char present in typed, extra vs original
        const sub = dp[i - 1][j - 1] + 1; // substitution
        dp[i][j] = Math.min(del, ins, sub);
      }
    }
  }

  // Backtrack from (n, m) to (0, 0) to recover the actual alignment.
  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
      ops.push({ type: 'match', expected: a[i - 1], typed: b[j - 1] });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ type: 'substitute', expected: a[i - 1], typed: b[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: 'missing', expected: a[i - 1], typed: null });
      i--;
    } else {
      ops.push({ type: 'extra', expected: null, typed: b[j - 1] });
      j--;
    }
  }
  ops.reverse();

  return { ops, editDistance: dp[n][m] };
}

const MAX_TYPED_LENGTH = 8000; // generous upper bound for a 5-minute test — defends the O(n*m) alignment against an oversized payload

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Scores one typing-test attempt.
 *
 * Formulas (deliberately matching the spec verbatim):
 *   Gross WPM = (Total Characters Typed / 5) / Time Taken (minutes)
 *   Net WPM   = Gross WPM * (Accuracy% / 100)
 *   Accuracy% = ((Total Expected Characters - Errors) / Total Expected Characters) * 100,
 *               clamped to [0, 100]
 *
 * "Total Expected Characters" is the length of the ORIGINAL paragraph — accuracy
 * measures how correctly the trainee reproduced the target text. "Errors" is the
 * Levenshtein edit distance (substitutions + missing + extra characters), which
 * is exactly the set of wrong/missing/extra characters, wrong words, spelling
 * mistakes, capitalization errors and punctuation errors the spec asks for — all
 * of those manifest as a 'substitute', 'missing' or 'extra' alignment op.
 */
export function scoreTypingAttempt({ original, typed, elapsedSeconds }) {
  const cleanOriginal = String(original ?? '');
  const cleanTyped = String(typed ?? '').slice(0, MAX_TYPED_LENGTH);

  const { ops, editDistance } = alignTypedText(cleanOriginal, cleanTyped);

  let correctChars = 0;
  for (const op of ops) if (op.type === 'match') correctChars++;
  const errors = editDistance;

  const totalCharsTyped = cleanTyped.length;
  const totalWordsTyped = cleanTyped.trim().length ? cleanTyped.trim().split(/\s+/).length : 0;

  const totalExpectedChars = cleanOriginal.length || 1;
  let accuracyPct = ((totalExpectedChars - errors) / totalExpectedChars) * 100;
  accuracyPct = Math.max(0, Math.min(100, accuracyPct));

  const minutes = Math.max(elapsedSeconds, 1) / 60;
  const grossWpm = (totalCharsTyped / 5) / minutes;
  const netWpm = grossWpm * (accuracyPct / 100);

  return {
    ops,
    totalChars: totalCharsTyped,
    correctChars,
    incorrectChars: errors,
    totalWords: totalWordsTyped,
    grossWpm: round1(grossWpm),
    netWpm: round1(netWpm),
    accuracyPct: round1(accuracyPct),
    errorCount: errors,
  };
}
