// EOL helper shared by the codegen scripts. Committed d.ts files are CRLF on
// Windows (core.autocrlf) while openapi-typescript emits LF; normalising both
// sides lets the drift check compare content without false-firing on line
// endings. (A .gitattributes `eol=lf` makes this redundant for a renormalised
// tree, but it keeps the gate honest on a misconfigured checkout.)
export function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n')
}
