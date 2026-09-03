// Certification gates differ by process: a mock call, a client certification round,
// a cumulative sales target, an email audit score, a daily error rate. Each rule owns
// a list of criteria and this module decides, for one trainee, whether each is met.
//
// Every function here is pure — no database, no request — so the arithmetic that
// decides whether a person is certifiable can be tested directly.

export const MEASURES = ['single', 'daily_average', 'cumulative', 'completion'];
export const DIRECTIONS = ['at_least', 'at_most'];
export const UNITS = ['percent', 'number', 'currency'];

// Evidence rows carry the criterion key in evidence_type. A daily criterion appends
// the day as "<key>#<day>". "pq_dayN" is the pre-criteria spelling and still parses.
export function parseEvidenceType(evidenceType) {
  const raw = String(evidenceType || '').trim();
  if (!raw) return null;
  const legacyPq = /^pq_day(\d{1,2})$/.exec(raw);
  if (legacyPq) return { key: 'pq', day: Number(legacyPq[1]) };
  const hashed = /^(.+)#(\d{1,2})$/.exec(raw);
  if (hashed) return { key: hashed[1], day: Number(hashed[2]) };
  return { key: raw, day: null };
}

export function buildEvidenceType(criterionKey, day = null) {
  const key = String(criterionKey || '').trim();
  return day ? `${key}#${day}` : key;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function meetsTarget(value, criterion) {
  if (value === null) return false;
  const target = Number(criterion.targetValue || 0);
  return criterion.direction === 'at_most' ? value <= target : value >= target;
}

function newest(a, b) {
  const at = new Date(a?.conductedAt || a?.createdAt || 0).getTime();
  const bt = new Date(b?.conductedAt || b?.createdAt || 0).getTime();
  return at >= bt ? a : b;
}

function rowsFor(criterion, evidence) {
  return (evidence || []).filter(row => parseEvidenceType(row.evidenceType)?.key === criterion.criterionKey);
}

export function formatValue(value, unit) {
  if (value === null || value === undefined) return '—';
  const rounded = Math.round(Number(value) * 100) / 100;
  if (unit === 'currency') return `₹${rounded.toLocaleString('en-IN')}`;
  if (unit === 'percent') return `${rounded}%`;
  return String(rounded);
}

// Returns the same shape for every measure so callers never branch on the type.
export function evaluateCriterion(criterion, evidence) {
  const rows = rowsFor(criterion, evidence);
  const base = {
    criterionKey: criterion.criterionKey,
    label: criterion.label,
    measure: criterion.measure,
    direction: criterion.direction,
    unit: criterion.unit,
    target: Number(criterion.targetValue || 0),
    days: Number(criterion.days || 0),
    blocks: Boolean(criterion.blocks),
    entries: rows.length,
    days_recorded: [],
    value: null,
    met: false,
  };

  if (criterion.measure === 'completion') {
    // No number to compare: the gate is cleared once a passing entry exists.
    const done = rows.some(row => String(row.result || '').toLowerCase() === 'pass');
    return { ...base, value: done ? 1 : 0, met: done };
  }

  if (criterion.measure === 'daily_average') {
    const perDay = new Map();
    const configuredDays = Math.max(1, Number(criterion.days || 1));
    for (const row of rows) {
      const day = parseEvidenceType(row.evidenceType)?.day;
      if (!day || day > configuredDays) continue;
      // A day scored again supersedes the earlier attempt rather than averaging both.
      perDay.set(day, perDay.has(day) ? newest(perDay.get(day), row) : row);
    }
    const recorded = [...perDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, row]) => ({ day, value: numeric(row.scorePct) ?? 0 }));
    const average = recorded.length
      ? recorded.reduce((sum, row) => sum + row.value, 0) / recorded.length
      : null;
    const rounded = average === null ? null : Math.round(average * 100) / 100;
    return {
      ...base,
      days: configuredDays,
      days_recorded: recorded,
      entries: recorded.length,
      value: rounded,
      met: meetsTarget(rounded, criterion),
    };
  }

  if (criterion.measure === 'cumulative') {
    // Entries add up: several sales logged across the week reaching one target.
    if (!rows.length) return base;
    const total = rows.reduce((sum, row) => sum + (numeric(row.scorePct) ?? 0), 0);
    const rounded = Math.round(total * 100) / 100;
    return { ...base, value: rounded, met: meetsTarget(rounded, criterion) };
  }

  // single: the most recent entry stands, so a re-test replaces a failed attempt.
  if (!rows.length) return base;
  const latest = rows.reduce(newest);
  const value = numeric(latest.scorePct);
  const rounded = value === null ? null : Math.round(value * 100) / 100;
  return { ...base, value: rounded, met: meetsTarget(rounded, criterion) };
}

export function describeShortfall(result) {
  if (result.measure === 'completion') return `${result.label} is not marked complete`;
  if (!result.entries) {
    return result.measure === 'daily_average'
      ? `No ${result.label} recorded yet (${result.direction === 'at_most' ? 'max' : 'min'} ${formatValue(result.target, result.unit)} across ${result.days} days)`
      : `No ${result.label} recorded yet (${result.direction === 'at_most' ? 'max' : 'min'} ${formatValue(result.target, result.unit)})`;
  }
  const comparison = result.direction === 'at_most' ? 'exceeds the limit of' : 'is below';
  const scope = result.measure === 'daily_average'
    ? ` across ${result.entries} day${result.entries === 1 ? '' : 's'}`
    : (result.measure === 'cumulative' ? ` from ${result.entries} entr${result.entries === 1 ? 'y' : 'ies'}` : '');
  return `${result.label} ${formatValue(result.value, result.unit)}${scope} ${comparison} ${formatValue(result.target, result.unit)}`;
}

export function evaluateCriteria(criteria, evidence) {
  const active = (criteria || []).filter(item => item.active !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const results = active.map(criterion => evaluateCriterion(criterion, evidence));
  // Only a blocking criterion can stop certification; the rest are recorded for visibility.
  const blockers = results.filter(result => result.blocks && !result.met).map(describeShortfall);
  return { results, blockers };
}
