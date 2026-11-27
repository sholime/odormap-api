// Tests the API end to end, with the database and the weather service replaced by fakes.

import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/services/passwords.js';
import { createTokens } from '../src/services/tokens.js';

const database = mockClient(DynamoDBDocumentClient);
const app = buildApp();

const topola = { lat: 45.8155, lon: 19.6318 };
const userId = '019a9a3c-6b1e-7000-8000-000000000001';

async function loggedIn(role: 'user' | 'admin' = 'user') {
  const { accessToken } = await createTokens({ userId, role });
  return { authorization: `Bearer ${accessToken}` };
}

beforeEach(() => {
  database.reset();
  // Unknown user, and updates that succeed, unless a test says otherwise.
  database.on(GetCommand).resolves({});
  database.on(UpdateCommand).resolves({});
  // Open-Meteo answers with calm weather unless a test says otherwise.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        current: {
          time: '2026-11-17T18:30',
          wind_speed_10m: 3.2,
          wind_direction_10m: 270,
          temperature_2m: 8.4,
          relative_humidity_2m: 81,
          pressure_msl: 1021.3,
        },
      }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('accounts', () => {
  it('registers a new user and returns tokens', async () => {
    database.on(QueryCommand).resolves({ Items: [] });
    database.on(PutCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'Ana@Example.com', password: 'long-enough', displayName: 'Ana', language: 'hu', acceptPrivacy: true },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toHaveProperty('accessToken');
    const saved = database.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(saved.email).toBe('ana@example.com');
    expect(saved.passwordHash).toMatch(/^scrypt\$/);
  });

  it('refuses a second account with the same email', async () => {
    database.on(QueryCommand).resolves({ Items: [{ userId, email: 'ana@example.com' }] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'ana@example.com', password: 'long-enough', displayName: 'Ana', language: 'sr', acceptPrivacy: true },
    });

    expect(response.statusCode).toBe(409);
  });

  it('still logs in when the app sends an expired guest login', async () => {
    const passwordHash = await hashPassword('correct-horse');
    database.on(QueryCommand).resolves({ Items: [{ userId, email: 'ana@example.com', passwordHash, role: 'user' }] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { authorization: 'Bearer expired-or-broken' },
      payload: { email: 'ana@example.com', password: 'correct-horse' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('logs in with the right password only', async () => {
    const passwordHash = await hashPassword('correct-horse');
    database.on(QueryCommand).resolves({ Items: [{ userId, email: 'ana@example.com', passwordHash, role: 'user' }] });

    const right = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ana@example.com', password: 'correct-horse' },
    });
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ana@example.com', password: 'wrong-horse' },
    });

    expect(right.statusCode).toBe(200);
    expect(wrong.statusCode).toBe(401);
  });
});

