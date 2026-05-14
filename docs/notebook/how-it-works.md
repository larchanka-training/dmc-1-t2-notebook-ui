# How the Notebook Works

## Overview

The notebook executes real JavaScript — not a simulator. Code runs inside the browser's own JS engine using the `Function` constructor, which creates and immediately calls an async function wrapping your code.

---

## Execution pipeline

When you press **Run** (or `Cmd+Enter`), this sequence happens:

```
user code (string)
    │
    ▼
executeJS(code)                        ← src/lib/executeJS.ts
    │
    ├─ 1. Capture console output
    │       Override console.log / warn / error with collectors
    │
    ├─ 2. Wrap code in async function
    │       new Function(`return (async () => { ${code} })()`)
    │
    ├─ 3. Execute
    │       await fn()
    │
    ├─ 4. Capture return value
    │       if result !== undefined → push to output lines
    │
    └─ 5. Restore console + return { output, error }
    │
    ▼
NotebookCell updates status → 'done' or 'error'
Output string displayed below the editor
```

---

## executeJS — the core function

```ts
// src/lib/executeJS.ts

export async function executeJS(code: string): Promise<{ output: string; error: boolean }> {
  const lines: string[] = []

  // Step 1 — redirect console output into our array
  const originalLog = console.log
  console.log = (...args) => lines.push(args.map(String).join(' '))
  // (same for console.warn and console.error)

  try {
    // Step 2 & 3 — wrap and run
    const fn = new Function(`return (async () => { ${code} })()`)
    const result = await fn()

    // Step 4 — capture explicit return value
    if (result !== undefined) lines.push(String(result))

    return { output: lines.join('\n'), error: false }
  } catch (err) {
    return { output: String(err), error: true }
  } finally {
    // Step 5 — always restore console
    console.log = originalLog
  }
}
```

---

## What you can run

### Basic expressions
```js
2 + 2
// output: 4
```

### console.log
```js
console.log('Hello', 'World')
// output: Hello World
```

### Multiple outputs
```js
console.log('first')
console.log('second')
// output:
// first
// second
```

### Variables and logic
```js
const nums = [1, 2, 3, 4, 5]
const evens = nums.filter(n => n % 2 === 0)
console.log(evens)
// output: 2,4
```

### Async / await
```js
const res = await fetch('https://jsonplaceholder.typicode.com/todos/1')
const data = await res.json()
console.log(data.title)
```

### Error handling
```js
JSON.parse('not valid json')
// output (in red): SyntaxError: Unexpected token 'o', "not valid" is not valid JSON
```

---

## Limitations

| Limitation | Reason |
|---|---|
| No `import` / `require` | Code runs inside `new Function`, not a module — no module system available |
| No access to `src/` files | Browser sandbox — you can't read files from the project |
| `console.warn` shown as `[warn] …` | Captured and prefixed to distinguish from `console.log` |
| Objects logged as `[object Object]` | `String(obj)` is used — use `JSON.stringify(obj)` for full output |

### Workaround for objects

```js
const obj = { name: 'Alice', age: 30 }
console.log(JSON.stringify(obj, null, 2))
```

---

## Cell state machine

Each cell has a `status` field that drives the UI:

```
idle  ──(run)──▶  running  ──(success)──▶  done
                      │
                      └──(error)──▶  error
```

| Status | Border | Run button | Output area |
|---|---|---|---|
| `idle` | default | green play icon | hidden |
| `running` | default | spinning loader | hidden |
| `done` | default | green play icon | visible, normal text |
| `error` | red (`border-destructive`) | green play icon | visible, red text |

---

## Related files

- `src/lib/executeJS.ts` — execution logic
- `src/components/common/NotebookCell.tsx` — cell UI component
- `src/pages/NotebookPage.tsx` — page that manages the list of cells
