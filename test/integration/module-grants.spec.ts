import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bootstrap, Harness } from './harness';

/**
 * Module access is gated by approval.
 *
 * The rule these tests exist to hold: `user_modules` means effective access and
 * nothing else. A row exists exactly when the user has the module right now.
 * Pending lives in `approval_requests`. Each test below attempts the thing that
 * must not work, because that is the only way to show the gate is enforced
 * rather than merely present.
 */
describe('module access grants', () => {
  let h: Harness;
  let prisma: PrismaClient;
  let platformToken: string;
  let operatorId: string;
  let moduleId: string;
  let disabledModuleId: string;
  const madeUsers: string[] = [];

  const asPlatform = async (method: 'get' | 'post', path: string, body?: unknown) => {
    let req = request(h.app.getHttpServer())[method](`/api/v1${path}`)
      .set('authorization', `Bearer ${platformToken}`);
    const res = await (body === undefined ? req.send() : req.send(body as object));
    const payload = res.body?.success === true && 'data' in res.body ? res.body.data : res.body;
    return { status: res.status, body: payload };
  };

  const newUser = async (label: string) => {
    const u = await prisma.user.create({
      data: {
        companyId: h.companyId,
        email: `grant-${label}-${Date.now()}@demo.com`,
        name: `Grant probe ${label}`,
        passwordHash: 'x',
        roleType: 'EMPLOYEE',
      },
      select: { id: true, email: true },
    });
    madeUsers.push(u.id);
    return u;
  };

  const hasModule = async (userId: string) =>
    prisma.userModule.count({ where: { userId, moduleId } });

  beforeAll(async () => {
    h = await bootstrap();
    prisma = h.prisma;

    const login = await request(h.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@erp.com', password: 'admin123' });
    platformToken = login.body?.data?.accessToken ?? login.body?.accessToken;
    // The operator who actually logged in — from the token's subject, not
    // "the first super admin in the table", which breaks as soon as a database
    // has more than one.
    operatorId = JSON.parse(Buffer.from(platformToken.split('.')[1], 'base64').toString('utf8')).sub;

    // Purpose-built modules rather than borrowed real ones.
    //
    // The entitlement test has to disable a module, and an earlier version of
    // this picked an arbitrary one off the company — which turned out to be a
    // module other suites depend on, so @RequireModule refused their requests
    // and twenty-three unrelated tests failed. A fixture that reaches into
    // shared state is not isolated no matter how carefully it restores itself.
    const enabledModule = await prisma.systemModule.upsert({
      where: { slug: 'test-grant-enabled' },
      update: {},
      create: {
        name: 'Grant Fixture (enabled)',
        slug: 'test-grant-enabled',
        description: 'Integration fixture. Not a real module.',
      },
    });
    const offModule = await prisma.systemModule.upsert({
      where: { slug: 'test-grant-disabled' },
      update: {},
      create: {
        name: 'Grant Fixture (not subscribed)',
        slug: 'test-grant-disabled',
        description: 'Integration fixture for the entitlement check.',
      },
    });
    moduleId = enabledModule.id;
    disabledModuleId = offModule.id;

    await prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId: h.companyId, moduleId } },
      update: { isEnabled: true },
      create: { companyId: h.companyId, moduleId, isEnabled: true },
    });
    await prisma.companyModule.upsert({
      where: { companyId_moduleId: { companyId: h.companyId, moduleId: disabledModuleId } },
      update: { isEnabled: false },
      create: { companyId: h.companyId, moduleId: disabledModuleId, isEnabled: false },
    });
  });

  afterAll(async () => {
    if (!h?.prisma) return;
    await prisma.approvalRequest.deleteMany({
      where: { companyId: h.companyId, documentType: 'user_module_grant' } });
    await prisma.userModule.deleteMany({ where: { userId: { in: madeUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
    await prisma.companyModule.deleteMany({
      where: { moduleId: { in: [moduleId, disabledModuleId] } } });
    await prisma.systemModule.deleteMany({
      where: { slug: { in: ['test-grant-enabled', 'test-grant-disabled'] } } });
    await h.close();
  });

  it('a request creates a pending approval and no access', async () => {
    const user = await newUser('pending');
    const res = await h.api('post', '/administration/module-grants', {
      userId: user.id, moduleId });

    expect(res.status).toBeLessThan(300);
    expect(res.body.autoApproved).toBe(false);

    const pending = await prisma.approvalRequest.findFirstOrThrow({
      where: { companyId: h.companyId, documentType: 'user_module_grant',
               documentId: `${user.id}:${moduleId}` } });
    expect(pending.status).toBe('PENDING');
    // The whole point: pending is not access.
    expect(await hasModule(user.id)).toBe(0);
  });

  it('approving creates the access, in the same commit as the decision', async () => {
    const user = await newUser('approve');
    await h.api('post', '/administration/module-grants', { userId: user.id, moduleId });
    const req = await prisma.approvalRequest.findFirstOrThrow({
      where: { documentId: `${user.id}:${moduleId}`, status: 'PENDING' } });

    const res = await asPlatform('post', `/administration/approvals/requests/${req.id}/decide`,
      { decision: 'APPROVED' });
    expect(res.status).toBeLessThan(300);

    expect(await hasModule(user.id)).toBe(1);
    const after = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe('APPROVED');
  });

  it('rejecting never creates access', async () => {
    const user = await newUser('reject');
    await h.api('post', '/administration/module-grants', { userId: user.id, moduleId });
    const req = await prisma.approvalRequest.findFirstOrThrow({
      where: { documentId: `${user.id}:${moduleId}`, status: 'PENDING' } });

    await asPlatform('post', `/administration/approvals/requests/${req.id}/decide`,
      { decision: 'REJECTED' });

    expect(await hasModule(user.id)).toBe(0);
    const after = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(after.status).toBe('REJECTED');
  });

  it('refuses a module the company does not subscribe to', async () => {
    const user = await newUser('entitlement');
    const res = await h.api('post', '/administration/module-grants', {
      userId: user.id, moduleId: disabledModuleId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.userModule.count({
      where: { userId: user.id, moduleId: disabledModuleId } })).toBe(0);
  });

  it('refuses at approval time if the subscription lapsed in between', async () => {
    const user = await newUser('lapsed');
    await h.api('post', '/administration/module-grants', { userId: user.id, moduleId });
    const req = await prisma.approvalRequest.findFirstOrThrow({
      where: { documentId: `${user.id}:${moduleId}`, status: 'PENDING' } });

    // Entitlement is re-checked when the decision lands, not only when the
    // request was raised — approvals can sit for days and a subscription can
    // lapse in between.
    await prisma.companyModule.update({
      where: { companyId_moduleId: { companyId: h.companyId, moduleId } },
      data: { isEnabled: false },
    });
    try {
      const res = await asPlatform('post',
        `/administration/approvals/requests/${req.id}/decide`, { decision: 'APPROVED' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await hasModule(user.id)).toBe(0);
      // The decision rolled back with the grant; the request is still pending.
      const after = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: req.id } });
      expect(after.status).toBe('PENDING');
    } finally {
      await prisma.companyModule.update({
        where: { companyId_moduleId: { companyId: h.companyId, moduleId } },
        data: { isEnabled: true },
      });
    }
  });

  it('refuses a decision from someone who is not an approver', async () => {
    const user = await newUser('outsider');
    await h.api('post', '/administration/module-grants', { userId: user.id, moduleId });
    const req = await prisma.approvalRequest.findFirstOrThrow({
      where: { documentId: `${user.id}:${moduleId}`, status: 'PENDING' } });

    // The company admin raised it and is not on the stage.
    const res = await h.api('post',
      `/administration/approvals/requests/${req.id}/decide`, { decision: 'APPROVED' });
    expect(res.status).toBe(403);
    expect(await hasModule(user.id)).toBe(0);
  });

  it('refuses a second decision on the same stage', async () => {
    const user = await newUser('twice');
    await h.api('post', '/administration/module-grants', { userId: user.id, moduleId });
    const req = await prisma.approvalRequest.findFirstOrThrow({
      where: { documentId: `${user.id}:${moduleId}`, status: 'PENDING' } });

    expect((await asPlatform('post',
      `/administration/approvals/requests/${req.id}/decide`, { decision: 'APPROVED' })).status)
      .toBeLessThan(300);
    const second = await asPlatform('post',
      `/administration/approvals/requests/${req.id}/decide`, { decision: 'APPROVED' });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it('produces one grant when approved twice at once', async () => {
    const user = await newUser('race');
    await h.api('post', '/administration/module-grants', { userId: user.id, moduleId });
    const req = await prisma.approvalRequest.findFirstOrThrow({
      where: { documentId: `${user.id}:${moduleId}`, status: 'PENDING' } });

    const [a, b] = await Promise.all([
      asPlatform('post', `/administration/approvals/requests/${req.id}/decide`, { decision: 'APPROVED' }),
      asPlatform('post', `/administration/approvals/requests/${req.id}/decide`, { decision: 'APPROVED' }),
    ]);
    expect(await hasModule(user.id)).toBe(1);

    // One wins; the loser is told it already decided rather than being handed
    // a raw constraint violation as a 500.
    const statuses = [a.status, b.status].sort();
    expect(statuses.filter((x) => x < 300)).toHaveLength(1);
    expect(statuses.filter((x) => x === 409)).toHaveLength(1);
  });

  describe('the platform operator is the approver, so their own grant is not routed', () => {
    it('records it as approved with a decision, rather than skipping the paperwork', async () => {
      const user = await newUser('auto');
      const res = await asPlatform('post',
        `/administration/module-grants?companyId=${h.companyId}`, { userId: user.id, moduleId });

      expect(res.status).toBeLessThan(300);
      expect(res.body.autoApproved).toBe(true);
      expect(await hasModule(user.id)).toBe(1);

      const req = await prisma.approvalRequest.findFirstOrThrow({
        where: { documentId: `${user.id}:${moduleId}` },
        include: { decisions: true },
      });
      expect(req.status).toBe('APPROVED');
      // An auto-approval that wrote the row and skipped the record would be
      // indistinguishable from access that never went through the gate.
      expect(req.decisions).toHaveLength(1);
      expect(req.decisions[0].approverId).toBe(operatorId);
    });
  });

  describe('creating a user with modules goes through the same gate', () => {
    it('creates the user immediately but not their access', async () => {
      const email = `created-${Date.now()}@demo.com`;
      const res = await h.api('post', '/users', {
        name: 'Created with modules', email, password: 'password123',
        roleType: 'EMPLOYEE', moduleIds: [moduleId],
      });
      expect(res.status).toBeLessThan(300);

      const created = await prisma.user.findFirstOrThrow({ where: { email } });
      madeUsers.push(created.id);

      // The user exists and can log in; only the module access waits.
      expect(created.isActive).toBe(true);
      expect(await hasModule(created.id)).toBe(0);
      const req = await prisma.approvalRequest.findFirst({
        where: { documentId: `${created.id}:${moduleId}`, status: 'PENDING' } });
      expect(req).not.toBeNull();
    });
  });

  it('shows the operator pending grants across every company', async () => {
    const res = await asPlatform('get', '/administration/module-grants/pending?scope=all');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const row of res.body) expect(row.company).toBeTruthy();
  });
});
