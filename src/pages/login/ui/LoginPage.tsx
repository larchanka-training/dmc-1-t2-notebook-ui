import { useEffect } from 'react'
import { urlAtom } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { accessTokenAtom, userAtom } from '@/entities/session'
import { LoginForm } from '@/features/auth'
import { appPath } from '@/shared/lib/paths'

const LoginPage = reatomComponent(() => {
  const isAuthenticated = accessTokenAtom() !== null && userAtom() !== null
  const rawFrom = urlAtom().searchParams.get('from')
  // #1 — reject protocol-relative URLs (//evil.com) which pass startsWith('/')
  // but navigate to an external origin via window.location.replace.
  // Default to the app base (import.meta.env.BASE_URL) so previews stay in-app.
  const to = rawFrom?.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : appPath()

  useEffect(() => {
    if (!isAuthenticated) return
    window.location.replace(to)
  }, [isAuthenticated, to])

  if (isAuthenticated) return null

  return (
    <div className="flex flex-1 items-center justify-center min-h-full py-12">
      <LoginForm />
    </div>
  )
}, 'LoginPage')

export default LoginPage
