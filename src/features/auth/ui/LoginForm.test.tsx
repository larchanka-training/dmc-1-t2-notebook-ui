// The dev OTP banner is gated by the RESPONSE alone (docs/auth.md §14.2): the
// backend returns the otp only in dev-like envs and 204 in production, so the
// frontend must not add a build-time gate on top. Regression for the
// `import.meta.env.DEV &&` guard that hid the banner in preview deployments
// (production builds talking to a dev backend).
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { auth as authApi } from '@/shared/api'
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

  test('typing in the uncontrolled email field still updates loginEmailAtom (TARDIS-167 №21)', async () => {
    const user = userEvent.setup()
    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email/i), 'a@b.com')

    // The field is uncontrolled (defaultValue + ref) to keep the caret stable,
    // but onChange must still mirror into the atom so the handlers + step-2
    // subtitle see the address.
    expect(loginEmailAtom()).toBe('a@b.com')
  })

  test('returning from the OTP step shows the previously typed email, not a stale value (TARDIS-167 №21, review PR #89)', async () => {
    const user = userEvent.setup()
    // 204 (no dev otp) — just advance to step 2.
    vi.spyOn(authApi, 'requestOtp').mockResolvedValue(null)
    render(<LoginForm />)

    await user.type(screen.getByLabelText(/email/i), 'a@b.com')
    await user.click(screen.getByRole('button', { name: /send code/i }))

    // Now on step 2 (the OTP entry screen).
    await waitFor(() => expect(screen.getByText(/we just sent to/i)).toBeInTheDocument())

    // Go back to the email step.
    await user.click(screen.getByRole('button', { name: /use a different email/i }))

    // The email field must show the address the user typed — the EmailStep
    // remounts and re-seeds its defaultValue from the live atom, so it is NOT
    // empty/stale (the bug: a value frozen at the first LoginForm mount).
    const field = screen.getByLabelText(/email/i) as HTMLInputElement
    expect(field).toHaveValue('a@b.com')
  })
})
