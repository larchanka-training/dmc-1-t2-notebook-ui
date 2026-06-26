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

Built on by #135 (now landed): the bootstrap load after sign-in, the switchable
slot id (`activeNotebookIdAtom`, retiring the fixed `LOCAL_NOTEBOOK_ID`) and the
sync-status UI — see ["Notebook id scoping"](#notebook-id-scoping-switchable-slot)
below and [`05-sync-ui.md`](../tasks/05-sync-ui.md). Still out of scope (other PRs
of #130): trusted/untrusted device mode (#136), background pull of other devices'
changes into an already-open notebook (#137).

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
- The diff baseline (`previousCellIds`) is re-seeded whenever the notebook is
  replaced wholesale from storage (boot, cross-tab pull, Reload, baseline
  adoption — signalled by `notebookRestoredAtom`), so deleting a cell that arrived
  via a reload still produces a tombstone instead of silently resurrecting on the
  server.

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
  push: it sets the `offline` status and arms **no** retry timer (a timer would
  re-enter this branch and grow the backoff with no server contact). Sync resumes
  on the browser `online` event (which flushes the queue) and on the next
  committed edit.
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
  - **Terminal (unknown shape)** — a non-`ApiError`/non-`NetworkError` (e.g. a
    programming `TypeError`) is also terminal (#135). It previously retried
    forever under backoff, hiding the bug behind an endless loop; the queue is
    still kept, so a later trigger re-pushes once the bug is fixed.

## Auth and session end

- The engine syncs only for an authorized user. Signed out, it stays idle and the
  queue persists. On sign-in / re-login (a null→token transition, and the matching
  `userAtom` hydration) it clears pause and re-attempts a flush — but the owner-gate
  below decides: **only a queue positively attributed to the signing-in user**
  auto-uploads. A change made while signed **out** is unattributed and stays local
  until the user edits it again while signed in (which records `ownerId`) or a
  later import/keep/discard flow handles it — it is **not** auto-uploaded on the
  next sign-in.
- It **never** inspects 401 or runs its own token refresh. `refreshMiddleware`
  (`shared/api/client.ts`) heals a transient 401 transparently — the engine does
  not even see it.
- The **only** end-of-session signal is `pauseRemoteSync()`, wired through
  `handleSessionExpired` (`app/model/sessionExpiry.ts`) to the client's
  `onSessionExpired` (which fires only when the refresh token is also dead). It
  pauses pushes and **never wipes local data** — a wipe-on-sign-out is #136's job.

**Cross-account safety (owner-gate).** The persisted queue + notebook content
survive `clearSession()` (offline-first on a trusted device), so on a **shared**
device a queue left by account A must not be uploaded under account B. The
sync-state records an `ownerId` (`userAtom().id` when the dirty change is made),
and the engine auto-pushes **only** a queue it can positively attribute to the
current user: a concrete `userAtom().id` is required (not just a token), and
`syncState.ownerId` must equal it. A queue with **no** `ownerId` (made while signed
out) or a different owner is **never** auto-uploaded — anonymous / previous-user
content cannot land in whoever signs in next. An edit made while signed in becomes
attributed and syncs normally; an unattributed edit syncs only once the user edits
it again while signed in. The explicit import/keep/discard flow for unattributed
local data, full per-account **content** isolation (B still _sees_ A's local
notebook in the editor), and a real per-account server id are #135/#136's job.

## Notebook id scoping (switchable slot)

The synced notebook id is the **active slot id** (`activeNotebookIdAtom`, #135),
not a fixed compile-time constant. `startRemoteSync(notebookId)` is bound to that
id, and the engine compares the pushed id against `activeNotebookIdAtom()` when it
decides whether the response is for the notebook open in the editor (the
adopt-baseline dirty-guard and editor reload — see
["Applying the server response"](#applying-the-server-response-lww-baseline)).

`LOCAL_NOTEBOOK_ID` is now only the **initial** value of that atom — the local
welcome-seed floor created on boot when storage is empty. Opening a backend
notebook from the sidebar (#135 open-into-slot) switches the slot to its id, and
the slot controller (`model/slot.ts`) re-arms autosave / remote-sync / AI-context
on the new id after draining the outgoing notebook's in-flight save.

**Per-user demo id.** The boot seed id is now per-user —
`resolveDemoNotebookId() = uuidv5(DEMO_NAMESPACE, user.id)` — so two accounts on
one device get distinct seed ids and never collide on the floor notebook. The
owner-gate still refuses to push a queue whose `ownerId` differs from the current
user, and the legacy shared `LOCAL_NOTEBOOK_ID` is migrated to the per-user id on
boot (`migrateLegacySeedIfNeeded`).

## Boot, deletion and the seed tombstone (TARDIS-167 №23)

The boot/delete/seed rules form one contract; the slot id alone does not capture
it.

**Boot — which notebook opens.** Boot (`loadNotebook(pickNewest=true)`, called
from `setup.ts` on reload and from `resetSlotToFloorForAccountChange` on first
sign-in) opens the **newest notebook owned by the current user** by `createdAt`
desc — not always the seed. "Owned" = the per-user seed, or a notebook whose
`sync` partition records `ownerId === user.id` (a notebook without provable
ownership is skipped, so a shared device never opens another account's local
notebook). `pickNewest` is boot-only; `degrade`/`reset` slot transitions keep
going to the seed floor (`loadNotebook()` without the flag).

**Empty local → server reconcile.** When local storage has no notebooks,
`reconcileBootFromServer()` (`model/bootReconcile.ts`) runs BEFORE the slot loads:
offline/empty list → seed path; non-empty list → pull the newest server notebook
into storage (stamping `ownerId` + `remoteCreated` so the owner-scoped picker
accepts it), and if the per-user seed id is **absent** from the server list, the
seed was deleted on another device → set the tombstone locally.

**Server-side seed invariant.** In the normal signed-in UI flow, an account that has any server notebooks has had its per-user demo notebook persisted on the server at least once.
The create button preserves this invariant: when the clean, never-synced per-user seed floor is open, `promoteSeedFloorIfUnsynced()` posts that seed first, and only then does `createNotebookAction()` create the new non-demo notebook.
Dirty or already-created seeds are owned by the remote-sync engine; by the time a non-demo server notebook exists through the healthy UI path, the demo either already exists server-side or has been soft-deleted later.
Fresh-device reconcile therefore treats a non-empty server list without the per-user seed id as “the seed was deleted elsewhere”, not as “the seed never existed”.
The `promoteSeedFloorIfUnsynced()` best-effort boundary is local liveness: a transient promotion failure is swallowed so notebook creation is not bricked by a local seed problem, but such a path is exceptional drift from the server invariant and must not make `features-demo/restore` mint arbitrary seed content.

**Seed tombstone (contract A).** Deleting the seed writes a durable per-account
marker in the storage `meta` partition (`seedTombstone.ts`, key
`seed-tombstone:<ownerId>`). `loadNotebook` does not resurrect a tombstoned seed;
`clearAll()` wipes the marker. **Restore** (usage page) lifts the tombstone,
recreates the seed server-side, stamps owner sync-state, surfaces the row in the
sidebar immediately (`upsertListItem`, no refetch) and opens it.

**Deletion contracts.** B-1: the user always keeps at least one notebook — the
Delete affordance is hidden and `deleteNotebookAction` refuses when only one slot
exists. B-2: deleting the **active** notebook opens the top remaining row (newest
by `createdAt`) via `openNotebookInSlot`, instead of resurrecting the seed. A
delete that 404s (already deleted server-side) is treated as an idempotent success
(tombstone the seed, drop the local copy, no "Delete failed").

**Creation cap (TARDIS-173).** The backend enforces no maximum number of
notebooks per user; the `200` on `GET /notebooks` is the page-size ceiling
(`limit`, `le=200`). The client reads only that single first page
(`notebook.ts` `LIST_PAGE_LIMIT`), so a notebook created beyond it would be
invisible in the sidebar and never synced. The UI therefore caps creation at the
page size: `MAX_NOTEBOOKS = LIST_PAGE_LIMIT`. `canCreateNotebook()` is
`effectiveNotebookCount() < MAX_NOTEBOOKS` — the **same** count the B-1 delete
guard uses, so the create "+" and the delete guard never disagree. The sidebar
marks the "+" `aria-disabled` at the cap (kept hoverable, not native `disabled`,
so its "limit reached" tooltip still shows) and `createNotebookAction` is the
model-level backstop for other entry points. Deleting any notebook drops the
count and re-enables creation. The welcome seed counts as one slot (it occupies a
listed/floor row), so the practical ceiling is **199 user-created notebooks plus
the restorable seed**. Known minor: a user near the cap who has deleted their
seed (tombstoned, slot freed) can reach 200 user notebooks — still within the
page the client can load/sync, so nothing is hidden. IndexedDB is shared across
accounts on a device and stores more rows than one account's cap; the cap is a
per-account _active list_ limit, not a local-storage limit.

> See also: the same cap is recorded in the monorepo docs
> (`docs/System_Architecture.md`, `docs/requirements.md`).

## Scaling note

Every POST/PATCH sends the **whole** document (full cell list + the entire
`deletedCells` buffer) — required by the server's full-set LWW contract and fine
for the single-notebook MVP, but a large notebook re-uploads fully on every
debounce cycle while editing. A save committed while a push is in flight re-arms
the 1500 ms debounce rather than triggering an immediate follow-up, so continued
typing coalesces into one delayed upload (only POST-409 → PATCH recovery loops
immediately). A future delta / changed-cells PATCH would cut the per-cycle size.

**Cell cap.** The backend caps `cells` at `maxItems: 500`. The engine refuses to
push a notebook over `MAX_SYNCABLE_CELLS` (500) with a distinct log instead of
sending it to be `422`'d into a silent terminal `failed` — local stays intact.

## Persistence of sync state

`{ remoteCreated, dirty, deletedCells, lastSyncedUpdatedAt }` per notebook lives
in memory and is write-through-persisted to the storage adapter's `sync` partition
(#133), so it survives a reload and is wiped in one call by `clearAll()` /
`clearLocalNotebookData()`. A failed write is logged and retried, not swallowed.

**Crash recovery (boot detection).** `lastSyncedUpdatedAt` is the `updatedAt` of
the doc at the last successful sync. If a content autosave landed durable but the
`dirty` flag was lost to a crash before it persisted, the marker alone would miss
the unsynced change. On boot, a previously-created notebook (`remoteCreated`) whose
stored `updatedAt` is **newer** than `lastSyncedUpdatedAt` is marked dirty and
pushed — so the change is not stranded until the next edit.

Boot detection is deliberately scoped to `remoteCreated` notebooks: a
**never-created** notebook whose dirty flag was lost to a crash has no `ownerId`
recorded either, so boot-pushing it would risk uploading content under the wrong
account (the cross-account leak the owner-gate exists to prevent). That case is a
liveness gap only — no data loss, and it syncs on the next edit (which re-records
`ownerId` + `dirty`). A fully durable fix is an atomic content + dirty-marker
write, deferred to a dedicated follow-up (see "Known follow-ups").

## Robustness guards

- **Metadata load.** A failed `getSyncState()` read leaves the durable queue
  unknown, so the engine holds off persisting and pushing (`metadataLoaded`) and
  retries the load — a fresh provisional state is never written over the unread
  durable record.
- **Auth hydration.** The owner-gate needs `userAtom().id`; if the token hydrates
  before the user, the flush is re-attempted when the user identity arrives.
- **Engine lifecycle.** All per-run state lives on a `RemoteSyncEngine` instance,
  and `active` points at the current one. A re-init (re-login / #135 slot switch)
  tears down the prior instance and creates a fresh one, so a stale
  request/load/timer that settles after a restart mutates only its own (dead)
  instance and can never corrupt the live engine. `active === this` tells a
  continuation whether its instance is still live.
- **Cancellation.** Each push has an `AbortController`; pause / teardown / sign-out
  abort the in-flight request and bump the per-instance `generation`, which discards
  a late result. The in-flight lock is per-instance, so a stale push can't keep the
  live engine's `pushInFlight` true or release its lock (no overlapping POST/PATCH
  under session churn).
- **Tombstone ↔ body consistency.** The sent `deletedCells` are filtered against
  the pushed document's cell ids, so a PATCH never carries a cell AND a tombstone
  for it (a deletion made in memory before its own save committed).
- **Owner conflict.** A concrete `ownerId` is sticky. If two different concrete
  owners meet — a load-race merge (one account's durable queue + another's
  in-memory edit) OR a local edit by a different signed-in user on a notebook
  already attributed to someone else — the sync-state is flagged `ownerConflict`
  (persisted) and the engine refuses to auto-push under either. The edit never
  re-stamps the existing owner with the current user, so previous-account content
  can't become eligible for upload under whoever edits next. #136 device-mode
  resolves it.
- **Payload caps.** The push is preflighted against the backend limits (cells 500,
  title 255, cell content 262144) and a client tombstone cap, failing terminally
  with a distinct log instead of a silent 422 or a pathological body.

## Reatom notes

Under `clearStack()` every entry point (`flush`, retry, `online`, the
save-committed subscriber) is `wrap`-captured, and every await is
`await wrap(promise)`, so atom reads/writes in continuations keep a stack — the
same pattern autosave uses.

## Known follow-ups

- **Per-user server id (#67) — done.** The boot floor now uses a per-account id
  (`resolveDemoNotebookId() = uuidv5(DEMO_NAMESPACE, user.id)`), with the legacy
  shared `LOCAL_NOTEBOOK_ID` migrated on boot. See "Boot, deletion and the seed
  tombstone" above. A cross-owner `403`/`404` is still handled fail-safe.
- **#136 (untrusted device).** Once `clearLocalNotebookData` is wired to sign-out,
  the sync-metadata persist already skips a write for a torn-down/paused engine and
  `pauseRemoteSync` cancels the persist-retry timer, but the full single-flight /
  versioned write discipline for storage-I/O should be revisited then.
- **Cross-tab sync-metadata CAS (#136).** `putSyncState` is an unconditional
  last-write-wins put, so two tabs editing the same local notebook can clobber each
  other's durable `dirty` flag / tombstone queue (a tab finishing an older in-flight
  push overwrites another tab's newer queue). Narrow window — each tab re-persists
  its own in-memory state on its next commit, so loss needs no further commit before
  a reload — but it is data-loss-class. The fix is a transactional get+merge+put in
  the storage adapter (preserve `dirty`, union tombstones, keep conflict/overflow,
  drop only acked tombstones still present). Deferred to #136, which owns the
  coherent cross-tab story (BroadcastChannel, memory backend, device mode). Flagged
  by review gpt-v-13.
- **First-create crash durability (follow-up).** A never-created notebook whose
  dirty marker is lost to a crash syncs only on the next edit (see "Crash
  recovery"). An atomic content + dirty-marker write would close the window.
  Deferred from #135 to a dedicated follow-up
  because it needs a new two-store atomic storage method and touches the
  owner-attribution path — see that issue's "Key risk: two writers of `ownerId`".
