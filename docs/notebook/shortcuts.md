# Keyboard shortcuts

The complete list of notebook keyboard shortcuts.
This page is the canonical reference; the in-app cheat-sheet (`ShortcutsHelp`, opened with `?`) mirrors it.

The notebook is **modal**, Jupyter-style.
A focused cell is in one of two states, shown by the colour of its left bar:

- **command mode** — the cell shell is focused, blue left bar; single-key shortcuts act on the cell.
- **edit mode** — the caret is inside the editor, green left bar; keys type into the editor.

Click a cell's shell to enter command mode; click inside the editor (or press `Enter`) to enter edit mode.
`Esc` leaves the editor back to command mode.

Modifier labels below use the macOS glyphs (`⌘` Command, `⌥` Option, `⇧` Shift).
On Windows/Linux read `⌘` as `Ctrl` and `⌥` as `Alt` — the app shows the right label per platform.

## Edit mode (caret in the editor)

| Keys      | Action                                         |
| --------- | ---------------------------------------------- |
| `⇧ Enter` | Run cell, then go to (or create) the next cell |
| `⌘ Enter` | Run cell, stay on it                           |
| `⌥ Enter` | Run cell, then insert a new code cell below    |
| `⌘ E`     | Markdown cell: toggle preview / edit           |
| `Esc`     | Leave the editor for command mode              |

A markdown cell is rendered, not executed: the run keys above switch it to preview and move on, they do not call the kernel.

## Command mode (cell focused, not editing)

| Keys      | Action                                  |
| --------- | --------------------------------------- |
| `A` / `B` | Insert a code cell above / below        |
| `D D`     | Delete the cell (two quick presses)     |
| `M` / `Y` | Change the cell kind to markdown / code |
| `↑` / `↓` | Move focus to the previous / next cell  |
| `Enter`   | Enter edit mode                         |

`D D` must be two presses on the **same** cell within ~600 ms; moving focus between presses cancels the gesture.
`M` / `Y` are ignored for a cell that is currently running or queued for Run All.

## Global (work anywhere)

| Keys        | Action                           |
| ----------- | -------------------------------- |
| `⌘ ⇧ Enter` | Run all cells                    |
| `⌘ Z`       | Undo the last notebook operation |
| `⌘ ⇧ Z`     | Redo                             |
| `⌘ F`       | Search the notebook              |
| `⌘ \`       | Toggle the left sidebar          |
| `?`         | Open this shortcut cheat-sheet   |

Undo / redo cover add, delete, move, change-kind and source edits (source edits coalesce per cell within 1 s).
Running a cell is not recorded in history.
`⌘ ⇧ Enter` and the undo/redo combos intentionally fire even while typing in a cell; the single-key shortcuts do not.

## Focus isolation

Global single-key shortcuts (command-mode `A` / `B` / `D` / `M` / `Y`, the `?` cheat-sheet) never fire while you are typing in a cell editor or any other text input.
Only meaningful modifier combos (run keys, undo/redo, search, Run All) are allowed through to the editor.
This guard lives in `shared/lib/hotkeys.ts` (`blockedByEditor`).

## Where this lives in code

- Edit-mode run keys (`⇧`/`⌘`/`⌥ Enter`, `Esc`) — bound inside CodeMirror at `Prec.highest` (`CodeEditor.tsx`); the markdown textarea mirrors them (`NotebookCell.tsx`).
- Command-mode keys — `commandHotkeys.ts` (`useCommandModeHotkeys`).
- Global keys — `NotebookView.tsx` (undo/redo), `SearchBar.tsx` (`⌘ F`), `AppTopbar.tsx` (Run All, toggle sidebar), `ShortcutsHelp.tsx` (`?`).
- The document-level scope stack and the editor guard — `shared/lib/hotkeys.ts`.
- Platform-specific key labels — `shared/lib/platform.ts`.

When you add or change a shortcut, update this page **and** the `ShortcutsHelp` `GROUPS` in the same change so the two stay in sync.
