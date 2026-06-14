import { describe, expect, test, vi } from 'vitest'
import { createKernel, PROMISE_HINT, type Kernel } from './quickjs'
import type { OutputItem } from './types'

// These tests pin the public contract of the persistent kernel. Worker
// integration lives in workerHost.test.ts; here we focus on the VM itself.
//
// Most tests want a clean scope, so they spin up a fresh kernel. The
// shared-scope suite deliberately reuses one kernel across runs.

async function runFresh(code: string, timeoutMs?: number) {
  const kernel = await createKernel()
  try {
    return await kernel.run(code, timeoutMs ? { timeoutMs } : undefined)
  } finally {
    kernel.dispose()
  }
}

describe('kernel.run — happy path', () => {
  test('captures single console.log', async () => {
    const r = await runFresh('console.log("hello")')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'hello' })
  })

  test('joins multi-argument console.log with spaces', async () => {
    const r = await runFresh('console.log(1, 2, 3)')
    expect(r.items).toContainEqual({ type: 'stdout', text: '1 2 3' })
  })

  test('console.warn → stderr with [warn] prefix', async () => {
    const r = await runFresh('console.warn("oops")')
    expect(r.items).toContainEqual({ type: 'stderr', text: '[warn] oops' })
  })

  test('console.error → stderr with [error] prefix', async () => {
    const r = await runFresh('console.error("nope")')
    expect(r.items).toContainEqual({ type: 'stderr', text: '[error] nope' })
  })

  test('console.info → stdout (no prefix)', async () => {
    const r = await runFresh('console.info("note")')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'note' })
  })

  test('top-level await is supported', async () => {
    const r = await runFresh('const v = await Promise.resolve(42); console.log(v)')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: '42' })
  })

  test('multi-step await chain settles in one job drain', async () => {
    // Regression guard for issue #8: several chained microtasks must all run,
    // not just the first. A single executePendingJobs() drains the whole VM
    // queue, so the accumulated value reaches the result.
    const r = await runFresh(
      'let n = 0; n += await Promise.resolve(1); n += await Promise.resolve(2); n += await Promise.resolve(3); n',
    )
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'result', value: { kind: 'primitive', value: 6 } })
  })

  test('await inside a loop accumulates across iterations', async () => {
    const r = await runFresh(
      'let sum = 0; for (let i = 1; i <= 5; i++) { sum += await Promise.resolve(i) } console.log(sum)',
    )
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: '15' })
  })

  test('trailing expression statement becomes a result item', async () => {
    const r = await runFresh('1 + 2')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'result', value: { kind: 'primitive', value: 3 } })
  })

  test('explicit return value becomes a result item', async () => {
    const r = await runFresh('return 1 + 2')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'result', value: { kind: 'primitive', value: 3 } })
  })

  test('console.log(undefined) prints "undefined"', async () => {
    const r = await runFresh('console.log(undefined)')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'undefined' })
  })

  test('object argument is serialized to readable form', async () => {
    const r = await runFresh('console.log({ a: 1 })')
    const stdout = r.items.find((it) => it.type === 'stdout')
    expect(stdout?.type).toBe('stdout')
    if (stdout?.type === 'stdout') {
      expect(stdout.text).toContain('a')
      expect(stdout.text).toContain('1')
    }
  })

  test('console.log of a cyclic object does not crash', async () => {
    // The arg-stringifier must never throw on a self-reference. (QuickJS's
    // dump may already collapse the cycle, but the JS-side path that handles
    // JSON.stringify failures must stay crash-free regardless.)
    const r = await runFresh('const a = { x: 1 }; a.self = a; console.log(a)')
    expect(r.status).toBe('done')
    expect(r.items.some((it) => it.type === 'stdout')).toBe(true)
  })

  test('console.log of a BigInt does not crash', async () => {
    const r = await runFresh('console.log(10n)')
    expect(r.status).toBe('done')
    const stdout = r.items.find((it) => it.type === 'stdout')
    expect(stdout?.type === 'stdout' && stdout.text).toContain('10')
  })
})

