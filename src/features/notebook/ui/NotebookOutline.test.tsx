import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { NotebookOutline } from './NotebookOutline'
import { addCell, updateCellCode } from '../model/notebook'
import { outlineDrawerOpenAtom, outlineVisibleAtom } from '../model/notebookSettings'

// NotebookOutline is responsive (TARDIS-74 T3): an inline floating card on
// wide layouts (>1280px, gated by outlineVisibleAtom) and a Sheet drawer on
// narrow ones (≤1280px, gated by outlineDrawerOpenAtom), with an
// IntersectionObserver-driven active-section highlight. jsdom provides neither
// IntersectionObserver nor a real layout, so we stub both and drive width via
// window.innerWidth (which useIsMobile reads on mount).

// Captures every observer the component creates so a test can fire its
// callback manually (the active-section assertion).
interface FakeObserver {
  cb: IntersectionObserverCallback
  observed: Element[]
}
let observers: FakeObserver[] = []

class MockIntersectionObserver {
  private record: FakeObserver
  constructor(cb: IntersectionObserverCallback) {
    this.record = { cb, observed: [] }
    observers.push(this.record)
  }
  observe(el: Element) {
    this.record.observed.push(el)
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
  root = null
  rootMargin = ''
  thresholds = []
}

// Stand-in cells injected into the DOM so scrollToCell / the observer can find
// elements by [data-cell-id] (NotebookOutline renders no cells itself).
const injectedCells: HTMLElement[] = []
function injectCell(id: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-cell-id', id)
  document.body.appendChild(el)
  injectedCells.push(el)
  return el
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

// Append `texts.length` markdown cells (after the default seed code cell), one
// heading each, and return their ids in document order.
async function seedMarkdownHeadings(texts: string[]): Promise<string[]> {
  const ids: string[] = []
  await act(async () => {
    let prev: string | undefined
    for (const text of texts) {
      const cell = addCell(prev, 'markdown')
      updateCellCode(cell.id, text)
      ids.push(cell.id)
      prev = cell.id
    }
  })
  return ids
}

function renderOutline() {
  return render(
    <TooltipProvider>
      <NotebookOutline />
    </TooltipProvider>,
  )
}

let scrollIntoViewSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  observers = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  // scrollToCell calls el.scrollIntoView without optional chaining; jsdom omits
  // it, so seed a no-op before spying (spyOn needs an existing method).
  Element.prototype.scrollIntoView = () => {}
  scrollIntoViewSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
})

afterEach(() => {
  injectedCells.forEach((el) => el.remove())
  injectedCells.length = 0
  vi.unstubAllGlobals()
  setViewportWidth(1024)
})

describe('NotebookOutline — responsive (T3)', () => {
  test('wide: renders the floating outline when visible with ≥2 headings', async () => {
    setViewportWidth(1440)
    await seedMarkdownHeadings(['# Alpha', '# Beta'])
    renderOutline()

    expect(screen.getByText('On this page')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
  })

  test('wide: renders nothing when outlineVisibleAtom is false', async () => {
    setViewportWidth(1440)
    await seedMarkdownHeadings(['# Alpha', '# Beta'])
    await act(async () => outlineVisibleAtom.set(false))
    renderOutline()

    expect(screen.queryByText('On this page')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull()
  })

  test('renders nothing with fewer than 2 headings', async () => {
    setViewportWidth(1440)
    await seedMarkdownHeadings(['# Solo'])
    renderOutline()

    expect(screen.queryByText('On this page')).toBeNull()
  })

  test('narrow: drawer is hidden while outlineDrawerOpenAtom is false', async () => {
    setViewportWidth(1024)
    await seedMarkdownHeadings(['# Alpha', '# Beta'])
    renderOutline()

    expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull()
  })

  test('narrow: drawer shows the headings when outlineDrawerOpenAtom is true', async () => {
    setViewportWidth(1024)
    await seedMarkdownHeadings(['# Alpha', '# Beta'])
    await act(async () => outlineDrawerOpenAtom.set(true))
    renderOutline()

    expect(await screen.findByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument()
  })

  test('narrow: clicking a heading scrolls to its cell and closes the drawer', async () => {
    setViewportWidth(1024)
    const [idAlpha] = await seedMarkdownHeadings(['# Alpha', '# Beta'])
    injectCell(idAlpha)
    await act(async () => outlineDrawerOpenAtom.set(true))
    renderOutline()

    const alpha = await screen.findByRole('button', { name: 'Alpha' })
    await userEvent.click(alpha)

    expect(scrollIntoViewSpy).toHaveBeenCalled()
    expect(outlineDrawerOpenAtom()).toBe(false)
  })

  test('wide: highlights the active heading when its cell intersects', async () => {
    setViewportWidth(1440)
    const [idAlpha, idBeta] = await seedMarkdownHeadings(['# Alpha', '# Beta'])
    injectCell(idAlpha)
    const elBeta = injectCell(idBeta)
    renderOutline()

    // The mounted outline registered one observer over the heading cells.
    expect(observers.length).toBeGreaterThan(0)
    const observer = observers[observers.length - 1]

    // Simulate Beta's cell entering the viewport.
    act(() => {
      observer.cb(
        [{ target: elBeta, isIntersecting: true } as unknown as IntersectionObserverEntry],
        observer as unknown as IntersectionObserver,
      )
    })

    // Active entry gets the primary tint; twMerge resolves the text color to it.
    expect(screen.getByRole('button', { name: 'Beta' }).className).toContain('text-primary')
    expect(screen.getByRole('button', { name: 'Alpha' }).className).not.toContain('text-primary')
  })
})
