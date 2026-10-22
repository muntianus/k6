# Changelog

Notable changes to this service. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Security

- `POST /api/v1/runs/synthetic-benchmark` no longer fetches arbitrary URLs: the target host
  must be in `K6_BENCHMARK_ALLOWED_HOSTS` (default: public globlex.* / perfops.* hosts),
  only http(s) is accepted (400 otherwise, 403 for other hosts), and redirects are not
  followed. Previously any caller could make the service probe internal addresses.

### Changed

- Adopted the muntianus Repository Standard v1: committed OpenAPI contract
  (`docs/api/openapi.json`) with a route/spec drift test, `AGENTS.md` / `CLAUDE.md` /
  `SECURITY.md`, `.env.example`, Dependabot, a non-root Docker image with a health check,
  and CI with SHA-pinned actions, least-privilege permissions
  (secret scanning stays with GitGuardian).
