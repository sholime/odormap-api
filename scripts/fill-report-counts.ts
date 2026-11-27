// Fills in each user's report count and last report time, which the admin "Users" screen shows.
// New reports keep them up to date; this is for the reports sent before that existed.
// Run it once per stage, right after deploying, with AWS credentials for that account:
//
//   npx tsx scripts/fill-report-counts.ts staging
//
// It counts every report again and overwrites the numbers, so running it twice is harmless.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const stage = process.argv[2];
if (stage !== 'staging' && stage !== 'production') {
  console.error('Usage: npx tsx scripts/fill-report-counts.ts staging|production');
  process.exit(1);
}
const usersTable = `odormap-${stage}-users`;
const reportsTable = `odormap-${stage}-reports`;
// Reports of deleted accounts belong to this id, which is not a user (see src/db/reports.ts).
const DELETED_USER_ID = '00000000-0000-0000-0000-000000000000';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'eu-central-1' }));

// Count every report per user, and find each user's newest one.
const counts = new Map<string, { count: number; last: string }>();
let startKey: Record<string, unknown> | undefined;
do {
  const page = await db.send(
    new ScanCommand({
      TableName: reportsTable,
      ProjectionExpression: 'userId, createdAt',
      ExclusiveStartKey: startKey,
    }),
  );
  for (const item of page.Items ?? []) {
    const { userId, createdAt } = item as { userId: string; createdAt: string };
    if (userId === DELETED_USER_ID) continue;
    const current = counts.get(userId) ?? { count: 0, last: '' };
    counts.set(userId, { count: current.count + 1, last: createdAt > current.last ? createdAt : current.last });
  }
  startKey = page.LastEvaluatedKey;
} while (startKey);

let updated = 0;
for (const [userId, { count, last }] of counts) {
  try {
    await db.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { userId },
        UpdateExpression: 'SET reportCount = :count, lastReportAt = :at',
        ExpressionAttributeValues: { ':count': count, ':at': last },
        ConditionExpression: 'attribute_exists(userId)',
      }),
    );
    updated++;
  } catch (error) {
    console.warn(`Skipped ${userId}: ${(error as Error).name}`);
  }
}
console.log(`Done: ${updated} users updated in ${usersTable}.`);
