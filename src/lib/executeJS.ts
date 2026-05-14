export async function executeJS(code: string): Promise<{ output: string; error: boolean }> {
  const lines: string[] = []

  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error

  console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  console.warn = (...args: unknown[]) => lines.push('[warn] ' + args.map(String).join(' '))
  console.error = (...args: unknown[]) => lines.push('[error] ' + args.map(String).join(' '))

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (async () => { ${code} })()`)
    const result = await fn()
    if (result !== undefined) lines.push(String(result))
    return { output: lines.join('\n'), error: false }
  } catch (err) {
    return { output: String(err), error: true }
  } finally {
    console.log = originalLog
    console.warn = originalWarn
    console.error = originalError
  }
}