describe('guests', () => {
  it('creates a guest account without email or password', async () => {
    database.on(PutCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/guest',
      payload: { language: 'sr', acceptPrivacy: true },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toHaveProperty('accessToken');
    const saved = database.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(saved.email).toBeUndefined();
    expect(saved.passwordHash).toBeUndefined();
  });

  it('needs the privacy notice accepted', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/guest', payload: { language: 'sr' } });
    expect(response.statusCode).toBe(400);
  });

  it('turns the guest into a full account on register, keeping the same user', async () => {
    const guest = { userId, displayName: 'Guest', language: 'sr', role: 'user', privacyAcceptedAt: 'x', createdAt: 'x' };
    database.on(QueryCommand).resolves({ Items: [] });
    database.on(GetCommand).resolves({ Item: guest });
    database.on(UpdateCommand).resolves({ Attributes: { ...guest, email: 'ana@example.com' } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: await loggedIn(),
      payload: { email: 'Ana@Example.com', password: 'long-enough', displayName: 'Ana', language: 'hu', acceptPrivacy: true },
    });

    expect(response.statusCode).toBe(200);
    expect(database.commandCalls(PutCommand)).toHaveLength(0);
    const update = database.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.Key).toEqual({ userId });
    expect(update.ExpressionAttributeValues![':email']).toBe('ana@example.com');
  });

  it('moves the reports of a guest when the guest logs into an existing account', async () => {
    const guestId = userId;
    const accountId = '019a9a3c-6b1e-7000-8000-000000000002';
    const passwordHash = await hashPassword('correct-horse');
    database.on(GetCommand).resolves({
      Item: { userId: guestId, displayName: 'Guest', role: 'user', reportCount: 1, lastReportAt: '2026-11-26T10:00:00Z' },
    });
    database.on(QueryCommand, { IndexName: 'byEmail' }).resolves({
      Items: [{ userId: accountId, email: 'ana@example.com', passwordHash, role: 'user' }],
    });
    database
      .on(QueryCommand, { KeyConditionExpression: 'userId = :userId' })
      .resolves({ Items: [{ userId: guestId, reportId: 'r1', strength: 3 }] });
    database.on(BatchWriteCommand).resolves({});
    database.on(DeleteCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: await loggedIn(),
      payload: { email: 'ana@example.com', password: 'correct-horse' },
    });

    expect(response.statusCode).toBe(200);
    const [copy, remove] = database.commandCalls(BatchWriteCommand).map((call) => Object.values(call.args[0].input.RequestItems!)[0]!);
    expect(copy![0]!.PutRequest!.Item).toMatchObject({ userId: accountId, reportId: 'r1' });
    expect(remove![0]!.DeleteRequest!.Key).toEqual({ userId: guestId, reportId: 'r1' });
    expect(database.commandCalls(DeleteCommand)[0]!.args[0].input.Key).toEqual({ userId: guestId });
    // The guest's report count is added to the account.
    const count = database.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(count.Key).toEqual({ userId: accountId });
    expect(count.ExpressionAttributeValues).toEqual({ ':count': 1, ':at': '2026-11-26T10:00:00Z' });
  });
});

describe('deleting an account', () => {
  it('deletes the user but keeps their reports, without the user or the comment', async () => {
    database.on(QueryCommand).resolves({ Items: [{ userId, reportId: 'r1', strength: 4, comment: 'Near my house' }] });
    database.on(BatchWriteCommand).resolves({});
    database.on(DeleteCommand).resolves({});

    const response = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: await loggedIn() });

    expect(response.statusCode).toBe(204);
    const [kept, removed] = database
      .commandCalls(BatchWriteCommand)
      .map((call) => Object.values(call.args[0].input.RequestItems!)[0]!);
    expect(kept![0]!.PutRequest!.Item).toEqual({
      userId: '00000000-0000-0000-0000-000000000000',
      reportId: 'r1',
      strength: 4,
    });
    expect(removed![0]!.DeleteRequest!.Key).toEqual({ userId, reportId: 'r1' });
    expect(database.commandCalls(DeleteCommand)[0]!.args[0].input.Key).toEqual({ userId });
  });
});

