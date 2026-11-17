// Registering, logging in and refreshing a session.

import type { FastifyInstance } from 'fastify';
import { GoogleLoginRequest, LoginRequest, RefreshRequest, RegisterRequest } from '@odormap/common';
import { v7 as newId } from 'uuid';
import { createUser, findUserByEmail, findUserByGoogleId, getUser, updateUser } from '../db/index.js';
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
    return createTokens(user);
  });

  app.post('/auth/google', async (request, reply) => {
    const body = GoogleLoginRequest.parse(request.body);
    const google = await verifyGoogleIdToken(body.idToken);

    // 1. Someone who signed in with Google before.
    const existing = await findUserByGoogleId(google.googleId);
    if (existing) return createTokens(existing);

    // 2. Someone who registered with email and password and now uses Google with the same email.
    const sameEmail = await findUserByEmail(google.email);
    if (sameEmail) {
      const linked = await updateUser(sameEmail.userId, { googleId: google.googleId });
      return createTokens(linked);
    }

    // 3. A new person: they must accept the privacy notice first.
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

  app.post('/auth/refresh', async (request) => {
    const body = RefreshRequest.parse(request.body);
    const { userId } = await readToken(body.refreshToken, 'refresh');
    // Read the user again so a changed role takes effect.
    const user = await getUser(userId);
    if (!user) throw new HttpError(401, 'Not logged in or session expired');
    return createTokens(user);
  });
}
