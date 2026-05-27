// AST-level rewriting that wires shared scope between cells.
//
// The kernel runs each cell inside a fresh async IIFE, but the QuickJS VM
// itself is persistent. To make `const`/`let`/`var`/`function`/`class`
// declared in cell N visible in cell N+1, every top-level binding lives on
// `globalThis` and NOWHERE else — there is a single storage slot per name.
//
// Two rewrites happen:
//
//   1. TOP-LEVEL DECLARATIONS — rewritten so the name becomes purely a
//      `globalThis` property, with no local lexical binding:
//        * `const x = e` / `let x = e` / `var x = e` → `;(globalThis.x = (e));`
//        * destructuring → the binding pattern is converted to an assignment
//          pattern whose targets are `globalThis.<name>` members;
//        * `function f(){}` / `class C {}` → `globalThis.f = function f(){}`
//          / `globalThis.C = class C {}` (named expression keeps recursion).
//      Because no local binding is created, a top-level function that closes
//      over `x` and a later cell that reads `x` resolve to the SAME slot
//      (`globalThis.x`) — mutations are observed everywhere (Jupyter-like).
//
//   2. TRAILING EXPRESSION — if the last top-level node is an
//      ExpressionStatement, it becomes `return <expression>` so the value
//      populates the `result` OutputItem (REPL-like behaviour).
//
// Re-running a cell with `const x = 1` is safe: it is just a re-assignment of
// `globalThis.x`, never a redeclaration.
//
// Nested declarations (inside `if`, `for`, function bodies, etc.) are
// deliberately left untouched: their scope is private to the block.
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
  // Drop the declaration keyword entirely: each declarator becomes an
  // assignment to a globalThis slot, so there is no local binding to shadow
  // the global or to be captured by a closure.
  return node.declarations.map((decl) => declaratorToGlobal(decl, source)).join('\n')
}

function declaratorToGlobal(
  decl: VariableDeclaration['declarations'][number],
  source: string,
): string {
  const target = patternToGlobalTarget(decl.id, source)
  const init = decl.init ? sliceNode(source, decl.init) : 'undefined'
  // Wrap the whole assignment in parens so an object-pattern target on the
  // left is parsed as a destructuring assignment, not a block statement.
  return `;(${target} = (${init}));`
}

function rewriteNamedDeclaration(node: Node, source: string, name: string | undefined): string {
  const original = sliceNode(source, node)
  if (!name) return original
  // `function f(){}` / `class C {}` → named expression assigned to globalThis.
  // The internal name binding still works for self-recursion; sibling cells
  // and closures resolve `f` to the single `globalThis.f` slot.
  return `globalThis.${name} = ${original};`
}

/**
 * Convert a binding pattern into an assignment target whose leaves are
 * `globalThis.<name>` member expressions. Handles plain ids, object/array
 * destructuring, rest elements and defaults — the mirror of a declaration
 * binding, but writing through to the single global slot per name.
 */
function patternToGlobalTarget(pattern: Pattern, source: string): string {
  switch (pattern.type) {
    case 'Identifier':
      return `globalThis.${pattern.name}`
    case 'ObjectPattern': {
      const props = pattern.properties.map((prop) => {
        if (prop.type === 'RestElement') {
          return `...${patternToGlobalTarget(prop.argument, source)}`
        }
        const value = patternToGlobalTarget(prop.value as Pattern, source)
        if (prop.computed) return `[${sliceNode(source, prop.key)}]: ${value}`
        const key = prop.key.type === 'Identifier' ? prop.key.name : sliceNode(source, prop.key)
        return `${key}: ${value}`
      })
      return `{ ${props.join(', ')} }`
    }
    case 'ArrayPattern': {
      const els = pattern.elements.map((el) => {
        if (!el) return ''
        if (el.type === 'RestElement') return `...${patternToGlobalTarget(el.argument, source)}`
        return patternToGlobalTarget(el as Pattern, source)
      })
      return `[${els.join(', ')}]`
    }
    case 'AssignmentPattern':
      return `${patternToGlobalTarget(pattern.left, source)} = ${sliceNode(source, pattern.right)}`
    case 'RestElement':
      return `...${patternToGlobalTarget(pattern.argument, source)}`
    default:
      // MemberExpression etc. cannot appear in a declaration binding.
      return sliceNode(source, pattern)
  }
}

function rewriteTrailingExpression(node: ExpressionStatement, source: string): string {
  return `return ${sliceNode(source, node.expression as Expression)}`
}

function sliceNode(source: string, node: Node): string {
  return source.slice(node.start, node.end)
}
