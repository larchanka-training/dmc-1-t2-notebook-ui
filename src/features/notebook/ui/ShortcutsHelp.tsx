import { atom, wrap } from '@reatom/core'
import { appPath } from '@/shared/lib/paths'
import { reatomComponent } from '@reatom/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { useHotkeys } from '@/shared/lib/hotkeys'
import { altKeyLabel, modKeyLabel, shiftKeyLabel } from '@/shared/lib/platform'

/** Whether the shortcuts cheat-sheet dialog is open. */
export const shortcutsOpenAtom = atom(false, 'notebook.shortcutsOpen')

interface ShortcutGroup {
  title: string
  items: Array<{ keys: string; desc: string }>
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Edit mode (in the editor)',
    items: [
      { keys: `${shiftKeyLabel} Enter`, desc: 'Run cell, go to next' },
      { keys: `${modKeyLabel} Enter`, desc: 'Run cell, stay' },
      { keys: `${altKeyLabel} Enter`, desc: 'Run cell, insert below' },
      { keys: `${modKeyLabel} E`, desc: 'Markdown: preview / edit' },
      { keys: 'Esc', desc: 'Leave editor (command mode)' },
    ],
  },
  {
    title: 'Command mode (cell focused)',
    items: [
      { keys: 'A / B', desc: 'Insert cell above / below' },
      { keys: 'D D', desc: 'Delete cell' },
      { keys: 'M / Y', desc: 'To markdown / code' },
      { keys: '↑ / ↓', desc: 'Move between cells' },
      { keys: 'Enter', desc: 'Enter edit mode' },
    ],
  },
  {
    title: 'Global',
    items: [
      { keys: `${modKeyLabel} ${shiftKeyLabel} Enter`, desc: 'Run all cells' },
      { keys: `${modKeyLabel} Z`, desc: 'Undo' },
      { keys: `${modKeyLabel} ${shiftKeyLabel} Z`, desc: 'Redo' },
      { keys: `${modKeyLabel} F`, desc: 'Search notebook' },
      { keys: `${modKeyLabel} \\`, desc: 'Toggle sidebar' },
      { keys: '?', desc: 'This help' },
    ],
  },
]

/**
 * Keyboard shortcuts cheat-sheet, opened with `?`. While open it pushes its
 * own hotkey scope (Esc closes), which shadows the notebook shortcuts beneath.
 */
export const ShortcutsHelp = reatomComponent(() => {
  const open = shortcutsOpenAtom()

  // '?' coexists with the notebook shortcuts (non-modal). Once open, the
  // dialog's Escape scope is modal so it shields the shortcuts beneath it.
  useHotkeys({ '?': wrap(() => shortcutsOpenAtom.set(true)) }, { enabled: !open })
  useHotkeys({ Escape: wrap(() => shortcutsOpenAtom.set(false)) }, { enabled: open, modal: true })

  return (
    <Dialog open={open} onOpenChange={wrap((next: boolean) => shortcutsOpenAtom.set(next))}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Speed up editing — press ? any time to reopen.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-warning">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.keys} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{item.desc}</span>
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap">
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="border-t border-border pt-4 text-sm text-muted-foreground">
          Need runnable examples?{' '}
          <a href={appPath('usage')} className="font-medium text-primary hover:underline">
            Open Usage
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}, 'ShortcutsHelp')
