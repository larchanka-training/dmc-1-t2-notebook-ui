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
const PARSE_OPTIONS: acorn.Options = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
}

export function isParseableJs(code: string): boolean {
  const trimmed = code.trim()
  if (!trimmed) return false
  try {
    acorn.parse(trimmed, PARSE_OPTIONS)
    return true
  } catch {
    return false
  }
}

// Sandbox-violation detector for in-browser generated code (TARDIS-168).
//
// Reasoning models keep emitting browser/DOM patterns in the CELL itself
// (`document.createElement`, `svg.getContext`, `fetch`, timers) even though the
// cell runs in QuickJS with NO DOM. A prompt is only a request, so we detect the
// violation deterministically and let the caller auto-repair / refuse rather
// than insert guaranteed-broken code.
//
// Why AST, not regex: the same words legitimately appear INSIDE a display() html
// string (e.g. `display({ type:'html', value:'<script>...getContext...</script>'})`).
// Walking the parsed tree flags only real identifier/method *references*; tokens
// inside a string literal are never identifier nodes, so no false positives.

// Global identifiers that simply don't exist in the QuickJS cell scope.
const FORBIDDEN_GLOBALS = new Set([
  'document',
  'window',
  'fetch',
  'XMLHttpRequest',
  'setTimeout',
  'setInterval',
  'requestAnimationFrame',
  'localStorage',
  'sessionStorage',
  'navigator',
  'alert',
])

// Method names whose base object is a local var (so the global set misses them),
// but which only make sense against a real DOM node.
const FORBIDDEN_METHODS = new Set(['getContext', 'createElement', 'createElementNS'])

type AstNode = { type: string } & Record<string, unknown>

/**
 * Return the sorted, de-duplicated names of sandbox-forbidden APIs *referenced*
 * by `code` (DOM globals, DOM-only methods, network, timers). Empty when the
 * code is clean or unparseable (an unparseable snippet is handled by
 * {@link isParseableJs} instead).
 */
export function detectSandboxViolations(code: string): string[] {
  let ast: acorn.Node
  try {
    ast = acorn.parse(code, PARSE_OPTIONS)
  } catch {
    return []
  }
  // Pass 1: collect every name the code BINDS locally (declarations, params,
  // function/class names). A user who declares their own `document`/`fetch`
  // shadows the host global and is sandbox-safe, so such names must never be
  // flagged — not at the binding site and not where they are later used. Without
  // this we'd false-flag `const document = {}; document.id` and fire a needless
  // repair pass. Single flat set (no nested-scope tracking): for THIS detector
  // — “did the model reach for the real host API” — a shadow anywhere means the
  // name isn't the host global, which is the safe call.
  const declared = new Set<string>()
  collectBindings(ast, declared)

  const found = new Set<string>()
  visit(ast, found, declared)
  return [...found].sort()
}

// Pass 1 walker: record bound identifier names without flagging anything.
function collectBindings(value: unknown, declared: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectBindings(item, declared)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as AstNode
  if (typeof node.type !== 'string') return

  if (node.type === 'VariableDeclarator') addBoundNames(node.id, declared)
  if (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  ) {
    if (node.id) addBoundNames(node.id, declared)
    for (const param of (node.params as unknown[]) ?? []) addBoundNames(param, declared)
  }
  if (node.type === 'CatchClause' && node.param) addBoundNames(node.param, declared)
  if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
    const id = node.id as AstNode | undefined
    if (id?.type === 'Identifier') declared.add(id.name as string)
  }

  for (const key in node) {
    if (key === 'type') continue
    collectBindings(node[key], declared)
  }
}

// Extract the identifier names bound by a (possibly destructuring) pattern.
function addBoundNames(pattern: unknown, declared: Set<string>): void {
  if (!pattern || typeof pattern !== 'object') return
  const node = pattern as AstNode
  switch (node.type) {
    case 'Identifier':
      declared.add(node.name as string)
      return
    case 'ArrayPattern':
      for (const el of (node.elements as unknown[]) ?? []) addBoundNames(el, declared)
      return
    case 'ObjectPattern':
      for (const prop of (node.properties as unknown[]) ?? []) {
        const p = prop as AstNode
        // `{ a }` / `{ a: b }` bind the VALUE; `...rest` binds its argument.
        addBoundNames(p.type === 'RestElement' ? p.argument : p.value, declared)
      }
      return
    case 'AssignmentPattern':
      addBoundNames(node.left, declared)
      return
    case 'RestElement':
      addBoundNames(node.argument, declared)
      return
  }
}

function visit(value: unknown, found: Set<string>, declared: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, found, declared)
    return
  }
  if (!value || typeof value !== 'object') return
  const node = value as AstNode
  if (typeof node.type !== 'string') return

  if (node.type === 'Identifier') {
    const name = node.name as string
    // Flag only a reference to the REAL host global — never a locally-bound name.
    if (FORBIDDEN_GLOBALS.has(name) && !declared.has(name)) found.add(name)
    return
  }
  if (node.type === 'MemberExpression') {
    visit(node.object, found, declared)
    // A non-computed property (`x.getContext`) is a method name, not a global
    // reference — flag it only against FORBIDDEN_METHODS. A computed property
    // (`x[expr]`) is a real expression, so recurse into it normally.
    if (node.computed) {
      visit(node.property, found, declared)
    } else {
      const prop = node.property as AstNode | undefined
      if (prop?.type === 'Identifier' && FORBIDDEN_METHODS.has(prop.name as string)) {
        found.add(prop.name as string)
      }
    }
    return
  }
  // A non-computed object-property key (`{ document: 1 }`) is not a reference;
  // skip the key, inspect the value.
  if (node.type === 'Property' && node.computed !== true) {
    visit(node.value, found, declared)
    return
  }

  for (const key in node) {
    if (key === 'type') continue
    visit(node[key], found, declared)
  }
}
