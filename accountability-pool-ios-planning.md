# Accountability Pool iOS App - Planning Document

Date: April 27, 2026

## 1. Product Concept

The app helps people reduce distracting phone usage through small daily accountability pools. A user chooses iPhone apps they want to avoid, joins a private pool with friends, and participates in a daily challenge. The MVP is non-cash only: users compete for points, streaks, and social accountability, with real-money pools deferred until a separate legal and payment-provider review is complete.

Working product name: `PoolFocus`

Primary promise:

> Make staying off distracting apps social, measurable, and meaningfully motivating.

## 2. Core Product Decisions

### Recommended MVP Rule Set

The first implementation should define a clear, auditable, non-cash daily contest:

- Each pool has a fixed timezone.
- Each challenge day runs from `00:00:00` to `23:59:59` in the pool timezone.
- MVP targets selected iPhone apps only. Websites, categories, Android, public pools, and cross-device enforcement are deferred.
- Each participant selects blocked apps before the daily lock deadline.
- During the active challenge, selected apps are shielded on the user's device.
- Score is measured from `challenge_start_utc` until the participant's first disqualifying event.
- Disqualifying events are shield unlock, Screen Time authorization revoked, selection removed or changed after lock, missing heartbeat beyond the grace period, monitor unavailable, and app deletion or inactivity inferred by missing sync.
- If nobody forfeits, all remaining users are co-winners for that day.
- Ties are co-wins in MVP. Do not roll over points or create a pot.

Why this rule set is better than passive monitoring only:

- It turns app use into an intentional "break glass" moment.
- It avoids needing to expose selected app identities to friends or the backend.
- It is easier to explain to users and App Review.
- It gives the app a useful experience without real-money functionality.

Fairness note:

- Private individual app selections are appropriate for friend accountability, but not strong enough for cash contests because users can choose easier targets. Any future cash mode must require locked, comparable, auditable challenge rules before users can enter.

## 3. Critical Compliance Position

The real-money pot is the highest-risk part of this product. It is excluded from MVP and should not appear in the first App Store submission. Do not include production Stripe/payment UI, real-money entry, stakes, pots, payouts, or gambling-like claims in v1.

This is not legal advice, but the product likely touches:

- Prize, contest, sweepstakes, gambling, or skill-game rules.
- State-by-state US restrictions and age limits.
- App Store rules for contests, real-money gaming, and official rules.
- Payment processor rules, chargebacks, KYC, sanctions screening, tax reporting, and possibly money transmission.

Minimum constraints before any future real-money beta:

- Users must be 18+.
- Real-money pools must be geo-restricted to approved jurisdictions.
- The app must present official contest rules in-app.
- The rules must state that Apple is not a sponsor or participant.
- Do not use Apple in-app purchase to buy credits, currency, or entries for real-money pools.
- If the product is classified as real-money gaming or a lottery, keep the app free on the App Store and satisfy all licensing and geo-restriction requirements.
- Do not hold user funds directly unless counsel confirms the licensing posture.
- Use a regulated payment/payout provider approved for the use case and keep a complete ledger.
- Do not take a platform rake unless counsel approves it.

Practical recommendation:

- Launch the first beta with points, streaks, and private friend accountability only.
- Move payment work to a post-MVP feasibility phase after legal review.
- Enable cash pools only after counsel and the payment provider approve the operating model, jurisdictions, challenge fairness rules, and payout timing.

## 4. Target Platforms and Stack

### iOS App

- Native SwiftUI app.
- Minimum target: iOS 16+, because individual Screen Time authorization for self-control use cases is available from iOS 16.
- Frameworks:
  - `FamilyControls` for Screen Time authorization and app selection.
  - `DeviceActivity` for usage windows, thresholds, and optional reports.
  - `ManagedSettings` for shielding selected apps during active pools.
  - `ManagedSettingsUI` for customized shield screens.
  - `DeviceCheck` / App Attest for server trust signals.
  - APNs for challenge reminders and result notifications.
- No StoreKit or production payment SDK is needed for MVP.

### Backend

Recommended backend:

- TypeScript service using Fastify or NestJS.
- PostgreSQL for durable pool, challenge, device, and event state.
- Redis or a managed queue for scheduled jobs, challenge finalization, and heartbeat checks.
- Object storage for compliance documents and audit exports if real-money work is revisited.
- APNs provider for push notifications.

The backend should be treated as the source of truth for pools, eligibility, final scoring, and participant status. The iOS app is the source of Screen Time events, but those events are not fully trusted and must be evaluated with server timestamps, App Attest, and conservative failure rules.

## 5. iOS Architecture

### App Targets and Extensions

Create these MVP targets:

