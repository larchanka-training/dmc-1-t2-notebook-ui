import { authClient } from './client'
import { toApiError } from './errors'
import type { components } from './generated/openapi-ts/auth'

export type User = components['schemas']['User']
export type LoginRequest = components['schemas']['LoginRequest']
export type LoginResponse = components['schemas']['LoginResponse']

export async function login(body: LoginRequest): Promise<LoginResponse> {
  const { data, error, response } = await authClient.POST('/auth/login', { body })
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}

export async function logout(): Promise<void> {
  const { error, response } = await authClient.POST('/auth/logout')
  if (error !== undefined) throw toApiError(response.status, error)
}

export async function getMe(): Promise<User> {
  const { data, error, response } = await authClient.GET('/auth/me')
  if (error !== undefined || !data) throw toApiError(response.status, error)
  return data
}
