import { action, atom, wrap } from '@reatom/core'
import type { auth as authApi } from '@/shared/api'
import { requestOtpAction } from './auth'

export const loginStepAtom = atom<1 | 2>(1, 'auth.loginForm.step')
export const loginEmailAtom = atom('', 'auth.loginForm.email')
export const loginOtpAtom = atom('', 'auth.loginForm.otp')
export const devOtpDataAtom = atom<authApi.OtpRequestResponse | null>(
  null,
  'auth.loginForm.devData',
)
export const resendCountdownAtom = atom(45, 'auth.loginForm.countdown')

export const tickCountdownAction = action(() => {
  const c = resendCountdownAtom()
  resendCountdownAtom.set(c > 0 ? c - 1 : 0)
}, 'auth.loginForm.tickCountdown')

// Request an OTP and advance the form to step 2. Lives in the model (not the
// component) so the async stack is owned by an action: `await wrap(...)`
// preserves the Reatom frame across the request, so the atom writes below run
// with context under production clearStack() — same shape as verifyOtpAction.
// Loading/error UI stays driven by requestOtpAction.ready()/error().
export const sendCodeAction = action(async (email: string) => {
  const data = await wrap(requestOtpAction(email))
  devOtpDataAtom.set(data)
  loginOtpAtom.set('')
  resendCountdownAtom.set(45)
  loginStepAtom.set(2)
}, 'auth.loginForm.sendCode')
