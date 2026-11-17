// Reading and writing users.
//
// Table keys: userId.
// Indexes: byEmail (email), byGoogle (googleId).

import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Language, Role, User } from '@odormap/common';
import { config } from '../config.js';
import { db } from './client.js';

/** A user as stored in the database. */
export type UserRecord = {
  userId: string;
  email: string;
  /** Missing for accounts that only sign in with Google. */
  passwordHash?: string;
  googleId?: string;
  displayName: string;
  language: Language;
  role: Role;
  privacyAcceptedAt: string;
  createdAt: string;
};

/** The shape the API returns: no password hash or Google id. */
export function toUser(record: UserRecord): User {
  return {
    id: record.userId,
    email: record.email,
    displayName: record.displayName,
    language: record.language,
    role: record.role,
    createdAt: record.createdAt,
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
      Item: { ...user, email: user.email.toLowerCase() },
      // Never overwrite an existing user by accident.
      ConditionExpression: 'attribute_not_exists(userId)',
    }),
  );
}

/** Changes the given fields and returns the updated user. */
export async function updateUser(
  userId: string,
  changes: Partial<Pick<UserRecord, 'displayName' | 'language' | 'googleId'>>,
): Promise<UserRecord> {
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
