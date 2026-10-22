# Security Policy

k6 is an internal PerfOps microservice (default port 4041).

- **Report a vulnerability:** open a private security advisory on this repo
  (GitHub → Security → Advisories) or contact the owner listed in
  [`muntianus/.github`](https://github.com/muntianus/.github/blob/main/SECURITY.md).
- **Secrets:** none are required. Never commit `.env`; only `.env.example`
  (placeholder values) is tracked. CI runs gitleaks via the org security gate.
- The API is unauthenticated. `POST /api/v1/runs/synthetic-benchmark` makes outbound HTTP requests to a caller-supplied `targetUrl`; keep the service on loopback / behind Caddy and never expose it publicly.
