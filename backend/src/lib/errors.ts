/** Typed application error. `code` is stable and safe to show to clients; `message` is user-facing. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

export const Errors = {
  badRequest: (message = 'Invalid request.', details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  validation: (details: unknown) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', details),
  unauthorized: (message = 'Authentication required.') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to do that.') => new AppError(403, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  insufficientCredits: () => new AppError(409, 'INSUFFICIENT_CREDITS', 'Insufficient sandbox credits.'),
  tooMany: () => new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.'),
  unprocessable: (code: string, message: string) => new AppError(422, code, message),
}
