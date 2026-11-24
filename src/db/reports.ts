// Reading and writing odor reports.
//
// Table keys: userId + reportId. Report ids are UUID version 7, which start
// with the time they were made, so sorting by id sorts by creation time.
// Index byAreaDay: areaDay ("backa-topola#2026-11-17") + observedAt,
// used to list reports in an area over a range of days.

import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { OdorReport, UpdateReportRequest } from '@odormap/common';
import { config } from '../config.js';
import { db } from './client.js';

/** A report as stored in the database. */
export type ReportRecord = Omit<OdorReport, 'id'> & {
  reportId: string;
  areaDay: string;
};

export function areaDayKey(areaId: string, isoTime: string): string {
  return `${areaId}#${isoTime.slice(0, 10)}`;
}

export function toOdorReport(record: ReportRecord): OdorReport {
  const { reportId, areaDay, ...rest } = record;
  return { id: reportId, ...rest };
}

export async function createReport(record: ReportRecord): Promise<void> {
  await db.send(new PutCommand({ TableName: config.reportsTable, Item: record }));
}

export async function getReport(userId: string, reportId: string): Promise<ReportRecord | undefined> {
  const result = await db.send(new GetCommand({ TableName: config.reportsTable, Key: { userId, reportId } }));
  return result.Item as ReportRecord | undefined;
}

/** Changes the given fields and returns the updated report. */
export async function updateReport(
  userId: string,
  reportId: string,
  changes: UpdateReportRequest,
): Promise<ReportRecord> {
  const fields = Object.entries(changes).filter(([, value]) => value !== undefined);
  const result = await db.send(
    new UpdateCommand({
      TableName: config.reportsTable,
      Key: { userId, reportId },
      UpdateExpression: 'SET ' + fields.map(([name]) => `#${name} = :${name}`).join(', '),
      ExpressionAttributeNames: Object.fromEntries(fields.map(([name]) => [`#${name}`, name])),
      ExpressionAttributeValues: Object.fromEntries(fields.map(([name, value]) => [`:${name}`, value])),
      ReturnValues: 'ALL_NEW',
    }),
  );
  return result.Attributes as ReportRecord;
}

/** A user's own reports, newest first. */
export async function listUserReports(userId: string, limit: number): Promise<ReportRecord[]> {
  const result = await db.send(
    new QueryCommand({
      TableName: config.reportsTable,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (result.Items ?? []) as ReportRecord[];
}

/** All reports in one area on one day (UTC) observed between from and to. */
export async function listReportsForAreaDay(
  areaDay: string,
  from: string,
  to: string,
): Promise<ReportRecord[]> {
  const records: ReportRecord[] = [];
  let startKey: Record<string, unknown> | undefined;
  // DynamoDB returns at most 1 MB per call, so keep asking until it has sent everything.
  do {
    const result = await db.send(
      new QueryCommand({
        TableName: config.reportsTable,
        IndexName: 'byAreaDay',
        KeyConditionExpression: 'areaDay = :areaDay AND observedAt BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':areaDay': areaDay, ':from': from, ':to': to },
        ExclusiveStartKey: startKey,
      }),
    );
    records.push(...((result.Items ?? []) as ReportRecord[]));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return records;
}

/**
 * Moves all of one user's reports to another user, e.g. when a guest logs into an existing account.
 * The user id is part of the key, so each report is copied to the new user, then the old copy is deleted.
 * If this stops halfway, running it again finishes the job.
 */
export async function moveReports(fromUserId: string, toUserId: string): Promise<void> {
  const records = await listAllUserReports(fromUserId);
  // DynamoDB writes at most 25 items per batch.
  for (let i = 0; i < records.length; i += 25) {
    const batch = records.slice(i, i + 25);
    await writeBatch(batch.map((record) => ({ PutRequest: { Item: { ...record, userId: toUserId } } })));
    await writeBatch(batch.map((record) => ({ DeleteRequest: { Key: { userId: fromUserId, reportId: record.reportId } } })));
  }
}

/**
 * The user id given to reports whose owner deleted their account.
 * It belongs to nobody, so the reports stay on the map and in the analysis
 * but can no longer be linked to a person.
 */
export const DELETED_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Keeps a user's reports when they delete their account: moves them to DELETED_USER_ID
 * and removes the comment, which is free text and could name the person.
 */
export async function anonymizeUserReports(userId: string): Promise<void> {
  const records = await listAllUserReports(userId);
  for (let i = 0; i < records.length; i += 25) {
    const batch = records.slice(i, i + 25);
    await writeBatch(
      batch.map(({ comment, ...record }) => ({ PutRequest: { Item: { ...record, userId: DELETED_USER_ID } } })),
    );
    await writeBatch(batch.map((record) => ({ DeleteRequest: { Key: { userId, reportId: record.reportId } } })));
  }
}

/** Every report of one user, reading page by page. */
async function listAllUserReports(userId: string): Promise<ReportRecord[]> {
  const records: ReportRecord[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await db.send(
      new QueryCommand({
        TableName: config.reportsTable,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ExclusiveStartKey: startKey,
      }),
    );
    records.push(...((result.Items ?? []) as ReportRecord[]));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return records;
}

type WriteRequest = NonNullable<ConstructorParameters<typeof BatchWriteCommand>[0]['RequestItems']>[string];

/** Sends one batch, repeating whatever DynamoDB could not process the first time. */
async function writeBatch(requests: WriteRequest): Promise<void> {
  let pending = requests;
  while (pending.length > 0) {
    const result = await db.send(new BatchWriteCommand({ RequestItems: { [config.reportsTable]: pending } }));
    pending = result.UnprocessedItems?.[config.reportsTable] ?? [];
  }
}
