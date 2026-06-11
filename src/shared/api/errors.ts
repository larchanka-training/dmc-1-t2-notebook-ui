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

export class ConflictError extends ApiError {
  constructor(code?: string, message?: string) {
    super(409, code, message)
    this.name = 'ConflictError'
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

/**
 * Thrown when the request never reached the server (offline, DNS failure,
 * connection reset). `fetch` rejects with a TypeError in these cases; the
 * facade catches it and rethrows as a NetworkError, so callers can tell
 * "no answer at all" apart from an HTTP status (retry vs. stop on 401).
 *
 * `status` is 0 — there was no HTTP response. Extends ApiError so a single
 * `instanceof ApiError` catch still covers it. `cause` carries the original
 * fetch error for diagnostics.
 */
export class NetworkError extends ApiError {
  constructor(message = 'Network request failed', cause?: unknown) {
    super(0, undefined, message)
    this.name = 'NetworkError'
    this.cause = cause
  }
}

export function parseRetryAfter(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined
  const seconds = Number.parseInt(headerValue, 10)
  if (Number.isNaN(seconds) || seconds < 0) return undefined
  return seconds
}

// Backend wraps errors as { error: { code, message, fields } } (see
// api/app/core/errors.py); legacy/flat { code, message } is still accepted. The
// body is whatever JSON the server returned (including FastAPI's
// { detail: [...] } validation envelope), so treat it as unknown and validate
// before reading.
function unwrapError(body: unknown): { code?: string; message?: string } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  const inner =
    typeof record.error === 'object' && record.error !== null
      ? (record.error as Record<string, unknown>)
      : record
  const code = typeof inner.code === 'string' ? inner.code : undefined
  const message = typeof inner.message === 'string' ? inner.message : undefined
  if (code === undefined && message === undefined) return undefined
  return { code, message }
}

export function toApiError(status: number, body: unknown, retryAfter?: number): ApiError {
  const error = unwrapError(body)
  switch (status) {
    case 400:
      return new BadRequestError(error?.code, error?.message)
    case 401:
      return new UnauthorizedError(error?.code, error?.message)
    case 404:
      return new NotFoundError(error?.code, error?.message)
    case 409:
      return new ConflictError(error?.code, error?.message)
    case 429:
      return new RateLimitedError(error?.code, error?.message, retryAfter)
    default:
      return new ApiError(status, error?.code, error?.message)
  }
}
