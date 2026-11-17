// Entry point on AWS Lambda. Every request to the Function URL arrives here
// and is passed to the same app that runs locally.

import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';

export const handler = awsLambdaFastify(buildApp());
