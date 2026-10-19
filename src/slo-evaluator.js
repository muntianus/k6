/**
 * Pure, transport-independent SLO evaluation for k6 run telemetry.
 *
 * Missing/non-finite telemetry must not silently produce an ALLOW verdict.
 */
export const DEFAULT_SLO_THRESHOLDS = Object.freeze({
  p95_ms: 450,
  p99_ms: 900,
  error_rate: 0.01,
  min_rps: 0.5,
});

const REQUIRED_METRICS = ['p50', 'p90', 'p95', 'p99', 'rps', 'error_rate', 'total_requests'];

export function buildLaunchGateEvaluation({
  service = 'globlex-api',
  environment = 'production',
  scenario = 'default',
  telemetry = {},
  thresholds = {},
} = {}) {
  const slo = { ...DEFAULT_SLO_THRESHOLDS, ...thresholds };
  const violations = [];

  for (const key of REQUIRED_METRICS) {
    if (!Number.isFinite(telemetry[key]) || telemetry[key] < 0) {
      violations.push(`Invalid or missing telemetry: ${key}`);
    }
  }

  for (const [key, value] of Object.entries(slo)) {
    if (!Number.isFinite(value) || value < 0) {
      violations.push(`Invalid SLO threshold: ${key}`);
    }
  }

  if (violations.length === 0) {
    if (telemetry.p95 > slo.p95_ms) {
      violations.push(`p95 latency ${telemetry.p95}ms exceeds threshold ${slo.p95_ms}ms`);
    }
    if (telemetry.p99 > slo.p99_ms) {
      violations.push(`p99 latency ${telemetry.p99}ms exceeds threshold ${slo.p99_ms}ms`);
    }
    if (telemetry.error_rate > slo.error_rate) {
      violations.push(`error_rate ${telemetry.error_rate} exceeds threshold ${slo.error_rate}`);
    }
    if (telemetry.rps < slo.min_rps) {
      violations.push(`rps ${telemetry.rps} is below minimum ${slo.min_rps}`);
    }
  }

  const passed = violations.length === 0;
  return {
    sloPassed: passed,
    badge: passed ? 'PASS' : 'FAIL',
    violations,
    launchGateRequest: {
      schemaVersion: 'launchgate.v1',
      service,
      environment,
      scenario,
      gateVerdict: passed ? 'ALLOW' : 'BLOCK',
      metrics: {
        latency_p50_ms: telemetry.p50,
        latency_p90_ms: telemetry.p90,
        latency_p95_ms: telemetry.p95,
        latency_p99_ms: telemetry.p99,
        rps: telemetry.rps,
        error_rate: telemetry.error_rate,
        total_requests: telemetry.total_requests,
      },
      thresholds: slo,
      violations,
    },
  };
}
