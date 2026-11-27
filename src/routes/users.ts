// The admin "Users" screen: listing users, making someone an admin, blocking and deleting.
// Admins cannot change or delete their own account here, so nobody locks themselves out.

import type { FastifyInstance } from 'fastify';
import { UpdateUserRequest } from '@odormap/common';
import { requireAdmin } from '../auth.js';
import {
  anonymizeUserReports,
  deleteUser,
  getUser,
  listAllUsers,
  listUserReports,
  toAdminUser,
  updateUser,
} from '../db/index.js';
import { HttpError } from '../errors.js';
import { toOwnReport } from './reports.js';

export async function userRoutes(app: FastifyInstance) {
  /** Every user, newest first. */
  app.get('/users', async (request) => {
    await requireAdmin(request);
    const users = await listAllUsers();
    return users.map(toAdminUser).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  /** One user's latest 50 reports, newest first, shown the same way as their own "My reports". */
  app.get<{ Params: { id: string } }>('/users/:id/reports', async (request) => {
    await requireAdmin(request);
    const records = await listUserReports(request.params.id, 50);
    return records.map(toOwnReport);
  });

  app.patch<{ Params: { id: string } }>('/users/:id', async (request) => {
    const admin = await requireAdmin(request);
    const changes = UpdateUserRequest.parse(request.body);
    if (changes.role === undefined && changes.blocked === undefined) throw new HttpError(400, 'Nothing to update');
    if (request.params.id === admin.userId) throw new HttpError(400, 'Admins cannot change their own account here');
    if (!(await getUser(request.params.id))) throw new HttpError(404, 'User not found');
    // A new role takes effect when that user's app next refreshes its login (within the access token's lifetime).
    return toAdminUser(await updateUser(request.params.id, changes));
  });

  /** Deletes an account the same way as when users delete their own: reports stay, without the user or comments. */
  app.delete<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const admin = await requireAdmin(request);
    if (request.params.id === admin.userId) throw new HttpError(400, 'Admins cannot delete their own account here');
    if (!(await getUser(request.params.id))) throw new HttpError(404, 'User not found');
    await anonymizeUserReports(request.params.id);
    await deleteUser(request.params.id);
    reply.status(204);
  });
}
