// Public-facing copy for the cloud LLM tier while it runs in private testing
// (roadmap Step 8d-2).
//
// Background: the backend can restrict `POST /llm/generate` to an allowlist of
// developer accounts (`LLM_ALLOWED_EMAILS`). While that is set, cloud generation
// is NOT generally available, and the UI has to say so — both up front, so nobody
// discovers it by hitting a wall, and at the point of denial.
//
// The client cannot know whether the signed-in account is on the allowlist: that
// is a server-side decision, deliberately not exposed (an endpoint that answered
// "are you allowlisted?" would leak the policy and invite probing). So the label
// is unconditional and the message is only shown after an actual 403 — the UI
// states the feature's status, it does not predict the verdict.
//
// Wording rules for anything added here:
//   - say it is limited testing, not that it is broken;
//   - do not promise a date or a rollout;
//   - do not imply retrying will help — a 403 is permanent for this account.

/** Short badge text next to cloud-tier controls. */
export const CLOUD_LLM_BETA_LABEL = 'Beta'

/** Tooltip / helper line explaining the badge. */
export const CLOUD_LLM_BETA_HINT =
  'Cloud AI is in limited testing and is not available on every account yet. The in-browser model works for everyone.'

/** Shown after the backend refuses this account with 403. */
export const CLOUD_LLM_RESTRICTED_MESSAGE =
  'Cloud AI is in limited testing and is not enabled for this account. Use the in-browser model instead.'
