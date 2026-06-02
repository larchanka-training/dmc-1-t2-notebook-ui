import { authClient } from './client'
import { toApiError } from './errors'
import type { components } from './generated/openapi-ts/auth'

export type User = components['schemas']['User']
export type OtpRequestResponse = components['schemas']['OtpRequestResponse']
export type AuthResponse = components['schemas']['AuthResponse']
export type RefreshResponse = components['schemas']['RefreshResponse']

export async function requestOtp(email: string): Promise<OtpRequestResponse | null> {
  const { data, error, response } = await authClient.POST('/auth/otp/request', {
    body: { email },
  })
  if (error !== undefined) throw toApiError(response.status, error)
  // 200 dev/local/test → OTP in body; 204 production → null
  return data ?? null
}

export async function verifyOtp(body: { email: string; otp: string }): Promise<AuthResponse> {
  const { data, error, response } = await authClient.POST('/auth/otp/verify', { body })
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}

export async function refreshTokens(refreshToken: string): Promise<RefreshResponse> {
  const { data, error, response } = await authClient.POST('/auth/refresh', {
    body: { refreshToken },
  })
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}

export async function logout(refreshToken: string): Promise<void> {
  // Logout is always 204 — no error responses defined in the schema.
  await authClient.POST('/auth/logout', { body: { refreshToken } })
}

export async function getMe(): Promise<User> {
  const { data, error, response } = await authClient.GET('/auth/me')
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}
