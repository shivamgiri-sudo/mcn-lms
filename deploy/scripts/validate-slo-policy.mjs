import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const policyPath = resolve(process.cwd(), process.argv[2] || 'deploy/slo-policy.json');
const errors = [];
const add = message => errors.push(message);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const between = (value, min, max, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    add(`${name} must be between ${min} and ${max}.`);
  }
};

let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, 'utf8'));
} catch (error) {
  console.error(`[SLO] Cannot read valid policy JSON at ${policyPath}: ${error.message}`);
  process.exit(64);
}

if (!isObject(policy)) add('Policy root must be an object.');
if (!Number.isInteger(policy.version) || policy.version < 1) add('version must be a positive integer.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.effectiveDate || '') || !Number.isFinite(Date.parse(`${policy.effectiveDate}T00:00:00Z`))) {
  add('effectiveDate must be a valid YYYY-MM-DD date.');
}
if (typeof policy.service !== 'string' || policy.service.trim().length < 3) add('service is required.');
between(policy.measurementWindowDays, 7, 90, 'measurementWindowDays');

if (!isObject(policy.objectives)) {
  add('objectives must be an object.');
} else {
  between(policy.objectives.availabilityPct, 99, 100, 'objectives.availabilityPct');
  between(policy.objectives.readinessPct, 99, 100, 'objectives.readinessPct');
  if (policy.objectives.readinessPct < policy.objectives.availabilityPct) add('readinessPct must not be lower than availabilityPct.');
  between(policy.objectives.maximumErrorRatePct, 0, 5, 'objectives.maximumErrorRatePct');
  between(policy.objectives.maximumP95LatencyMs, 50, 5000, 'objectives.maximumP95LatencyMs');
  between(policy.objectives.maximumP99LatencyMs, 100, 10000, 'objectives.maximumP99LatencyMs');
  if (policy.objectives.maximumP99LatencyMs < policy.objectives.maximumP95LatencyMs) add('maximumP99LatencyMs must be at least maximumP95LatencyMs.');
  between(policy.objectives.maximumNotificationBacklog, 0, 100000, 'objectives.maximumNotificationBacklog');
  between(policy.objectives.minimumHealthyWebInstances, 1, 100, 'objectives.minimumHealthyWebInstances');
  between(policy.objectives.minimumHealthyWorkerInstances, 1, 100, 'objectives.minimumHealthyWorkerInstances');
}

if (!isObject(policy.recovery)) {
  add('recovery must be an object.');
} else {
  between(policy.recovery.rtoMinutes, 1, 1440, 'recovery.rtoMinutes');
  between(policy.recovery.rpoMinutes, 1, 1440, 'recovery.rpoMinutes');
  between(policy.recovery.backupSuccessPct, 99, 100, 'recovery.backupSuccessPct');
  between(policy.recovery.restoreDrillFrequencyDays, 1, 90, 'recovery.restoreDrillFrequencyDays');
  between(policy.recovery.backupRetentionDays, policy.recovery.restoreDrillFrequencyDays || 1, 365, 'recovery.backupRetentionDays');
}

if (!isObject(policy.endpoints)) {
  add('endpoints must be an object.');
} else {
  if (policy.endpoints.liveness !== '/api/runtime/health/live') add('Unexpected liveness endpoint.');
  if (policy.endpoints.readiness !== '/api/runtime/health/ready') add('Unexpected readiness endpoint.');
}

if (!Array.isArray(policy.burnRateAlerts) || policy.burnRateAlerts.length < 2) {
  add('At least two burnRateAlerts are required.');
} else {
  const names = new Set();
  policy.burnRateAlerts.forEach((alert, index) => {
    if (!isObject(alert)) {
      add(`burnRateAlerts[${index}] must be an object.`);
      return;
    }
    if (typeof alert.name !== 'string' || !alert.name) add(`burnRateAlerts[${index}].name is required.`);
    if (names.has(alert.name)) add(`Duplicate burn-rate alert name: ${alert.name}.`);
    names.add(alert.name);
    between(alert.shortWindowMinutes, 1, 10080, `burnRateAlerts[${index}].shortWindowMinutes`);
    between(alert.longWindowMinutes, 1, 43200, `burnRateAlerts[${index}].longWindowMinutes`);
    if (alert.longWindowMinutes <= alert.shortWindowMinutes) add(`burnRateAlerts[${index}] long window must exceed short window.`);
    between(alert.multiplier, 1, 100, `burnRateAlerts[${index}].multiplier`);
    if (!['critical', 'high', 'moderate', 'low'].includes(alert.severity)) add(`burnRateAlerts[${index}].severity is invalid.`);
  });
}

const requiredGates = [
  'requireReadiness',
  'requireSmoke',
  'requireBoundedLoad',
  'requireBackup',
  'requireRestoreEvidence',
  'requireHealthyWorker',
  'requireApprovedManifest',
];
if (!isObject(policy.releaseGates)) {
  add('releaseGates must be an object.');
} else {
  for (const gate of requiredGates) {
    if (policy.releaseGates[gate] !== true) add(`releaseGates.${gate} must be true.`);
  }
}

if (errors.length) {
  errors.forEach(error => console.error(`[SLO] ${error}`));
  process.exit(1);
}

console.log(`[SLO] Policy valid: ${policy.service}, ${policy.objectives.availabilityPct}% availability, RTO ${policy.recovery.rtoMinutes}m, RPO ${policy.recovery.rpoMinutes}m.`);
