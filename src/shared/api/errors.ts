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

type ErrorBody = { code?: string; message?: string } | undefined

export function toApiError(status: number, body: ErrorBody): ApiError {
  switch (status) {
    case 400:
      return new BadRequestError(body?.code, body?.message)
    case 401:
      return new UnauthorizedError(body?.code, body?.message)
    case 404:
      return new NotFoundError(body?.code, body?.message)
    default:
      return new ApiError(status, body?.code, body?.message)
  }
}
