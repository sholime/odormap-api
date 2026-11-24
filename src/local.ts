// Runs the API on your computer: `npm run dev`, then open http://localhost:3000/health.
// It talks to the DynamoDB tables named in config.ts, using your AWS credentials.

import { buildApp } from './app.js';

const app = buildApp();
await app.listen({ port: 3000 });
