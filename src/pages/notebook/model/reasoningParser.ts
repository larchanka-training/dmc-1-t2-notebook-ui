// Parser for reasoning-model output in the In-browser generator (TARDIS-168).
//
// Reasoning models (e.g. DeepSeek-R1-Distill) wrap their chain-of-thought in
// `<think>…</think>` and put the final answer AFTER the closing tag. The old
// generator only stripped markdown fences, so the raw think-stream leaked into
// the inserted cell — and when the model degenerated into a loop it never even
// emitted code. This parser separates the two channels so the UI can show the
// thinking live and insert only the real code.

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

export interface ReasoningSplit {
  /** Concatenated chain-of-thought text (without the tags), for live display. */
  thinking: string
  /** The final code/answer after the last `</think>`, markdown fences stripped. */
  code: string
  /**
   * True when a `<think>` was opened but never closed — the model is still
   * reasoning (mid-stream) or stopped without ever producing an answer
   * (degenerate loop / budget cut). Callers treat this as "no usable code yet".
   */
  thinkOpen: boolean
}

/** Strip markdown code fences a model may wrap around the answer anyway. */
function stripFences(text: string): string {
  return text
    .replace(/```(?:javascript|js|typescript|ts)?\n?/gi, '')
    .replace(/```/g, '')
    .trim()
}

/**
 * Split a (possibly partial) model response into its thinking and code parts.
 *
 * Handles three shapes:
 *  - `<think>reasoning</think>code` → thinking + code;
 *  - `<think>reasoning…` (unclosed) → all thinking, no code, `thinkOpen`;
 *  - `plain code` (no tags) → all code.
 *
 * Robust to the R1 failure mode of emitting several `<think>`/`</think>` pairs:
 * everything from the first `<think>` to the LAST `</think>` is thinking, and
 * only the tail after the last `</think>` is treated as code.
 */
export function splitThinkAndCode(raw: string): ReasoningSplit {
  const openIdx = raw.indexOf(THINK_OPEN)
  const lastCloseIdx = raw.lastIndexOf(THINK_CLOSE)

  // No reasoning markers at all → the whole response is the answer.
  if (openIdx === -1 && lastCloseIdx === -1) {
    return { thinking: '', code: stripFences(raw), thinkOpen: false }
  }

  // A <think> with no matching </think> after it → still thinking, no code yet.
  // (Covers both the plain unclosed case and the degenerate `</think>…<think>…`
  // where the only close precedes the open.)
  if (openIdx !== -1 && (lastCloseIdx === -1 || lastCloseIdx < openIdx)) {
    const thinking = raw.slice(openIdx + THINK_OPEN.length)
    return { thinking: thinking.trim(), code: '', thinkOpen: true }
  }

  // Closed reasoning. Thinking spans from just after the opening <think> — or
  // from the very start when the model omitted it: a reasoning model whose
  // prompt template already emitted <think> (DeepSeek-R1-Distill) streams ONLY
  // the closing </think>, so without this its whole monologue would fall into
  // `code` and fail to parse (TARDIS-168 H4). Thinking runs to the LAST
  // </think>; the tail after it is the code. Inner repeated tags are stripped so
  // nested/repeated pairs don't leak into the displayed reasoning. Any preamble
  // before the first <think> is intentionally dropped (not reasoning, not code).
  const thinkStart = openIdx === -1 ? 0 : openIdx + THINK_OPEN.length
  const thinking = raw
    .slice(thinkStart, lastCloseIdx)
    .split(THINK_OPEN)
    .join('')
    .split(THINK_CLOSE)
    .join('')
    .trim()

  const code = stripFences(raw.slice(lastCloseIdx + THINK_CLOSE.length))
  return { thinking, code, thinkOpen: false }
}
