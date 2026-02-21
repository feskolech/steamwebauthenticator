import fp from 'fastify-plugin';
import { getBearerToken, verifySessionToken } from '../utils/jwt';

export default fp(async (app) => {
  app.decorate('authenticate', async (request, reply) => {
    const cookieToken = request.cookies?.sg_token;
    const bearerToken = getBearerToken(request.headers.authorization);
    const token = cookieToken ?? bearerToken;

    if (!token) {
      reply.code(401).send({ message: 'Unauthorized' });
      return;
    }

    const user = verifySessionToken(token);
    if (!user) {
      reply.code(401).send({ message: 'Unauthorized' });
      return;
    }

    request.user = user;
  });

  app.decorate('requireAdmin', async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent) {
      return;
    }

    if (request.user.role !== 'admin') {
      reply.code(403).send({ message: 'Forbidden' });
    }
  });
});
