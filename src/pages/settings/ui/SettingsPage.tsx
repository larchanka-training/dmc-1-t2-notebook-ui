import { useState } from 'react'
import { wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import { Lock } from 'lucide-react'
import { displayNameAtom, startViewAtom } from '@/features/settings'
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
          // Defence-in-depth: the Select only offers catalogue ids and `coerce`
          // resets a phantom id on load, so in practice this is always enabled —
          // it just guards against arming auto-load for an unknown model id.
          disabled={!AVAILABLE_MODELS.includes(modelId)}
        />
        <span>Auto-load this model on start</span>
      </label>
    </SettingsSection>
  )
}, 'DefaultModelSection')

// A number field with a LOCAL string draft. A controlled number input bound
// straight to the atom can't be cleared (the atom value snaps back, and a
// fallback-on-empty makes `Number('') === 0` either persist 0 or fight the
// edit). Keeping the visible value as a string lets the field be transiently
// empty/partial while committing to the atom only a real finite number — so a
// cleared field leaves the atom at its last valid value instead of writing 0/NaN.
// `commit` is pre-`wrap`ped by the caller (clearStack). The draft re-seeds when
// `value` changes from outside the field (account switch / sign-out reset).
//
// Deliberate `useState` (not `reatomField`): the project prefers Reatom forms,
// but this draft/commit dance is exactly the local-UI-state case `useState` is
// for (same as the sidebar's filter input), and it isolates the `Number('')`
// quirk of a controlled number input. The source of truth stays the Reatom atom.
function TokenLimitField({
  label,
  value,
  min,
  max,
  commit,
}: {
  label: string
  value: number
  min: number
  max: number
  commit: (n: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  // Re-seed the draft when `value` changes from OUTSIDE the field (account
  // switch / sign-out reset). React's "adjust state during render on prop
  // change" pattern — a render-time set, not an effect, so no cascading-render
  // lint and no stale frame.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(String(value))
  }
  return (
    <Input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={256}
      aria-label={label}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') return
        const n = Number(raw)
        if (Number.isFinite(n)) commit(n)
      }}
      onBlur={() => {
        // Normalise to [min, max] on blur so the field never lingers showing an
        // out-of-range value that generation would silently clamp. An empty /
        // invalid draft snaps back to the last committed `value`.
        const n = Number(draft)
        const next = draft.trim() === '' || !Number.isFinite(n) ? value : n
        const clamped = Math.min(max, Math.max(min, Math.round(next)))
        setDraft(String(clamped))
        if (clamped !== value) commit(clamped)
      }}
    />
  )
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
        <TokenLimitField
          label="Generation token limit"
          value={maxTokens}
          min={MIN_IN_BROWSER_MAX_TOKENS}
          max={MAX_IN_BROWSER_MAX_TOKENS}
          commit={wrap((n: number) => inBrowserMaxTokensAtom.set(n))}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span>
          Thinking limit (tokens) — {MIN_THINK_TOKEN_BUDGET}–{MAX_THINK_TOKEN_BUDGET}
        </span>
        <TokenLimitField
          label="Thinking token limit"
          value={thinkBudget}
          min={MIN_THINK_TOKEN_BUDGET}
          max={MAX_THINK_TOKEN_BUDGET}
          commit={wrap((n: number) => thinkTokenBudgetAtom.set(n))}
        />
      </label>
    </SettingsSection>
  )
}, 'LimitsSection')

// TARDIS-183: "On start" chooses what opens after sign-in. Two options (dashboard
// vs the last notebook used) is a binary choice, so a Switch fits — same pattern
// as "Auto-load this model on start". The atom is the reactive source for this
// toggle; the startup resolver reads the persisted record directly (boot-time
// async-hydration race), not this atom.
const OnStartSection = reatomComponent(() => {
  const startView = startViewAtom()
  return (
    <SettingsSection
      title="On start"
      description="Open the dashboard or the last notebook used on this device."
    >
      <label className="flex items-center gap-2.5 text-sm">
        <Switch
          checked={startView === 'dashboard'}
          onCheckedChange={wrap((checked: boolean) =>
            startViewAtom.set(checked ? 'dashboard' : 'last-opened'),
          )}
        />
        {/* Name BOTH outcomes so the off-state isn't a guess: a Switch normally
            reads as on/off, but here both positions are named modes. */}
        <span>
          Show the dashboard on start
          <span className="block text-xs text-muted-foreground">
            {startView === 'dashboard'
              ? 'Opening the dashboard.'
              : 'Opening the last notebook used on this device.'}
          </span>
        </span>
      </label>
    </SettingsSection>
  )
}, 'OnStartSection')

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

      <OnStartSection />
      <SettingsSection
        title="Passkey"
        description="Link this device for biometric sign-in and manage linked passkeys."
        locked
      />
    </div>
  )
}
