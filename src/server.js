import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { K6RunRegistry, executeSyntheticBenchmark } from './run-engine.js';

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 }));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Hosts the unauthenticated benchmark endpoint may send traffic to. Anything else
 * (internal addresses, metadata endpoints, other sites) is refused, so the
 * endpoint cannot be used as an SSRF / port-scanning proxy. Override with
 * K6_BENCHMARK_ALLOWED_HOSTS (comma-separated hostnames, exact match).
 */
export const DEFAULT_BENCHMARK_HOSTS = [
  'api.globlex.pro',
  'globlex.pro',
  'globlex.shop',
  'globlex.online',
  'perfops.tech',
  'app.perfops.tech',
  'perfops.shop',
  'aco.perfops.shop',
  'perfops.ai',
];

export function parseAllowedHosts(raw) {
  const hosts = String(raw || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length ? hosts : DEFAULT_BENCHMARK_HOSTS;
}

function assertBenchmarkTarget(rawUrl, allowedHosts) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    target = null;
  }
  if (!target || (target.protocol !== 'http:' && target.protocol !== 'https:')) {
    throw Object.assign(new Error('targetUrl must be an absolute http(s) URL'), { statusCode: 400 });
  }
  if (!allowedHosts.includes(target.hostname.toLowerCase())) {
    throw Object.assign(
      new Error(`targetUrl host ${target.hostname} is not allowed (K6_BENCHMARK_ALLOWED_HOSTS)`),
      { statusCode: 403 },
    );
  }
}

function health(req, res) {
  return sendJson(res, 200, {
    status: 'ok',
    service: 'perfops-k6-runner',
    version: '1.0.0',
  });
}

function listRuns(req, res, url, { registry }) {
  const service = url.searchParams.get('service') || undefined;
  const badge = url.searchParams.get('badge') || undefined;
  const runs = registry.list({ service, badge });
  return sendJson(res, 200, {
    count: runs.length,
    runs,
  });
}

async function ingestRun(req, res, url, { registry }) {
  try {
    const body = await readJsonBody(req);
    const record = registry.ingest(body);
    return sendJson(res, 201, record);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, {
      error: err.message || 'Failed to ingest k6 run summary',
    });
  }
}

async function syntheticBenchmark(req, res, url, { registry, fetchImpl, allowedHosts }) {
  try {
    const body = await readJsonBody(req);
    const targetUrl = body.targetUrl || 'https://api.globlex.pro/health';
    assertBenchmarkTarget(targetUrl, allowedHosts);
    const bench = await executeSyntheticBenchmark({
      targetUrl,
      iterations: body.iterations ?? 5,
      concurrency: body.concurrency ?? 2,
      timeoutMs: body.timeoutMs ?? 4000,
      headers: body.headers,
      fetchImpl,
    });

    const record = registry.ingest({
      service: body.service || 'globlex-api',
      environment: body.environment || 'production',
      scenario: body.scenario || `synthetic:${bench.targetUrl}`,
      thresholds: body.thresholds,
      summary: bench.k6Summary,
    });

    return sendJson(res, 200, {
      status: 'completed',
      targetUrl: bench.targetUrl,
      iterations: bench.iterations,
      concurrency: bench.concurrency,
      k6Summary: bench.k6Summary,
      runRecord: record,
    });
  } catch (err) {
    return sendJson(res, err.statusCode || 500, {
      error: err.message || 'Synthetic benchmark failed',
    });
  }
}

/**
 * Every route the service answers. Handlers get `(req, res, url, ctx)` where
 * ctx = { registry, fetchImpl, allowedHosts }. tests/openapi-contract.test.js keeps this
 * table and docs/api/openapi.json in lockstep.
 */
export const ROUTES = [
  { method: 'GET', path: '/health', handler: health },
  { method: 'GET', path: '/api/v1/runs', handler: listRuns },
  { method: 'POST', path: '/api/v1/runs/ingest', handler: ingestRun },
  { method: 'POST', path: '/api/v1/runs/synthetic-benchmark', handler: syntheticBenchmark },
];

/**
 * Creates the PerfOps k6 Telemetry Collector, Run Registry & LaunchGate Bridge HTTP server.
 * @param {{ registry?: K6RunRegistry, fetchImpl?: typeof globalThis.fetch, allowedHosts?: string[] }} [deps]
 * @returns {import('node:http').Server}
 */
export function createServer(deps = {}) {
  const ctx = {
    registry: deps.registry || new K6RunRegistry(),
    fetchImpl: deps.fetchImpl,
    allowedHosts: deps.allowedHosts || parseAllowedHosts(process.env.K6_BENCHMARK_ALLOWED_HOSTS),
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const route = ROUTES.find((r) => r.method === req.method && r.path === url.pathname);
    if (route) {
      return route.handler(req, res, url, ctx);
    }
    return sendJson(res, 404, { error: 'Not Found', path: url.pathname });
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.PORT || 4041);
  const server = createServer();
  server.listen(port, () => {
    console.log(`[perfops-k6-runner] listening on http://0.0.0.0:${port}`);
  });
}
