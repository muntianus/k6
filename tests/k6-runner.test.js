import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  extractK6Telemetry,
  buildLaunchGateEvaluation,
  executeSyntheticBenchmark,
  K6RunRegistry,
} from '../src/run-engine.js';
import { createServer, parseAllowedHosts } from '../src/server.js';

test('extractK6Telemetry: parses standard k6 --summary-export metrics', () => {
  const sampleSummary = {
    metrics: {
      http_req_duration: {
        values: {
          avg: 112.4,
          med: 98.2,
          'p(50)': 98.2,
          'p(90)': 180.5,
          'p(95)': 220.75,
          'p(99)': 340.1,
        },
      },
      http_reqs: {
        values: {
          count: 1200,
          rate: 40.0,
        },
      },
      http_req_failed: {
        values: {
          rate: 0.0025,
        },
      },
    },
  };

  const telemetry = extractK6Telemetry(sampleSummary);
  assert.equal(telemetry.p50, 98.2);
  assert.equal(telemetry.p90, 180.5);
  assert.equal(telemetry.p95, 220.75);
  assert.equal(telemetry.p99, 340.1);
  assert.equal(telemetry.rps, 40);
  assert.equal(telemetry.error_rate, 0.0025);
  assert.equal(telemetry.total_requests, 1200);
});

test('buildLaunchGateEvaluation: produces PASS/ALLOW and FAIL/BLOCK verdicts accurately', () => {
  const healthy = buildLaunchGateEvaluation({
    service: 'api.globlex.pro',
    environment: 'production',
    scenario: 'globlex-enterprise-slo',
    telemetry: {
      p50: 45,
      p90: 110,
      p95: 165,
      p99: 290,
      avg: 58,
      rps: 55.2,
      error_rate: 0,
      total_requests: 500,
    },
  });

  assert.equal(healthy.sloPassed, true);
  assert.equal(healthy.badge, 'PASS');
  assert.equal(healthy.launchGateRequest.gateVerdict, 'ALLOW');
  assert.equal(healthy.violations.length, 0);

  const degraded = buildLaunchGateEvaluation({
    service: 'api.globlex.pro',
    environment: 'staging',
    scenario: 'stress',
    telemetry: {
      p50: 250,
      p90: 520,
      p95: 680,
      p99: 1200,
      avg: 310,
      rps: 18.4,
      error_rate: 0.035,
      total_requests: 350,
    },
  });

  assert.equal(degraded.sloPassed, false);
  assert.equal(degraded.badge, 'FAIL');
  assert.equal(degraded.launchGateRequest.gateVerdict, 'BLOCK');
  assert.equal(degraded.violations.length, 3);
});

test('executeSyntheticBenchmark: runs concurrent HTTP probes and emits k6-compatible summary', async () => {
  const targetServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });
  await new Promise((resolve) => targetServer.listen(0, '127.0.0.1', resolve));
  const targetPort = targetServer.address().port;

  try {
    const result = await executeSyntheticBenchmark({
      targetUrl: `http://127.0.0.1:${targetPort}/health`,
      iterations: 6,
      concurrency: 2,
    });

    assert.equal(result.iterations, 6);
    assert.equal(result.k6Summary.metrics.http_reqs.values.count, 6);
    assert.equal(result.k6Summary.metrics.http_req_failed.values.rate, 0);
    assert.ok(result.k6Summary.metrics.http_req_duration.values['p(95)'] >= 0);
  } finally {
    await new Promise((resolve) => targetServer.close(resolve));
  }
});