describe('kernel.run — errors', () => {
  test('throw new Error → error item, status=error', async () => {
    const r = await runFresh('throw new Error("boom")')
    expect(r.status).toBe('error')
    const err = r.items.find((it) => it.type === 'error')
    if (err?.type === 'error') {
      expect(err.message).toBe('boom')
      expect(err.name).toBe('Error')
    }
  })

  test('syntax error → error item, status=error', async () => {
    const r = await runFresh('this is not js')
    expect(r.status).toBe('error')
    expect(r.items.some((it) => it.type === 'error')).toBe(true)
  })

  test('reference error → error item', async () => {
    const r = await runFresh('definitelyNotDefined()')
    expect(r.status).toBe('error')
    const err = r.items.find((it) => it.type === 'error')
    expect(err?.type === 'error' && err.name).toMatch(/ReferenceError|Error/)
  })

  test('import is rejected with a readable SyntaxError', async () => {
    const r = await runFresh('import x from "y"')
    expect(r.status).toBe('error')
    const err = r.items.find((it) => it.type === 'error')
    expect(err?.type === 'error' && err.message).toMatch(/import is not supported/)
  })

  test('new.target runs (not mistaken for import.meta)', async () => {
    const r = await runFresh('function F(){ return String(Boolean(new.target)) }; console.log(F())')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'false' })
  })
})

describe('kernel.run — sandbox isolation', () => {
  test.each([
    ['window'],
    ['document'],
    ['fetch'],
    ['localStorage'],
    ['XMLHttpRequest'],
    ['sessionStorage'],
    ['navigator'],
  ])('typeof %s === "undefined" inside sandbox', async (name) => {
    const r = await runFresh(`console.log(typeof ${name})`)
    expect(r.items).toContainEqual({ type: 'stdout', text: 'undefined' })
  })

  test('does not call host console.log when user code logs', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runFresh('console.log("inside")')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('a fresh kernel does not see another kernel scope', async () => {
    await runFresh('var leak = 1')
    const r = await runFresh('console.log(typeof leak)')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'undefined' })
  })
})

describe('kernel.run — persistent shared scope', () => {
  let kernel: Kernel

  test('const / let / var from run A are visible in run B', async () => {
    kernel = await createKernel()
    try {
      await kernel.run('const x = 7; let y = 8; var z = 9')
      const r = await kernel.run('console.log(x, y, z)')
      expect(r.items).toContainEqual({ type: 'stdout', text: '7 8 9' })
    } finally {
      kernel.dispose()
    }
  })

  test('re-running a cell with const declarations does NOT throw', async () => {
    kernel = await createKernel()
    try {
      await kernel.run('const k = 1')
      const r = await kernel.run('const k = 1; console.log(k)')
      expect(r.status).toBe('done')
      expect(r.items).toContainEqual({ type: 'stdout', text: '1' })
    } finally {
      kernel.dispose()
    }
  })

  test('mutation in a later run updates the shared binding', async () => {
    kernel = await createKernel()
    try {
      await kernel.run('let counter = 1')
      await kernel.run('counter += 1')
      const r = await kernel.run('console.log(counter)')
      expect(r.items).toContainEqual({ type: 'stdout', text: '2' })
    } finally {
      kernel.dispose()
    }
  })

  test('function declared in run A is callable in run B', async () => {
    kernel = await createKernel()
    try {
      await kernel.run('function answer(){ return 42 }')
      const r = await kernel.run('console.log(answer())')
      expect(r.items).toContainEqual({ type: 'stdout', text: '42' })
    } finally {
      kernel.dispose()
    }
  })

  test('a function called before its declaration in the SAME run works (hoisting)', async () => {
    // Real JS hoists function declarations, so a forward call is valid. The
    // transform must preserve this — otherwise `compute(5)` would run before
    // `globalThis.compute` is assigned and throw a ReferenceError.
    const r = await runFresh('const r = compute(5);\nfunction compute(n){ return n * 2 }\nr')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'result', value: { kind: 'primitive', value: 10 } })
  })

  test('a top-level function mutating a top-level let is seen by later runs', async () => {
    // Regression: previously declarations stayed local to the IIFE and were
    // only *copied* to globalThis, so a closure mutated the local copy while
    // later cells read the stale global. With a single globalThis slot per
    // name, the closure and the later read share one binding.
    kernel = await createKernel()
    try {
      await kernel.run('let shared = 1; function bump(){ shared += 1; return shared }')
      const bumped = await kernel.run('bump()')
      expect(bumped.items).toContainEqual({
        type: 'result',
        value: { kind: 'primitive', value: 2 },
      })
      const read = await kernel.run('console.log(shared)')
      expect(read.items).toContainEqual({ type: 'stdout', text: '2' })
    } finally {
      kernel.dispose()
    }
  })

  test('class instance survives across runs (closures + state)', async () => {
    kernel = await createKernel()
    try {
      await kernel.run('class Box { constructor(v){ this.v = v } get(){ return this.v } }')
      await kernel.run('const box = new Box(99)')
      const r = await kernel.run('console.log(box.get())')
      expect(r.items).toContainEqual({ type: 'stdout', text: '99' })
    } finally {
      kernel.dispose()
    }
  })

  test('closure keeps captured state between runs', async () => {
    kernel = await createKernel()
    try {
      await kernel.run('function mk(){ let n = 0; return () => ++n }')
      await kernel.run('const inc = mk()')
      const r1 = await kernel.run('console.log(inc())')
      const r2 = await kernel.run('console.log(inc())')
      expect(r1.items).toContainEqual({ type: 'stdout', text: '1' })
      expect(r2.items).toContainEqual({ type: 'stdout', text: '2' })
    } finally {
      kernel.dispose()
    }
  })

  test('destructuring bindings persist across runs', async () => {
    kernel = await createKernel()
    try {
      await kernel.run('const { a, b: c } = { a: 1, b: 2 }')
      const r = await kernel.run('console.log(a, c)')
      expect(r.items).toContainEqual({ type: 'stdout', text: '1 2' })
    } finally {
      kernel.dispose()
    }
  })
})

