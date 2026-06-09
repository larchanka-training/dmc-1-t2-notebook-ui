export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, code?: string, message?: string) {
    super(message ?? `API error ${status}${code ? ` (${code})` : ''}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export class BadRequestError extends ApiError {
  constructor(code?: string, message?: string) {
    super(400, code, message)
    this.name = 'BadRequestError'
  }
}

export class UnauthorizedError extends ApiError {
  constructor(code?: string, message?: string) {
    super(401, code, message)
    this.name = 'UnauthorizedError'
  }
}

export class NotFoundError extends ApiError {
  constructor(code?: string, message?: string) {
    super(404, code, message)
    this.name = 'NotFoundError'
  }
}

/**
 * Thrown when the backend returns 429. Exposes the parsed `Retry-After`
 * header so callers can implement honest back-off instead of guessing.
 *
 * The header may arrive as either a delta-seconds integer (RFC 7231
 * §7.1.3) or an HTTP-date. We only parse the delta-seconds form here;
 * an unparseable or absent value leaves `retryAfter` as `undefined`,
 * which the UI should treat as "no machine-readable hint".
 */
export class RateLimitedError extends ApiError {
  readonly retryAfter?: number

  constructor(code?: string, message?: string, retryAfter?: number) {
    super(429, code, message)
    this.name = 'RateLimitedError'
    this.retryAfter = retryAfter
  }
}

export function parseRetryAfter(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined
  const seconds = Number.parseInt(headerValue, 10)
  if (Number.isNaN(seconds) || seconds < 0) return undefined
  return seconds
}

// Backend returns errors as { error: { code, message, fields } } — see api/app/core/errors.py
type ErrorBody =
  | { error: { code?: string; message?: string } }
  | { code?: string; message?: string }
  | undefined

function unwrapError(body: ErrorBody): { code?: string; message?: string } | undefined {
  if (!body) return undefined
  if ('error' in body) return body.error
  return body
}

export function toApiError(status: number, body: ErrorBody, retryAfter?: number): ApiError {
  const error = unwrapError(body)
  switch (status) {
    case 400:
      return new BadRequestError(error?.code, error?.message)
    case 401:
      return new UnauthorizedError(error?.code, error?.message)
    case 404:
      return new NotFoundError(error?.code, error?.message)
    case 429:
      return new RateLimitedError(error?.code, error?.message, retryAfter)
    default:
      return new ApiError(status, error?.code, error?.message)
  }
}
