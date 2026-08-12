import { buildApp } from '../src/app';
import { signSessionToken } from '../src/utils/jwt';

function sessionCookie(): string {
  return `sg_token=${signSessionToken({ id: 7, email: 'user@example.com', role: 'user' })}`;
}

describe('websocket route', () => {
  it('accepts an authenticated session and responds to ping', async () => {
    const app = await buildApp();
    await app.ready();

    const messages: any[] = [];
    const waitForMessage = (eventName: string) =>
      new Promise<any>((resolve) => {
        const interval = setInterval(() => {
          const found = messages.find((item) => item.event === eventName);
          if (found) {
            clearInterval(interval);
            resolve(found);
          }
        }, 5);
      });

    const socket = await (app as any).injectWS('/ws', {
      headers: {
        cookie: sessionCookie()
      }
    }, {
      onInit: (client: any) => {
        client.on('message', (raw: Buffer | string) => {
          messages.push(JSON.parse(raw.toString()));
        });
      }
    });

    await expect(waitForMessage('connected')).resolves.toMatchObject({
      event: 'connected',
      payload: { userId: 7 }
    });

    socket.send('ping');

    await expect(waitForMessage('pong')).resolves.toMatchObject({
      event: 'pong'
    });

    socket.terminate();
    await app.close();
  });
});