describe('kernel.run — timeout', () => {
  test('infinite loop is interrupted by deadline with status=timeout', async () => {
    const start = Date.now()
    const r = await runFresh('while(true){}', 200)
    const elapsed = Date.now() - start
    expect(r.status).toBe('timeout')
    expect(elapsed).toBeLessThan(1000)
    // A deadline abort must NOT surface a synthetic InternalError item — the
    // status carries the meaning, the friendly marker is added one layer up.
    expect(r.items.some((it) => it.type === 'error')).toBe(false)
  })

  test('the VM survives a timeout — a later run on the same kernel works', async () => {
    const kernel = await createKernel()
    try {
      const timedOut = await kernel.run('while(true){}', { timeoutMs: 150 })
      expect(timedOut.status).toBe('timeout')
      const ok = await kernel.run('console.log("alive")')
      expect(ok.status).toBe('done')
      expect(ok.items).toContainEqual({ type: 'stdout', text: 'alive' })
    } finally {
      kernel.dispose()
    }
  }, 5000)

  test('default timeout accepts undefined options', async () => {
    const r = await runFresh('1 + 1')
    expect(r.status).toBe('done')
  })
})

describe('kernel.run — cooperative interrupt', () => {
  test('shouldInterrupt aborts a tight loop with status=interrupted (not timeout)', async () => {
    // Mirrors the SAB-backed Stop: the flag is already set, so the very
    // first interrupt-handler tick aborts. Generous timeout proves the
    // abort is the user-stop cause, not the deadline.
    const kernel = await createKernel({ shouldInterrupt: () => true })
    try {
      const r = await kernel.run('while(true){}', { timeoutMs: 60_000 })
      expect(r.status).toBe('interrupted')
    } finally {
      kernel.dispose()
    }
  }, 5000)

  test('VM survives a user interrupt — scope and later runs still work', async () => {
    let stop = false
    const kernel = await createKernel({ shouldInterrupt: () => stop })
    try {
      await kernel.run('const kept = 5')
      stop = true
      const interrupted = await kernel.run('while(true){}', { timeoutMs: 60_000 })
      expect(interrupted.status).toBe('interrupted')
      stop = false
      const after = await kernel.run('console.log(kept)')
      expect(after.status).toBe('done')
      expect(after.items).toContainEqual({ type: 'stdout', text: '5' })
    } finally {
      kernel.dispose()
    }
  }, 5000)

  test('a user interrupt does NOT add a synthetic error item (only the status)', async () => {
    // Regression for the double-output bug: the abort surfaced a red
    // "InternalError: interrupted" item on top of the friendly marker.
    const kernel = await createKernel({ shouldInterrupt: () => true })
    try {
      const r = await kernel.run('while(true){}', { timeoutMs: 60_000 })
      expect(r.status).toBe('interrupted')
      expect(r.items.some((it) => it.type === 'error')).toBe(false)
    } finally {
      kernel.dispose()
    }
  }, 5000)
})

