import fp from 'fastify-plugin';

export default fp(async (app) => {
  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ message: 'Unauthorized' });
    }
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
