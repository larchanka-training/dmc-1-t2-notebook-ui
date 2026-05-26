// Epic 01 — Execution Runtime — Acceptance Traceability
//
// Each test in this file maps to an explicit acceptance criterion from
// `ui/docs/tasks/01-execution-runtime.md`. The tests exercise the
// public API (runCell, runAll, cell.output, cell.executionCount, etc.)
// rather than internal primitives, so they double as living documentation
// of what the epic delivers.
//
// Stop / Stop All / Restart Kernel scenarios live in the sibling file
// `runtime.acceptance.stop.test.ts` — splitting them keeps the
// @vitest/web-worker shim happy when running both groups.

import { beforeEach, describe, expect, test } from 'vitest'
import { addCell, cellsAtom, deleteCell, updateCellCode } from '../model/notebook'
import { execCounterAtom, restartKernel, runAll, runCell } from '../model/runtime'

beforeEach(async () => {
  restartKernel()
  await Promise.resolve()
  await Promise.resolve()
  const ids = cellsAtom().map((c) => c.id)
  for (let i = 1; i < ids.length; i++) deleteCell(ids[i])
  const [first] = cellsAtom()
  first.code.set('')
})

// ─── DOM output via display() ────────────────────────────────────────────────

describe('Epic 01 AC — DOM output (display API)', () => {
  test('AC: display({ type: "html" }) flows through runCell into cell.output', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'display({ type: "html", value: "<div>hi</div>" })')
    await runCell(cell.id)
    expect(cell.status()).toBe('done')
    expect(cell.output()).toContainEqual({ type: 'html', html: '<div>hi</div>' })
  })

  test('AC: display({ type: "image" }) flows through runCell into cell.output', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'display({ type: "image", mime: "image/svg+xml", data: "PHN2Zy8+" })')
    await runCell(cell.id)
    expect(cell.output()).toContainEqual({
      type: 'image',
      mime: 'image/svg+xml',
      data: 'PHN2Zy8+',
    })
  })
})

// ─── Sandbox ───────────────────────────────────────────────────────────────

describe('Epic 01 AC — Sandbox', () => {
  test('AC: typeof document is undefined inside sandbox', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log(typeof document)')
    await runCell(cell.id)
    expect(cell.output()).toContainEqual({ type: 'stdout', text: 'undefined' })
  })

  test('AC: typeof window is undefined inside sandbox', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log(typeof window)')
    await runCell(cell.id)
    expect(cell.output()).toContainEqual({ type: 'stdout', text: 'undefined' })
  })

  test('AC: typeof fetch is undefined inside sandbox', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log(typeof fetch)')
    await runCell(cell.id)
    expect(cell.output()).toContainEqual({ type: 'stdout', text: 'undefined' })
  })

  test('AC: typeof localStorage is undefined inside sandbox', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log(typeof localStorage)')
    await runCell(cell.id)
    expect(cell.output()).toContainEqual({ type: 'stdout', text: 'undefined' })
  })

  test('AC: runtime errors carry an explicit error item with name and message', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'throw new TypeError("nope")')
    await runCell(cell.id)
    expect(cell.status()).toBe('error')
    const err = cell.output().find((it) => it.type === 'error')
    expect(err).toBeDefined()
    if (err?.type === 'error') {
      expect(err.message).toBe('nope')
      expect(err.name).toMatch(/Error/)
    }
  })
})

// ─── Shared scope ────────────────────────────────────────────────────────────

describe('Epic 01 AC — Shared scope', () => {
  test('AC: const declared in cell A is visible in cell B', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'const sharedConst = 1')
    updateCellCode(b.id, 'console.log(sharedConst)')
    await runCell(a.id)
    await runCell(b.id)
    expect(b.output()).toContainEqual({ type: 'stdout', text: '1' })
  })

  test('AC: let declared in cell A is visible in cell B', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'let sharedLet = 2')
    updateCellCode(b.id, 'console.log(sharedLet)')
    await runCell(a.id)
    await runCell(b.id)
    expect(b.output()).toContainEqual({ type: 'stdout', text: '2' })
  })

  test('AC: var declared in cell A is visible in cell B', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'var sharedVar = 3')
    updateCellCode(b.id, 'console.log(sharedVar)')
    await runCell(a.id)
    await runCell(b.id)
    expect(b.output()).toContainEqual({ type: 'stdout', text: '3' })
  })

  test('AC: deleting a cell does NOT remove its variables from scope', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'const persisted = 99')
    updateCellCode(b.id, 'console.log(persisted)')
    await runCell(a.id)
    deleteCell(a.id)
    await runCell(b.id)
    expect(b.output()).toContainEqual({ type: 'stdout', text: '99' })
  })
})

// ─── Очередь / Run All ───────────────────────────────────────────────────────

describe('Epic 01 AC — Очередь', () => {
  test('AC: runAll executes every code cell in order with monotonic executionCount', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    updateCellCode(a.id, 'console.log("a")')
    updateCellCode(b.id, 'console.log("b")')
    updateCellCode(c.id, 'console.log("c")')
    await runAll()
    expect(a.status()).toBe('done')
    expect(b.status()).toBe('done')
    expect(c.status()).toBe('done')
    expect(a.executionCount()).toBe(1)
    expect(b.executionCount()).toBe(2)
    expect(c.executionCount()).toBe(3)
  }, 10_000)

  test('AC: an error in the middle of the queue marks the rest as skipped', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    const c = addCell()
    updateCellCode(a.id, 'console.log("a")')
    updateCellCode(b.id, 'throw new Error("middle")')
    updateCellCode(c.id, 'console.log("c")')
    await runAll()
    expect(a.status()).toBe('done')
    expect(b.status()).toBe('error')
    expect(c.status()).toBe('skipped')
    expect(c.executionCount()).toBe(null)
  })
})

