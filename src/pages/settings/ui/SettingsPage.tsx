import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Lock } from 'lucide-react'
import { displayNameAtom } from '@/features/settings'
import { modelIdAtom, autoLoadModelAtom, MODEL_CATALOG, AVAILABLE_MODELS } from '@/features/web-llm'
import {
  inBrowserMaxTokensAtom,
  thinkTokenBudgetAtom,
  MIN_IN_BROWSER_MAX_TOKENS,
  MAX_IN_BROWSER_MAX_TOKENS,
  MIN_THINK_TOKEN_BUDGET,
  MAX_THINK_TOKEN_BUDGET,
} from '@/features/notebook'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Input } from '@/shared/ui/input'
import { Switch } from '@/shared/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

// A titled settings group. `locked` greys the card out and shows a lock + a
// "coming soon" note for features that don't exist yet (start view, Passkey).
function SettingsSection({
  title,
  description,
  locked,
  children,
}: {
  title: string
  description: string
  locked?: boolean
  children?: React.ReactNode
}) {
  return (
    <Card className={locked ? 'opacity-60' : undefined} aria-disabled={locked}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {locked ? <Lock className="size-4 text-muted-foreground" /> : null}
          {title}
          {locked ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Coming soon
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children ? <CardContent className="flex flex-col gap-3">{children}</CardContent> : null}
    </Card>
  )
}

const DisplayNameSection = reatomComponent(() => {
  const displayName = displayNameAtom()
  return (
    <SettingsSection
      title="Display name"
      description="Shown in the sidebar on this device. Leave empty to use your email."
    >
      <Input
        value={displayName}
        placeholder="Your name"
        aria-label="Display name"
        maxLength={80}
        onChange={wrap((e: React.ChangeEvent<HTMLInputElement>) =>
          displayNameAtom.set(e.target.value),
        )}
      />
    </SettingsSection>
  )
}, 'DisplayNameSection')

const DefaultModelSection = reatomComponent(() => {
  const modelId = modelIdAtom()
  const autoLoad = autoLoadModelAtom()
  return (
    <SettingsSection
      title="Default LLM model"
      description="The in-browser model used for code generation. Auto-load downloads it on app start; otherwise load it manually before the first request."
    >
      <Select
        value={modelId}
        onValueChange={wrap((val: string | null) => val && modelIdAtom.set(val))}
      >
        <SelectTrigger className="w-full" aria-label="Default model">
          <SelectValue placeholder="Pick a model" />
        </SelectTrigger>
        <SelectContent>
          {MODEL_CATALOG.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.id} ({m.size})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2.5 text-sm">
        <Switch
          checked={autoLoad}
          onCheckedChange={wrap((checked: boolean) => autoLoadModelAtom.set(checked))}
          disabled={!AVAILABLE_MODELS.includes(modelId)}
        />
        <span>Auto-load this model on start</span>
      </label>
    </SettingsSection>
  )
}, 'DefaultModelSection')

// Read-time conversion: an empty / non-numeric field falls back to the atom's
// current value, so a half-cleared input never writes NaN. Generation clamps
// these via the `effective*` atoms, so an out-of-range raw value stays safe.
function parseLimit(raw: string, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const LimitsSection = reatomComponent(() => {
  const maxTokens = inBrowserMaxTokensAtom()
  const thinkBudget = thinkTokenBudgetAtom()
  return (
    <SettingsSection
      title="Local model limits"
      description="Token budgets for the in-browser model, overriding the built-in defaults. Values are clamped to a safe range when generating."
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span>
          Generation limit (tokens) — {MIN_IN_BROWSER_MAX_TOKENS}–{MAX_IN_BROWSER_MAX_TOKENS}
        </span>
        <Input
          type="number"
          value={String(maxTokens)}
          min={MIN_IN_BROWSER_MAX_TOKENS}
          max={MAX_IN_BROWSER_MAX_TOKENS}
          step={256}
          aria-label="Generation token limit"
          onChange={wrap((e: React.ChangeEvent<HTMLInputElement>) =>
            inBrowserMaxTokensAtom.set(parseLimit(e.target.value, maxTokens)),
          )}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span>
          Thinking limit (tokens) — {MIN_THINK_TOKEN_BUDGET}–{MAX_THINK_TOKEN_BUDGET}
        </span>
        <Input
          type="number"
          value={String(thinkBudget)}
          min={MIN_THINK_TOKEN_BUDGET}
          max={MAX_THINK_TOKEN_BUDGET}
          step={256}
          aria-label="Thinking token limit"
          onChange={wrap((e: React.ChangeEvent<HTMLInputElement>) =>
            thinkTokenBudgetAtom.set(parseLimit(e.target.value, thinkBudget)),
          )}
        />
      </label>
    </SettingsSection>
  )
}, 'LimitsSection')

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-6 pt-12 pb-24 sm:px-10">
      <header>
        <h1 className="mb-1.5 text-[34px] font-semibold tracking-tight">Settings</h1>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Device-local preferences — stored in this browser only.
        </p>
      </header>

      <DisplayNameSection />
      <DefaultModelSection />
      <LimitsSection />

      <SettingsSection
        title="On start"
        description="Open the dashboard or the last notebook used on this device."
        locked
      />
      <SettingsSection
        title="Passkey"
        description="Link this device for biometric sign-in and manage linked passkeys."
        locked
      />
    </div>
  )
}
