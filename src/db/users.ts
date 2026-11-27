// Reading and writing users.
//
// Table keys: userId.
// Indexes: byEmail (email), byGoogle (googleId).

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AdminUser, Language, Role, SignInMethod, User } from '@odormap/common';
import { config } from '../config.js';
import { db } from './client.js';

/** A user as stored in the database. */
export type UserRecord = {
  userId: string;
  /** Missing for guests (accounts made with "continue without account"). */
  email?: string;
  /** Missing for accounts that only sign in with Google. */
  passwordHash?: string;
  googleId?: string;
  displayName: string;
  language: Language;
  role: Role;
  privacyAcceptedAt: string;
  createdAt: string;
  /** Set by an admin. A blocked user can log in but cannot send reports. Missing means not blocked. */
  blocked?: boolean;
  /** Kept up to date when a report is sent, so admins can list users without counting reports. */
  reportCount?: number;
  lastReportAt?: string;
};

/** The shape the API returns: no password hash or Google id. */
export function toUser(record: UserRecord): User {
  return {
    id: record.userId,
    email: record.email,
    isGuest: record.email === undefined,
    displayName: record.displayName,
    language: record.language,
    role: record.role,
    createdAt: record.createdAt,
  };
}

/** The shape admins see on the "Users" screen. */
export function toAdminUser(record: UserRecord): AdminUser {
  const signInMethods: SignInMethod[] = [];
  if (record.passwordHash) signInMethods.push('password');
  if (record.googleId) signInMethods.push('google');
  return {
    ...toUser(record),
    signInMethods,
    blocked: record.blocked === true,
    reportCount: record.reportCount ?? 0,
    lastReportAt: record.lastReportAt,
  };
}

export async function getUser(userId: string): Promise<UserRecord | undefined> {
  const result = await db.send(new GetCommand({ TableName: config.usersTable, Key: { userId } }));
  return result.Item as UserRecord | undefined;
}

export async function findUserByEmail(email: string): Promise<UserRecord | undefined> {
  return findOne('byEmail', 'email', email.toLowerCase());
}

export async function findUserByGoogleId(googleId: string): Promise<UserRecord | undefined> {
  return findOne('byGoogle', 'googleId', googleId);
}

export async function createUser(user: UserRecord): Promise<void> {
  await db.send(
    new PutCommand({
      TableName: config.usersTable,
      Item: { ...user, email: user.email?.toLowerCase() },
      // Never overwrite an existing user by accident.
      ConditionExpression: 'attribute_not_exists(userId)',
    }),
  );
}

/** Changes the given fields and returns the updated user. */
export async function updateUser(
  userId: string,
  changes: Partial<
    Pick<
      UserRecord,
      'email' | 'passwordHash' | 'googleId' | 'displayName' | 'language' | 'role' | 'blocked' | 'lastReportAt'
    >
  >,
): Promise<UserRecord> {
  if (changes.email) changes = { ...changes, email: changes.email.toLowerCase() };
  const fields = Object.entries(changes).filter(([, value]) => value !== undefined);
  const result = await db.send(
    new UpdateCommand({
      TableName: config.usersTable,
      Key: { userId },
      UpdateExpression: 'SET ' + fields.map(([name]) => `#${name} = :${name}`).join(', '),
      ExpressionAttributeNames: Object.fromEntries(fields.map(([name]) => [`#${name}`, name])),
      ExpressionAttributeValues: Object.fromEntries(fields.map(([name, value]) => [`:${name}`, value])),
      ReturnValues: 'ALL_NEW',
    }),
  );
  return result.Attributes as UserRecord;
}

/**
 * Adds to a user's report count and sets the time of their last report.
 * Called with 1 when a report is sent, and with a guest's count when their reports move to an account.
 */
export async function addReports(userId: string, count: number, lastReportAt: string): Promise<void> {
  await db.send(
    new UpdateCommand({
      TableName: config.usersTable,
      Key: { userId },
      UpdateExpression: 'ADD reportCount :count SET lastReportAt = :at',
      ExpressionAttributeValues: { ':count': count, ':at': lastReportAt },
      // Never create a user by accident (e.g. one deleted a moment ago).
      ConditionExpression: 'attribute_exists(userId)',
    }),
  );
}

/** Every user, reading the whole table page by page. Fine for the few thousand users a town has. */
export async function listAllUsers(): Promise<UserRecord[]> {
  const users: UserRecord[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await db.send(new ScanCommand({ TableName: config.usersTable, ExclusiveStartKey: startKey }));
    users.push(...((result.Items ?? []) as UserRecord[]));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return users;
}

export async function deleteUser(userId: string): Promise<void> {
  await db.send(new DeleteCommand({ TableName: config.usersTable, Key: { userId } }));
}

async function findOne(indexName: string, attribute: string, value: string): Promise<UserRecord | undefined> {
  const result = await db.send(
    new QueryCommand({
      TableName: config.usersTable,
      IndexName: indexName,
      KeyConditionExpression: '#attribute = :value',
      ExpressionAttributeNames: { '#attribute': attribute },
      ExpressionAttributeValues: { ':value': value },
      Limit: 1,
    }),
  );
  return result.Items?.[0] as UserRecord | undefined;
}
