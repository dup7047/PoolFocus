# PoolFocus UX Redesign Plan

## Product Direction
PoolFocus should feel like a private daily accountability challenge, not a diagnostics dashboard. The primary experience is the user's current challenge state: create or join a pool, pick private apps to avoid, commit for today, stay in the challenge, then review results.

## Information Architecture
Use a three-tab app shell:

- Today: state-driven primary flow for onboarding, app selection, commitment, active challenge, forfeit, and results.
- Pool: private friend group, member statuses, invite code, and recent history.
- Profile: compact settings and diagnostics for Screen Time/demo access, app selection, sync, and reset demo data.

## Implementation Corrections From Review

- `DemoPoolStore.loadPool()` must return nil when there is no pool. It must not auto-seed, because the welcome state depends on no pool existing.
- Demo pool creation and joining are explicit actions that seed the default friend group.
- Synthetic friend forfeits are timestamp-based using `scheduledForfeitAt`, not `Task.sleep`, so status survives navigation and app relaunch better.
- The demo user's `DemoMember.id` and `ChallengeCoordinator.activeEntry.id/userID` must be aligned whenever a pool is loaded or created.
- `finalizeDemoChallenge()` must be idempotent and guarded so the active challenge only completes once.
- The real `PoolFocus` scheme should keep its Screen Time code paths intact, but physical-device success is not expected with a personal Apple team. The build verification target is `PoolFocusDemo`.
- Demo invite codes use six characters. Joining accepts any non-empty code in demo mode.
- Continue from existing files and avoid duplicate model/store/component types.

## Demo Flow To Verify

1. Fresh launch shows welcome state.
2. Create Pool seeds You, Alex, Priya, Sam, and Jordan.
3. Pick demo apps, save, and see app count/hash update.
4. Lock in for today.
5. Start the 1-minute demo challenge.
6. Active view shows countdown, progress ring, live friend statuses, and a manual forfeit button.
7. At zero, results show co-winners and streak.
8. Manual forfeit shows a humane forfeit recap.
9. Profile reset returns the app to the welcome state.
