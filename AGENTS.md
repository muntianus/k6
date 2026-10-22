# AGENTS.md — k6

> Canon: `~/github/vault/personal/agent-config/AGENTS.md` · details: `agent-config/repos/k6.md`
> Org policy: [`muntianus/.github/AGENT_POLICY.md`](https://github.com/muntianus/.github/blob/main/AGENT_POLICY.md) ·
> [Repository Standard](https://github.com/muntianus/.github/blob/main/docs/standards/REPOSITORY_STANDARD.md)

## Repo-local rules

- **Zero dependencies.** Node ≥ 20 standard library only (`node:http`, `node:test`);
  adding an npm dependency needs an ADR.
- **Contract first.** A route change updates `ROUTES` in `src/server.js` and
  `docs/api/openapi.json` in the same commit; `tests/openapi-contract.test.js` fails on drift.
- **Config is env-only.** Every variable the code reads is listed in `.env.example`;
  never commit `.env`.
- **`GET /health` stays dependency-free** (liveness only).
- **The run registry is in-memory** (last 200 runs, lost on restart); do not document it as durable storage.
- Before pushing: `npm test`.
- Conventional commits; branch `feat/*` / `fix/*` / `chore/*`; never push to `main`.
