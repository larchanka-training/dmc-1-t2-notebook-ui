// Content of the seed "feature demo" notebook (TARDIS-67).
//
// This is the notebook a brand-new local user sees first. It is a guided,
// runnable tour that tells one small story — "here is everything a cell can
// do" — while exercising EVERY output channel the runtime supports:
//   - stdout / stderr  (console.log / info / warn / error)
//   - result           (a cell's trailing expression, the `⟹` line)
//   - html             (display({ type: 'html', value }))
//   - image            (display({ type: 'image', mime, data }))
//   - error            (a thrown error rendered as a structured item)
//
// Every code cell must run AS-IS in a real cell. The QuickJS sandbox injects
// `console`, `display` and the base64 codecs `btoa` / `atob`; there is still NO
// `fetch`, `window` or `document` in cell scope (see runtime/quickjs.ts). So:
//   - SVG goes through `display({ type: 'html' })`,
//   - canvas is drawn inside an HTML output iframe, where the DOM exists,
//   - the `image` channel ships RAW base64 (no `data:` prefix).
//
// Kept in its own module (imported by ./notebook) so the editor model stays
// free of large literal content.
import type { NotebookJSON } from '../persistence/schema'

/** Title of the seed feature-demo notebook. */
export const SEED_TITLE = '📗 My first notebook, full of features'

// A small, pre-encoded PNG (80×80, indigo square with a pink dot) shown via the
// `image` output channel. Raw base64, no `data:` prefix — the renderer adds it.
// Pre-encoded on purpose: keeps the demo cell readable and the `image` channel
// is for assets you already have encoded. (`btoa` does exist in the sandbox now,
// so a cell *could* build base64 at runtime — it just shouldn't inline a blob.)
// Exported so the Usage page can reuse the SAME runnable bytes in its example.
export const DEMO_IMAGE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAMKSURBVHhe7Zq/a1RBFIXz5/kbjRgNGjGGaGNhI1jYWFjYWNiIKAoqBEFQRBGRgAoGCYhFEIUgIgFJEQT/gpGzsBLusLqbc+/MFU7xNcuye+ab9+7Mu/OmFs78KmLnTNkPxGRIIIkEkkggiQSSSCCJBJJIIIkEkkggiQSSSCCJBJJIIIkEkkggiQSSSCCJBJKkFXhp/nu5cnL9D5dPfa2+k4EUAs8u/izXT6yVl4dflW9775WtXTdHsrn7dlmeflFuHP9Yzi9sVr/Vmq4CL5z+MZBmJU3CyqGng6vV/nYrugg8t7hVnsy8HlxNVshOwUT0uCKbC0Qt29hzpxLgASbk2tyn6j8jaSoQdcvzqhvF/WPvq/+OopnApaPvqoFGglvaZoigicBbsx+qAbbg0czbKos34QKxh2tx244C2yObyZNQgVgVoxaMccHkRW5zQgViq2IH1IM308+rbF6ECbw4v9H11rWglNiMHoQJxKzbQfRk7cDDKqMHIQLxpGEHkIGIhkSIQGyYbfgMYC9qs7KECES3xIbPwOf9S1VWlhCBvbcufwMdIJuXwV0g9n42dCa8V2N3gSjUNnQmUJ9tZgZ3gWgn2dCZ8O7UuAvs1TgYF++V2F0gHt5t6EykF4gibUNnIn0NxDbBhs7E1bkvVWYGd4HAhs6E9+NciMDVg4+r4BnAmbPNyhIiEFsFGz4DEeckIQLRC7ThM+Bd/0CIQID+mx1AT3D74hUSm5MlTGC2J5K7s6tVRg/CBAK8t2IH0oOobjQIFYjTMDuYHkS+7hEqEODWsQNqCU4GbSZPwgWCZ0eWq4G1ACXEZvGmiUCsfq3rIeoeDrdsFm+aCASQyL5MOS6YrBbyQDOBQ6JrYnTNszQXCNDy8t5or+97ELrajqKLwCFovmLgVsYk4AQwapM8Dl0FDsGVg5X6X2/ob5eGs2dMQMTj2SSkELgd9Ovw0I/WuwWivY8lWdIJ/N+QQBIJJJFAEgkkkUASCSSRQBIJJJFAEgkkkUASCSSRQBIJJJFAEgkkkUASCST5Dby6ca16hS3TAAAAAElFTkSuQmCC'

/**
 * Cells of the feature-demo notebook, in story order. `updatedAt` is a
 * placeholder (1); `freshDemoNotebook()` stamps the real time when seeding.
 *
 * INVARIANT: the first cell's content MUST start with "# Welcome to JS Notebook"
 * and at least one code cell MUST contain `display({ type: "html"` — both are
 * asserted by the slot/boot tests.
 */
