import { atom } from '@reatom/core'

// Whether LLM features are available to the signed-in user (roadmap Step 8b;
// decision: `docs/specs/llm-provider-toggle-security-contract.md`).
//
// Lives in `entities` rather than `features/settings` on purpose: three features
// and two pages read it (notebook generation, web-llm loading, the playground),
// and a feature must not import a sibling feature. `entities` is below all of
// them, so this is the lowest layer every consumer can legitimately reach.
//
// NOT self-persisted: like the other per-user settings it is hydrated from and
// written back to the `settings:<userId>` record by `app/model/settingsSync.ts`,
// so two accounts on one browser keep separate values.
//
// IMPORTANT — this is a UX preference, NOT a security control. It is
// client-side state derived from user-editable localStorage; a determined
// caller can flip it. Its job is preventing ACCIDENTAL cloud requests and
// unwanted multi-gigabyte model downloads. The real controls on
// `POST /llm/generate` are server-side and unchanged: authentication, the
// per-user rate limit, and the request byte caps. Never describe this flag as
// authorization, and never rely on it to keep anyone out of anything.
//
// GUARDED ENTRY POINTS — keep this list in step with the code. A new generation
// or model-download path must check this atom, or the switch silently stops
// meaning "off":
//   cloud (T2)
//     - features/notebook/model/cloudCodeGenerator.ts  cloudGenerateAndInsertCodeAction
//     - features/notebook/model/agentChat.ts           agentSendAction
//     - pages/llm-playground/model/cloudPlayground.ts  cloudSendAction
//   in-browser (T1)
//     - features/notebook/model/codeGenerator.ts       generateAndInsertCodeAction
//     - features/notebook/model/agentChat.ts           agentSendInBrowserAction
//     - features/web-llm/model/webLlm.ts               loadModelAction (all downloads)
//     - features/web-llm/model/webLlm.ts               sendMessageAction
//   implicit
//     - app/model/settingsSync.ts                      sign-in auto-load
//
// The matching negative tests live in `llmEnabledGate.test.ts` beside the first
// two feature groups, in `webLlm.llmEnabled.test.ts`, in the playground's
// `cloudPlayground.test.ts`, and in `settingsSync.test.ts`.
//
// Default `true` so existing users see no behaviour change on upgrade.
export const llmEnabledAtom = atom(true, 'llm.enabled')
