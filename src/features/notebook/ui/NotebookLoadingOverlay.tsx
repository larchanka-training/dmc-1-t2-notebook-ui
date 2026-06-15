import { cn } from '@/shared/lib/cn'

export function NotebookLoadingOverlay() {
  const skeleton = 'relative overflow-hidden rounded-[5px] bg-muted'

  return (
    <div
      className="absolute inset-0 z-30 grid place-items-center overflow-hidden bg-background/60 backdrop-blur-[7px]"
      aria-busy="true"
      aria-label="Loading notebook"
      role="status"
    >
      <div className="absolute inset-0 overflow-hidden opacity-70" aria-hidden="true">
        <div className="mx-auto flex max-w-[760px] flex-col gap-5 px-10 pt-12">
          <div className={cn(skeleton, 'h-[30px] w-[60%]')} />
          <div className={cn(skeleton, 'h-[15px] w-[88%]')} />
          <div className={cn(skeleton, 'h-[120px] w-full rounded-[var(--radius-cell)]')} />
          <div className={cn(skeleton, 'h-[92px] w-full rounded-[var(--radius-cell)]')} />
          <div className={cn(skeleton, 'h-[15px] w-[72%]')} />
        </div>
      </div>

      <div className="relative flex w-[min(348px,86%)] flex-col items-center rounded-[var(--radius-modal)] border border-border bg-card/95 px-9 py-8 text-center shadow-[var(--shadow-pop)]">
        <div className="relative mb-[18px] grid size-[72px] place-items-center">
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <div className="grid size-[52px] place-items-center rounded-[14px] bg-primary font-mono text-[21px] font-semibold text-primary-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,black_8%,transparent)]">
            JS
          </div>
        </div>
        <div className="text-[17px] font-semibold tracking-[-0.01em]">
          Synchronization<span className="animate-pulse">...</span>
        </div>
        <div className="mt-[5px] max-w-[26ch] text-[13.5px] leading-[1.5] text-muted-foreground">
          Restoring your notebook and checking the server version
        </div>
        <div className="relative mt-5 h-[5px] w-full overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-y-0 w-2/5 animate-pulse rounded-full bg-primary" />
        </div>
      </div>
    </div>
  )
}