describe('kernel.run — output budget (in-VM enforcement)', () => {
  test('a runaway output loop is stopped inside the VM with a truncation marker', async () => {
    // The budget is enforced by the kernel itself (not just the host), so the
    // loop is aborted while still producing output — the worker cannot grow
    // its memory without bound. A generous timeout proves the budget, not the
    // deadline, is what stopped it.
    const r = await runFresh(
      "const chunk = 'x'.repeat(1024); for (let i = 0; i < 1e7; i++) console.log(chunk)",
      60_000,
    )
    expect(r.status).toBe('error')
    expect(r.items.some((it) => it.type === 'stderr' && /truncated/i.test(it.text))).toBe(true)
  }, 10_000)

  test('a runaway loop of EMPTY logs is stopped by the item-count limit, not the timeout', async () => {
    // Each `console.log('')` is 0 bytes, so the byte budget never trips. The
    // item-count limit is what stops it. A generous timeout proves the limit
    // (not the deadline) is what fired, and the marker names the item cap.
    const r = await runFresh("for (let i = 0; i < 1e7; i++) console.log('')", 60_000)
    expect(r.status).toBe('error')
    expect(
      r.items.some((it) => it.type === 'stderr' && /truncated at \d+ items/i.test(it.text)),
    ).toBe(true)
    // The output is bounded by the item cap, not left to grow to millions.
    expect(r.items.length).toBeLessThan(20_000)
  }, 10_000)
})

describe('kernel.run — memory limit', () => {
  test('an unbounded allocation surfaces as an error, and the kernel survives', async () => {
    // The VM memory limit turns a runaway allocation into a catchable QuickJS
    // error instead of letting the worker grow until the tab dies. A generous
    // timeout proves the memory cap (not the deadline) is what stopped it.
    const kernel = await createKernel()
    try {
      const r = await kernel.run('const a = []; for (;;) a.push(new Array(10000).fill(1))', {
        timeoutMs: 60_000,
      })
      expect(r.status).toBe('error')
      // The persistent VM must stay usable after an out-of-memory abort.
      const after = await kernel.run('1 + 1')
      expect(after.status).toBe('done')
      expect(after.items).toContainEqual({ type: 'result', value: { kind: 'primitive', value: 2 } })
    } finally {
      kernel.dispose()
    }
  }, 15_000)
})

describe('kernel.run — display() API', () => {
  test('display({ type: "html", value }) produces an html item', async () => {
    const r = await runFresh('display({ type: "html", value: "<b>x</b>" })')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'html', html: '<b>x</b>' })
  })

  test('display({ type: "image", mime, data }) produces an image item', async () => {
    const r = await runFresh('display({ type: "image", mime: "image/png", data: "iVBORw0K" })')
    expect(r.items).toContainEqual({ type: 'image', mime: 'image/png', data: 'iVBORw0K' })
  })

  test('display() with a disallowed image mime is ignored', async () => {
    const r = await runFresh('display({ type: "image", mime: "text/html", data: "x" })')
    expect(r.items.some((it) => it.type === 'image')).toBe(false)
  })

  test('display() with an unknown shape is silently ignored', async () => {
    const r = await runFresh('display({ type: "weird", whatever: 1 }); console.log("after")')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'after' })
    expect(r.items.some((it) => it.type === 'html' || it.type === 'image')).toBe(false)
  })

  test('display() is callable multiple times in the same run', async () => {
    const r = await runFresh(
      'display({ type: "html", value: "<i>1</i>" }); display({ type: "html", value: "<i>2</i>" })',
    )
    expect(r.items.filter((it) => it.type === 'html')).toHaveLength(2)
  })
})

