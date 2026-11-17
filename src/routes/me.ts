// The logged-in user's own profile.

import type { FastifyInstance } from 'fastify';
import { UpdateMeRequest } from '@odormap/common';
import { requireUser } from '../auth.js';
import { getUser, toUser, updateUser } from '../db/index.js';
import { HttpError } from '../errors.js';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', async (request) => {
    const { userId } = await requireUser(request);
    const user = await getUser(userId);
    if (!user) throw new HttpError(404, 'User not found');
    return toUser(user);
  });

  app.patch('/me', async (request) => {
    const { userId } = await requireUser(request);
    const changes = UpdateMeRequest.parse(request.body);
    if (changes.displayName === undefined && changes.language === undefined) {
      throw new HttpError(400, 'Nothing to update');
    }
    return toUser(await updateUser(userId, changes));
  });
}
