import { reatomComponent } from '@reatom/react'
import { CodeEditor, type CodeEditorProps, type SearchHighlight } from './CodeEditor'
import { activeMatchAtom, searchMatchesAtom, searchOpenAtom } from '../model/search'

// Thin reactive wrapper that owns the notebook-search subscription for a single
// code cell and feeds the matches into the (presentational) CodeEditor.
//
// Why this exists: search results change on every keystroke in the search bar.
// If the enclosing cell row read `searchMatchesAtom` directly, the WHOLE cell
// (card, toolbar, output panel) would re-render per keystroke for every cell on
// screen. Isolating the subscription here means only the lightweight editor
// wrapper reacts; CodeEditor itself diffs the ranges and skips a CM dispatch
// when nothing changed (see `matchesKey` there).
interface CodeCellEditorProps extends Omit<CodeEditorProps, 'searchMatches'> {
  cellId: string
}

export const CodeCellEditor = reatomComponent<CodeCellEditorProps>(({ cellId, ...editorProps }) => {
  const matches: SearchHighlight[] = []
  if (searchOpenAtom()) {
    const all = searchMatchesAtom()
    // Clamped active match (shared with the search bar): never undefined while
    // matches exist, so the active highlight stays in sync with the counter
    // even after a live edit shrinks the result set.
    const activeMatch = activeMatchAtom()
    for (const m of all) {
      if (m.cellId !== cellId) continue
      matches.push({ from: m.index, to: m.index + m.length, active: m === activeMatch })
    }
  }
  return <CodeEditor {...editorProps} searchMatches={matches} />
}, 'CodeCellEditor')
