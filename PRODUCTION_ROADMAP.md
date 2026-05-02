# PoolFocus → Production Roadmap

A phased plan for moving the PoolFocus iOS app from its current demo build (free Apple team, in-memory backend, fake friends, simulated Screen Time) to a shippable App Store product.

Each chunk is sized to be a single focused implementation session: clear deliverable, testable in isolation, and structured so demo mode keeps working while it's in flight.

---

## Success metric

Pre-launch we cannot validate retention, so the v1 success metric is **process-based**: 10 distinct friend pools created during a 4-week TestFlight beta, with at least 3 of them running ≥5 challenge days each. Anything less means the product loop isn't sticky enough to justify shipping; revisit before App Store submission.

---

## Where we are vs. where we're going

| Area | Today | Production target |
|---|---|---|
| Auth / identity | None — `DeviceIdentityStore` UUID only | Sign in with Apple → backend JWT session |
| Pools / friends | `DemoPoolStore` in App Group, fake friends | Backend-owned pools, invite codes, real members |
| Apps to avoid | Demo picker (6 fake apps) | `FamilyActivityPicker` (real Screen Time) |
| Challenge enforcement | Simulated countdown | `DeviceActivityMonitor` + `ManagedSettings` shields |
| Backend | `InMemoryRepository`, hardcoded "development-user" | Postgres, real users, deduped events |
| Security | App Attest stubbed (returns nil) | Attestation + assertion validated server-side |
| Notifications | None | APNs: challenge start, friend forfeit, results |
| Tests | Scoring only | + auth, pool CRUD, event ingest, integration |
| Observability | `print` and string error messages | Structured logs, error reporting, uptime + p95 latency alerts |
| Distribution | Local install, free team | TestFlight → App Store with Family Controls entitlement |

---

## Tooling decisions (committed, not punted)

- **Backend framework:** Fastify + pino (TypeScript-native, fast, small).
- **DB layer:** **Drizzle ORM** — first-class TypeScript schema + migrations from the same source.
- **Hosting:** **Railway** for MVP (<1k DAU it is meaningfully cheaper than Fly + simpler deploy story). Revisit at scale.
- **APNs library:** **`@parse/node-apn`** (the original `apn` package is abandoned; this fork is actively maintained).
- **Validation:** `zod` (already an industry default).
- **Error reporting:** Sentry (gated behind `#if !POOLFOCUS_DEMO`).

---

## Phase 0 — Prerequisites (admin, runs in background)

These don't unblock day-one chunks but gate later ones. Start them now.

**0.1 — Apple Developer enrollment + Family Controls entitlement request**
Submit the Family Controls Distribution request (developer.apple.com/contact/request/family-controls-distribution) with a use-case writeup ("private accountability pool for personal device-time reduction; no ads, no profiling"). Approval is typically 2–8 weeks.
**Fallback if rejected:** ship a "honor-mode" build (no shielding, voluntary self-report only) so the rest of the product can still launch. Plan this fallback before submitting, not after rejection.
**Gates:** Phase 5, Phase 9.

**0.2 — Provision hosting + Postgres**
Railway project + Railway Postgres + a `backend/.env.example` with `DATABASE_URL`, `JWT_SECRET`, `APNS_KEY_ID`, `APNS_TEAM_ID`. Document where each secret is stored (Railway env vars; never committed).
**Acceptance:** `railway up` from `backend/` deploys a hello-world endpoint to a public URL.

**0.3 — APNs auth key generation**
Generate an APNs auth key in the Apple Developer portal; store the `.p8` in Railway secrets. Needed by Phase 7.

---

## Phase 1 — Backend foundation (no entitlements needed; do first)

**1.1 — Add Fastify + pino to existing endpoints**
Replace the hand-rolled `http` server in `backend/src/server.ts`. Keep all existing endpoints behaviorally identical.
**Acceptance:** `npm test` passes; `curl /health` returns 200; pino logs include method/path/duration/requestId per request.

