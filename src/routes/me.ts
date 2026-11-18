// The logged-in user's own profile, and deleting the account.

import type { FastifyInstance } from 'fastify';
import { UpdateMeRequest } from '@odormap/common';
import { requireUser } from '../auth.js';
import { deleteUser, deleteUserReports, getUser, toUser, updateUser } from '../db/index.js';
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

  /** Deletes the account and all its reports. This cannot be undone. */
  app.delete('/me', async (request, reply) => {
    const { userId } = await requireUser(request);
    // Reports first: if this stops halfway, the account still exists and can be deleted again.
    await deleteUserReports(userId);
    await deleteUser(userId);
    reply.status(204);
  });
}