test('src/server.js: HTTP API /health, /api/v1/runs/ingest, /api/v1/runs, and /api/v1/runs/synthetic-benchmark', async () => {
  const mockTarget = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => mockTarget.listen(0, '127.0.0.1', resolve));
  const mockTargetUrl = `http://127.0.0.1:${mockTarget.address().port}/health`;

  const registry = new K6RunRegistry();
  const server = createServer({ registry, allowedHosts: ['127.0.0.1'] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.deepEqual(healthBody, {
      status: 'ok',
      service: 'perfops-k6-runner',
      version: '1.0.0',
    });

    // 2. POST /api/v1/runs/ingest
    const ingestRes = await fetch(`${baseUrl}/api/v1/runs/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'api.globlex.pro',
        environment: 'production',
        scenario: 'globlex-enterprise-slo',
        summary: {
          metrics: {
            http_req_duration: {
              values: { 'p(50)': 42.1, 'p(90)': 88.4, 'p(95)': 120.5, 'p(99)': 210.0 },
            },
            http_reqs: { values: { count: 400, rate: 35.5 } },
            http_req_failed: { values: { rate: 0 } },
          },
        },
      }),
    });
    assert.equal(ingestRes.status, 201);
    const ingested = await ingestRes.json();
    assert.equal(ingested.badge, 'PASS');
    assert.equal(ingested.telemetry.p95, 120.5);
    assert.equal(ingested.launchGateRequest.gateVerdict, 'ALLOW');

    // 3. POST /api/v1/runs/synthetic-benchmark
    const benchRes = await fetch(`${baseUrl}/api/v1/runs/synthetic-benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: mockTargetUrl,
        service: 'globlex-health-probe',
        iterations: 4,
        concurrency: 2,
      }),
    });
    assert.equal(benchRes.status, 200);
    const benchData = await benchRes.json();
    assert.equal(benchData.status, 'completed');
    assert.equal(benchData.iterations, 4);
    assert.equal(benchData.runRecord.badge, 'PASS');

    // 4. GET /api/v1/runs
    const listRes = await fetch(`${baseUrl}/api/v1/runs`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.count, 2);
    assert.equal(listData.runs[0].service, 'globlex-health-probe');
    assert.equal(listData.runs[1].service, 'api.globlex.pro');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => mockTarget.close(resolve));
  }
});


test('SLO gate fails closed on missing or invalid metrics', () => {
  const incomplete = buildLaunchGateEvaluation({ telemetry: { p95: 1, p99: 2 } });
  assert.equal(incomplete.sloPassed, false);
  assert.equal(incomplete.launchGateRequest.gateVerdict, 'BLOCK');
  assert.ok(incomplete.violations.some((v) => v.includes('rps')));

  const invalid = buildLaunchGateEvaluation({
    telemetry: { p50: 1, p90: 1, p95: NaN, p99: 1, rps: 1, error_rate: 0, total_requests: 10 },
  });
  assert.equal(invalid.badge, 'FAIL');
  assert.ok(invalid.violations.some((v) => v.includes('p95')));
});

test('SLO gate applies configured min_rps threshold', () => {
  const lowThroughput = buildLaunchGateEvaluation({
    telemetry: { p50: 1, p90: 1, p95: 1, p99: 1, rps: 0.1, error_rate: 0, total_requests: 5 },
    thresholds: { min_rps: 1 },
  });
  assert.equal(lowThroughput.badge, 'FAIL');
  assert.match(lowThroughput.violations.join(' '), /minimum 1/);
});

test('synthetic benchmark refuses targets outside the host allowlist (SSRF guard)', async () => {
  let hits = 0;
  const internal = http.createServer((req, res) => {
    hits += 1;
    res.end('secret');
  });
  await new Promise((resolve) => internal.listen(0, '127.0.0.1', resolve));
  const server = createServer({ registry: new K6RunRegistry() });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const post = (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/v1/runs/synthetic-benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    for (const targetUrl of [
      `http://127.0.0.1:${internal.address().port}/`,
      'http://169.254.169.254/latest/meta-data/',
      'http://localhost:8090/api/collections',
      'https://evil.example/',
    ]) {
      const res = await post({ targetUrl, iterations: 1 });
      assert.equal(res.status, 403, targetUrl);
      assert.match((await res.json()).error, /not allowed/);
    }
    for (const targetUrl of ['file:///etc/passwd', 'not a url', 'gopher://api.globlex.pro/']) {
      assert.equal((await post({ targetUrl })).status, 400, targetUrl);
    }
    assert.equal(hits, 0, 'no request may reach a refused target');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => internal.close(resolve));
  }
});

test('parseAllowedHosts: env list overrides the default portfolio hosts', () => {
  assert.ok(parseAllowedHosts('').includes('api.globlex.pro'));
  assert.deepEqual(parseAllowedHosts(' Staging.Example.com , ,api.test '), ['staging.example.com', 'api.test']);
});