describe('reports', () => {
  it('needs a login', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/reports', payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it('saves a report with the weather added by the server', async () => {
    database.on(QueryCommand).resolves({ Items: [] });
    database.on(PutCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: await loggedIn(),
      payload: { location: topola, strength: 4 },
    });

    expect(response.statusCode).toBe(201);
    const report = response.json();
    expect(report.areaId).toBe('backa-topola');
    expect(report.odorKind).toBe('not_set');
    expect(report.weather).toEqual({
      windSpeedMs: 3.2,
      windDirectionDeg: 270,
      temperatureC: 8.4,
      humidityPercent: 81,
      pressureHpa: 1021.3,
    });
    // The user's report count goes up, for the admin "Users" screen.
    const count = database.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(count.Key).toEqual({ userId });
    expect(count.UpdateExpression).toBe('ADD reportCount :count SET lastReportAt = :at');
    expect(count.ExpressionAttributeValues![':count']).toBe(1);
  });

  it('refuses reports from a blocked user', async () => {
    database.on(GetCommand).resolves({ Item: { userId, role: 'user', blocked: true } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: await loggedIn(),
      payload: { location: topola, strength: 4 },
    });

    expect(response.statusCode).toBe(403);
    expect(database.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('still saves the report when the weather service is down', async () => {
    database.on(QueryCommand).resolves({ Items: [] });
    database.on(PutCommand).resolves({});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: await loggedIn(),
      payload: { location: topola, strength: 2 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().weather).toBeUndefined();
  });

  it('saves a location outside every area under the area "unknown"', async () => {
    database.on(QueryCommand).resolves({ Items: [] });
    database.on(PutCommand).resolves({});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: await loggedIn(),
      payload: { location: { lat: 44.8125, lon: 20.4612 }, strength: 3 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().areaId).toBe('unknown');
    expect(database.commandCalls(PutCommand)[0]!.args[0].input.Item!.areaDay).toMatch(/^unknown#/);
  });

  it('rejects a report without a strength', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: await loggedIn(),
      payload: { location: topola },
    });
    expect(response.statusCode).toBe(400);
  });

  it('stops a user after 10 reports in an hour', async () => {
    const justNow = new Date().toISOString();
    database.on(QueryCommand).resolves({ Items: Array.from({ length: 10 }, () => ({ createdAt: justNow })) });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: await loggedIn(),
      payload: { location: topola, strength: 3 },
    });
    expect(response.statusCode).toBe(429);
  });

  it('lets the owner add a comment later', async () => {
    const stored = {
      reportId: '019a9a3c-6b1e-7000-8000-0000000000aa',
      userId,
      areaId: 'backa-topola',
      areaDay: 'backa-topola#2026-11-17',
      createdAt: '2026-11-17T18:30:00.000Z',
      observedAt: '2026-11-17T18:30:00.000Z',
      location: topola,
      strength: 3,
      odorKind: 'not_set',
    };
    database.on(GetCommand).resolves({ Item: stored });
    database.on(UpdateCommand).resolves({ Attributes: { ...stored, comment: 'Still there' } });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/reports/${stored.reportId}`,
      headers: await loggedIn(),
      payload: { comment: 'Still there' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().comment).toBe('Still there');
  });

  it('lets the owner change strength and odor kind', async () => {
    const stored = {
      reportId: '019a9a3c-6b1e-7000-8000-0000000000cc',
      userId,
      areaId: 'backa-topola',
      areaDay: 'backa-topola#2026-11-17',
      createdAt: '2026-11-17T18:30:00.000Z',
      observedAt: '2026-11-17T18:30:00.000Z',
      location: topola,
      strength: 3,
      odorKind: 'not_set',
    };
    database.on(GetCommand).resolves({ Item: stored });
    database.on(UpdateCommand).resolves({ Attributes: { ...stored, strength: 5, odorKind: 'pig_manure' } });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/reports/${stored.reportId}`,
      headers: await loggedIn(),
      payload: { strength: 5, odorKind: 'pig_manure' },
    });

    expect(response.statusCode).toBe(200);
    const update = database.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ExpressionAttributeValues).toEqual({ ':strength': 5, ':odorKind': 'pig_manure' });
  });

  it('lists reports for everyone without names or exact locations, marking the caller\'s own', async () => {
    database.on(QueryCommand).resolves({
      Items: [
        {
          reportId: '019a9a3c-6b1e-7000-8000-0000000000bb',
          userId,
          areaId: 'backa-topola',
          observedAt: '2026-11-17T18:30:00.000Z',
          location: { lat: 45.815549, lon: 19.631812 },
          strength: 5,
          odorKind: 'pig_manure',
          comment: 'Right behind my house at Main Street 12',
        },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/reports?areaId=backa-topola&from=2026-11-17T00:00:00Z&to=2026-11-17T23:59:59Z',
      headers: await loggedIn(),
    });

    expect(response.statusCode).toBe(200);
    const [report] = response.json();
    expect(report.location).toEqual({ lat: 45.816, lon: 19.632 });
    expect(report).not.toHaveProperty('userId');
    expect(report.comment).toBe('Right behind my house at Main Street 12');
    expect(report.isMine).toBe(true);
  });

  it('lists reports from outside every area only for admins', async () => {
    database.on(QueryCommand).resolves({ Items: [] });
    const url = '/api/v1/reports?areaId=unknown&from=2026-11-17T00:00:00Z&to=2026-11-17T23:59:59Z';

    const asUser = await app.inject({ method: 'GET', url, headers: await loggedIn() });
    const asAdmin = await app.inject({ method: 'GET', url, headers: await loggedIn('admin') });

    expect(asUser.statusCode).toBe(403);
    expect(asAdmin.statusCode).toBe(200);
  });
});

