import { action, atom } from '@reatom/core'
import type { auth as authApi } from '@/shared/api'

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
