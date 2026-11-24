// An error that should be sent to the caller with a specific HTTP status.
// Throw it from any route, e.g. `throw new HttpError(404, 'Report not found')`.
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