- Main app: onboarding, pools, friends, challenge dashboard, event sync.
- Device Activity Monitor extension: handles challenge intervals and threshold events.
- Shield Configuration extension: customizes the screen shown when a selected app is blocked.
- Shield Action extension: records "unlock and forfeit" actions.

Defer the Device Activity Report extension unless the team decides to show local usage summaries after the core challenge loop is stable.

Capabilities:

- Family Controls entitlement on the app and Screen Time extensions.
- App Groups for sharing selected tokens and challenge state between the app and extensions.
- Push Notifications.
- Sign in with Apple.
- Associated Domains for invite links.
- DeviceCheck/App Attest.

Important entitlement action:

- Request Apple's Family Controls distribution entitlement early for the main app and all related extension bundle IDs. This is a schedule risk and should not wait until the end of development.

### Screen Time Flow

1. User signs in.
2. User grants Screen Time access with `AuthorizationCenter.shared.requestAuthorization(for: .individual)`.
3. User selects iPhone apps using `FamilyActivityPicker`.
4. App stores the resulting opaque tokens locally and in an App Group container.
5. App sends only a selection version hash and challenge metadata to the backend, not app names or app tokens.
6. Before the challenge starts, app schedules a `DeviceActivitySchedule`.
7. At interval start, the monitor extension applies a `ManagedSettingsStore` shield to selected apps.
8. If the user tries to open a shielded app, the shield screen offers a deliberate "forfeit and unlock" action.
9. The Shield Action extension writes the forfeiture event to the App Group store.
10. The Device Activity and Shield extensions write local events only; the main app syncs those events to the backend.
11. The server records `received_at` for every synced event and never fully trusts client timestamps.
12. At interval end, the extension removes the shield and the backend finalizes the day after a grace period.

### Monitoring Backstop

Use `DeviceActivityEvent` with a small threshold, such as one minute of selected app activity, as a backstop. This helps detect cases where shielding is not active or a restriction is cleared.

Limitations:

- Screen Time APIs preserve privacy and do not give the backend raw app usage.
- Detection may be minute-level, not second-perfect.
- Revoking authorization must count as forfeiture or ineligibility.
- Multi-device coverage only works reliably for devices where the app is installed, authorized, and configured.
- Push notifications are UX only and must not be part of scoring correctness.

## 6. Product Flows

### Onboarding

- Sign in with Apple.
- Explain Screen Time permission in plain language.
- Request Screen Time authorization.
- Select iPhone apps to avoid.
- Create or join a pool.
- Accept pool rules.

### Pool Creation

Pool creator chooses:

- Pool name.
- Invite method.
- Pool timezone.
- Challenge days.
- Minimum participants.
- Tie behavior: co-winners.

MVP uses individual app selections because it is more private and maps well to Apple's opaque app tokens.

### Daily Challenge

Before start:

- Verify Screen Time authorization.
- Verify app selection is complete.
- Verify selection version hash matches the version locked for the day.
- Send reminder notification.

During challenge:

- Show active timer.
- Show participant statuses: active, forfeited, pending sync, completed.
- Do not show selected app names to other users.
- Provide an emergency unlock path that clearly forfeits the day.

After challenge:

- Wait for sync grace period.
- Finalize leaderboard.
- Award points and update streaks.
- Send results notification.
- Record immutable audit rows.

## 7. Backend Domain Model

Core tables:

- `users`: account, display name, privacy settings.
- `devices`: user device records, App Attest state, notification token.
- `pools`: name, owner, timezone, rules, private invite settings.
- `pool_memberships`: user role, eligibility, join status.
- `challenge_days`: pool, date, start/end timestamps, status.
- `app_selection_sets`: local selection version metadata and hash, not raw app names or tokens.
- `challenge_entries`: participant state for a specific day.
- `screen_time_events`: immutable event records used for scoring and audit.

MVP status enums:

- `challenge_entries.status`: `pending_config`, `ready`, `active`, `forfeited`, `completed`, `invalid`.
- `screen_time_events.type`: `shield_unlock`, `authorization_revoked`, `monitor_unavailable`, `heartbeat_missing`, `selection_changed`, `challenge_completed`.

Minimum MVP API behavior:

- Create and join private pools.
- Submit readiness with selection version hash, not selected app names.
- Submit challenge events with App Attest assertion, device ID, selection version, client timestamp, and server `received_at`.
- Fetch daily leaderboard and participant statuses.

Use immutable event records for scoring. Store selected app tokens only in the iOS App Group container; the backend stores only selection version metadata and challenge state.

## 8. Post-MVP Payment Feasibility

MVP must not include production payments, stakes, pots, payouts, or payment-provider onboarding. Payment work belongs in a separate post-MVP feasibility phase after legal review.

If cash pools are revisited later:

