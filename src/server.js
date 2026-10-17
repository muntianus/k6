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
 * Creates the PerfOps k6 Telemetry Collector, Run Registry & LaunchGate Bridge HTTP server.
 * @param {{ registry?: K6RunRegistry, fetchImpl?: typeof globalThis.fetch }} [deps]
 * @returns {import('node:http').Server}
 */
export function createServer(deps = {}) {
  const registry = deps.registry || new K6RunRegistry();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'perfops-k6-runner',
        version: '1.0.0',
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/runs') {
      const service = url.searchParams.get('service') || undefined;
      const badge = url.searchParams.get('badge') || undefined;
      const runs = registry.list({ service, badge });
      return sendJson(res, 200, {
        count: runs.length,
        runs,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/runs/ingest') {
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

    if (req.method === 'POST' && url.pathname === '/api/v1/runs/synthetic-benchmark') {
      try {
        const body = await readJsonBody(req);
        const bench = await executeSyntheticBenchmark({
          targetUrl: body.targetUrl || 'https://api.globlex.pro/health',
          iterations: body.iterations ?? 5,
          concurrency: body.concurrency ?? 2,
          timeoutMs: body.timeoutMs ?? 4000,
          headers: body.headers,
          fetchImpl: deps.fetchImpl,
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
