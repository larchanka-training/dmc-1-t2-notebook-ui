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
to storage and reloaded into the editor (`reloadFromStorage`, which also
re-accepts the clean baseline so autosave does not immediately re-save, and does
not re-trigger a push).

**Guard (INV-3):** the response is adopted **only** when the in-memory notebook
is clean (`!hasLocalChangesAtom()`) and no newer save committed during the
request. If the user edited while the push was in flight, the merged response is
discarded and the newer local version is re-pushed instead — local edits are
never clobbered. A malformed / newer-format response is not adopted either.

## Offline, retries, errors

- `isOnlineAtom` mirrors `navigator.onLine`. While offline the engine does not
  push; it schedules a retry and re-attempts on the `online` event.
- Any failure (NetworkError, 5xx, or even a 401 that reached the facade) keeps
  the queue (dirty flag + tombstones untouched) and retries with capped
  exponential backoff. Data is never dropped on failure.

## Auth and session end

- The engine syncs only for an authorized user (`accessTokenAtom`). Signed out,
  it stays idle and the queue persists.
- It **never** inspects 401 or runs its own token refresh. `refreshMiddleware`
  (`shared/api/client.ts`) heals a transient 401 transparently — the engine does
  not even see it.
- The **only** end-of-session signal is `pauseRemoteSync()`, wired to
  `onSessionExpired` in `app/model/setup.ts` (which fires only when the refresh
  token is also dead). It pauses pushes and **never wipes local data** — a real
  re-login resumes and flushes the queue. A wipe-on-sign-out is #136's job.

## Persistence of sync state

`{ remoteCreated, dirty, deletedCells }` per notebook lives in memory and is
write-through-persisted to the storage adapter's `sync` partition (#133), so it
survives a reload and is wiped in one call by `clearAll()` /
`clearLocalNotebookData()`.

## Reatom notes

Under `clearStack()` every entry point (`flush`, retry, `online`, the
save-committed subscriber) is `wrap`-captured, and every await is
`await wrap(promise)`, so atom reads/writes in continuations keep a stack — the
same pattern autosave uses.

## Known follow-up

The notebook facade takes no `AbortSignal`, so a torn-down / paused engine
discards an in-flight push's result via a `generation` guard rather than
aborting the fetch. Threading a real `AbortSignal` through the facade is a
follow-up.
