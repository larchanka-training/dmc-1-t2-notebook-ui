import { http, HttpResponse } from 'msw'
import type { components as AuthC } from '@/shared/api/generated/openapi-ts/auth'
import type { components as NotebookC } from '@/shared/api/generated/openapi-ts/notebook'

type User = AuthC['schemas']['User']
type LoginRequest = AuthC['schemas']['LoginRequest']
type Notebook = NotebookC['schemas']['Notebook']
type CreateNotebookRequest = NotebookC['schemas']['CreateNotebookRequest']

const state = {
  user: null as User | null,
  token: null as string | null,
  notebooks: [
    {
      id: 'nb-seed-1',
      title: 'Welcome notebook',
      createdAt: '2026-05-01T00:00:00Z',
      cells: [],
    },
    {
      id: 'nb-seed-2',
      title: 'Scratchpad',
      createdAt: '2026-05-10T00:00:00Z',
      cells: [],
    },
  ] as Notebook[],
}

function hasBearer(request: Request): boolean {
  return request.headers.get('authorization')?.startsWith('Bearer ') ?? false
}

const unauthorized = () =>
  HttpResponse.json({ code: 'unauthenticated', message: 'missing bearer token' }, { status: 401 })

export const handlersArray = [
  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as LoginRequest
    if (!body.email || !body.password) {
      return HttpResponse.json(
        { code: 'invalid_request', message: 'email and password required' },
        { status: 400 },
      )
    }
    if (body.password === 'wrong') {
      return HttpResponse.json(
        { code: 'invalid_credentials', message: 'wrong password' },
        { status: 401 },
      )
    }
    state.user = {
      id: 'u-mock-1',
      email: body.email,
      displayName: body.email.split('@')[0],
    }
    state.token = `mock-jwt-${Math.random().toString(36).slice(2)}`
    return HttpResponse.json({ token: state.token, user: state.user })
  }),

  http.post('/api/auth/logout', ({ request }) => {
    if (!hasBearer(request)) return unauthorized()
    state.user = null
    state.token = null
    return new HttpResponse(null, { status: 204 })
  }),

  http.get('/api/auth/me', ({ request }) => {
    if (!hasBearer(request)) return unauthorized()
    // MSW state is in-memory and resets on full page reload. The token, however,
    // persists in localStorage via `withLocalStorage`. To keep the mocked
    // "session" alive across reloads, fabricate a user on demand.
    if (!state.user) {
      state.user = { id: 'u-mock-1', email: 'demo@example.com', displayName: 'demo' }
    }
    return HttpResponse.json(state.user)
  }),

  http.get('/api/notebooks', ({ request }) => {
    if (!hasBearer(request)) return unauthorized()
    return HttpResponse.json(state.notebooks)
  }),

  http.post('/api/notebooks', async ({ request }) => {
    if (!hasBearer(request)) return unauthorized()
    const body = (await request.json()) as CreateNotebookRequest
    if (!body.title) {
      return HttpResponse.json(
        { code: 'invalid_request', message: 'title is required' },
        { status: 400 },
      )
    }
    const nb: Notebook = {
      id: `nb-${Math.random().toString(36).slice(2)}`,
      title: body.title,
      createdAt: new Date().toISOString(),
      cells: [],
    }
    state.notebooks.push(nb)
    return HttpResponse.json(nb, { status: 201 })
  }),

  http.post('/api/notebooks/:notebookId/cells/:cellId/run', ({ request, params }) => {
    if (!hasBearer(request)) return unauthorized()
    const nb = state.notebooks.find((n) => n.id === params.notebookId)
    if (!nb) {
      return HttpResponse.json(
        { code: 'not_found', message: 'notebook not found' },
        { status: 404 },
      )
    }
    return HttpResponse.json({
      status: 'done',
      output: `[mock] notebook=${nb.id} cell=${params.cellId} executed`,
      durationMs: 42,
    })
  }),
]
