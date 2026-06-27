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

  // No reasoning markers at all → the whole response is the answer.
  if (openIdx === -1) {
    return { thinking: '', code: stripFences(raw), thinkOpen: false }
  }

  const lastCloseIdx = raw.lastIndexOf(THINK_CLOSE)

  // Opened but never closed → still thinking; no usable code yet.
  if (lastCloseIdx === -1 || lastCloseIdx < openIdx) {
    const thinking = raw.slice(openIdx + THINK_OPEN.length)
    return { thinking: thinking.trim(), code: '', thinkOpen: true }
  }

  // Thinking = between the first <think> and the last </think>, with any inner
  // tags removed so nested/repeated pairs don't show up as literal markers.
  const thinking = raw
    .slice(openIdx + THINK_OPEN.length, lastCloseIdx)
    .split(THINK_OPEN)
    .join('')
    .split(THINK_CLOSE)
    .join('')
    .trim()

  const code = stripFences(raw.slice(lastCloseIdx + THINK_CLOSE.length))
  return { thinking, code, thinkOpen: false }
}
