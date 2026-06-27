export {
  accessTokenAtom,
  refreshTokenAtom,
  userAtom,
  setSession,
  setSessionUser,
  clearSession,
  sessionRestoredAtom,
  SESSION_STORAGE_KEYS,
  type SessionUser,
} from './model/session'
// NOTE: `startSessionCrossTabSync` is deliberately NOT re-exported here. It
// imports `@/setup` (which calls `clearStack()` at import time); pulling that
// into the widely-imported session barrel would transitively run `clearStack()`
// in every test that touches `@/entities/session` and break the shared
// `context.reset()` in the test harness. Import it directly from
// `./model/crossTabSync` where needed (only `app/model/setup.ts`).
