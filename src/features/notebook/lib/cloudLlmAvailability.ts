import { ApiError, ForbiddenError, RateLimitedError } from '@/shared/api/errors'

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

/**
 * The one formatter for cloud-LLM failures, shared by every cloud entry point.
 *
 * It exists because there were three: the cell toolbar, the Ask-agent dialog and
 * the playground each formatted errors their own way, so the Step 8d-2 allowlist
 * branch was added to two of them and silently missed the third — Ask-agent kept
 * showing `Generation failed: <raw message>` for a 403. One function means a new
 * branch cannot reach some surfaces and not others.
 *
 * `suggestion` is the only thing that legitimately varies: the notebook can point
 * a blocked user at the in-browser model, while the playground just says to try
 * again. Everything else — which conditions exist and what they mean — is shared.
 */
export function formatCloudLlmError(err: Error, suggestion: string): string {
  if (err instanceof RateLimitedError) {
    const wait = err.retryAfter ? ` Try again in ${err.retryAfter}s.` : ''
    return `Rate limit reached.${wait}`
  }

  // Allowlist denial. Matched on STATUS + code, not the code alone: the backend
  // reuses `llm_access_denied` for HTTP 500 when the SERVER's provider credentials
  // are rejected, and that one IS transient. A 403 carrying some other code is not
  // this case, so it falls through to the generic handling below.
  if (err instanceof ForbiddenError && err.code === 'llm_access_denied') {
    return CLOUD_LLM_RESTRICTED_MESSAGE
  }

  if (err instanceof ApiError) {
    if (err.status === 401) return 'Cloud AI requires sign-in. Log in and try again.'
    if (err.code === 'llm_internal' || err.code === 'llm_access_denied') {
      return `Cloud AI is temporarily unavailable. ${suggestion}`
    }
    if (err.code === 'request_too_large') return 'Prompt is too large for the cloud request.'
  }

  // Fallback matching on the message. Kept because not every failure arrives as a
  // typed ApiError (an action can reject with a plain Error carrying the code).
  const msg = err.message.toLowerCase()
  if (msg.includes('invalid_token') || msg.includes('401') || msg.includes('sign in')) {
    return 'Cloud AI requires sign-in. Log in and try again.'
  }
  if (msg.includes('prompt_rejected') || msg.includes('rejected')) {
    return 'Prompt was flagged by the safety filter.'
  }
  if (msg.includes('llm_timeout') || msg.includes('timeout')) {
    return `Cloud generation timed out. ${suggestion}`
  }
  if (msg.includes('request_too_large')) {
    return 'Prompt is too large for the cloud request.'
  }
  if (
    msg.includes('llm_provider_not_configured') ||
    msg.includes('llm_provider_error') ||
    msg.includes('llm_unavailable') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('unavailable')
  ) {
    return `Cloud AI is temporarily unavailable. ${suggestion}`
  }
  return `Cloud generation failed: ${err.message}`
}

/** Suggestion for surfaces that have an in-browser fallback (notebook, Ask-agent). */
export const USE_IN_BROWSER_SUGGESTION = 'Use the in-browser model instead.'
/** Suggestion for the playground, where both tiers sit side by side. */
export const TRY_AGAIN_SUGGESTION = 'Try again later.'
