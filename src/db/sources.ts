// Reading and writing pollution sources.
//
// Table keys: sourceId. The table is small (a few dozen places), so listing
// reads the whole table.

import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { PollutionSource } from '@odormap/common';
import { config } from '../config.js';
import { db } from './client.js';

/** A pollution source as stored in the database. */
export type SourceRecord = Omit<PollutionSource, 'id'> & { sourceId: string };

export function toPollutionSource(record: SourceRecord): PollutionSource {
  const { sourceId, ...rest } = record;
  return { id: sourceId, ...rest };
}

export async function listSources(): Promise<SourceRecord[]> {
  const result = await db.send(new ScanCommand({ TableName: config.sourcesTable }));
  return (result.Items ?? []) as SourceRecord[];
}

export async function getSource(sourceId: string): Promise<SourceRecord | undefined> {
  const result = await db.send(new GetCommand({ TableName: config.sourcesTable, Key: { sourceId } }));
  return result.Item as SourceRecord | undefined;
}

/** Creates or fully replaces a source. */
export async function saveSource(record: SourceRecord): Promise<void> {
  await db.send(new PutCommand({ TableName: config.sourcesTable, Item: record }));
}
