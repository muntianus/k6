# PerfOps k6 Telemetry Collector, Run Registry & LaunchGate Bridge (`k6`)

Telemetry ingestion, historical SLO run registry, synthetic HTTP benchmark engine, and **LaunchGate** (`launchgate-core`) evaluation bridge for k6 load tests across **PerfOps** and **Globex** (`api.globlex.pro`).

## Architecture & Modules

- `src/run-engine.js` — Extracts `p50`, `p90`, `p95`, `p99`, `rps`, and `error_rate` from k6 `--summary-export` JSON payloads, formats `launchgate.v1` gate evaluation requests (`ALLOW` / `BLOCK`), runs lightweight synthetic HTTP benchmarks, and maintains the in-memory `K6RunRegistry`.
- `src/server.js` — HTTP microservice (`PORT` default `4041`) exposing telemetry ingestion, run history with SLO `PASS`/`FAIL` badges, and on-demand synthetic benchmarking.
- `index.js` — Baseline k6 smoke probe script.
- `tests/k6-runner.test.js` — Full automated test suite (`node --test`).

## Quick Start

```bash
# Run automated test suite
npm test

# Start the PerfOps k6 Runner & Telemetry Collector service (PORT=4041)
npm start
```

## HTTP API (`PORT=4041`)

- `GET /health` — Returns `{"status":"ok","service":"perfops-k6-runner","version":"1.0.0"}`.
- `POST /api/v1/runs/ingest` — Ingests a k6 `--summary-export` JSON payload, extracts `p50`, `p90`, `p95`, `p99`, `rps`, `error_rate`, evaluates SLO thresholds, and formats a `launchgate.v1` evaluation request.
- `GET /api/v1/runs` — Lists historical k6 runs with SLO `PASS` / `FAIL` badges (supports `?service=` and `?badge=` filters).
- `POST /api/v1/runs/synthetic-benchmark` — Executes a lightweight concurrent HTTP benchmark against a target URL (default `https://api.globlex.pro/health`), returns k6-compatible summary JSON, and registers the run.
