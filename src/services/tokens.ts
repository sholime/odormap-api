// Login tokens (JSON Web Tokens).
//
// After logging in, the app gets two tokens:
// - an access token, sent with every request, valid for 15 minutes;
// - a refresh token, used only to get a new access token, valid for 30 days.

import { SignJWT, jwtVerify } from 'jose';
import type { AuthTokens, Role } from '@odormap/common';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

type TokenType = 'access' | 'refresh';

/** Who is making a request, as read from their access token. */
export type CurrentUser = { userId: string; role: Role };

const secret = new TextEncoder().encode(config.jwtSecret);

export async function createTokens(user: CurrentUser): Promise<AuthTokens> {
  return {
    accessToken: await sign(user, 'access', '15m'),
    refreshToken: await sign(user, 'refresh', '30d'),
  };
}

/** Checks a token and returns its user. Throws 401 if it is invalid or expired. */
export async function readToken(token: string, type: TokenType): Promise<CurrentUser> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.type !== type || typeof payload.sub !== 'string') throw new Error('Wrong token type');
    return { userId: payload.sub, role: payload.role as Role };
  } catch {
    throw new HttpError(401, 'Not logged in or session expired');
  }
}

async function sign(user: CurrentUser, type: TokenType, expiresIn: string): Promise<string> {
  return new SignJWT({ type, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}