**1.2a — Postgres + Drizzle bootstrap**
Add Drizzle, `pg`, and a `npm run migrate` command. Single empty migration file proving the toolchain works. `docker-compose.yml` for local Postgres.
**Acceptance:** `docker compose up -d postgres && npm run migrate` succeeds against a fresh DB; CI runs the same flow.

**1.2b — Schema for users, devices, pools, memberships, invites**
Define + migrate: `users`, `devices`, `pools`, `pool_members`, `pool_invites`. FKs, unique constraints, created_at/updated_at columns. Seed script with one sample user + pool.
**Acceptance:** seeded DB visible in `psql`; foreign-key violations enforced.

**1.2c — Schema for challenge_days, challenge_entries, screen_time_events**
The challenge-domain tables. `screen_time_events` has a unique constraint on `(entry_id, client_event_id)` for client-driven dedupe.
**Acceptance:** ingesting the same event twice (same id) is a no-op, not a duplicate row.

**1.3 — Swap `InMemoryRepository` for `PgRepository` behind the existing interface**
Repository interface stays; only `server.ts` wiring changes.
**Acceptance:** existing scoring tests pass against PgRepository; `POST /challenge/readiness` then `GET /challenge/leaderboard/:id` round-trips through Postgres.

**1.4 — Backups + point-in-time recovery enabled**
Enable Railway Postgres daily snapshots + 7-day PITR. Document restore procedure in `backend/RUNBOOK.md`.
**Acceptance:** restore-test on a scratch DB completes in under 15 minutes from documented runbook steps.

---

## Phase 2 — Identity (no entitlements; can run in parallel with Phase 1)

**2.1 — iOS: Sign in with Apple on welcome screen**
Replace `WelcomeCard`'s "Create Pool" button with a Sign in with Apple button as the gate. Persist the Apple `userIdentifier` + identity token via Keychain (new `AuthTokenStore`).
**Acceptance:** signing in stores the token; the existing Welcome → Pool flow appears after sign-in; sign-out clears Keychain.

