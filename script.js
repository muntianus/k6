import http from 'k6/http';
import { check, group } from 'k6';

const TARGETS = [
  { name: 'PerfOps Hub', url: 'https://app.perfops.tech/hub/', expectedStatus: 200 },
  { name: 'PerfOps Docs', url: 'https://app.perfops.tech/docs/', expectedStatus: 200 },
  { name: 'PerfOps Graph', url: 'https://app.perfops.tech/kg/', expectedStatus: 200 },
  {
    name: 'PerfOps Knowledge Base',
    url: 'https://app.perfops.tech/kb-new/00-INDEX.html',
    expectedStatus: 200,
  },
  { name: 'PerfOps Dashboard', url: 'https://app.perfops.tech/dash/', expectedStatus: 200 },
  { name: 'LaunchGate UI', url: 'https://app.perfops.tech/launchgate/', expectedStatus: 200 },
  {
    name: 'LaunchGate Health',
    url: 'https://app.perfops.tech/launchgate-api/healthz',
    expectedStatus: 200,
  },
  {
    name: 'HCGI Health',
    url: 'https://app.perfops.tech/hcgi/api/health',
    expectedStatus: 200,
  },
  { name: 'Endpoint Inventory', url: 'https://app.perfops.tech/endpoints/', expectedStatus: 200 },
  { name: 'Repositories KB', url: 'https://app.perfops.tech/repos-kb/', expectedStatus: 200 },
  { name: 'PerfOps Marketing', url: 'https://perfops.tech/', expectedStatus: 200 },
  { name: 'PerfOps Shop', url: 'https://perfops.shop/', expectedStatus: 200 },
  { name: 'Agent Control Health', url: 'https://aco.perfops.shop/health', expectedStatus: 200 },
  { name: 'Globlex Pro', url: 'https://globlex.pro/', expectedStatus: 200 },
  { name: 'Globlex Shop', url: 'https://globlex.shop/', expectedStatus: 200 },
  { name: 'Globlex Online', url: 'https://globlex.online/', expectedStatus: 200 },
  { name: 'Jaeger Authentication', url: 'https://jaeger.perfops.tech/', expectedStatus: 401 },
  { name: 'VictoriaMetrics Authentication', url: 'https://vm.perfops.tech/', expectedStatus: 401 },
  {
    name: 'WireGuard Redirect',
    url: 'https://wg2.perfops.tech/',
    expectedStatus: 302,
    redirects: 0,
  },
];

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  group('public endpoint inventory', () => {
    for (const target of TARGETS) {
      const response = http.get(target.url, {
        redirects: target.redirects ?? 10,
        // Caddy may normalize a trailing slash before the final contract response.
        // The check below still verifies the final status for each endpoint.
        responseCallback: http.expectedStatuses(target.expectedStatus, 301, 302, 307, 308),
        tags: { endpoint: target.name },
        timeout: '10s',
      });

      check(response, {
        [`${target.name}: expected status ${target.expectedStatus}`]:
          (res) => res.status === target.expectedStatus,
      });
    }
  });
}
