import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildLaunchGateEvaluation } from './slo-evaluator.js';
export { DEFAULT_SLO_THRESHOLDS, buildLaunchGateEvaluation } from './slo-evaluator.js';

function roundMetric(val, decimals = 2) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

function computePercentile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1)
  );
  return roundMetric(sortedValues[idx], 2);
}

/**
 * Extracts normalized telemetry metrics (`p50`, `p90`, `p95`, `p99`, `rps`, `error_rate`)
 * from a k6 `--summary-export` JSON payload.
 *
 * Supports both classic k6 summary export (`metrics.http_req_duration.values` or direct keys)
 * and simplified summary objects.
 *
 * @param {object} summaryPayload
 * @returns {{
 *   p50: number,
 *   p90: number,
 *   p95: number,
 *   p99: number,
 *   avg: number,
 *   rps: number,
 *   error_rate: number,
 *   total_requests: number
 * }}
 */
export function extractK6Telemetry(summaryPayload = {}) {
  const metrics = summaryPayload?.metrics || summaryPayload || {};

  const durationRaw = metrics.http_req_duration?.values || metrics.http_req_duration || {};
  const reqsRaw = metrics.http_reqs?.values || metrics.http_reqs || {};
  const failedRaw = metrics.http_req_failed?.values || metrics.http_req_failed || {};

  const p50 = roundMetric(
    durationRaw['p(50)'] ?? durationRaw.med ?? durationRaw.p50 ?? summaryPayload.p50 ?? 0
  );
  const p90 = roundMetric(
    durationRaw['p(90)'] ?? durationRaw.p90 ?? summaryPayload.p90 ?? 0
  );
  const p95 = roundMetric(
    durationRaw['p(95)'] ?? durationRaw.p95 ?? summaryPayload.p95 ?? 0
  );
  const p99 = roundMetric(
    durationRaw['p(99)'] ??
      durationRaw.p99 ??
      summaryPayload.p99 ??
      (durationRaw.max !== undefined ? durationRaw.max : p95 * 1.25)
  );
  const avg = roundMetric(durationRaw.avg ?? summaryPayload.avg ?? p50);

  const rps = roundMetric(reqsRaw.rate ?? summaryPayload.rps ?? 0);
  const totalRequests = Math.round(Number(reqsRaw.count ?? summaryPayload.total_requests ?? 0));

  // In k6 summary-export, http_req_failed.rate (or .value) represents failure ratio [0..1]
  const rawErrorRate =
    failedRaw.rate ??
    failedRaw.value ??
    failedRaw.fails_rate ??
    summaryPayload.error_rate ??
    0;
  const errorRate = roundMetric(rawErrorRate, 4);

  return {
    p50,
    p90,
    p95,
    p99,
    avg,
    rps,
    error_rate: errorRate,
    total_requests: totalRequests,
  };
}

/**
 * Executes a lightweight synthetic HTTP benchmark against a target URL and returns a k6-compatible
 * `--summary-export` JSON structure plus extracted telemetry.
 *
 * @param {object} [options]
 * @param {string} [options.targetUrl='https://api.globlex.pro/health']
 * @param {number} [options.iterations=5]
 * @param {number} [options.concurrency=2]
 * @param {number} [options.timeoutMs=4000]
 * @param {typeof globalThis.fetch} [options.fetchImpl=globalThis.fetch]
 */
