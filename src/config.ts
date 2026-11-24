// All settings come from environment variables.
// In AWS they are set by template.yaml; locally you can export them in your shell.

const stage = process.env.STAGE ?? 'local';
const isLocal = stage === 'local' || stage === 'test';

function setting(name: string, localDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isLocal) return localDefault;
  throw new Error(`Missing environment variable ${name}`);
}

export const config = {
  /** 'local', 'test', 'staging' or 'production'. */
  stage,

  usersTable: setting('USERS_TABLE', 'odormap-local-users'),
  sourcesTable: setting('SOURCES_TABLE', 'odormap-local-sources'),
  reportsTable: setting('REPORTS_TABLE', 'odormap-local-reports'),

  /** Secret used to sign login tokens. Must be long and random outside local. */
  jwtSecret: setting('JWT_SECRET', 'local-development-secret-not-for-real-use'),

  /** OAuth client id from Google Cloud Console, used to check Google sign-ins. */
  googleClientId: setting('GOOGLE_CLIENT_ID', 'local-google-client-id'),

  /** Web addresses allowed to call the API from a browser, comma separated. */
  allowedOrigins: setting('ALLOWED_ORIGINS', 'http://localhost:5173').split(','),
};
