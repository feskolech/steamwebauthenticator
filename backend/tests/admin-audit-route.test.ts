jest.mock('../src/db/pool', () => ({
  queryRows: jest.fn(),
  execute: jest.fn(),
  db: {
    getConnection: jest.fn()
  }
}));

import { buildApp } from '../src/app';
import { signSessionToken } from '../src/utils/jwt';
import { queryRows } from '../src/db/pool';

describe('admin audit route', () => {
  it('returns mapped admin logs and forwards user filters', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    queryRowsMock.mockResolvedValueOnce([
      {
        id: 7,
        user_id: 1,
        user_email: 'admin@example.com',
        account_id: null,
        alias: null,
        type: 'system',
        details: JSON.stringify({ event: 'registration_toggle', enabled: true }),
        created_at: new Date('2026-03-22T10:00:00Z')
      }
    ] as never);

    const app = await buildApp();
    const cookie = `sg_token=${signSessionToken({ id: 1, email: 'admin@example.com', role: 'admin' })}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/logs?scope=security&userId=1&limit=50',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(queryRowsMock).toHaveBeenCalledWith(
      expect.stringContaining('WHERE l.user_id IS NOT NULL AND l.user_id = ?'),
      [1, 150]
    );
    expect(response.json().items[0]).toMatchObject({
      userEmail: 'admin@example.com',
      eventKey: 'security.registration.toggled'
    });

    await app.close();
  });

  it('rejects invalid numeric filters', async () => {
    const app = await buildApp();
    const cookie = `sg_token=${signSessionToken({ id: 1, email: 'admin@example.com', role: 'admin' })}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/logs?userId=abc',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: 'Invalid userId' });

    await app.close();
  });
});