**2.2 — Backend: `/auth/apple` endpoint**
Verifies Apple identity token (using Apple's JWKS, cached with TTL refresh), upserts a row in `users`, returns a 30-day backend JWT.
**Acceptance:** integration test posts a mocked Apple token, gets back a valid JWT decodable by the same secret; expired/invalid Apple tokens return 401.

**2.3 — iOS: attach `Authorization: Bearer <jwt>` to all backend calls**
Add an interceptor in `HTTPChallengeAPIClient`. On 401, clear stored JWT and bounce to Sign in with Apple.
**Acceptance:** real (non-demo) build hitting a local backend submits readiness with auth header; tampered/missing header returns 401; expired JWT triggers re-auth UX.

**2.4 — iOS: demo → real account migration UX**
On first sign-in, if a `DemoPool` exists locally, prompt: "Bring your demo pool over, or start fresh?" If "bring over": create a real pool with the same name, copy the user's selected app count + streak; do NOT copy fake friends.
**Acceptance:** user with a 5-day demo streak retains the streak after sign-in; fake friends are gone; pool name carries over.

---

## Phase 3 — Real pools (requires Phase 1 + 2)

**3.1 — Backend: pool CRUD + invite endpoints**
`POST /pools` (create), `POST /pools/join` (by code), `GET /pools/mine`, `GET /pools/:id/members`, `POST /pools/:id/invites`.
**Acceptance:** integration tests for create → invite → join flow with two users; join with bad code returns 404; user can't join the same pool twice.

**3.1.1 — Invite code hardening**
Codes are ≥10 chars (URL-safe alphabet, ~60 bits of entropy), expire after 24h, and `/pools/join` is rate-limited to 10 attempts per (IP, hour) and 5 per (device, hour). Failed attempts logged for abuse review.
**Acceptance:** brute-force script (1k attempts/min) is blocked at the rate limiter, not the DB.

**3.2 — iOS: `PoolService` protocol + `RemotePoolService` impl**
`DemoPoolStore` becomes one impl; `RemotePoolService` is the other. `PoolFocusRuntime.isDemoMode` continues to drive selection.
**Acceptance:** demo mode unchanged; real mode creates a pool that survives reinstall on the same Apple ID.

**3.3 — iOS: real `PoolView` data wiring + cold-start empty state**
Pool tab reads from `PoolService`. When the user is the only member of a real pool, show "Invite a friend" hero — not the populated demo layout, which would feel broken.
**Acceptance:** Pool tab shows real backend members; pull-to-refresh works; invite code is copyable; solo pool shows the empty-state hero.

---

## Phase 4 — Real challenge lifecycle (requires Phase 3)

**4.0 — Timezone model**
Decisions written down + implemented:
- Each user has a captured timezone (sent on every readiness submit).
- Each pool has a single canonical timezone (creator's at creation; settable in pool settings later).
- Challenge windows are computed in the *pool's* timezone.
- DST: a window that crosses a DST transition is allowed to be 23 or 25 "real" hours; documented in code comment.
**Acceptance:** unit tests for windows on DST-transition dates; pool timezone visible in Pool tab.

**4.1a — Backend: `challenge_days` schema + on-demand generator**
On the first member's first readiness POST per (pool, local date), insert one `challenge_day` row for that day in the pool's timezone. Window times are pool-configurable; default 18:00–22:00 local.
**Acceptance:** two members posting readiness 5 minutes apart land on the same `challenge_day` row.

**4.1b — Backend: cron finalization at window end**
A scheduled job (every 5 minutes) finds `challenge_days` whose end has passed and finalizes entries via `ChallengeScoring.finalizeEntries` + `awardPoints`. Idempotent.
**Acceptance:** a manually-aged `challenge_day` gets finalized within 5 minutes of its window close; running the job twice produces no duplicate point awards.

**4.2 — iOS: surface today's window in `CommitmentCard` + `ReadyWaitingCard`**
Pull `challenge_day.window_start/end` from backend; `ReadyWaitingCard` shows a real countdown to window start. Demo mode still uses the 1-minute synthetic window.
**Acceptance:** real build shows the actual challenge window; demo build unchanged.

**4.3 — Backend: server-authoritative leaderboard**
`GET /pools/:id/leaderboard?day=YYYY-MM-DD`. iOS removes any code path that computes results from local events for non-demo mode — backend is the only source of truth in production.
**Acceptance:** ResultsView in real mode renders co-winners exclusively from server data; an audit pass confirms no `ChallengeScoring.leaderboard` call in the real-mode UI path.

---

## Phase 5 — Real Screen Time (requires Family Controls entitlement, Phase 0.1)

Time estimates here are open-ended — extension debugging on a paid team can hide weeks of bugs.

**5.1 — Real `FamilyActivityPicker` reachable from Profile**
Verify the picker entry signs cleanly under the granted entitlement and saves the selection to the App Group.
**Acceptance:** real build picks 3 real apps; selection version hash updates; reopening shows them still selected.

**5.2 — End-to-end shielding bring-up**
Walk: pick apps → mark ready → start challenge → open a shielded app → see the `ShieldConfiguration` UI → tap "Forfeit and open" → confirm a `shield_unlock` event lands in `LocalChallengeEventStore`.
**Acceptance:** the full enforcement loop works on a paid-team device. Open-ended scope; budget at least 5 sessions for first-time bring-up.

**5.3 — Heartbeats + revocation detection**
`DeviceActivityMonitor.intervalDidStart` already records a heartbeat. Add: foreground check for missed heartbeats during the active window → write `heartbeat_missing`; observe `AuthorizationCenter.authorizationStatus` mid-challenge → write `authorization_revoked`.
**Acceptance:** force-quit during challenge → reopen later → see a `heartbeat_missing` event sync.

**5.4 — Family Controls re-authorization recovery UX**
If `authorizationStatus` drops to `.denied` between sessions, show a dedicated re-auth screen (not just the welcome flow). Block challenge start until re-authorized.
**Acceptance:** revoke Screen Time in iOS Settings → reopen app → see re-auth prompt with a clear path back to working state.

---

## Phase 6 — Security (App Attest can land before Phase 2)

App Attest identifies the **device**, not the user — it can ship before Sign in with Apple to protect the unauthenticated `/auth/apple` endpoint itself from abuse. Sequence-wise it's earlier than originally planned.

**6.1a — iOS: App Attest key generation + attestation on first launch**
Implement `AppAttestService.generateKey() + attestKey()`; POST attestation to `/auth/attest`.
**Acceptance:** real build on a real device generates a key, sends attestation; second launch reuses the key from Keychain.

**6.1b — Backend: validate App Attest attestation**
CBOR-decode the attestation, validate the X.509 certificate chain against Apple's App Attest root CA, verify nonce challenge, store the validated public key per device.
**Acceptance:** integration test with Apple's published sample attestation passes; tampered attestation rejected. Budget 3–5 sessions; this is genuinely fiddly.

**6.2 — App Attest assertion on event submit**
Wire `AppAttestService.assertion(for:)`. Backend validates assertion against the stored key per request. Reject invalid/missing assertions in production mode.
**Acceptance:** valid assertions pass; tampered request body fails verification; missing assertion in real mode returns 401.

---

## Phase 7 — Push notifications (requires APNs key from Phase 0)

**7.1 — iOS: APNs registration + UserNotifications permission**
Add the `aps-environment` entitlement. **Do NOT** ask for permission at launch (HIG violation, hurts grant rate). Ask at the moment of first commitment ("Lock in for today" → "Want a heads-up when your pool starts?"). POST device token to `/devices/push-token`.
**Acceptance:** permission prompt appears at the contextually correct moment; backend records the token; sign-out invalidates the token server-side.

**7.2 — Backend: APNs sender + 3 notification types**
Triggers: (a) "Today's pool starts in 10 min" (cron, T-10), (b) "Alex just forfeited — you're still in" (event-driven), (c) "You and 2 others are co-winners today" (post-finalize).
**Acceptance:** end-to-end on a real device for each of the three triggers.

**7.3 — iOS: notification deep-links into the right tab**
Tapping (a) → Today; (b) → Pool; (c) → Today's Results.
**Acceptance:** background tap on each notification type lands on the right screen.

---

## Phase 8 — Hardening (anytime after the relevant phase)

**8.1 — Backend: rate limiting + zod validation + structured errors**
`@fastify/rate-limit`. Per-endpoint zod schemas. Errors: `{error: {code, message, requestId}}`.
**Acceptance:** integration tests for malformed payloads return 400 with the stable shape; rate-limited requests return 429 with retry-after.

**8.2 — Backend: integration tests for auth + pools + events**
`node:test` + `undici`. GitHub Actions runs against ephemeral Postgres.
**Acceptance:** CI green on PRs; coverage report shows ≥80% for the auth + pool + event handlers.

**8.3 — iOS: event submit retry/backoff + dedupe**
Exponential backoff (1s → 2s → 4s → … capped at 5 min) and max-attempts cap on `syncPendingEvents`. Server-side dedupe by `event.id` (already in 1.2c).
**Acceptance:** with backend offline, events accumulate; when backend returns, they drain in order; killing the network mid-sync produces no duplicate rows server-side.

**8.4 — iOS: error/crash reporting (Sentry)**
Real builds only (`#if !POOLFOCUS_DEMO`). DSN via `xcconfig`, never checked in.
**Acceptance:** a forced crash in a TestFlight build appears in Sentry within 5 minutes.

**8.5 — Backend: monitoring + alerting**
Beyond crashes: uptime monitor (Better Stack / similar), p95 latency alert (>2s for 5 min), error-rate alert (>1% over 5 min). Alerts go to one channel (Discord / Slack / email) — pick before this chunk lands.
**Acceptance:** simulated 500-error storm triggers an alert within 5 minutes; intentional 30-second downtime triggers the uptime alert.

**8.6 — App Store compliance: account deletion + data export**
- **Required by Apple since iOS 16:** in-app "Delete my account" flow that nukes user, devices, pool memberships server-side.
- **Required by GDPR / nice-to-have:** "Export my data" → email JSON dump of user + entries + events.
**Acceptance:** delete-account flow removes the user from all pools and revokes JWTs; data export job emails a tarball within 24h.

**8.7 — Forced upgrade / API versioning**
`/v1/...` URL prefix on all endpoints. iOS sends `X-Client-Version`; backend can return `426 Upgrade Required` with a payload that triggers a friendly "please update" screen on the iOS side.
**Acceptance:** a backend response with the upgrade signal renders the upgrade screen; older clients can still call `/v1` endpoints unchanged.

**8.8 — Privacy review pass**
Verify with a code-grep checklist:
- No app names in network payloads (only `selection_version_hash` + counts).
- No PII in pino logs (request user IDs are hashed in log output).
- All tokens in Keychain, not UserDefaults.
- Backend retention: events older than 90 days deleted via a cron.
**Acceptance:** a one-page privacy summary that an App Store reviewer can also read; the grep checklist is in `scripts/privacy-audit.sh` and CI runs it.

---

## Phase 9 — Release

**9.1 — TestFlight build + ≥10 friend beta**
Real Family Controls entitlement, real backend on prod URL, real APNs. 4-week soak.
**Acceptance:** the [success metric](#success-metric) is met; no `heartbeat_missing` false-positives in the last week of the beta.

**9.2 — App Store submission package**
Privacy nutrition labels (Identifiers, Usage Data, Diagnostics — NOT Sensitive Info), Family Controls justification PDF, screenshots from real device, demo account credentials for reviewer, marketing copy.
**Acceptance:** submission package is complete and self-checked against Apple's review checklist before upload.

---

## Suggested execution order

```
0.1 (entitlement, async) → 0.2 (host) → 0.3 (APNs key)
↓
1.1 → 1.2a → 1.2b → 1.2c → 1.3 → 1.4         (backend foundation; ~6 sessions)
↓
6.1a → 6.1b → 6.2                            (App Attest first; ~5 sessions)
↓
2.1 → 2.2 → 2.3 → 2.4                        (auth + migration; ~4 sessions)
↓
3.1 → 3.1.1 → 3.2 → 3.3                      (real pools; ~4 sessions)
↓
4.0 → 4.1a → 4.1b → 4.2 → 4.3                (challenge lifecycle; ~5 sessions)
↓
8.1 → 8.2 → 8.3 → 8.5 → 8.6 → 8.7 → 8.8     (hardening; ~7 sessions)
↓
[Family Controls entitlement granted by here]
↓
5.1 → 5.2 → 5.3 → 5.4                        (real Screen Time; ≥10 sessions)
↓
7.1 → 7.2 → 7.3                              (push; ~3 sessions)
↓
8.4                                          (Sentry; 1 session)
↓
9.1 → 9.2                                    (release)
```

**Honest estimate:** ~50 focused sessions to App Store, with Phase 5 and 6.1b as the largest unknowns. The original "25–30 sessions" was optimistic by ~2x.

---

## Things deliberately NOT included

- **Real-money pools / payments / Stripe** — out of scope per the MVP non-cash rule; revisit only after legal review and at least one quarter of real usage data.
- **Android** — the entire Screen Time enforcement model is iOS-specific (DeviceActivity / ManagedSettings have no Android analog). Android would be a separate product, not a port.
- **Web companion app** — nice-to-have for invites and results browsing, but adds an entire surface; defer until post-launch if users ask.
- **Certificate pinning on iOS HTTPS** — overkill for v1 given the threat model; revisit if the app handles anything more sensitive than pool memberships.
