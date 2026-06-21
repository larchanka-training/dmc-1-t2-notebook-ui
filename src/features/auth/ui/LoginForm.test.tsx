// The dev OTP banner is gated by the RESPONSE alone (docs/auth.md §14.2): the
// backend returns the otp only in dev-like envs and 204 in production, so the
// frontend must not add a build-time gate on top. Regression for the
// `import.meta.env.DEV &&` guard that hid the banner in preview deployments
// (production builds talking to a dev backend).
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { devOtpDataAtom, loginEmailAtom, loginStepAtom } from '../model/loginForm'
import { LoginForm } from './LoginForm'

// Seed before render so the component reads the target state on its initial
// synchronous render (same pattern as SaveIndicator.test.tsx).
function seedStep2(devData: { otp: string; expiresAt: number } | null) {
  loginStepAtom.set(2)
  devOtpDataAtom.set(devData)
}

describe('LoginForm dev OTP banner', () => {
  afterEach(() => {
    cleanup()
    devOtpDataAtom.set(null)
    loginStepAtom.set(1)
    loginEmailAtom.set('')
    vi.unstubAllEnvs()
  })

  test('shows the banner when the OTP response contains the code, even in a production build', () => {
    // Emulate a production build: before the fix the banner was additionally
    // gated by `import.meta.env.DEV`, hiding it on preview deployments.
    vi.stubEnv('DEV', false)
    seedStep2({ otp: '424242', expiresAt: 1780000000000 })
    render(<LoginForm />)
    expect(screen.getByText('424242')).toBeInTheDocument()
  })

  test('shows no banner when the backend returned 204 (no otp in the response)', () => {
    seedStep2(null)
    render(<LoginForm />)
    expect(screen.queryByText(/dev mode/i)).not.toBeInTheDocument()
  })

  test('shows which email the OTP was sent to on step 2 (TARDIS-167 №6)', () => {
    // Seed BEFORE render so the component reads it on the initial synchronous
    // render (no post-render state update → no act() warning).
    seedStep2(null)
    loginEmailAtom.set('user@example.com')
    render(<LoginForm />)
    // The address appears in the step-2 subtitle so the user can catch a typo.
    expect(screen.getByText(/we just sent to/i)).toBeInTheDocument()
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
  })
})
