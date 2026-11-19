// The one DynamoDB connection shared by all files in src/db.
//
// All database access lives in src/db. The rest of the code only calls the
// functions exported from there, so moving to another database later means
// rewriting this folder and nothing else.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// The "document client" lets us read and write plain JavaScript objects.
export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
