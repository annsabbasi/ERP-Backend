import { bootstrap, Harness } from './harness';

/**
 * Every leave-request action answers with the same shape the list does —
 * including the employee and the leave type.
 *
 * The Leave Application window shows whatever the action returned. Submit,
 * Approve, Reject and Cancel used to return the bare row, so right after any
 * of them the view read "Employee —" with the leave type blank until the row
 * was clicked again. Found by the UI matrix on 2026-09-26.
 */
let h: Harness;
let employeeId = '';
let leaveTypeId = '';
let leaveTypeName = '';
const created: string[] = [];

beforeAll(async () => {
  h = await bootstrap();
  const code = `QALR${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const type = await h.api('post', '/hr/leaves/types', { code, name: `Leave response ${code}`, requiresApproval: true, paid: false });
  expect(type.status).toBeLessThan(300);
  leaveTypeId = type.body.id;
  leaveTypeName = type.body.name;
  // Its own employee, with no login: the cancel route lets HR cancel for them.
  const emp = await h.prisma.employee.create({
    data: { companyId: h.companyId, name: `Leave response ${code}` },
    select: { id: true },
  });
  employeeId = emp.id;
});

afterAll(async () => {
  try {
    await h.prisma.leaveRequest.deleteMany({ where: { id: { in: created } } });
    await h.prisma.leaveBalance.deleteMany({ where: { leaveTypeId } });
    await h.prisma.employee.deleteMany({ where: { id: employeeId } });
    await h.prisma.leaveType.deleteMany({ where: { id: leaveTypeId } });
  } finally {
    await h.close();
  }
});

const submit = async (day: string) => {
  const res = await h.api('post', `/hr/leaves/requests/employees/${employeeId}`, {
    leaveTypeId, startDate: day, endDate: day, days: 1,
  });
  expect(res.status).toBeLessThan(300);
  created.push(res.body.id);
  return res;
};

const expectFullShape = (body: any) => {
  expect(body.leaveType).toEqual(expect.objectContaining({ id: leaveTypeId, name: leaveTypeName }));
  expect(body.employee).toEqual(expect.objectContaining({ id: employeeId }));
};

describe('leave request responses', () => {
  it('submit returns the employee and leave type', async () => {
    const res = await submit('2031-01-06');
    expect(res.body.status).toBe('PENDING');
    expectFullShape(res.body);
  });

  it.each(['approve', 'reject', 'cancel'])('%s returns the employee and leave type', async (action) => {
    const day = { approve: '2031-01-07', reject: '2031-01-08', cancel: '2031-01-09' }[action]!;
    const { body } = await submit(day);
    const res = await h.api('post', `/hr/leaves/requests/${body.id}/${action}`, {});
    expect(res.status).toBeLessThan(300);
    expect(res.body.status).toBe({ approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' }[action]);
    expectFullShape(res.body);
  });
});
