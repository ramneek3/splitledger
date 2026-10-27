/**
 * Domain error carrying an HTTP status and a stable machine-readable code
 * that the client uses to decide how to react (e.g. VERSION_CONFLICT -> reload).
 */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Please sign in to continue') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You are not allowed to do that') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code, msg, details) => new AppError(409, code, msg, details);

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
