const BASE = 'http://127.0.0.1:3070/api/v1';

async function main() {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@erp.com', password: 'admin123' }),
  }).then((r) => r.json());
  const token = login.data.accessToken;
  console.log('logged in as super admin');

  const suffix = Date.now();
  const payload = {
    name: `Repro Test Co ${suffix}`,
    slug: `repro-test-co-${suffix}`,
    industry: 'generic',
    country: 'US',
    currency: 'USD',
    locale: 'en-US',
    timezone: 'UTC',
    fiscalYearStart: 1,
    planKey: 'premium',
    adminName: 'Repro Admin',
    adminEmail: `repro-admin-${suffix}@example.com`,
  };

  const t0 = Date.now();
  const res = await fetch(`${BASE}/companies/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const elapsed = Date.now() - t0;
  const body = await res.text();
  console.log('elapsed ms:', elapsed, '| status:', res.status);
  console.log('body:', body.slice(0, 500));
}
main().catch((e) => { console.error(e); process.exit(1); });
