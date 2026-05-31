import { atom, wrap } from '@reatom/core'
import { reatomComponent } from '@reatom/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { useHotkeys } from '@/shared/lib/hotkeys'

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
      { keys: '⇧ Enter', desc: 'Run cell, go to next' },
      { keys: '⌘/Ctrl Enter', desc: 'Run cell, stay' },
      { keys: '⌥ Enter', desc: 'Run cell, insert below' },
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
      { keys: '⌘/Ctrl Z', desc: 'Undo' },
      { keys: '⌘/Ctrl ⇧ Z', desc: 'Redo' },
      { keys: '⌘/Ctrl F', desc: 'Search notebook' },
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

  useHotkeys({ '?': wrap(() => shortcutsOpenAtom.set(true)) }, !open)
  useHotkeys({ Escape: wrap(() => shortcutsOpenAtom.set(false)) }, open)

  return (
    <Dialog open={open} onOpenChange={wrap((next: boolean) => shortcutsOpenAtom.set(next))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Speed up editing — press ? any time to reopen.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.keys} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{item.desc}</span>
                    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}, 'ShortcutsHelp')
