jest.mock('../src/db/pool', () => ({
  queryRows: jest.fn(),
  execute: jest.fn(),
  db: {
    getConnection: jest.fn()
  }
}));

import { buildApp } from '../src/app';
import { signSessionToken } from '../src/utils/jwt';
import { execute, queryRows } from '../src/db/pool';

describe('steam queue route', () => {
  it('queries only pending confirmations for queue view', async () => {
    const queryRowsMock = queryRows as jest.MockedFunction<typeof queryRows>;
    const executeMock = execute as jest.MockedFunction<typeof execute>;

    queryRowsMock
      .mockResolvedValueOnce([{ id: 1 }] as never)
      .mockResolvedValueOnce([] as never);
    executeMock.mockResolvedValue({ affectedRows: 0 } as never);

    const app = await buildApp();
    const cookie = `sg_token=${signSessionToken({ id: 7, email: 'user@example.com', role: 'user' })}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/steamauth/1/queue',
      headers: {
        cookie
      }
    });

    expect(response.statusCode).toBe(200);
    expect(queryRowsMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND status = 'pending'"),
      [1]
    );

    await app.close();
  });
});
