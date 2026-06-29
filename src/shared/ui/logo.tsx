import { cn } from '@/shared/lib/cn'

export interface LogoProps {
  /** Square side length, in px. */
  size: number
  /** Glyph font size, in px. Defaults to half the box size. */
  fontSize?: number
  /** Border radius, in px. Defaults to ~18.75% of the box size. */
  radius?: number
  className?: string
}

/**
 * The "JS" brand tile — the single source of truth for the JS Notebook logo.
 * Every surface (login, sidebar, loading overlay) renders the same outlined
 * glyph, scaled by `size`. Change the look here and it changes everywhere.
 */
export function Logo({ size, fontSize = size / 2, radius = size * 0.1875, className }: LogoProps) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center border-2 border-primary bg-primary-foreground font-mono font-semibold text-primary',
        className,
      )}
      style={{ width: size, height: size, fontSize, borderRadius: radius }}
    >
      JS
    </span>
  )
}
