// Password hashing with scrypt, which is built into Node.js
// (no extra library, nothing to compile for AWS Lambda).
//
// A stored hash looks like "scrypt$<salt>$<hash>", both parts in base64.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [method, saltText, hashText] = stored.split('$');
  if (method !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltText, 'base64'), expected.length);
  // Compare in constant time so the comparison itself leaks nothing.
  return timingSafeEqual(actual, expected);
}