export async function executeSyntheticBenchmark(options = {}) {
  const targetUrl = options.targetUrl || 'https://api.globlex.pro/health';
  const iterations = Math.min(50, Math.max(1, Number(options.iterations ?? 5)));
  const concurrency = Math.min(iterations, Math.max(1, Number(options.concurrency ?? 2)));
  const timeoutMs = Math.max(250, Number(options.timeoutMs ?? 4000));
  const fetchFn = options.fetchImpl || globalThis.fetch;

  const durations = [];
  let failures = 0;
  let completed = 0;

  const startedAt = performance.now();

  async function worker() {
    while (completed < iterations) {
      const currentIdx = completed;
      completed += 1;
      if (currentIdx >= iterations) break;

      const reqStart = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetchFn(targetUrl, {
          method: options.method || 'GET',
          headers: {
            'User-Agent': 'perfops-k6-synthetic-runner/1.0.0',
            ...(options.headers || {}),
          },
          signal: controller.signal,
        });
        const elapsed = performance.now() - reqStart;
        durations.push(elapsed);
        if (!res || res.status >= 400) {
          failures += 1;
        }
      } catch {
        const elapsed = performance.now() - reqStart;
        durations.push(elapsed);
        failures += 1;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const totalElapsedSec = Math.max(0.001, (performance.now() - startedAt) / 1000);
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  const min = sorted.length ? roundMetric(sorted[0]) : 0;
  const max = sorted.length ? roundMetric(sorted[sorted.length - 1]) : 0;
  const avg = sorted.length ? roundMetric(sum / sorted.length) : 0;
  const p50 = computePercentile(sorted, 50);
  const p90 = computePercentile(sorted, 90);
  const p95 = computePercentile(sorted, 95);
  const p99 = computePercentile(sorted, 99);
  const rps = roundMetric(sorted.length / totalElapsedSec, 2);
  const errorRate = sorted.length ? roundMetric(failures / sorted.length, 4) : 0;

  const k6Summary = {
    root_group: {
      name: 'synthetic-benchmark',
      path: '::synthetic-benchmark',
      checks: {
        'status 200': {
          name: 'status 200',
          passes: sorted.length - failures,
          fails: failures,
        },
      },
    },
    metrics: {
      http_req_duration: {
        type: 'trend',
        contains: 'time',
        values: {
          avg,
          min,
          med: p50,
          max,
          'p(50)': p50,
          'p(90)': p90,
          'p(95)': p95,
          'p(99)': p99,
        },
      },
      http_reqs: {
        type: 'counter',
        contains: 'default',
        values: {
          count: sorted.length,
          rate: rps,
        },
      },
      http_req_failed: {
        type: 'rate',
        contains: 'default',
        values: {
          rate: errorRate,
          passes: failures,
          fails: sorted.length - failures,
        },
      },
    },
  };

  return {
    targetUrl,
    iterations: sorted.length,
    concurrency,
    k6Summary,
  };
}

/**
 * In-memory Run Registry for k6 telemetry ingestion and historical queries.
 */
export class K6RunRegistry {
  constructor(maxRuns = 200) {
    this.maxRuns = maxRuns;
    this.runs = [];
  }

  /**
   * Ingests a k6 summary payload, computes telemetry & LaunchGate verdict, and stores the record.
   * @param {object} payload
   */
  ingest(payload = {}) {
    const summarySource = payload.summary || payload.k6Summary || payload;
    const telemetry = extractK6Telemetry(summarySource);
    const service = payload.service || 'globlex-api';
    const environment = payload.environment || 'production';
    const scenario = payload.scenario || 'globlex-enterprise-slo';

    const evaluation = buildLaunchGateEvaluation({
      service,
      environment,
      scenario,
      telemetry,
      thresholds: payload.thresholds,
    });

    const record = {
      runId: payload.runId || `run_${crypto.randomUUID().slice(0, 8)}`,
      timestamp: payload.timestamp || new Date().toISOString(),
      service,
      environment,
      scenario,
      badge: evaluation.badge,
      sloPassed: evaluation.sloPassed,
      telemetry,
      violations: evaluation.violations,
      launchGateRequest: evaluation.launchGateRequest,
    };

    this.runs.unshift(record);
    if (this.runs.length > this.maxRuns) {
      this.runs.length = this.maxRuns;
    }

    return record;
  }

  /**
   * Lists stored runs with optional service or badge filtering.
   * @param {{ service?: string, badge?: string }} [filter]
   */
  list(filter = {}) {
    return this.runs.filter((r) => {
      if (filter.service && r.service !== filter.service) return false;
      if (filter.badge && r.badge !== filter.badge.toUpperCase()) return false;
      return true;
    });
  }
}
