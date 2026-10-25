import { assertIfMatch, etagFor, versionFromIfMatch } from '../src/common/etag';
import { decodeCursor, encodeCursor, toPage } from '../src/common/pagination';
import { ProblemException } from '../src/common/problem';
import { correlationIdFor } from '../src/common/request-context';

describe('cursor pagination helpers', () => {
  it('round-trips a cursor', () => {
    const key = { id: '0192f000-0000-7000-8000-000000000001', at: 17 };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it.each([
    '%%%',
    Buffer.from('[1,2]').toString('base64url'),
    Buffer.from('{"a":{}}').toString('base64url'),
  ])('refuses the cursor %j', (cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(ProblemException);
  });

  it('sets next_cursor only when a further row exists', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(toPage(rows, 2, (r) => ({ id: r.id }))).toEqual({
      data: [{ id: 'a' }, { id: 'b' }],
      next_cursor: encodeCursor({ id: 'b' }),
    });
    expect(toPage(rows, 3, (r) => ({ id: r.id })).next_cursor).toBeNull();
  });
});

describe('ETag helpers', () => {
  it('reads weak and strong ETags', () => {
    expect(etagFor(3)).toBe('W/"3"');
    expect(versionFromIfMatch('W/"3"')).toBe(3);
    expect(versionFromIfMatch('"4"')).toBe(4);
    expect(versionFromIfMatch('nonsense')).toBeUndefined();
  });

  it('answers 428 without If-Match and 412 on another version', () => {
    expect(() => assertIfMatch(undefined, 1)).toThrow(expect.objectContaining({ status: 428 }));
    expect(() => assertIfMatch('W/"1"', 2)).toThrow(expect.objectContaining({ status: 412 }));
    expect(() => assertIfMatch('W/"2"', 2)).not.toThrow();
    expect(() => assertIfMatch('*', 9)).not.toThrow();
  });
});

describe('correlation id', () => {
  const req = (value?: string) =>
    ({ headers: value ? { 'x-correlation-id': value } : {} }) as never;

  it('reuses a well-formed id and replaces anything else', () => {
    expect(correlationIdFor(req('client-req-0001'))).toBe('client-req-0001');
    expect(correlationIdFor(req('<script>'))).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationIdFor(req())).toMatch(/^[0-9a-f-]{36}$/);
  });
});
