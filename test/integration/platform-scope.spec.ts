import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bootstrap, Harness } from './harness';

/**
 * The platform read path.
 *
 * A platform operator belongs to no company. Every user query filtered on a
 * concrete companyId, and in SQL a comparison against NULL never matches, so
 * those users were excluded from every list for every company with no endpoint
 * that could show them. These tests pin both halves of the fix: the operator
 * can see across tenants, and a company user still cannot.
 */
describe('platform-scoped reads', () => {
  let h: Harness;
  let prisma: PrismaClient;
  let platformToken: string;

  const asPlatform = async (path: string) => {
    const res = await request(h.app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('authorization', `Bearer ${platformToken}`);
    const body = res.body?.success === true && 'data' in res.body ? res.body.data : res.body;
    return { status: res.status, body };
  };

  beforeAll(async () => {
    h = await bootstrap();
    prisma = h.prisma;
    // A platform operator authenticates without a company slug — that is what
    // distinguishes them at the login boundary.
    const login = await request(h.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@erp.com', password: 'admin123' });
    platformToken = login.body?.data?.accessToken ?? login.body?.accessToken;
  });

  afterAll(async () => {
    if (!h?.prisma) return;
    await h.close();
  });

  it('seeds the platform operator with no company and the right role', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@erp.com' } });
    expect(admin.companyId).toBeNull();
    expect(admin.isSuperAdmin).toBe(true);
    // The seed used to create this row and never reconcile it, so on any
    // database that predated the UserRoleType remap it sat at EMPLOYEE while
    // isSuperAdmin stayed true — wrong everywhere that reads the role rather
    // than the flag, and silent because the permissions guard reads the flag.
    expect(admin.roleType).toBe('SUPER_ADMIN');
  });

  it('lets the operator log in without naming a company', () => {
    expect(platformToken).toBeTruthy();
  });

  it('shows the operator the users who belong to no company', async () => {
    const res = await asPlatform('/users?scope=platform');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((u: { email: string }) => u.email === 'admin@erp.com')).toBe(true);
  });

  it('shows the operator every user, with the company each belongs to', async () => {
    const res = await asPlatform('/users?scope=all');
    expect(res.status).toBe(200);

    const emails = res.body.map((u: { email: string }) => u.email);
    expect(emails).toContain('admin@erp.com');
    expect(emails).toContain('manager@demo.com');

    const platformRow = res.body.find((u: { email: string }) => u.email === 'admin@erp.com');
    const tenantRow = res.body.find((u: { email: string }) => u.email === 'manager@demo.com');
    expect(platformRow.company).toBeNull();
    expect(tenantRow.company?.slug).toBe('demo');
  });

  it('still requires the operator to name a company for a tenant listing', async () => {
    // Falling back to their own null company is what produced an empty grid
    // that looked like a tenant with no data.
    const res = await asPlatform('/users');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/compan/i);
  });

  it('lists a named company when the operator asks for one', async () => {
    const res = await asPlatform(`/users?companyId=${h.companyId}`);
    expect(res.status).toBe(200);
    expect(res.body.some((u: { email: string }) => u.email === 'manager@demo.com')).toBe(true);
    expect(res.body.some((u: { email: string }) => u.email === 'admin@erp.com')).toBe(false);
  });

  describe('a company user cannot reach the platform scopes', () => {
    it.each(['platform', 'all'])('refuses scope=%s', async (scope) => {
      const res = await h.api('get', `/users?scope=${scope}`);
      expect(res.status).toBe(403);
    });

    it('sees only its own tenant on the ordinary listing', async () => {
      const res = await h.api('get', '/users');
      expect(res.status).toBe(200);
      const emails = res.body.map((u: { email: string }) => u.email);
      expect(emails).toContain('manager@demo.com');
      expect(emails).not.toContain('admin@erp.com');
    });

    it('cannot read another company by naming it', async () => {
      const other = await prisma.company.create({
        data: { name: 'Scope Probe Co', slug: `scope-probe-${Date.now()}` } });
      try {
        // The supplied companyId is ignored for a company user rather than
        // trusted, so this returns their own tenant instead of the other one.
        const res = await h.api('get', `/users?companyId=${other.id}`);
        expect(res.status).toBe(200);
        const emails = res.body.map((u: { email: string }) => u.email);
        expect(emails).toContain('manager@demo.com');
      } finally {
        await prisma.company.delete({ where: { id: other.id } });
      }
    });
  });

  it('rejects an unknown scope rather than ignoring it', async () => {
    const res = await asPlatform('/users?scope=everything');
    expect(res.status).toBe(400);
  });
});
