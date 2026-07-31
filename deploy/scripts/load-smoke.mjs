import { performance } from 'node:perf_hooks';

const baseUrl = String(process.env.BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const concurrency = Math.max(1, Math.min(200, Number.parseInt(process.env.LOAD_CONCURRENCY || '25', 10) || 25));
const requestCount = Math.max(concurrency, Math.min(20000, Number.parseInt(process.env.LOAD_REQUESTS || '500', 10) || 500));
const p95LimitMs = Math.max(50, Number.parseInt(process.env.LOAD_P95_LIMIT_MS || '1500', 10) || 1500);
const maximumErrorPct = Math.max(0, Number.parseFloat(process.env.LOAD_MAX_ERROR_PCT || '1') || 0);
const requestTimeoutMs = Math.max(500, Number.parseInt(process.env.LOAD_REQUEST_TIMEOUT_MS || '5000', 10) || 5000);
const endpoints = ['/api/runtime/health/live', '/api/runtime/health/ready', '/'];

const durations = [];
const failures = [];
let cursor = 0;

async function runRequest(index) {
  const endpoint = endpoints[index % endpoints.length];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      signal: controller.signal,
      headers: { 'X-Request-Id': `rc-load-${process.pid}-${index}` },
    });
    const elapsed = performance.now() - started;
    durations.push(elapsed);
    if (!response.ok) failures.push({ index, endpoint, status: response.status });
    await response.arrayBuffer();
  } catch (error) {
    durations.push(performance.now() - started);
    failures.push({ index, endpoint, error: error?.message || String(error) });
  } finally {
    clearTimeout(timer);
  }
}

async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= requestCount) return;
    await runRequest(index);
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const totalDurationMs = performance.now() - startedAt;
const sorted = [...durations].sort((a, b) => a - b);
const percentile = value => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1))] || 0;
const errorPct = requestCount ? failures.length / requestCount * 100 : 100;
const report = {
  baseUrl,
  concurrency,
  requests: requestCount,
  failures: failures.length,
  errorPct: Number(errorPct.toFixed(3)),
  p50Ms: Number(percentile(0.5).toFixed(1)),
  p95Ms: Number(percentile(0.95).toFixed(1)),
  p99Ms: Number(percentile(0.99).toFixed(1)),
  throughputPerSecond: Number((requestCount / (totalDurationMs / 1000)).toFixed(1)),
  totalDurationMs: Number(totalDurationMs.toFixed(1)),
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) console.error(JSON.stringify(failures.slice(0, 20), null, 2));

if (errorPct > maximumErrorPct) {
  console.error(`[LOAD] Error rate ${errorPct.toFixed(3)}% exceeds ${maximumErrorPct}%.`);
  process.exit(1);
}
if (report.p95Ms > p95LimitMs) {
  console.error(`[LOAD] p95 ${report.p95Ms}ms exceeds ${p95LimitMs}ms.`);
  process.exit(1);
}
console.log('[LOAD] Release candidate load smoke passed.');
