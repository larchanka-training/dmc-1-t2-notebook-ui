import { useEffect, type FormEvent } from 'react'
import { BookText, Loader2 } from 'lucide-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { userAtom } from '@/entities/session'
import { OTP_EXPIRED_CODE, requestOtpAction, verifyOtpAction } from '../model/auth'
import {
  devOtpDataAtom,
  loginEmailAtom,
  loginOtpAtom,
  loginStepAtom,
  resendCountdownAtom,
  sendCodeAction,
  tickCountdownAction,
} from '../model/loginForm'
import { DevOtpBanner } from './DevOtpBanner'

export const LoginForm = reatomComponent(() => {
  const step = loginStepAtom()
  const email = loginEmailAtom()
  const otp = loginOtpAtom()
  const devData = devOtpDataAtom()
  const countdown = resendCountdownAtom()

  const isSending = !requestOtpAction.ready()
  const isVerifying = !verifyOtpAction.ready()
  const sendError = requestOtpAction.error()?.message ?? null
  const verifyError = verifyOtpAction.error()?.message ?? null

  // wrap() must be called at render time, where reatomComponent provides the
  // Reatom context to capture. Calling it inside a useEffect/setInterval (a
  // passive effect, no active stack) throws `missing async stack`. We capture
  // the bound callbacks here and only invoke them from the effects below.
  const resetToStep1 = wrap(() => {
    loginStepAtom.set(1)
    loginOtpAtom.set('')
  })
  const tick = wrap(tickCountdownAction)

  // otp_expired → go back to step 1 so user can request a fresh code.
  useEffect(() => {
    if (verifyError === OTP_EXPIRED_CODE) resetToStep1()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyError])

  // #4 — countdown depends only on step, not on countdown itself.
  // Including countdown in the deps caused a new setInterval every second
  // (cleanup + re-create on every tick), doubling up under React StrictMode.
  useEffect(() => {
    if (step !== 2) return
    const id = window.setInterval(tick, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const onSendCode = wrap(async (e: FormEvent) => {
    e.preventDefault()
    try {
      await sendCodeAction(email)
    } catch {
      // Error displayed via requestOtpAction.error().
    }
  })

  const onVerify = wrap(async (e: FormEvent) => {
    e.preventDefault()
    try {
      await verifyOtpAction({ email, otp })
    } catch {
      // Error displayed via verifyOtpAction.error().
    }
  })

  const onResend = wrap(async () => {
    try {
      await sendCodeAction(email)
    } catch {
      // Error displayed via requestOtpAction.error().
    }
  })

  // #5 — clear stale verifyOtpAction.error when going back to step 1 so it
  // doesn't appear immediately on the next step-2 screen before any attempt.
  const onBackToStep1 = wrap(() => {
    verifyOtpAction.error.set(undefined)
    loginStepAtom.set(1)
  })

  const user = userAtom()
  if (user) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Welcome, {user.displayName ?? user.email}</h1>
        <p className="text-sm text-muted-foreground">You are signed in as {user.email}.</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10">
          <BookText className="size-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">JS Notebook</h1>
        <p className="text-sm text-muted-foreground">
          {step === 1 ? 'Sign in to your account' : `Code sent to ${email}`}
        </p>
      </div>

      {step === 1 ? (
        <form onSubmit={onSendCode} className="border rounded-xl p-6 space-y-4 bg-card shadow-sm">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={email}
              onChange={wrap((e) => loginEmailAtom.set(e.target.value))}
              disabled={isSending}
            />
          </div>

          {sendError ? (
            <p role="alert" className="text-sm text-destructive">
              {sendError}
            </p>
          ) : null}

          <Button className="w-full" type="submit" disabled={isSending || !email}>
            {isSending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isSending ? 'Sending…' : 'Send code'}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          {/* #9 — client-side env guard as defence-in-depth: even if the backend
              accidentally returns an OTP in production, it won't be shown in a
              production build. */}
          {import.meta.env.DEV && devData ? (
            <DevOtpBanner otp={devData.otp} expiresAt={devData.expiresAt} />
          ) : null}

          <form onSubmit={onVerify} className="border rounded-xl p-6 space-y-4 bg-card shadow-sm">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="otp">
                One-time code
              </label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="\d{6}"
                autoComplete="one-time-code"
                placeholder="000000"
                className="tracking-[0.5em] text-center font-mono text-lg"
                value={otp}
                onChange={wrap((e) => loginOtpAtom.set(e.target.value.replace(/\D/g, '')))}
                disabled={isVerifying}
                autoFocus
              />
            </div>

            {verifyError && verifyError !== OTP_EXPIRED_CODE ? (
              <p role="alert" className="text-sm text-destructive">
                {verifyError}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={isVerifying || otp.length !== 6}>
                {isVerifying ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {isVerifying ? 'Verifying…' : 'Verify'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isSending || countdown > 0}
                onClick={onResend}
              >
                {countdown > 0 ? `Resend in ${countdown}s` : 'Resend'}
              </Button>
            </div>
          </form>

          <button
            type="button"
            className="block w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={onBackToStep1}
          >
            ← Use a different email
          </button>
        </div>
      )}
    </div>
  )
}, 'LoginForm')
