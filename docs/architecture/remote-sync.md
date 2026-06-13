# Remote autosync

Background synchronisation of the authorized user's notebook to the backend
(TARDIS-134, PR D of the [#130 epic](../tasks/05-sync-ui.md)). It sits **after**
the local autosave: the edit is persisted locally first, then pushed to the
server as a second background step.

Source: `src/features/notebook/model/remoteSync.ts` (engine),
`remoteSyncCore.ts` (pure helpers), `online.ts` (connectivity). It builds on the
storage-adapter sync partition (#133, see
[`../tasks/02-notebook-data-model.md`](../tasks/02-notebook-data-model.md)) and
the notebook facade (#132, `@/shared/api`).

Out of scope (other PRs of #130): bootstrap load after sign-in and sync-status
UI (#135), trusted/untrusted device mode (#136), background pull of other
devices' changes (#137).

## Trigger — local-first

The engine subscribes to `localSaveCommittedAtom` (autosave), **not** the raw
`notebookRevisionAtom`. That atom bumps only when a user-driven local save
commits (the debounced autosave or "Save mine"), never on boot / reload /
cross-tab pull. Consequences:

- A server push happens only **after** the edit is already on disk locally.
- A just-restored (pulled / booted) version is not bounced back to the server.

The push reads the **locally-persisted** document (`notebookStorage.get(id)`),
so by construction it can only send what local storage already holds.

## Push

A separate debounce (`REMOTE_DEBOUNCE_MS = 1500`, distinct from autosave's
500 ms) coalesces a burst of saves into one request.

- **First push** (`remoteCreated = false`): `POST /api/v1/notebooks` with the
  client-chosen `id` and the **full** cell list. The client id makes a retried
  POST idempotent (no duplicate), and sending the full document means the
  server's merge sees the local content (it can never come back as an empty
  "all cells deleted" notebook). After success, `remoteCreated` flips to `true`.
- **Subsequent pushes**: `PATCH /api/v1/notebooks/{id}` with the whole document
  (`title`, `formatVersion`, `cells`) plus the `deletedCells` tombstone buffer.

The server performs the last-write-wins merge per cell (`cell.updatedAt`; ties
go to the server) and returns the merged notebook.

**Lost create-ack recovery.** If the original `POST` committed server-side but its
response was lost (offline), `remoteCreated` stays `false`; a later edit makes the
re-`POST`ed content differ, and the backend answers `409` (same id, same owner,
different payload). A 409 on the create path is treated as "already exists under
us": the engine flips `remoteCreated` and re-pushes via `PATCH` (which LWW-merges,
never 409s) instead of wedging on a terminal failure. This also recovers the case
where the create succeeded but persisting `remoteCreated` failed before a reload.

## deletedCells (tombstones)

A cell deletion is detected in the sync layer by diffing the previous cell-id
set against the current one at each committed save (`removedCellIds`). A
`changeCellKind` reuses the same id, so a kind switch is correctly **not** a
deletion. Each removed id is recorded as `{ id, deletedAt }` in the per-notebook
buffer and persisted.

- The whole buffer is sent on every `PATCH`.
- After a successful `PATCH`, only the tombstones that were **sent** are dropped
  (`dropAckedTombstones`), keeping any deletion made while the request was in
  flight.
- A failed `PATCH` leaves the buffer intact — deletions are never lost.

## Applying the server response (LWW baseline)

On success the merged response is adopted as the new local baseline — persisted
to storage and reloaded into the editor. The reload is **only** for the open
notebook (`LOCAL_NOTEBOOK_ID` in the single-notebook MVP); `reloadFromStorage`
also re-accepts the clean baseline so autosave does not immediately re-save, and
does not re-trigger a push.

Adoption (`applyServerBaseline`) returns one of three outcomes and **never loses
local data**:

- **`applied`** — adopted as the new baseline.
- **`deferred`** — a concurrent local edit (checked before _and_ after the
  storage write), or storage already holds a newer version than this push was
  based on (`putIfNewer` CAS, not an unconditional `put`, so another tab is not
  clobbered). Local stays authoritative and is re-pushed. When a keystroke lands
  _during_ the write, the autosave CAS base is advanced to the just-written server
  version so the pending autosave persists the keystroke cleanly instead of a
  false `conflict`.
- **`rejected`** — a malformed/newer-format response, or a well-formed `cells: []`
  that would zero a non-empty notebook. Local is kept, the anomaly is logged, and
  the engine does **not** auto-loop on it.

**Guard (INV-3):** adoption runs only when the in-memory notebook is clean
(`!hasLocalChangesAtom()`) and no newer save committed during the request. If the
user edited while the push was in flight, the merged response is discarded and
the newer local version re-pushed — local edits are never clobbered.

## Offline, retries, errors

- `isOnlineAtom` mirrors `navigator.onLine`. While offline the engine does not
  push; it schedules a retry and re-attempts on the `online` event.
- **Every** failure keeps the queue (dirty flag + tombstones untouched) — data is
  never dropped. Failures are then classified:
  - **Retryable** — `NetworkError`, 5xx, 408, 429 (honouring a `Retry-After`),
    and 401 (an ordinary failed request per the issue, **not** end-of-session):
    retry with capped exponential backoff (reset only on a _successful_ push, so a
    flapping connection can't reset the floor on every `online` edge).
  - **Terminal** — a deterministic 4xx (400/403/404/409/422): the server rejects
    this body every time, so the engine stops the retry loop and surfaces a
    terminal `failed` status (queue still kept) instead of looping forever and
    hiding the problem behind a false `synced`.

## Auth and session end

- The engine syncs only for an authorized user (`accessTokenAtom`). Signed out,
  it stays idle and the queue persists. It subscribes to `accessTokenAtom` and,
  on a null→token transition (sign-in / re-login), clears pause and **flushes the
  queued change** — so a change made while signed out syncs as soon as the user
  signs in.
- It **never** inspects 401 or runs its own token refresh. `refreshMiddleware`
  (`shared/api/client.ts`) heals a transient 401 transparently — the engine does
  not even see it.
- The **only** end-of-session signal is `pauseRemoteSync()`, wired through
  `handleSessionExpired` (`app/model/sessionExpiry.ts`) to the client's
  `onSessionExpired` (which fires only when the refresh token is also dead). It
  pauses pushes and **never wipes local data** — a wipe-on-sign-out is #136's job.

## Notebook id scoping (single-notebook MVP) — known limitation

The synced notebook currently carries the compile-time constant `LOCAL_NOTEBOOK_ID`
for every user (the single-notebook MVP; FU1's client UUID applies only to _list_
notebooks). The backend keys notebooks by `id` and 403s a cross-owner re-POST, so
correctness depends on the backend being owner-scoped, and **only the first user
to POST that id can create it** — every other user's first push gets a permanent 403. That 403 is handled fail-safe (terminal status, queue kept, no infinite loop,
no false `synced`), but real multi-user sync needs a **per-user server id** (e.g.
derived from the account id), designed together with the #135 bootstrap (the GET
must use the same id). Tracked as a #135 design item.

## Scaling note

Every POST/PATCH sends the **whole** document (full cell list + the entire
`deletedCells` buffer) — required by the server's full-set LWW contract and fine
for the single-notebook MVP, but a large notebook re-uploads fully on every
debounce cycle while editing. A future delta / changed-cells PATCH is the
mitigation.

## Persistence of sync state

`{ remoteCreated, dirty, deletedCells, lastSyncedUpdatedAt }` per notebook lives
in memory and is write-through-persisted to the storage adapter's `sync` partition
(#133), so it survives a reload and is wiped in one call by `clearAll()` /
`clearLocalNotebookData()`. A failed write is logged and retried, not swallowed.

**Crash recovery (boot detection).** `lastSyncedUpdatedAt` is the `updatedAt` of
the doc at the last successful sync. If a content autosave landed durable but the
`dirty` flag was lost to a crash before it persisted, the marker alone would miss
the unsynced change. On boot, a previously-created notebook whose stored
`updatedAt` is **newer** than `lastSyncedUpdatedAt` is marked dirty and pushed —
so the change is not stranded until the next edit.

## Reatom notes

Under `clearStack()` every entry point (`flush`, retry, `online`, the
save-committed subscriber) is `wrap`-captured, and every await is
`await wrap(promise)`, so atom reads/writes in continuations keep a stack — the
same pattern autosave uses.

## Known follow-ups

- The notebook facade takes no `AbortSignal`, so a torn-down / paused engine
  discards an in-flight push's result via a `generation` guard rather than
  aborting the fetch. Threading a real `AbortSignal` through the facade is a
  follow-up.
- **Per-user server id (#135).** The shared `LOCAL_NOTEBOOK_ID` only works for the
  first user; a real per-account id must be designed with the #135 bootstrap (see
  "Notebook id scoping" above). A cross-owner `403` is handled fail-safe today.
- **#136 (untrusted device).** Once `clearLocalNotebookData` is wired to sign-out,
  the sync-metadata persist already skips a write for a torn-down/paused engine and
  `pauseRemoteSync` cancels the persist-retry timer, but the full single-flight /
  versioned write discipline for storage-I/O should be revisited then.
- **`loadStateAndFlush` generation guard.** Boot load is guarded by
  `activeNotebookId`; a `generation`-based guard (matching the push path) is a
  latent hardening for the #135 re-login path.
