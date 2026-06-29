// Base-aware path helpers for imperative navigation.
//
// The router composes routes under import.meta.env.BASE_URL ('/' normally,
// '/pr-<N>/' under a per-PR preview — see app/model/routes.tsx). But anything
// that bypasses the router — window.location.replace, <a href> — must add the
// base itself, or under a preview it points outside the app (e.g. '/login'
// instead of '/pr-77/login', which 404s). Vite guarantees BASE_URL ends with
// '/'.
const base = import.meta.env.BASE_URL

/** Prefix an in-app path with the Vite base. `appPath('login')` → '/pr-77/login'. */
export const appPath = (path = ''): string => base + path.replace(/^\//, '')

/** Absolute in-app path of the login page, base included. */
export const LOGIN_PATH = appPath('login')

/** Absolute in-app path of the settings page, base included. */
export const SETTINGS_PATH = appPath('settings')
