// Registering, logging in and refreshing a session.
//
// Guests: someone can use the app without an account (POST /auth/guest). When a guest
// registers, logs in or signs in with Google while still logged in as the guest, their
// reports are kept:
// - a new account: the guest account itself becomes the full account;
// - an existing account: the guest's reports move to it and the guest is deleted.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { GoogleLoginRequest, GuestLoginRequest, LoginRequest, RefreshRequest, RegisterRequest } from '@odormap/common';
import { v7 as newId } from 'uuid';
import { optionalUser } from '../auth.js';
import {
  createUser,
  deleteUser,
  findUserByEmail,
  findUserByGoogleId,
  getUser,
  moveReports,
  updateUser,
  type UserRecord,
} from '../db/index.js';
import { HttpError } from '../errors.js';
import { verifyGoogleIdToken } from '../services/google.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import { createTokens, readToken } from '../services/tokens.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const body = RegisterRequest.parse(request.body);
    if (await findUserByEmail(body.email)) {
      throw new HttpError(409, 'An account with this email already exists');
    }
    const guest = await findGuest(request);
    if (guest) {
      const upgraded = await updateUser(guest.userId, {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName,
        language: body.language,
      });
      return createTokens(upgraded);
    }
    const now = new Date().toISOString();
    const user = {
      userId: newId(),
      email: body.email,
      passwordHash: await hashPassword(body.password),
      displayName: body.displayName,
      language: body.language,
      role: 'user' as const,
      privacyAcceptedAt: now,
      createdAt: now,
    };
    await createUser(user);
    reply.status(201);
    return createTokens(user);
  });

  app.post('/auth/login', async (request) => {
    const body = LoginRequest.parse(request.body);
    const user = await findUserByEmail(body.email);
    const passwordMatches = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
    // Same message whether the email or the password is wrong, so nobody can probe for accounts.
    if (!user || !passwordMatches) throw new HttpError(401, 'Wrong email or password');
    return logIn(request, user);
  });

  app.post('/auth/google', async (request, reply) => {
    const body = GoogleLoginRequest.parse(request.body);
    const google = await verifyGoogleIdToken(body.idToken);

    // 1. Someone who signed in with Google before.
    const existing = await findUserByGoogleId(google.googleId);
    if (existing) return logIn(request, existing);

    // 2. Someone who registered with email and password and now uses Google with the same email.
    const sameEmail = await findUserByEmail(google.email);
    if (sameEmail) {
      const linked = await updateUser(sameEmail.userId, { googleId: google.googleId });
      return logIn(request, linked);
    }

    // 3. A guest signing in with Google for the first time: their guest account becomes the Google account.
    const guest = await findGuest(request);
    if (guest) {
      const upgraded = await updateUser(guest.userId, {
        email: google.email,
        googleId: google.googleId,
        displayName: google.name,
      });
      return createTokens(upgraded);
    }

    // 4. A new person: they must accept the privacy notice first.
    if (body.acceptPrivacy !== true) {
      throw new HttpError(400, 'The privacy notice must be accepted to create an account');
    }
    const now = new Date().toISOString();
    const user = {
      userId: newId(),
      email: google.email,
      googleId: google.googleId,
      displayName: google.name,
      language: body.language ?? 'sr',
      role: 'user' as const,
      privacyAcceptedAt: now,
      createdAt: now,
    };
    await createUser(user);
    reply.status(201);
    return createTokens(user);
  });

  app.post('/auth/guest', async (request, reply) => {
    const body = GuestLoginRequest.parse(request.body);
    const now = new Date().toISOString();
    const user = {
      userId: newId(),
      displayName: 'Guest',
      language: body.language,
      role: 'user' as const,
      privacyAcceptedAt: now,
      createdAt: now,
    };
    await createUser(user);
    reply.status(201);
    return createTokens(user);
  });

  app.post('/auth/refresh', async (request) => {
    const body = RefreshRequest.parse(request.body);
    const { userId } = await readToken(body.refreshToken, 'refresh');
    // Read the user again so a changed role takes effect.
    const user = await getUser(userId);
    if (!user) throw new HttpError(401, 'Not logged in or session expired');
    return createTokens(user);
  });
}

/** The guest account the request is logged in as, if any. */
async function findGuest(request: FastifyRequest): Promise<UserRecord | undefined> {
  // An expired or broken guest login just means "not a guest", so logging in still works.
  const current = await optionalUser(request).catch(() => undefined);
  if (!current) return undefined;
  const user = await getUser(current.userId);
  return user && user.email === undefined ? user : undefined;
}

/** Logs into an existing account. A guest's reports move to that account first. */
async function logIn(request: FastifyRequest, user: UserRecord) {
  const guest = await findGuest(request);
  if (guest && guest.userId !== user.userId) {
    await moveReports(guest.userId, user.userId);
    await deleteUser(guest.userId);
  }
  return createTokens(user);
}
