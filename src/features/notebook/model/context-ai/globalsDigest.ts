import * as acorn from 'acorn'
import type { Cell } from '../../domain/cell'

// Compact, model-free digest of the notebook's declared globals (name + a rough
// type/shape), so the LLM knows what already exists in the global scope and can
// reuse it (docs/ai-architecture.md §4.3, context kind `globals`).
//
// MVP approach: STATIC analysis of code-cell source via acorn — top-level
// `const`/`let`/`var`/`function`/`class` declarations. It does not execute the
// notebook, so it reports *declared* globals and a type inferred from the
// initializer, not live runtime values. Runtime introspection of the QuickJS
// global scope (exact values/shapes) is a future enhancement.

// A minimal view of an acorn node — acorn's own types leave child fields loose,
// so we read them through a narrow record instead of `any`.
type AstNode = { type: string } & Record<string, unknown>

function asNode(value: unknown): AstNode | null {
  return value && typeof value === 'object' && 'type' in value ? (value as AstNode) : null
}

const MAX_OBJECT_KEYS = 4

/** Infer a short type/shape label from a declarator initializer node. */
function inferType(init: AstNode | null): string {
  if (!init) return 'unknown'
  switch (init.type) {
    case 'ArrayExpression': {
      const elements = Array.isArray(init.elements) ? init.elements : []
      return `array[${elements.length}]`
    }
    case 'ObjectExpression': {
      const props = Array.isArray(init.properties) ? init.properties : []
      const keys = props
        .map((p) => asNode(p)?.key)
        .map((k) => asNode(k))
        .map((k) => (k?.type === 'Identifier' ? String(k.name) : null))
        .filter((k): k is string => k !== null)
        .slice(0, MAX_OBJECT_KEYS)
      return keys.length ? `object{${keys.join(',')}}` : 'object'
    }
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return 'function'
    case 'TemplateLiteral':
      return 'string'
    case 'NewExpression': {
      const callee = asNode(init.callee)
      return callee?.type === 'Identifier' ? String(callee.name) : 'object'
    }
    case 'Literal': {
      const value = init.value
      return value === null ? 'null' : typeof value
    }
    default:
      return 'unknown'
  }
}

/**
 * Collect every binding name introduced by a declarator id — a plain
 * `Identifier`, or the names inside an object/array destructuring pattern
 * (`const { a, b } = obj`, `const [x, ...rest] = arr`, incl. defaults + nesting).
 */
function collectBindingNames(node: AstNode | null): string[] {
  if (!node) return []
  switch (node.type) {
    case 'Identifier':
      return [String(node.name)]
    case 'ObjectPattern': {
      const props = Array.isArray(node.properties) ? node.properties : []
      // Property → `.value`; RestElement (`{ ...rest }`) → `.argument`.
      return props.flatMap((p) => {
        const prop = asNode(p)
        return collectBindingNames(asNode(prop?.value ?? prop?.argument))
      })
    }
    case 'ArrayPattern': {
      const elements = Array.isArray(node.elements) ? node.elements : []
      return elements.flatMap((e) => collectBindingNames(asNode(e)))
    }
    case 'AssignmentPattern': // `{ a = 1 }` / `[x = 0]`
      return collectBindingNames(asNode(node.left))
    case 'RestElement': // `[...rest]`
      return collectBindingNames(asNode(node.argument))
    default:
      return []
  }
}

/**
 * Top-level declarations of one code cell as `name: type` entries (e.g.
 * `items: array[1]`). Covers `const`/`let`/`var` (incl. destructuring — those
 * binding names are reported with type `unknown`), `function` and `class`.
 * Empty when the cell declares nothing or does not parse. Exposed so callers can
 * extract a single cell's globals incrementally without re-parsing everything.
 */
export function extractDeclarations(source: string): string[] {
  let program: acorn.Program
  try {
    // acorn parses JavaScript only. A cell mid-edit — or a TypeScript cell with
    // type annotations / interface / enum — raises and yields an empty digest
    // (a known MVP limitation; TS globals are not surfaced). The default
    // notebook language is `javascript`.
    program = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    return []
  }
  const out: string[] = []
  for (const raw of program.body) {
    const node = asNode(raw)
    if (!node) continue
    if (node.type === 'VariableDeclaration') {
      const decls = Array.isArray(node.declarations) ? node.declarations : []
      for (const d of decls) {
        const decl = asNode(d)
        const id = asNode(decl?.id)
        if (id?.type === 'Identifier') {
          out.push(`${String(id.name)}: ${inferType(asNode(decl?.init))}`)
        } else {
          // Destructuring: binding names are known, the type per name is not.
          for (const name of collectBindingNames(id)) out.push(`${name}: unknown`)
        }
      }
    } else if (node.type === 'FunctionDeclaration') {
      const id = asNode(node.id)
      if (id?.type === 'Identifier') out.push(`${String(id.name)}: function`)
    } else if (node.type === 'ClassDeclaration') {
      const id = asNode(node.id)
      if (id?.type === 'Identifier') out.push(`${String(id.name)}: class`)
    }
  }
  return out
}

/**
 * Merge per-cell declaration lists into one, later declarations winning on a
 * name collision (the notebook runs top-to-bottom). Input is one list per cell,
 * in notebook order.
 */
export function mergeDeclarations(lists: string[][]): string[] {
  const byName = new Map<string, string>()
  for (const list of lists) {
    for (const entry of list) {
      byName.set(entry.slice(0, entry.indexOf(':')), entry)
    }
  }
  return [...byName.values()]
}

/** Format merged declarations into the `globals:` digest line ("" when empty). */
export function formatGlobalsDigest(entries: string[]): string {
  return entries.length ? `globals: ${entries.join('; ')}` : ''
}

/**
 * Build a one-line digest of globals declared across the given code cells, e.g.
 * `globals: items: array[1]; groupBy: function; total: number`. Returns an empty
 * string when nothing is declared.
 */
export function buildGlobalsDigest(cells: Cell[]): string {
  const lists = cells
    .filter((cell) => cell.kind === 'code')
    .map((cell) => extractDeclarations(cell.code()))
  return formatGlobalsDigest(mergeDeclarations(lists))
}
