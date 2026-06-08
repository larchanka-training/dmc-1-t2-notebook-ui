import { useEffect, useRef, useState } from 'react'
import { Copy, Wrench } from 'lucide-react'
import type { auth as authApi } from '@/shared/api'

type Props = authApi.OtpRequestResponse

// Legacy copy path for non-secure contexts. The async Clipboard API
// (navigator.clipboard) only exists over HTTPS/localhost; dev runs on bare
// http://notebook.com, where it is undefined. Falls back to a throwaway
// textarea + execCommand('copy'). Returns whether the copy succeeded.
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function DevOtpBanner({ otp, expiresAt }: Props) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expiresStr =
    new Date(expiresAt).toLocaleTimeString('en-US', { timeZone: 'UTC', hour12: false }) + ' UTC'

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current)
    },
    [],
  )

  const markCopied = () => {
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current)
    setCopied(true)
    resetTimerRef.current = setTimeout(() => {
      setCopied(false)
      resetTimerRef.current = null
    }, 2000)
  }

  const copy = () => {
    // Guard navigator.clipboard: it is undefined outside a secure context, so a
    // bare `.writeText` throws a TypeError before any promise. Use it when
    // available, otherwise fall back to the legacy execCommand path.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(otp).then(markCopied, () => {
        if (legacyCopy(otp)) markCopied()
      })
      return
    }
    if (legacyCopy(otp)) markCopied()
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-sm space-y-1">
      <div className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
        <Wrench className="size-3.5" />
        DEV MODE
      </div>
      <div className="flex items-center gap-2">
        <span className="text-amber-900 dark:text-amber-200">
          Your OTP: <span className="font-mono font-bold tracking-widest">{otp}</span>
        </span>
        <button
          type="button"
          onClick={copy}
          className="text-xs text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1"
        >
          <Copy className="size-3" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="text-xs text-amber-700 dark:text-amber-400">Expires at {expiresStr}</p>
    </div>
  )
}
