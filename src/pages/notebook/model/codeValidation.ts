import * as acorn from 'acorn'

// Lightweight syntactic validity check for generated JS (TARDIS-168).
//
// Used when the user STOPS an in-browser generation: the model may have been cut
// off mid-statement, so before inserting the partial output we make sure it at
// least parses. This is a syntax gate, not execution — a parseable snippet can
// still throw at runtime, but an unparseable one is guaranteed-broken noise.
//
// The notebook sandbox is JavaScript (the in-browser system prompt asks for plain
// JS), so acorn is the right parser. Options mirror the QuickJS runtime surface:
// top-level `await` and a trailing expression/return are valid in a cell.
export function isParseableJs(code: string): boolean {
  const trimmed = code.trim()
  if (!trimmed) return false
  try {
    acorn.parse(trimmed, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    })
    return true
  } catch {
    return false
  }
}