// ─── Structured output ───────────────────────────────────────────────────────

describe('Epic 01 AC — Structured output', () => {
  test('AC: cell.output is an OutputItem[], not a string', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log("hi")')
    await runCell(cell.id)
    expect(Array.isArray(cell.output())).toBe(true)
    expect(cell.output().length).toBeGreaterThan(0)
  })

  test('AC: console.log/warn/error produce separately typed items', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log("a"); console.warn("b"); console.error("c")')
    await runCell(cell.id)
    const items = cell.output()
    expect(items).toContainEqual({ type: 'stdout', text: 'a' })
    expect(items).toContainEqual({ type: 'stderr', text: '[warn] b' })
    expect(items).toContainEqual({ type: 'stderr', text: '[error] c' })
  })

  test('AC: trailing expression statement becomes a result item', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, '1 + 2')
    await runCell(cell.id)
    expect(cell.output()).toContainEqual({
      type: 'result',
      value: { kind: 'primitive', value: 3 },
    })
  })

  test('AC: deep object is serialised up to depth 5, deeper becomes [Object]', async () => {
    // Build a chain 6 levels deep, take its serialized representation
    // as the trailing-expression `result`, and assert the truncation
    // marker shows up at the documented depth.
    //
    // Names use a `_deep_` prefix to avoid colliding with anything that
    // may already live in shared scope across test runs.
    const [cell] = cellsAtom()
    updateCellCode(
      cell.id,
      [
        'let _deep_node = { leaf: true }',
        'for (let i = 0; i < 6; i++) _deep_node = { a: _deep_node }',
        '_deep_node',
      ].join('\n'),
    )
    await runCell(cell.id)
    const result = cell.output().find((it) => it.type === 'result')
    expect(result).toBeDefined()
    if (result?.type === 'result') {
      let node = result.value
      for (let i = 0; i < 5; i++) {
        if (node.kind !== 'object') throw new Error('expected object at depth ' + i)
        const next = node.entries.find(([k]) => k === 'a')?.[1]
        if (!next) throw new Error('missing a-key at depth ' + i)
        node = next
      }
      expect(node).toEqual({ kind: 'truncated', placeholder: '[Object]' })
    }
  })

  test('AC: cyclic references do not crash the sandbox', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'const a = {}; a.self = a; console.log(a)')
    await runCell(cell.id)
    // Status is 'done' — runtime survived the cycle.
    expect(cell.status()).toBe('done')
  })
})

// ─── ExecutionCount ──────────────────────────────────────────────────────────

describe('Epic 01 AC — ExecutionCount', () => {
  test('AC: execCounter increments monotonically across cells and runs', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'console.log(1)')
    updateCellCode(b.id, 'console.log(2)')
    await runCell(a.id)
    await runCell(b.id)
    await runCell(a.id) // re-run a
    expect(a.executionCount()).toBe(3)
    expect(b.executionCount()).toBe(2)
    expect(execCounterAtom()).toBe(3)
  })

  test('AC: editing a cell does NOT reset its executionCount', async () => {
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'console.log("v1")')
    await runCell(cell.id)
    expect(cell.executionCount()).toBe(1)
    updateCellCode(cell.id, 'console.log("v2")')
    expect(cell.executionCount()).toBe(1)
  })
})

// ─── Limits ──────────────────────────────────────────────────────────────────

describe('Epic 01 AC — Limits', () => {
  test('AC: an explicit short timeout interrupts a tight loop and surfaces as an error status', async () => {
    // Mirror the production 30 s default with a much shorter limit so the
    // test is cheap. Production uses runtime/workerHost.ts: DEFAULT_TIMEOUT_MS.
    const [cell] = cellsAtom()
    updateCellCode(cell.id, 'while(true){}')
    // Drop the per-cell budget by talking to runInWorker directly via the
    // worker host export: in runCell we always use the default. Verify the
    // mechanism via the lower-level entry point instead, since this is an
    // AC about the *mechanism*, not the default value.
    const { runInWorker } = await import('./workerHost')
    const r = await runInWorker('while(true){}', { timeoutMs: 200 })
    expect(r.status).toBe('timeout')
    expect(r.items.some((it) => it.type === 'stderr' || it.type === 'error')).toBe(true)
    // Sanity: cell still shows running state until runCell completes; for
    // an explicit-timeout case we just assert the runInWorker contract.
    void cell // silence unused-var
  }, 5000)

  test('AC: output larger than the host budget is truncated with a stderr marker', async () => {
    const { OUTPUT_BUDGET_BYTES, runInWorker } = await import('./workerHost')
    const code = `
      const chunk = 'x'.repeat(80);
      for (let i = 0; i < 200000; i++) console.log(chunk);
    `
    const r = await runInWorker(code, { timeoutMs: 60_000 })
    expect(r.status).toBe('error')
    expect(
      r.items.some(
        (it) => it.type === 'stderr' && it.text.includes(`${OUTPUT_BUDGET_BYTES} bytes`),
      ),
    ).toBe(true)
  }, 10_000)

  test('AC: shared scope carries values across runs (observed via a later cell)', async () => {
    const [a] = cellsAtom()
    const b = addCell()
    updateCellCode(a.id, 'const carried = 7')
    updateCellCode(b.id, 'console.log(carried)')
    await runCell(a.id)
    await runCell(b.id)
    expect(b.output()).toContainEqual({ type: 'stdout', text: '7' })
  })
})