describe('admin: users', () => {
  const otherId = '019a9a3c-6b1e-7000-8000-000000000002';
  const other = {
    userId: otherId,
    email: 'marko@example.com',
    passwordHash: 'scrypt$secret',
    googleId: 'g-123',
    displayName: 'Marko',
    language: 'sr',
    role: 'user',
    createdAt: '2026-11-21T10:00:00Z',
    reportCount: 9,
    lastReportAt: '2026-11-26T18:00:00Z',
  };
  const guest = { userId: '019a9a3c-6b1e-7000-8000-000000000003', displayName: 'Gost', language: 'hu', role: 'user', createdAt: '2026-11-25T10:00:00Z' };

  it('is for admins only', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/users', headers: await loggedIn() });
    expect(response.statusCode).toBe(403);
  });

  it('lists every user, newest first, without passwords', async () => {
    database.on(ScanCommand).resolvesOnce({ Items: [other], LastEvaluatedKey: { userId: otherId } }).resolves({ Items: [guest] });

    const response = await app.inject({ method: 'GET', url: '/api/v1/users', headers: await loggedIn('admin') });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: guest.userId,
        isGuest: true,
        displayName: 'Gost',
        language: 'hu',
        role: 'user',
        createdAt: '2026-11-25T10:00:00Z',
        signInMethods: [],
        blocked: false,
        reportCount: 0,
      },
      {
        id: otherId,
        email: 'marko@example.com',
        isGuest: false,
        displayName: 'Marko',
        language: 'sr',
        role: 'user',
        createdAt: '2026-11-21T10:00:00Z',
        signInMethods: ['password', 'google'],
        blocked: false,
        reportCount: 9,
        lastReportAt: '2026-11-26T18:00:00Z',
      },
    ]);
  });

  it('makes a user an admin and blocks them', async () => {
    database.on(GetCommand).resolves({ Item: other });
    database.on(UpdateCommand).resolves({ Attributes: { ...other, role: 'admin', blocked: true } });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${otherId}`,
      headers: await loggedIn('admin'),
      payload: { role: 'admin', blocked: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ role: 'admin', blocked: true });
    const update = database.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.Key).toEqual({ userId: otherId });
    expect(update.ExpressionAttributeValues).toEqual({ ':role': 'admin', ':blocked': true });
  });

  it("does not let admins change or delete their own account", async () => {
    const headers = await loggedIn('admin');
    const change = await app.inject({ method: 'PATCH', url: `/api/v1/users/${userId}`, headers, payload: { blocked: true } });
    const remove = await app.inject({ method: 'DELETE', url: `/api/v1/users/${userId}`, headers });
    expect(change.statusCode).toBe(400);
    expect(remove.statusCode).toBe(400);
  });

  it('answers 404 for an unknown user', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${otherId}`,
      headers: await loggedIn('admin'),
      payload: { role: 'admin' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('deletes a user and keeps their reports without the user or the comment', async () => {
    database.on(GetCommand).resolves({ Item: other });
    database.on(QueryCommand).resolves({ Items: [{ userId: otherId, reportId: 'r1', strength: 4, comment: 'Kod škole' }] });
    database.on(BatchWriteCommand).resolves({});
    database.on(DeleteCommand).resolves({});

    const response = await app.inject({ method: 'DELETE', url: `/api/v1/users/${otherId}`, headers: await loggedIn('admin') });

    expect(response.statusCode).toBe(204);
    const kept = Object.values(database.commandCalls(BatchWriteCommand)[0]!.args[0].input.RequestItems!)[0]!;
    expect(kept[0]!.PutRequest!.Item).toEqual({ userId: '00000000-0000-0000-0000-000000000000', reportId: 'r1', strength: 4 });
    expect(database.commandCalls(DeleteCommand)[0]!.args[0].input.Key).toEqual({ userId: otherId });
  });
});
