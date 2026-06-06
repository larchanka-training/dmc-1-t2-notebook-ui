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

export function toApiError(status: number, body: ErrorBody): ApiError {
  const error = unwrapError(body)
  switch (status) {
    case 400:
      return new BadRequestError(error?.code, error?.message)
    case 401:
      return new UnauthorizedError(error?.code, error?.message)
    case 404:
      return new NotFoundError(error?.code, error?.message)
    default:
      return new ApiError(status, error?.code, error?.message)
  }
}
