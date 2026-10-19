# PerfOps k6 Telemetry Collector, Run Registry & LaunchGate Bridge (`k6`)

Telemetry ingestion, historical SLO run registry, synthetic HTTP benchmark engine, and **LaunchGate** (`launchgate-core`) evaluation bridge for k6 load tests across **PerfOps** and **Globex** (`api.globlex.pro`).

## Architecture & Modules

- `src/run-engine.js` — Extracts `p50`, `p90`, `p95`, `p99`, `rps`, and `error_rate` from k6 `--summary-export` JSON payloads, formats `launchgate.v1` gate evaluation requests (`ALLOW` / `BLOCK`), runs lightweight synthetic HTTP benchmarks, and maintains the in-memory `K6RunRegistry`.
- `src/server.js` — HTTP microservice (`PORT` default `4041`) exposing telemetry ingestion, run history with SLO `PASS`/`FAIL` badges, and on-demand synthetic benchmarking.
- `script.js` — Deterministic public-route smoke probe generated from
  `https://app.perfops.tech/endpoints/`. It verifies 19 externally reachable
  endpoints, including intended `401` and `302` responses.
- `tests/k6-runner.test.js` — Full automated test suite (`node --test`).

## Quick Start

```bash
# Run automated test suite
npm test

# Start the PerfOps k6 Runner & Telemetry Collector service (PORT=4041)
npm start

# Probe the public endpoint inventory once (one request per route)
npm run smoke
```

The script intentionally excludes the dashboard entries currently marked
`down` (`repos-kb/api/stats`, `api.globlex.pro/health`, and Grafana), as well
as the private loopback address. Update the target list only after the
endpoint inventory reports a new expected contract.

## HTTP API (`PORT=4041`)

- `GET /health` — Returns `{"status":"ok","service":"perfops-k6-runner","version":"1.0.0"}`.
- `POST /api/v1/runs/ingest` — Ingests a k6 `--summary-export` JSON payload, extracts `p50`, `p90`, `p95`, `p99`, `rps`, `error_rate`, evaluates SLO thresholds, and formats a `launchgate.v1` evaluation request.
- `GET /api/v1/runs` — Lists historical k6 runs with SLO `PASS` / `FAIL` badges (supports `?service=` and `?badge=` filters).
- `POST /api/v1/runs/synthetic-benchmark` — Executes a lightweight concurrent HTTP benchmark against a target URL (default `https://api.globlex.pro/health`), returns k6-compatible summary JSON, and registers the run.

## Contact / Support

PerfOps official Telegram contact: [@perfops_ai_manager](https://t.me/perfops_ai_manager).

For security vulnerabilities, use private vulnerability reporting rather than public Telegram messages.
