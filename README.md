# PoolFocus MVP

PoolFocus is a non-cash iOS accountability app scaffold for reducing phone usage with private friend pools, points, and streaks. The first implementation intentionally excludes stakes, pots, payouts, and production payment UI.

## What Is Implemented

- Swift core package with challenge states, Screen Time event types, leaderboard scoring, co-winner handling, and tests.
- SwiftUI app scaffold for Screen Time authorization, app selection, readiness, demo challenge scheduling, and pending event sync.
- Device Activity Monitor extension source for applying and clearing Managed Settings shields.
- Shield Action extension source for recording a `shield_unlock` forfeit event.
- Shield Configuration extension source for the non-cash shield UI.
- App Group, Family Controls, App Attest, APNs, and extension Info.plist placeholders.
- Dependency-light TypeScript backend scaffold with readiness, event ingest, leaderboard, and scoring tests.
- `project.yml` for generating an Xcode project with XcodeGen.

## Local Verification

Run core Swift tests:

```sh
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  CLANG_MODULE_CACHE_PATH="$PWD/.build/clang-module-cache" \
  /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift test \
  --cache-path "$PWD/.build/swiftpm-cache"
```

Run backend tests:

```sh
cd backend
npm test
```

Run the development backend:

```sh
cd backend
npm run dev
```

## Opening In Xcode

This repository includes an XcodeGen `project.yml`. Generate the project with:

```sh
xcodegen generate
open PoolFocus.xcodeproj
```

## Simulator Testing

Use the `PoolFocusDemo` scheme for local simulator or personal-team iPhone testing. It does not embed Screen Time extensions or request Screen Time entitlements, because Device Activity and Managed Settings shield extensions need a paid Apple Developer team with Family Controls enabled.

Fast path:

```sh
./scripts/run-simulator.sh
```

Manual path:

```sh
xcodegen generate
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild \
  -project PoolFocus.xcodeproj \
  -scheme PoolFocusDemo \
  -configuration Debug \
  -sdk iphonesimulator \
  -arch arm64 \
  -derivedDataPath "$PWD/DerivedData" \
  SYMROOT="$PWD/BuildProducts" \
  OBJROOT="$PWD/BuildIntermediates" \
  CLANG_MODULE_CACHE_PATH="$PWD/.build/clang-module-cache" \
  CODE_SIGNING_ALLOWED=NO \
  build
```

In the demo app, tap `Use Demo Screen Time Access`, then `Choose Demo Apps`, select a few demo apps, then tap `Mark Ready` and `Start 1-Minute Demo Challenge`.

## Personal-Team iPhone Demo

The demo scheme can run on a physical iPhone without a paid developer account. It simulates Screen Time authorization, app selection, readiness, challenge start, and local sync state. It cannot block other apps, detect selected app usage, show Apple's real Screen Time picker, or run the Screen Time extensions.

Build it for a connected iPhone from Xcode by selecting:

- Scheme: `PoolFocusDemo`
- Destination: your iPhone

Then press Run.

Before running the real Screen Time target on a physical iPhone:

- Change `com.example.*` bundle identifiers.
- Change `group.com.example.PoolFocus` in entitlements and `PoolFocusConstants`.
- Add an Apple Developer team.
- Request and configure the Family Controls entitlement for the app and Screen Time extensions.
- Configure App Attest key registration on the backend before treating assertions as enforced.

Screen Time APIs require physical-device testing for the real authorization, picker, monitoring, and shield behavior.
