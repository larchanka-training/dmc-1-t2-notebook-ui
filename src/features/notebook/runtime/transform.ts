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
//      ExpressionStatement, it becomes `return __nbTrailing(<expression>)` so
//      the value populates the `result` OutputItem (REPL-like behaviour).
//      `__nbTrailing` (injected by the kernel) is an identity function that
//      records whether the trailing value is a Promise, so the kernel can
//      attach a "did you forget await?" hint when that Promise rejects — a
//      rejected trailing Promise is otherwise indistinguishable from a throw
//      once the async IIFE has adopted it.
//
// Re-running a cell with `const x = 1` is safe: it is just a re-assignment of
// `globalThis.x`, never a redeclaration.
//
// Nested declarations (inside `if`, `for`, function bodies, etc.) are
// deliberately left untouched: their scope is private to the block.
//
//   3. HOISTING — top-level `function` declarations are emitted BEFORE the
//      rest of the body (but after any `"use strict";` directive prologue), so
//      a cell that calls a function above its textual declaration still works,
//      matching real JS function hoisting. `class` declarations are NOT
//      hoisted (they sit in a TDZ in real JS), so they keep source order.
//      `var` hoisting is intentionally not emulated (a forward read sees a
//      ReferenceError instead of `undefined`) — a documented dialect quirk.
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

/**
 * Name of the identity marker the trailing expression is wrapped in. Shared
 * contract: `transform` emits a call to it, the kernel (`quickjs.ts`) injects a
 * function of this exact name. Keep both sides on this constant — a literal on
 * one side and a rename on the other would only fail at runtime.
 */
export const TRAILING_MARKER = '__nbTrailing'

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

  // Static `import`/`export` are caught per-statement in rewriteBody, but
  // dynamic `import(...)` and `import.meta` hide inside expressions anywhere
  // in the tree. Reject them up front with the same readable error instead of
  // letting the VM throw a cryptic one at runtime.
  rejectDynamicImport(ast)

  return { code: rewriteBody(ast.body, source) }
}

/**
 * Walk the AST and throw on `ImportExpression` (dynamic `import(...)`) or
 * `import.meta`. A tiny hand-rolled walk avoids pulling in `acorn-walk` for
 * two node types.
 *
 * Note: `import.meta` and `new.target` share the `MetaProperty` node type;
 * acorn distinguishes them by `meta.name` (`'import'` vs `'new'`). We must
 * reject ONLY `import.meta` — `new.target` is valid JS the kernel supports.
 */
function rejectDynamicImport(root: Node): void {
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    const type = (node as { type?: unknown }).type
    if (type === 'ImportExpression' || isImportMeta(node)) {
      throw new UnsupportedSyntaxError('import is not supported in notebook cells yet')
    }
    for (const key in node) {
      if (key === 'type') continue
      stack.push((node as Record<string, unknown>)[key])
    }
  }
}

/**
 * True only for the `import.meta` meta-property. `new.target` is also a
 * `MetaProperty` but carries `meta.name === 'new'`, so it passes through.
 */
function isImportMeta(node: object): boolean {
  if ((node as { type?: unknown }).type !== 'MetaProperty') return false
  const meta = (node as { meta?: { name?: unknown } }).meta
  return meta?.name === 'import'
}

function rewriteBody(body: Array<Statement | ModuleDeclaration>, source: string): string {
  // Three buckets, concatenated as [prologue, hoisted, rest]:
  //   - prologue: a leading run of bare string-literal statements (the
  //     directive prologue, e.g. `"use strict";`). Kept verbatim and FIRST so
  //     hoisting functions above it can't strip its directive meaning.
  //   - hoisted: top-level function declarations, lifted so a forward call
  //     (`f(); function f(){}`) resolves — matching real JS hoisting.
  //   - rest: everything else, in source order (incl. the trailing return).
  const prologue: string[] = []
  const hoisted: string[] = []
  const rest: string[] = []
  let inPrologue = true
  for (let i = 0; i < body.length; i++) {
    const node = body[i]
    const isLast = i === body.length - 1
    if (node.type === 'ImportDeclaration') {
      throw new UnsupportedSyntaxError('import is not supported in notebook cells yet')
    }
    if (node.type.startsWith('Export')) {
      throw new UnsupportedSyntaxError('export is not supported in notebook cells yet')
    }
    // The trailing expression becomes the REPL `result`. It wins over the
    // directive-prologue check, so a cell that is a lone string literal
    // (`"hello"`) still yields that string as its value.
    if (isLast && node.type === 'ExpressionStatement') {
      inPrologue = false
      rest.push(rewriteTrailingExpression(node, source))
      continue
    }
    if (inPrologue && isDirective(node)) {
      prologue.push(sliceNode(source, node))
      continue
    }
    inPrologue = false
    if (node.type === 'VariableDeclaration') {
      rest.push(rewriteVariableDeclaration(node, source))
    } else if (node.type === 'FunctionDeclaration') {
      hoisted.push(rewriteNamedDeclaration(node, source, (node as FunctionDeclaration).id?.name))
    } else if (node.type === 'ClassDeclaration') {
      // Classes are NOT hoisted in real JS (TDZ): keep them in source order.
      rest.push(rewriteNamedDeclaration(node, source, (node as ClassDeclaration).id?.name))
    } else {
      rest.push(sliceNode(source, node))
    }
  }
  return [...prologue, ...hoisted, ...rest].join('\n')
}

/**
 * True for a bare string-literal statement (`"use strict";`). A leading run of
 * these forms the directive prologue, which must stay at the very top.
 */
function isDirective(node: Statement | ModuleDeclaration): boolean {
  if (node.type !== 'ExpressionStatement') return false
  const expr = (node as ExpressionStatement).expression
  return expr.type === 'Literal' && typeof (expr as { value?: unknown }).value === 'string'
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
  // Wrap in the kernel's identity marker so a rejected trailing Promise can be
  // told apart from an ordinary throw (see header §2). The expression gets its
  // OWN inner parens: a bare SequenceExpression (`a, b`) would otherwise be
  // parsed as two call ARGUMENTS, so the marker would see only `a` and the cell
  // would return the wrong operand (JS sequence semantics yield the last).
  return `return ${TRAILING_MARKER}((${sliceNode(source, node.expression as Expression)}))`
}

function sliceNode(source: string, node: Node): string {
  return source.slice(node.start, node.end)
}
