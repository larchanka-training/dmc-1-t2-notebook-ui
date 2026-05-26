// AST-level rewriting that wires shared scope between cells.
//
// Why an AST is needed:
//   `with (__ctx)` does NOT capture assignments. `var x = 1` inside `with`
//   still creates the binding in the surrounding function scope, never
//   touching __ctx. So we parse the cell, locate top-level declarations,
//   and emit code that writes them through __ctx.
//
// Three rewrites happen, in order:
//
//   1. PRELUDE — for every entry in the incoming scope we emit
//      `const <name> = globalThis.__ctx.<name>`, so existing identifiers
//      from previous cells resolve.
//
//   2. TOP-LEVEL DECLARATIONS — `const x = expr` becomes
//      `globalThis.__ctx.x = (expr); const x = globalThis.__ctx.x`.
//      `function foo(...) {}` becomes
//      `function foo(...) {} globalThis.__ctx.foo = foo`.
//      We keep the local binding because subsequent statements in the
//      same cell may already reference it directly.
//
//   3. TRAILING EXPRESSION — if the last top-level node is an
//      ExpressionStatement, we rewrite it into `return <expression>`.
//      That populates the `result` OutputItem (REPL-like behaviour).
//
// Nested declarations (inside `if`, `for`, function bodies, etc.) are
// deliberately NOT lifted: their scope is private to the block.

import { Parser } from 'acorn'
import type {
  Expression,
  ExpressionStatement,
  FunctionDeclaration,
  Identifier,
  ModuleDeclaration,
  Node,
  Program,
  Statement,
  VariableDeclaration,
} from 'acorn'
import type { SharedScope } from './types'

export interface TransformResult {
  /** Rewritten source with prelude + lifted declarations + return trailer. */
  code: string
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function transformCellCode(source: string, scope: SharedScope): TransformResult {
  // `allowReturnOutsideFunction` lets us emit `return <expr>` as the trailing
  // statement; we wrap everything in an async IIFE on the caller side.
  const ast = Parser.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  }) as Program

  const prelude = buildPrelude(scope)
  const body = rewriteBody(ast.body, source)
  return { code: prelude ? `${prelude}\n${body}` : body }
}

function buildPrelude(scope: SharedScope): string {
  const lines: string[] = []
  for (const key of Object.keys(scope)) {
    if (!IDENTIFIER_RE.test(key)) continue
    lines.push(`const ${key} = globalThis.__ctx.${key}`)
  }
  return lines.join('\n')
}

function rewriteBody(body: Array<Statement | ModuleDeclaration>, source: string): string {
  const parts: string[] = []
  for (let i = 0; i < body.length; i++) {
    const node = body[i]
    const isLast = i === body.length - 1
    if (node.type === 'VariableDeclaration') {
      parts.push(rewriteVariableDeclaration(node, source))
    } else if (node.type === 'FunctionDeclaration') {
      parts.push(rewriteFunctionDeclaration(node, source))
    } else if (isLast && node.type === 'ExpressionStatement') {
      parts.push(rewriteTrailingExpression(node, source))
    } else {
      parts.push(sliceNode(source, node))
    }
  }
  return parts.join('\n')
}

function rewriteVariableDeclaration(node: VariableDeclaration, source: string): string {
  // `const a = 1, b = 2` → declarations: [{ id: a, init: 1 }, { id: b, init: 2 }]
  // We keep the original declaration (so locals resolve), then write each
  // initialised binding through __ctx in a follow-up statement.
  const assignments: string[] = []
  for (const decl of node.declarations) {
    if (decl.id.type !== 'Identifier' || decl.init == null) continue
    assignments.push(`globalThis.__ctx.${decl.id.name} = ${decl.id.name}`)
  }
  const original = sliceNode(source, node)
  return assignments.length ? `${original}\n${assignments.join('\n')}` : original
}

function rewriteFunctionDeclaration(node: FunctionDeclaration, source: string): string {
  const original = sliceNode(source, node)
  // Anonymous function declarations only happen as `export default`; we
  // don't see them at the top level here because of sourceType=module
  // semantics (would parse but not declare a name).
  const id = node.id as Identifier | null
  if (!id) return original
  return `${original}\nglobalThis.__ctx.${id.name} = ${id.name}`
}

function rewriteTrailingExpression(node: ExpressionStatement, source: string): string {
  return `return ${sliceExpression(source, node.expression)}`
}

function sliceNode(source: string, node: Node): string {
  // acorn nodes carry start/end offsets into the source string.
  const start = (node as Node & { start: number }).start
  const end = (node as Node & { end: number }).end
  return source.slice(start, end)
}

function sliceExpression(source: string, expr: Expression): string {
  return sliceNode(source, expr)
}