describe('kernel.run — incremental output streaming (onItem)', () => {
  test('onItem fires per item, in order, and matches the final result', async () => {
    const kernel = await createKernel()
    try {
      const streamed: OutputItem[] = []
      const r = await kernel.run('console.log("a"); console.warn("b"); console.log("c"); 1 + 2', {
        onItem: (item) => streamed.push(item),
      })
      // Streamed set === final set (same objects, same order), proving items
      // were emitted as produced rather than replayed at the end.
      expect(streamed).toEqual(r.items)
      expect(streamed).toEqual([
        { type: 'stdout', text: 'a' },
        { type: 'stderr', text: '[warn] b' },
        { type: 'stdout', text: 'c' },
        { type: 'result', value: { kind: 'primitive', value: 3 } },
      ])
    } finally {
      kernel.dispose()
    }
  })

  test('a syntax error is streamed through onItem too', async () => {
    const kernel = await createKernel()
    try {
      const streamed: OutputItem[] = []
      const r = await kernel.run('import x from "y"', { onItem: (item) => streamed.push(item) })
      expect(r.status).toBe('error')
      expect(streamed).toEqual(r.items)
      expect(streamed.some((it) => it.type === 'error')).toBe(true)
    } finally {
      kernel.dispose()
    }
  })

  test('the truncation marker is streamed when the budget is exhausted', async () => {
    const kernel = await createKernel()
    try {
      let sawTruncation = false
      const r = await kernel.run(
        "const chunk = 'x'.repeat(1024); for (let i = 0; i < 1e7; i++) console.log(chunk)",
        {
          timeoutMs: 60_000,
          onItem: (item) => {
            if (item.type === 'stderr' && /truncated/i.test(item.text)) sawTruncation = true
          },
        },
      )
      expect(r.status).toBe('error')
      expect(sawTruncation).toBe(true)
    } finally {
      kernel.dispose()
    }
  }, 10_000)
})

describe('kernel.run — promise output (TARDIS-65)', () => {
  // Regression: a Promise passed to console.log must NOT leak QuickJS's
  // internal promise-state object (`{"type":"rejected",...}`) into stdout.
  // It renders Node-style: `Promise { ... }`. This is the `stdout` leak path.
  function onlyStdout(items: OutputItem[]): string {
    const out = items.filter((it) => it.type === 'stdout')
    expect(out).toHaveLength(1)
    return (out[0] as Extract<OutputItem, { type: 'stdout' }>).text
  }

  test('console.log(rejected) renders Promise { <rejected> … }, not raw JSON', async () => {
    const r = await runFresh('console.log(Promise.reject(new TypeError("not a function")))')
    expect(r.status).toBe('done')
    const text = onlyStdout(r.items)
    expect(text).toBe('Promise { <rejected> TypeError: not a function }')
    expect(text).not.toContain('"type":"rejected"')
  })

  test('console.log(fulfilled) renders Promise { value }, not raw JSON', async () => {
    const r = await runFresh('console.log(Promise.resolve(42))')
    const text = onlyStdout(r.items)
    expect(text).toBe('Promise { 42 }')
    expect(text).not.toContain('"type":"fulfilled"')
  })

  test('console.log(pending) renders Promise { <pending> }, not raw JSON', async () => {
    const r = await runFresh('console.log(new Promise(() => {}))')
    const text = onlyStdout(r.items)
    expect(text).toBe('Promise { <pending> }')
    expect(text).not.toContain('"type":"pending"')
  })

  test('a non-Promise object is unaffected by promise-aware stringify', async () => {
    const r = await runFresh('console.log({ a: 1 })')
    expect(onlyStdout(r.items)).toBe('{"a":1}')
  })

  // The `result` leak path: a trailing rejected Promise must surface as a
  // structured error (never raw JSON) and carry the "forgot await?" hint.
  function onlyError(items: OutputItem[]): Extract<OutputItem, { type: 'error' }> {
    const err = items.find((it) => it.type === 'error')
    expect(err).toBeDefined()
    return err as Extract<OutputItem, { type: 'error' }>
  }

  test('trailing rejected Promise → structured error with hint, not raw JSON', async () => {
    const r = await runFresh('Promise.reject(new TypeError("not a function"))')
    expect(r.status).toBe('error')
    const err = onlyError(r.items)
    expect(err.name).toBe('TypeError')
    expect(err.message).toBe('not a function')
    expect(err.hint).toBe(PROMISE_HINT)
    expect(r.items.some((it) => it.type === 'result')).toBe(false)
    expect(JSON.stringify(r.items)).not.toContain('"type":"rejected"')
  })

  test('trailing rejected Promise from an async function carries the hint', async () => {
    const r = await runFresh('async function f(n){ return n.nope() }\nf(5)')
    expect(r.status).toBe('error')
    expect(onlyError(r.items).hint).toBe(PROMISE_HINT)
  })

  test('an ordinary thrown error gets NO promise hint (unchanged)', async () => {
    const r = await runFresh('throw new TypeError("not a function")')
    expect(r.status).toBe('error')
    const err = onlyError(r.items)
    expect(err.message).toBe('not a function')
    expect(err.hint).toBeUndefined()
  })

  test('a trailing fulfilled Promise still resolves to its value (unchanged)', async () => {
    const r = await runFresh('Promise.resolve(42)')
    expect(r.status).toBe('done')
    expect(r.items).toContainEqual({ type: 'result', value: { kind: 'primitive', value: 42 } })
    expect(r.items.some((it) => it.type === 'error')).toBe(false)
  })

  test('a trailing non-Promise value is a plain result, no hint', async () => {
    const r = await runFresh('1 + 1')
    expect(r.items).toContainEqual({ type: 'result', value: { kind: 'primitive', value: 2 } })
    expect(r.items.some((it) => it.type === 'error')).toBe(false)
  })

  // H-1 (cross-review): Promise.reject(x) does NOT unwrap x, so the reason can
  // be a native Promise. vm.dump disposes a Promise handle and leaks its state,
  // so the old code double-freed (QuickJSUseAfterFree) and re-leaked raw JSON.
  function assertNoLeakNoCrash(items: OutputItem[]) {
    const blob = JSON.stringify(items)
    expect(blob).not.toContain('QuickJSUseAfterFree')
    expect(blob).not.toContain('"type":"fulfilled"')
    expect(blob).not.toContain('"type":"rejected"')
    expect(blob).not.toContain('"type":"pending"')
  }

  test('console.log(Promise.reject(<fulfilled promise>)) does not crash or leak', async () => {
    const r = await runFresh('console.log(Promise.reject(Promise.resolve(1)))')
    expect(r.status).toBe('done')
    assertNoLeakNoCrash(r.items)
    expect(onlyStdout(r.items)).toContain('Promise {')
  })

  test('console.log(Promise.reject(<rejected promise>)) does not crash or leak', async () => {
    const r = await runFresh('console.log(Promise.reject(Promise.reject(2)))')
    expect(r.status).toBe('done')
    assertNoLeakNoCrash(r.items)
  })

  test('trailing Promise.reject(<native promise>) → error + hint, no crash or leak', async () => {
    const r = await runFresh('Promise.reject(Promise.resolve(1))')
    expect(r.status).toBe('error')
    assertNoLeakNoCrash(r.items)
    const err = onlyError(r.items)
    expect(err.name).not.toBe('QuickJSUseAfterFree')
    expect(err.hint).toBe(PROMISE_HINT)
  })
})

