// Checking a Google sign-in.
//
// The browser or phone signs in with Google and receives an "ID token".
// We check that Google signed it and that it was issued for our app,
// using Google's published public keys.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export type GoogleProfile = { googleId: string; email: string; name: string };

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  try {
    const { payload } = await jwtVerify(idToken, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: config.googleClientId,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email_verified !== true) {
      throw new Error('Google account has no verified email');
    }
    return {
      googleId: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
    };
  } catch {
    throw new HttpError(401, 'Google sign-in could not be verified');
  }
}
