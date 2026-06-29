# Exporting a Notebook

Self-export lets a user take a notebook out of the system as a local file — no
account / server / network needed. The flow is entirely client-side: it reads
the in-memory snapshot, serializes it, and triggers a browser download. This is
the path used by the DevOps runbook §11.4.1 pre-shutdown checklist (users must
be able to keep their data before any sunset / migration).

## Where it lives in the UI

Open any notebook. In the header, to the right of the editable title, there is
a **Download** icon button (`aria-label="Download notebook"`). Clicking it opens
a menu with two formats:

- **JSON** — full snapshot, suitable for re-import (future).
- **Markdown** — human-readable copy of the document.

Both download immediately via the browser's native save dialog. There is no
loading state — the conversion is synchronous.

## What gets exported

### JSON

Mirrors the on-disk format used by IndexedDB persistence
(`features/notebook/persistence/schema.ts`). The file is a single
`NotebookJSON` object:

```jsonc
{
  "formatVersion": 1,
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "title": "My Notebook",
  "createdAt": 1730000000000,
  "updatedAt": 1730000500000,
  "cells": [
    { "id": "…uuid…", "kind": "code", "content": "const x = 1", "updatedAt": 1730000300000 },
    { "id": "…uuid…", "kind": "markdown", "content": "# Notes", "updatedAt": 1730000400000 },
  ],
}
```

Notes:

- `updatedAt` (on both notebook and cells) is Unix epoch milliseconds, not an
  ISO string — same wire format as the backend (`api/docs/openapi.json`
  `NotebookResponse`).
- The notebook-level `updatedAt` is deterministic: it is the maximum of (a) the
  most recent cell edit, (b) the last persisted base, (c) the create time.
  Two consecutive exports of an unmodified notebook produce the same value.
- Run state (`output`, `status`, `executionCount`) is **not** included. It is
  ephemeral and reproducible by re-running the cell.

### Markdown

A flat human-readable rendering:

````markdown
# My Notebook

# Notes

```javascript
const x = 1
```
````

Rules:

- The first line is `# <title>` (or `# Untitled notebook` if the title is
  empty).
- Markdown cells are emitted verbatim (GFM passthrough).
- Code cells are wrapped in a fenced block with a `javascript` language hint
  (the engine has no per-cell language).
- The fence length is dynamic — one backtick longer than the longest backtick
  run inside the cell — so code that itself contains ` ``` ` does not
  accidentally close the block (CommonMark §4.5).
- Cells are separated by a single blank line; the document ends with a trailing
  newline.

## File name

The browser saves the file as `<sanitized-title>.<ext>`. Sanitization
(`shared/lib/sanitizeFilename.ts`) keeps the name safe across browsers and
operating systems:

- ASCII allowlist (`[A-Za-z0-9_]`); spaces collapse to `-`; repeated dashes
  collapse; truncated to 80 characters; trailing dashes are trimmed.
- Non-ASCII content (Cyrillic, emoji, CJK) is **stripped**, not transliterated.
  If that leaves the name empty, the file falls back to `notebook-<id>.<ext>`
  using the notebook's UUID, so a usable name is always produced.

| Title            | File name              |
| ---------------- | ---------------------- |
| `My Notebook 01` | `My-Notebook-01.json`  |
| `Hello / World!` | `Hello-World.json`     |
| `Заметка 🚀`     | `notebook-<uuid>.json` |
| empty            | `notebook-<uuid>.json` |

## Works offline and when signed out

The export reads only the in-memory notebook state — there is no API call. The
feature works:

- with no network at all (DevTools → Network → Offline);
- when the user is signed out (the locally-cached notebook is still available
  through IndexedDB persistence).

This is by design: the offline guarantee is the whole point of the
pre-shutdown self-export.

## Out of scope

The MVP intentionally stops here. The following are separate concerns and have
not been built into this flow:

- **Bulk export** — downloading all notebooks as a ZIP.
- **Server-side export** — `GET /api/v1/notebooks/{id}/export`. Not needed
  because the data is local; would be required only if the source of truth
  moves to the server.
- **Other formats** — PDF, HTML, Jupyter `.ipynb`.
- **Import from file** — restoring a notebook from a downloaded JSON.

## Implementation map

| File                                              | Role                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/features/notebook/persistence/serialize.ts`  | Pure `toJSON` / `toMarkdown` converters                                            |
| `src/shared/lib/sanitizeFilename.ts`              | ASCII-safe download name + `notebook-<id>` fallback                                |
| `src/shared/lib/downloadBlob.ts`                  | `<a download>` + deferred `URL.revokeObjectURL` (Safari quirk)                     |
| `src/features/notebook/model/export.ts`           | `exportNotebook(format)` action — builds the snapshot, blob, and triggers download |
| `src/features/notebook/ui/NotebookExportMenu.tsx` | `reatomComponent` wrapping the DropdownMenu (JSON / Markdown)                      |
| `src/features/notebook/ui/NotebookHeader.tsx`     | Mounts the menu next to the editable title                                         |

The action is read-only: it does not write any atoms, does not bump the
autosave revision, and does not trigger a remote sync.

## Related

- [How the Notebook Works](./how-it-works.md) — execution and shared-scope
  model that produces the cell content this exports.
- [Working with Cells](./adding-cells.md) — the cell shape (`code` ⇄
  `content` mapping) the serializer mirrors.
- DevOps runbook §11.4.1 (mono-repo `docs/sprint-3-deliverables/DevOps-runbook.md`)
  — pre-shutdown self-export checklist this feature closes.
