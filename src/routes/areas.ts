// The towns or regions the app covers. Public, no login needed.

import type { FastifyInstance } from 'fastify';
import { AREAS } from '../areas.js';

export async function areaRoutes(app: FastifyInstance) {
  app.get('/areas', async () => AREAS.filter((area) => area.active));
}