export const DEMO_CELLS: NotebookJSON['cells'] = [
  {
    id: '0d0c0001-0000-4000-8000-000000000001',
    kind: 'markdown',
    content:
      '# Welcome to JS Notebook\n\n' +
      'This is your first notebook — a short, runnable tour of what it can do.\n\n' +
      'A notebook is a stack of **cells**. Some hold **text** (Markdown, like\n' +
      'this one); some hold **code** (JavaScript). Press **▶ Run** on the code\n' +
      'cells below and the output appears right underneath. Edit anything — it\n' +
      'is yours now.',
    updatedAt: 1,
  },
  {
    id: '0d0c0002-0000-4000-8000-000000000002',
    kind: 'markdown',
    content:
      '## 📒 Where this notebook lives\n\n' +
      'Until you edit it, this notebook is stored only in **this browser**.\n' +
      'After your first edit it starts syncing to the server, so it becomes\n' +
      'available after a reload and on your other devices — whenever you are\n' +
      'online and signed in.\n\n' +
      'Sync is asynchronous: being offline, an expired session, or a server\n' +
      'error simply leaves your change queued locally until it can be sent.',
    updatedAt: 1,
  },
  {
    id: '0d0c0003-0000-4000-8000-000000000003',
    kind: 'markdown',
    content:
      '## 1 · Console output\n\n' +
      '`console.log` and `console.info` write to **stdout**; `console.warn`\n' +
      'and `console.error` write to **stderr**. Consecutive lines are grouped\n' +
      'into one block, in the exact order your code prints them.',
    updatedAt: 1,
  },
  {
    id: 'c0de0004-0000-4000-8000-000000000004',
    kind: 'code',
    content:
      'console.log("👋 Hello! This code runs right here in your browser.")\n' +
      'console.info("info and log both go to stdout — grouped together.")\n' +
      'console.warn("warn is tagged as a warning…")\n' +
      'console.error("…and error stands out below.")',
    updatedAt: 1,
  },
  {
    id: '0d0c0005-0000-4000-8000-000000000005',
    kind: 'markdown',
    content:
      '## 2 · Results and a persistent scope\n\n' +
      "A cell's **last expression** becomes its result — shown on the `⟹`\n" +
      'line. And just like Jupyter, every cell shares one persistent scope: a\n' +
      '`const` you define in one cell is still there in the next.',
    updatedAt: 1,
  },
  {
    id: 'c0de0006-0000-4000-8000-000000000006',
    kind: 'code',
    content:
      "// The last expression is returned as this cell's result.\n" +
      'const launch = { product: "JS Notebook", cells: ["code", "text"], offline: true }\n' +
      'launch',
    updatedAt: 1,
  },
  {
    id: 'c0de0007-0000-4000-8000-000000000007',
    kind: 'code',
    content:
      '// `launch` is still alive from the previous cell — shared scope.\n' +
      'const kinds = launch.cells.join(" + ")\n' +
      '"This notebook = " + launch.product + " with " + kinds + " cells"',
    updatedAt: 1,
  },
  {
    id: '0d0c0008-0000-4000-8000-000000000008',
    kind: 'markdown',
    content:
      '## 3 · Rich HTML and SVG\n\n' +
      'Call `display({ type: "html", value })` to render real HTML in a\n' +
      'sandboxed iframe — a styled card, or an SVG you build from data. For\n' +
      'vector graphics, HTML is simpler than the image channel: no base64.',
    updatedAt: 1,
  },
  {
    id: 'c0de0009-0000-4000-8000-000000000009',
    kind: 'code',
    content:
      'display({\n' +
      '  type: "html",\n' +
      '  value:\n' +
      "    '<div style=\"padding:16px;border-radius:14px;color:#fff;' +\n" +
      "    'font-family:system-ui,sans-serif;' +\n" +
      "    'background:linear-gradient(135deg,#6366f1,#ec4899)\">' +\n" +
      "    '<strong>HTML output</strong> renders inside a sandboxed iframe.' +\n" +
      "    '</div>',\n" +
      '})',
    updatedAt: 1,
  },
  {
    id: 'c0de0010-0000-4000-8000-000000000010',
    kind: 'code',
    content:
      '// Turn data into an SVG bar chart, then render it as HTML output.\n' +
      'const data = [5, 12, 9, 15, 7, 18]\n' +
      'const peak = Math.max(...data)\n' +
      'const bars = data\n' +
      '  .map(function (v, i) {\n' +
      '    const h = Math.round((v / peak) * 90)\n' +
      '    return \'<rect x="\' + (i * 48 + 16) + \'" y="\' + (110 - h) + \'" width="34" height="\' + h + \'" rx="6" fill="#6366f1"/>\'\n' +
      '  })\n' +
      '  .join("")\n' +
      'display({\n' +
      '  type: "html",\n' +
      '  value:\n' +
      '    \'<svg xmlns="http://www.w3.org/2000/svg" width="340" height="120">\' +\n' +
      '    \'<rect width="340" height="120" rx="12" fill="#0b1020"/>\' +\n' +
      '    bars +\n' +
      '    "</svg>",\n' +
      '})',
    updatedAt: 1,
  },
  {
    id: '0d0c0011-0000-4000-8000-000000000011',
    kind: 'markdown',
    content:
      '## 4 · Canvas, drawn in the iframe\n\n' +
      'A code cell has no `document`, so you cannot touch a `<canvas>` directly.\n' +
      'Instead, put the canvas and an inline `<script>` inside an HTML output:\n' +
      'the iframe has a real DOM, so the drawing runs there.',
    updatedAt: 1,
  },
  {
    id: 'c0de0012-0000-4000-8000-000000000012',
    kind: 'code',
    content:
      'display({\n' +
      '  type: "html",\n' +
      '  value:\n' +
      '    \'<canvas id="c" width="300" height="120"></canvas>\' +\n' +
      "    '<script>' +\n" +
      '    \'const ctx = document.getElementById("c").getContext("2d");\' +\n' +
      '    \'ctx.fillStyle = "#6366f1"; ctx.fillRect(12, 18, 130, 84);\' +\n' +
      '    \'ctx.fillStyle = "#ec4899";\' +\n' +
      "    'ctx.beginPath(); ctx.arc(220, 60, 46, 0, 2 * Math.PI); ctx.fill();' +\n" +
      "    '</script>',\n" +
      '})',
    updatedAt: 1,
  },
  {
    id: '0d0c0013-0000-4000-8000-000000000013',
    kind: 'markdown',
    content:
      '## 5 · Inline images\n\n' +
      'When you already have an encoded asset, `display({ type: "image", mime,\n' +
      'data })` shows it inline. `data` is raw base64 (no `data:` prefix); the\n' +
      'allowed types are PNG, JPEG, GIF, WebP and SVG.',
    updatedAt: 1,
  },
  {
    id: 'c0de0014-0000-4000-8000-000000000014',
    kind: 'code',
    content:
      '// A pre-encoded PNG, shown via the image channel (base64, no data: prefix).\n' +
      'const png =\n' +
      '  "' +
      DEMO_IMAGE_PNG_BASE64 +
      '"\n' +
      'display({ type: "image", mime: "image/png", data: png })',
    updatedAt: 1,
  },
  {
    id: '0d0c0015-0000-4000-8000-000000000015',
    kind: 'markdown',
    content:
      '## 6 · Errors are first-class\n\n' +
      'When a cell throws, you get a structured **error** output — and the\n' +
      'rest of your notebook keeps its state. Nothing else is lost.',
    updatedAt: 1,
  },
  {
    id: 'c0de0016-0000-4000-8000-000000000016',
    kind: 'code',
    content:
      '// Run me: the error below is rendered as its own output item.\n' +
      'throw new Error("This is exactly how a thrown error looks.")',
    updatedAt: 1,
  },
  {
    id: '0d0c0017-0000-4000-8000-000000000017',
    kind: 'markdown',
    content:
      '## 7 · Sandboxed by design\n\n' +
      'Code runs in an isolated QuickJS sandbox with **no network and no DOM**:\n' +
      'there is no `fetch`, `window`, or `localStorage`. That isolation is what\n' +
      'makes running untrusted notebooks safe.',
    updatedAt: 1,
  },
  {
    id: 'c0de0018-0000-4000-8000-000000000018',
    kind: 'code',
    content:
      'console.log("fetch:", typeof fetch)\n' +
      'console.log("window:", typeof window)\n' +
      'console.log("localStorage:", typeof localStorage)',
    updatedAt: 1,
  },
  {
    id: '0d0c0019-0000-4000-8000-000000000019',
    kind: 'markdown',
    content:
      "## That's the tour 🎉\n\n" +
      'Now make it yours: edit these cells, add your own with the toolbar, or\n' +
      'start a blank notebook with the **+** button in the sidebar.\n\n' +
      'Want the full reference? Open the **Usage** page from the sidebar.',
    updatedAt: 1,
  },
]
