# odormap-api

Backend API for OdorMap: residents of Bačka Topola report bad odors, stored with location and wind data.

It runs as one AWS Lambda function with a public URL, stores data in DynamoDB,
and gets wind data from [Open-Meteo](https://open-meteo.com). Shared types and
validation come from [odormap-common](https://github.com/sholime/odormap-common).

## How the code is organised

```
src/
  app.ts          builds the web server and registers all routes
  lambda.ts       entry point on AWS Lambda
  local.ts        entry point on your computer (npm run dev)
  config.ts       settings read from environment variables
  areas.ts        the towns the app covers and their boundaries
  auth.ts         reads the logged-in user from the request
  geo.ts          rounding locations for public reports
  errors.ts       HttpError, for answering with a status code
  routes/         one file per group of endpoints
  services/       passwords, login tokens, Google sign-in, weather
  db/             all database access; nothing else talks to DynamoDB
test/             tests, with the database and weather replaced by fakes
template.yaml     the AWS resources (function, tables, logs)
infra/            one-time AWS setup for automatic deploys
```

A request flows like this: `routes/*.ts` checks the login (`auth.ts`) and the input
(schemas from odormap-common), then calls `db/*.ts` and `services/*.ts`.

## Endpoints

All under `/api/v1`. "Login" means an `Authorization: Bearer <accessToken>` header.

| Method | Path | Who | What it does |
| --- | --- | --- | --- |
| POST | /auth/register | Anyone | Create an account with email and password (a logged-in guest keeps their reports) |
| POST | /auth/login | Anyone | Log in, get tokens (a logged-in guest's reports move to the account) |
| POST | /auth/google | Anyone | Sign in or register with Google (a logged-in guest keeps their reports) |
| POST | /auth/guest | Anyone | Use the app without an account (creates a guest) |
| POST | /auth/refresh | Anyone with a refresh token | Get new tokens |
| GET, PATCH | /me | Login | Own profile |
| POST | /reports | Login | Report an odor; the server adds the weather |
| PATCH | /reports/:id | Login, owner | Change strength, odor kind or comment later |
| GET | /reports/mine | Login | Own latest 50 reports |
| GET | /reports | Login | Anonymous reports by area and time, optional map box |
| GET | /sources | Login | Known pollution sources |
| POST, PATCH | /sources | Admin | Add or change a pollution source |
| GET | /areas | Anyone | Covered areas |

`GET /health` answers `{"ok":true}`.

## Working on it

```bash
npm install
npm test           # run the tests
npm run typecheck  # check types
npm run dev        # run locally on http://localhost:3000 (needs AWS credentials and tables)
```

## Deploying

Merging into main deploys to staging; a version tag deploys to production.
One-time setup: [docs/deploy-setup.md](docs/deploy-setup.md).
