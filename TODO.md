# TODO: Local-First IndexedDB Sync

Goal: migrate the todo app from `localStorage` to a local-first IndexedDB architecture with HLC-ordered mutations and a cloud sync backend. WebRTC P2P is out of scope for now.

---

## Phase 0 — PWA Shell & Splash Screen (do first)

The manifest splash screen on Android/Chrome is auto-generated from `name`, `background_color`, and a **maskable** icon. The current icons are all `"purpose": "any"` — no maskable variant exists, so the splash either shows a plain icon or falls back to a letterbox. iOS needs separate meta tags entirely.

- [x] Add a `maskable` icon variant to `public/manifest.json`
  - Added `"purpose": "maskable"` entry reusing the 512x512 icon
  - Note: the source image is 507x512 (not perfectly square) — a proper maskable icon with safe-zone padding would improve Android adaptive icons

- [x] Add iOS splash / home-screen meta tags to `index.html`
  - Added `<meta name="apple-mobile-web-app-capable" content="yes">` (was missing; `mobile-web-app-capable` was Android-only)
  - `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, and `apple-touch-icon` were already present

- [x] Add an HTML app shell / skeleton to `styles/main.css`
  - `todo-app:not(:defined)` shows a centred indigo spinner + fading app name while the JS bundle loads
  - Pure CSS — no JS needed, automatically removed the instant the custom element registers

- [ ] Add `screenshots` array to `public/manifest.json` (enhances the browser install prompt)
  - Two entries: one portrait mobile screenshot, one desktop — needs actual screenshot PNGs captured from the running app

---

## Phase 1 — Client Data Layer

Replace `localStorage` with IndexedDB, add HLC timestamps and tombstone soft-deletes.

- [ ] Create `scripts/db/types.ts`
  - `TodoRecord` — stable UUID `id`, `text`, `complete`, `is_deleted` (tombstone), `hlc`
  - `MutationLog` — outbox entry: `id`, `table`, `recordId`, `action`, `payload`, `hlc`, `synced`

- [ ] Create `scripts/db/hlc.ts`
  - Port the `HLC` class from `docs/local_first_vanilla_sync_blueprint.md`
  - `increment()` — generates `${ts}-${count}-${nodeId}` on every write
  - `receive(incoming)` — advances clock on sync
  - `HLC.compare(a, b)` — used for LWW conflict resolution

- [ ] Create `scripts/db/store.ts`
  - `LocalStore` class wrapping native IndexedDB
  - Object stores: `todos` (keyPath: `id`, index on `hlc`), `outbox` (keyPath: `id`, index on `synced`)
  - Methods: `putTodo`, `getTodo`, `getAllTodos`, `addToOutbox`, `getPendingMutations`, `markSynced`
  - Call `navigator.storage.persist()` on init to prevent browser eviction

- [ ] Migrate `scripts/components/todo-app/todo-app.ts`
  - Replace `localStorage` reads/writes with `LocalStore` calls (async)
  - Change todo `id` from `number` (auto-increment) to `crypto.randomUUID()` string
  - Replace hard deletes with tombstone writes (`is_deleted: true`, new HLC)
  - Stamp every `_commit` with `hlc.increment()`
  - Write each mutation to the outbox (`synced: 0`) alongside the main store write
  - Filter out `is_deleted` records when rendering the list

- [ ] Update `scripts/components/todo-list/todo-list.ts` and `todo-item/todo-item.ts`
  - Accept `string` IDs instead of `number`

---

## Phase 2 — Background Sync (Service Worker)

Drain the outbox even if the user closes the tab immediately after a write.

- [ ] Register background sync from the app on every `_commit`:
  ```ts
  navigator.serviceWorker.ready.then(reg => reg.sync.register('sync-todos'));
  ```

- [ ] Update `public/sw.js` to handle the `sync` event:
  - Open IndexedDB, query outbox where `synced = 0`
  - POST each pending mutation to `POST /api/mutations`
  - On 200, mark the row `synced = 1`
  - On network failure, let the browser retry (don't swallow the error)

---

## Phase 3 — Sync Client (Pull + Push)

Pull remote mutations down and push the local outbox up on reconnect.

- [ ] Create `scripts/sync/client.ts`
  - `pushOutbox()` — drain `synced = 0` outbox rows to `POST /api/mutations`
  - `pullMutations(sinceHlc)` — fetch `GET /api/mutations?since=<hlc>`, apply via LWW:
    - If incoming HLC > local HLC for that record → `putTodo` + `hlc.receive()`
    - If incoming is a tombstone → set `is_deleted: true`
  - `sync()` — push then pull, dispatch `db-sync-complete` event on finish

- [ ] Wire `sync()` in `todo-app.ts`:
  - Call on `window` `online` event
  - Call on app startup if `navigator.onLine`
  - Listen for `db-sync-complete` to re-render the list

---

## Offline Continuity — must hold throughout all phases

The service worker already caches assets correctly. These invariants must stay true after every phase above:

- [ ] IndexedDB works fully offline — reads/writes must never block on network. All `LocalStore` operations are purely local; sync is always fire-and-forget from the app's perspective.
- [ ] The outbox drains only when online. Background Sync fires when connectivity returns — the app must never show an error or spinner waiting for sync. Fail silently, retry automatically.
- [ ] `navigator.onLine` check before any `sync()` call — skip push/pull entirely when offline, don't surface a network error to the user.
- [ ] Bump the service worker cache version (`CACHE_NAME`) after any change to `sw.js` so old clients don't get stuck with a stale worker.
- [ ] Playwright offline test: use `context.setOffline(true)`, create todos, set online, assert todos persisted in IndexedDB and outbox has pending entries.

---

## Phase 4 — Local Sync Backend (for dev/testing)

The CDK stack (`cdk/lib/stack.ts`) is the production backend (DynamoDB + API Gateway). For local development and Playwright tests we need a lightweight equivalent.

**Answer to Containerfile question:** Yes — add a local sync server. The Containerfile today is Playwright-only and has no HTTP server. The simplest approach is a small Node.js server that mirrors the production API surface:

- `POST   /api/mutations`         — append to an in-memory/JSON-file mutation log
- `GET    /api/mutations?since=X` — return mutations with HLC > X
- `PUT    /api/vault/:key`        — write blob to local filesystem
- `GET    /api/vault/:key`        — read blob from local filesystem

- [ ] Create `server/sync-server.ts` (Hono or plain Node `http`)
  - Persists to `server/data/mutations.json` and `server/data/vault/` so state survives restarts
  - No auth in dev mode (auth is a CDK/Cognito concern)

- [ ] Add `Containerfile.dev` (or extend `Containerfile` with a second stage)
  - Stage 1: build the Vite PWA
  - Stage 2: run both `vite preview` and `sync-server` (use `concurrently`)
  - Stage 3: Playwright tests pointing to `http://localhost:4173`

- [ ] Update Playwright tests (`tests/todo-flow.spec.ts`)
  - Add a test for offline → edit → online → sync: create a todo offline, bring server up, assert it appears in the mutation log

---

## CDK (production) — no changes needed yet

The `cdk/lib/stack.ts` already has:
- `AppMutations` DynamoDB table (UserId PK, Hlc SK) for the mutation ledger
- `HeavyStorageVault` S3 bucket for vault blobs
- `POST /mutations` and `GET/PUT /vault/{key}` REST endpoints via API Gateway

These match the client's sync API surface directly. No CDK changes are needed until auth (Cognito) is wired to the frontend.