describe('kernel.run — trailing marker hardening (TARDIS-65)', () => {
  test('user code cannot reassign the marker away (hint survives the session)', async () => {
    const kernel = await createKernel()
    try {
      // Reassigning the internal marker is silently ignored (non-writable, sloppy
      // mode). The persistent VM must keep detecting trailing promises afterward.
      const clobber = await kernel.run('globalThis.__nbTrailing = 123')
      expect(clobber.status).toBe('done')
      const r = await kernel.run('Promise.reject(new TypeError("x"))')
      expect(r.status).toBe('error')
      const err = r.items.find((it) => it.type === 'error')
      expect(err?.type === 'error' && err.hint).toBe(PROMISE_HINT)
    } finally {
      kernel.dispose()
    }
  })

  test('the marker is not enumerable on globalThis', async () => {
    const r = await runFresh('console.log(Object.keys(globalThis).includes("__nbTrailing"))')
    expect(r.items).toContainEqual({ type: 'stdout', text: 'false' })
  })

  test('a stale hint does not leak to a later plain throw on the same kernel', async () => {
    // trailingWasPromise is a per-run flag reset at the top of runOne. On the
    // persistent VM (one kernel per worker) a hint from a trailing rejected
    // promise must not survive into the next run's ordinary throw.
    const kernel = await createKernel()
    try {
      const first = await kernel.run('Promise.reject(new TypeError("x"))')
      const firstErr = first.items.find((it) => it.type === 'error')
      expect(firstErr?.type === 'error' && firstErr.hint).toBe(PROMISE_HINT)

      const second = await kernel.run('throw new Error("plain")')
      const secondErr = second.items.find((it) => it.type === 'error')
      expect(secondErr?.type === 'error' && secondErr.hint).toBeUndefined()
    } finally {
      kernel.dispose()
    }
  })
})