- Use a provider-approved marketplace/payout flow such as Stripe Connect or an equivalent regulated provider.
- Avoid in-app wallet balances, app-specific currency, and arbitrary user-to-user transfers.
- Use source-linked transfers where supported, wait for funds availability, and account for failed payments and chargebacks before payouts.
- Keep immutable double-entry ledger tables for `ledger_accounts`, `ledger_entries`, `payments`, `payouts`, refunds, disputes, and transfer reversals.
- Require 18+ checks, geo-restrictions, official rules, and payment-provider KYC/payout onboarding.
- Do not take a platform rake unless counsel approves it.
- Require locked, comparable, auditable challenge rules before users can enter any cash contest.

## 9. Anti-Cheat and Trust Model

Threats:

- User revokes Screen Time access.
- User deletes the app.
- User uses another device.
- User tampers with local storage or app binary.
- User blocks network sync.
- User changes selected apps after the daily lock deadline.

Mitigations:

- App Attest for sensitive API calls, treated as a risk signal rather than cheat-proof proof.
- Device binding for challenge participation.
- Require Screen Time authorization before daily lock.
- Treat authorization revocation as forfeiture.
- Treat missing heartbeat after a grace period as forfeiture.
- Treat selection changes after lock as forfeiture or invalidation.
- DeviceActivity and Shield extensions write local event logs in the App Group; the main app syncs them on next launch.
- Server records `received_at` and never fully trusts client timestamps.
- Keep detailed audit records for support and abuse review.

Important limitation:

- This app cannot be made perfectly cheat-proof because iOS Screen Time data is intentionally privacy-preserving and client-originated. The product should frame the pool as friend accountability, not casino-grade fraud-proof wagering.

## 10. Privacy Principles

The privacy model is a product feature.

- Friends should not see which apps another user selected unless that user explicitly shares them.
- Backend should not store app names, bundle IDs, or raw Screen Time reports.
- Store only challenge-relevant states: configured, active, forfeited, completed, revoked, pending sync.
- Keep Screen Time tokens local in the App Group container.
- Do not use usage data for ads, marketing, or unrelated analytics.
- Provide clear data deletion and pool exit flows.
- Retain audit records only as long as needed for support, abuse review, and legal obligations.

## 11. App Review Strategy

Prepare App Review notes that explain:

- The app uses Screen Time APIs for user-authorized self-control and digital wellbeing.
- Users select apps privately through Apple's picker.
- The backend does not receive app identities or raw Screen Time data.
- The shield screen gives users control and a clear way to stop participating.
- The first submission uses points, streaks, and non-cash accountability only.
- No payment, stake, pot, payout, or gambling-like claim appears in MVP UI, metadata, screenshots, or review notes.

Before App Store submission:

- Confirm Family Controls distribution entitlement approval.
- Verify all extension bundle IDs have required entitlements.
- Test Screen Time flows on physical devices, not only simulators.
- Test deauthorization, device reboot, offline mode, time zone changes, and app deletion behavior.

## 12. MVP Scope

### Build First

- Sign in with Apple.
- Pool creation and invite links.
- Friend join flow.
- Family Controls authorization.
- App selection with `FamilyActivityPicker`.
- Active challenge screen.
- Managed Settings shield during challenge.
- Forfeit/unlock shield action.
- Local event sync to backend.
- Leaderboard and daily results.
- Points and streaks.
- App Attest-protected event sync.

### Defer

- Live cash payouts.
- Production payment UI and provider onboarding.
- Sandbox stake simulation until legal review approves a payment feasibility spike.
- Website and category selection.
- Public pools.
- Contacts upload.
- Complex chat.
- Streak insurance, boosts, or power-ups.
- Android support.
- Cross-device enforcement.
- Corporate/team plans.
- Advanced analytics.

## 13. Implementation Phases

### Phase 0: MVP Validation and Entitlements, 1-2 weeks

- Finalize non-cash MVP rules: selected iPhone apps, daily challenges, co-winners, points, and streaks.
- Apply for Family Controls entitlement.
- Confirm App Review positioning avoids real-money, stakes, pots, payouts, and gambling-like claims.
- Document future real-money questions for counsel without building production payment UI.

### Phase 1: Screen Time Prototype, 2-3 weeks

- Build a small SwiftUI prototype.
- Request individual Family Controls authorization.
- Select apps with `FamilyActivityPicker`.
- Apply and remove Managed Settings shields.
- Implement shield action for "forfeit and unlock."
- Verify behavior across reboot, offline mode, permission revocation, selection changes after lock, and missing heartbeat.

### Phase 2: Social Pool MVP, 3-5 weeks

- Build backend auth, users, pools, memberships, challenge days.
- Add invite links and APNs.
- Sync challenge events with App Attest assertions, device ID, selection version, client timestamp, and server `received_at`.
- Implement daily scoring and tie rules.
- Launch internal TestFlight with points only.

