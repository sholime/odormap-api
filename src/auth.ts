// Finding out who is calling, from the "Authorization: Bearer <token>" header.

import type { FastifyRequest } from 'fastify';
import { HttpError } from './errors.js';
import { readToken, type CurrentUser } from './services/tokens.js';

/** The logged-in user. Throws 401 if the request has no valid access token. */
export async function requireUser(request: FastifyRequest): Promise<CurrentUser> {
  const header = request.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Not logged in or session expired');
  return readToken(token, 'access');
}

/** The logged-in user, or undefined if the request has no login at all. */
export async function optionalUser(request: FastifyRequest): Promise<CurrentUser | undefined> {
  return request.headers.authorization ? requireUser(request) : undefined;
}

/** The logged-in user, who must be an admin. Throws 401 or 403 otherwise. */
export async function requireAdmin(request: FastifyRequest): Promise<CurrentUser> {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw new HttpError(403, 'Only admins can do this');
  return user;
}
