import { useState, type FormEvent } from 'react'
import { BookText, Loader2 } from 'lucide-react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { userAtom } from '@/entities/session'
import { loginAction } from '../model/auth'

export const LoginForm = reatomComponent(() => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const isLoading = !loginAction.ready()
  const error = loginAction.error()?.message ?? null
  const user = userAtom()

  const onSubmit = wrap(async (e: FormEvent) => {
    e.preventDefault()
    await loginAction({ email, password })
  })

  if (user) {
    return (
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Welcome, {user.displayName ?? user.email}</h1>
        <p className="text-sm text-muted-foreground">You are signed in as {user.email}.</p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10">
          <BookText className="size-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">JS Notebook</h1>
        <p className="text-sm text-muted-foreground">Sign in to your account</p>
      </div>

      <div className="border rounded-xl p-6 space-y-4 bg-card shadow-sm">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium" htmlFor="password">
              Password
            </label>
            <a
              href="#"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Forgot password?
            </a>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button className="w-full" type="submit" disabled={isLoading}>
          {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <a href="#" className="text-foreground font-medium hover:underline">
          Sign up
        </a>
      </p>
    </form>
  )
}, 'LoginForm')
