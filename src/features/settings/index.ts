// `features/settings` owns only the device-local display-name model (depends on
// `entities/session` alone). The per-user persistence + sync orchestration
// (`userSettings`, `settingsSync`) lives in `app/model` because it composes
// several features and a feature must not import a sibling feature.
export { displayNameAtom, sidebarDisplayNameAtom, startViewAtom } from './model/settings'
export type { StartView } from './model/settings'