### Phase 3: Post-MVP Cash Feasibility, timeline depends on legal review

- Engage counsel for real-money classification, jurisdictions, official rules, tax treatment, and money transmission risk.
- Confirm a payment provider accepts the exact use case before building any payment UI.
- Design comparable, locked, auditable challenge rules for any cash mode.
- Add sandbox-only ledger and payout experiments after legal and provider approval.
- Enable real money only in approved jurisdictions with age checks, geo-restrictions, KYC, official rules, conservative payout timing, and no rake unless counsel approves it.

## 14. Test Plan

Real-device iOS tests:

- FamilyControls authorization succeeds, fails, and is revoked.
- App selection creates a local selection version hash without sending app identities to the backend.
- Managed Settings shield applies at challenge start and clears at challenge end.
- Shield unlock records `shield_unlock` and marks the user forfeited.
- Device reboot, offline mode, authorization revocation, app deletion, and selection change after lock produce conservative forfeiture or invalidation behavior.

Backend tests:

- Scoring uses first disqualifying event from `challenge_start_utc`.
- Tie handling produces co-winners.
- Missing heartbeat beyond the grace period marks a forfeiture.
- Duplicate event submissions are idempotent.
- Server records `received_at` and does not trust client timestamps for final ordering without validation.
- Invalid or missing App Attest assertions are rejected or risk-flagged according to the endpoint policy.

Product acceptance tests:

- A user can create a pool, invite friends, select apps, complete a challenge, and see results without cash.
- A user who unlocks a selected app is marked forfeited.
- A user who revokes Screen Time access is marked invalid or forfeited.
- Friends cannot see selected app identities by default.
- No payment, stake, pot, payout, or gambling-like claim appears in MVP UI.

## 15. Key Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| App Store rejects Screen Time use | High | Apply for entitlement early, keep use case focused on self-control, provide clear review notes. |
| Cash pool is treated as gambling or regulated contest | High | Exclude real money from MVP; require legal review, geo-restrictions, official rules, and age gates before any cash beta. |
| Money movement triggers licensing obligations | High | Do not build production payment UI in v1; use a provider-approved flow only after counsel review. |
| Private app selection is unfair for cash contests | High | Use private selections only for non-cash accountability; require comparable locked rules for any future cash mode. |
| Screen Time callbacks are inconsistent | Medium | Test on real devices, use shield-first UX, add sync grace periods. |
| Users cheat by revoking access or using other devices | Medium | Mark revocation/missing sync as forfeiture, use App Attest, explain trust limits. |
| Push notifications are mistaken for scoring infrastructure | Medium | Treat notifications as UX only; final scoring depends on server-side challenge state and synced events. |
| Privacy trust is weak | High | Do not expose selected apps, minimize backend data, clear privacy copy. |

## 16. MVP Defaults and Deferred Questions

Locked MVP defaults:

- Pools use individual iPhone app selections only.
- If everyone succeeds for the full day, all remaining users are co-winners.
- Pools are daily only.
- Forfeiting unlocks the requested app and marks the participant forfeited for the day.
- Websites, categories, weekly challenges, public pools, and cash stakes are deferred.

Deferred post-MVP questions:

- Which jurisdictions can support a real-money beta?
- Can a payment provider approve the exact use case?
- What comparable challenge rules would make cash contests fair enough to operate?
- Should the business model use subscriptions, sponsorships, or another non-rake model?

## 17. Immediate Next Steps

1. Finalize MVP rules: individual iPhone app selections, daily challenge, co-winners, points, and streaks.
2. Start Apple Family Controls entitlement request.
3. Build the Screen Time prototype on physical devices.
4. Set up backend schema for pools, challenge entries, selection version metadata, and immutable Screen Time events.
5. Add App Attest-protected event sync and server `received_at` handling.
6. Keep real-money research separate from MVP implementation until counsel and a payment provider approve the exact use case.

## 18. Source Notes

- Apple Screen Time API overview and iOS 16 individual authorization: https://developer.apple.com/videos/play/wwdc2022/110336/
- FamilyControls documentation: https://developer.apple.com/documentation/familycontrols
- DeviceActivity documentation: https://developer.apple.com/documentation/deviceactivity
- ManagedSettings documentation: https://developer.apple.com/documentation/managedsettings
- DeviceActivityReport privacy behavior: https://developer.apple.com/documentation/deviceactivity/deviceactivityreport
- Apple App Review Guidelines, especially payments and section 5.3: https://developer.apple.com/app-store/review/guidelines/
- Apple DeviceCheck and App Attest: https://developer.apple.com/documentation/devicecheck
- Stripe Connect separate charges and transfers: https://docs.stripe.com/connect/separate-charges-and-transfers
- eCFR 31 CFR 1010.100 money services business and money transmitter definitions: https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1010/subpart-A/section-1010.100
