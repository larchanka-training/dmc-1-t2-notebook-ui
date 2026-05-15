export async function executeJS(code: string): Promise<{ output: string; error: boolean }> {
  const lines: string[] = []

  const sandboxConsole = {
    log: (...args: unknown[]) => lines.push(args.map(String).join(' ')),
    warn: (...args: unknown[]) => lines.push('[warn] ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => lines.push('[error] ' + args.map(String).join(' ')),
  }

  try {
    const fn = new Function('console', `return (async () => { ${code} })()`)
    const result = await fn(sandboxConsole)
    if (result !== undefined) lines.push(String(result))
    return { output: lines.join('\n'), error: false }
  } catch (err) {
    return { output: String(err), error: true }
  }
}
