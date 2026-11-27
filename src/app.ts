// Builds the web server: settings, error handling and all routes.
// The same app runs on AWS Lambda (lambda.ts) and on your computer (local.ts).

import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { areaRoutes } from './routes/areas.js';
import { userRoutes } from './routes/users.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { reportRoutes } from './routes/reports.js';
import { sourceRoutes } from './routes/sources.js';

export function buildApp() {
  const app = Fastify({ logger: config.stage !== 'test' });

  app.register(cors, { origin: config.allowedOrigins });

  // Turn errors into clear JSON answers.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'Invalid request', details: error.issues });
    }
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'Something went wrong' });
  });

  app.get('/health', async () => ({ ok: true }));

  app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(meRoutes);
      await api.register(reportRoutes);
      await api.register(sourceRoutes);
      await api.register(areaRoutes);
      await api.register(userRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
