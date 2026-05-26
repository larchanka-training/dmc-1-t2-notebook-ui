// AST-level rewriting that wires shared scope between cells.
//
// The kernel runs each cell inside a fresh async IIFE, but the QuickJS VM
// itself is persistent. Declarations made with `const`/`let`/`var`/
// `function`/`class` are block-local to the IIFE, so to make them visible in
// later cells we additionally publish each top-level binding onto
// `globalThis`. A later cell reads a bare identifier (e.g. `x`), which the VM
// resolves to `globalThis.x`.
//
// Two rewrites happen:
//
//   1. TOP-LEVEL DECLARATIONS — the original declaration is kept verbatim
//      (so references later in the *same* cell resolve to the local binding),
//      followed by `globalThis.<name> = <name>` for every bound identifier.
//      This covers plain ids, multi-declarators, destructuring patterns,
//      functions and classes uniformly.
//
//   2. TRAILING EXPRESSION — if the last top-level node is an
//      ExpressionStatement, it becomes `return <expression>` so the value
//      populates the `result` OutputItem (REPL-like behaviour).
//
// Because there is no prelude and no `__ctx`, re-running a cell with
// `const x = 1` is safe: each run is a fresh IIFE with a single `const x`.
//
// Nested declarations (inside `if`, `for`, function bodies, etc.) are
// deliberately NOT published: their scope is private to the block.
//
// ESM `import`/`export` are rejected with a clear error — QuickJS has no
// module loader here, and a bare SyntaxError from the VM is cryptic.

import { Parser } from 'acorn'
import type {
  ClassDeclaration,
  Expression,
  ExpressionStatement,
  FunctionDeclaration,
  ModuleDeclaration,
  Node,
  Pattern,
  Program,
  Statement,
  VariableDeclaration,
} from 'acorn'

export interface TransformResult {
  /** Rewritten source: declarations published to globalThis + return trailer. */
  code: string
}

class UnsupportedSyntaxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyntaxError'
  }
}

export function transformCellCode(source: string): TransformResult {
  // `allowReturnOutsideFunction` lets us emit `return <expr>` as the trailing
  // statement; the kernel wraps everything in an async IIFE.
  const ast = Parser.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  }) as Program

  return { code: rewriteBody(ast.body, source) }
}

function rewriteBody(body: Array<Statement | ModuleDeclaration>, source: string): string {
  const parts: string[] = []
  for (let i = 0; i < body.length; i++) {
    const node = body[i]
    const isLast = i === body.length - 1
    if (node.type === 'ImportDeclaration') {
      throw new UnsupportedSyntaxError('import is not supported in notebook cells yet')
    }
    if (node.type.startsWith('Export')) {
      throw new UnsupportedSyntaxError('export is not supported in notebook cells yet')
    }
    if (node.type === 'VariableDeclaration') {
      parts.push(rewriteVariableDeclaration(node, source))
    } else if (node.type === 'FunctionDeclaration') {
      parts.push(rewriteNamedDeclaration(node, source, (node as FunctionDeclaration).id?.name))
    } else if (node.type === 'ClassDeclaration') {
      parts.push(rewriteNamedDeclaration(node, source, (node as ClassDeclaration).id?.name))
    } else if (isLast && node.type === 'ExpressionStatement') {
      parts.push(rewriteTrailingExpression(node, source))
    } else {
      parts.push(sliceNode(source, node))
    }
  }
  return parts.join('\n')
}

function rewriteVariableDeclaration(node: VariableDeclaration, source: string): string {
  // Keep the original declaration (so locals resolve within the cell), then
  // publish every bound identifier onto globalThis for later cells.
  const names = new Set<string>()
  for (const decl of node.declarations) {
    collectPatternNames(decl.id, names)
  }
  return withGlobalPublish(sliceNode(source, node), names)
}

function rewriteNamedDeclaration(node: Node, source: string, name: string | undefined): string {
  const original = sliceNode(source, node)
  if (!name) return original
  return withGlobalPublish(original, new Set([name]))
}

function withGlobalPublish(original: string, names: Set<string>): string {
  if (names.size === 0) return original
  const publish = [...names].map((name) => `globalThis.${name} = ${name}`).join('\n')
  return `${original}\n${publish}`
}

/**
 * Recursively collect every bound identifier name from a binding pattern:
 * plain ids, object/array destructuring, rest elements, defaults.
 */
function collectPatternNames(pattern: Pattern, out: Set<string>): void {
  switch (pattern.type) {
    case 'Identifier':
      out.add(pattern.name)
      return
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') collectPatternNames(prop.argument, out)
        else collectPatternNames(prop.value, out)
      }
      return
    case 'ArrayPattern':
      for (const el of pattern.elements) {
        if (el) collectPatternNames(el, out)
      }
      return
    case 'RestElement':
      collectPatternNames(pattern.argument, out)
      return
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, out)
      return
    default:
      // MemberExpression etc. cannot appear in a declaration binding.
      return
  }
}

function rewriteTrailingExpression(node: ExpressionStatement, source: string): string {
  return `return ${sliceNode(source, node.expression as Expression)}`
}

function sliceNode(source: string, node: Node): string {
  return source.slice(node.start, node.end)
}
