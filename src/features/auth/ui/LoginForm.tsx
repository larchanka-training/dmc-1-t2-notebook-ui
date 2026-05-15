import { useState } from 'react'
import { BookText } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center justify-center size-12 rounded-xl bg-primary/10">
          <BookText className="size-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">JS Notebook</h1>
        <p className="text-sm text-muted-foreground">Sign in to your account</p>
      </div>

      <div className="border rounded-xl p-6 space-y-4 bg-card shadow-sm">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="email">Email</label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium" htmlFor="password">Password</label>
            <a href="#" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Forgot password?
            </a>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>
        <Button className="w-full" type="submit">Sign in</Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{' '}
        <a href="#" className="text-foreground font-medium hover:underline">Sign up</a>
      </p>
    </div>
  )
}
