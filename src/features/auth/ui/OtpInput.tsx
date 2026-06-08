import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { cn } from '@/shared/lib/cn'

export const OTP_LENGTH = 6

interface OtpInputProps {
  // Single source of truth: the same `loginOtpAtom` string the old input wrote.
  // This component is purely presentational — it never owns the value.
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  autoFocus?: boolean
  // Renders all boxes in an error ring (e.g. after a rejected code).
  invalid?: boolean
  'aria-label'?: string
}

// Six single-digit boxes that read/write one flat OTP string (e.g. "123456").
// Behaviour mirrors the new-design-v2 prototype: type to auto-advance, Backspace
// to step back, paste a full code into ANY box to fill all six. Focus is managed
// via refs (DOM only — no Reatom), so no `wrap` is needed here; the injected
// `onChange` is wrapped by the caller.
export function OtpInput({
  value,
  onChange,
  disabled,
  autoFocus,
  invalid,
  'aria-label': ariaLabel = 'One-time code',
}: OtpInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])

  const focusBox = (index: number) => {
    const clamped = Math.max(0, Math.min(OTP_LENGTH - 1, index))
    const el = inputsRef.current[clamped]
    el?.focus()
    el?.select()
  }

  // Replace the digit at `index`, keeping the string at most OTP_LENGTH long.
  const writeDigit = (index: number, digit: string) => {
    const chars = value.slice(0, OTP_LENGTH).split('')
    while (chars.length < OTP_LENGTH) chars.push('')
    chars[index] = digit
    onChange(chars.join('').slice(0, OTP_LENGTH))
  }

  const handleInput = (index: number, raw: string) => {
    // Keep only the last typed digit so overwriting a filled box works.
    const digit = raw.replace(/\D/g, '').slice(-1)
    writeDigit(index, digit)
    if (digit) focusBox(index + 1)
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (value[index]) {
        writeDigit(index, '')
      } else if (index > 0) {
        writeDigit(index - 1, '')
        focusBox(index - 1)
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusBox(index - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusBox(index + 1)
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!pasted) return
    onChange(pasted)
    // Land on the next empty box, or the last one when the code is complete.
    focusBox(pasted.length >= OTP_LENGTH ? OTP_LENGTH - 1 : pasted.length)
  }

  return (
    <div className="flex justify-center gap-2.5" role="group" aria-label={ariaLabel}>
      {Array.from({ length: OTP_LENGTH }, (_, i) => {
        const digit = value[i] ?? ''
        return (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            aria-label={`Digit ${i + 1}`}
            value={digit}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            onChange={(e) => handleInput(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            className={cn(
              'size-12 rounded-lg border bg-background text-center font-mono text-xl text-foreground',
              'transition-colors outline-none focus:border-primary focus:ring-3 focus:ring-primary/20',
              'disabled:pointer-events-none disabled:opacity-50',
              invalid
                ? 'border-destructive ring-3 ring-destructive/20'
                : digit
                  ? 'border-primary'
                  : 'border-border',
            )}
          />
        )
      })}
    </div>
  )
}
