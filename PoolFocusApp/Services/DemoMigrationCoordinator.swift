import Foundation
import SwiftUI

/// Watches for the moment we transition from "no usable session" to "signed in"
/// while a `DemoPool` exists locally, and presents the migration prompt at most
/// once per device. Owns the side effects for both choices:
///   - .bringOver: drop fake friends from the existing pool, keep streak +
///     selected-app count + pool name. Marks migration complete.
///   - .startFresh: nuke all demo state. Marks migration complete.
@MainActor
final class DemoMigrationCoordinator: ObservableObject {
    @Published var isPromptVisible = false
    @Published private(set) var lastChoice: DemoMigrationChoice?

    private let demoStore: DemoPoolStore?
    private let appSelection: DemoAppSelectionStore?
    private let groupStore: AppGroupStore?

    init(
        demoStore: DemoPoolStore? = DemoPoolStore(),
        appSelection: DemoAppSelectionStore? = DemoAppSelectionStore(),
        groupStore: AppGroupStore? = AppGroupStore()
    ) {
        self.demoStore = demoStore
        self.appSelection = appSelection
        self.groupStore = groupStore

        // Test hooks for verification from outside the app.
        let args = CommandLine.arguments
        if args.contains("-poolfocus-reset-migration-flag") {
            groupStore?.set(nil as Data?, forKey: PoolFocusConstants.demoMigrationCompletedKey)
            groupStore?.set(nil as String?, forKey: PoolFocusConstants.demoMigrationChoiceKey)
        }
        if args.contains("-poolfocus-seed-demo-state-streak-5") {
            seedDemoStateForTesting(streak: 5, appCount: 4)
        }
        // Test hooks that run the migration choice without UI tap.
        if args.contains("-poolfocus-migrate-bring-over") {
            bringOver(signedInDisplayName: "Ada Lovelace")
        }
        if args.contains("-poolfocus-migrate-start-fresh") {
            startFresh()
        }
        if args.contains("-poolfocus-print-migration-snapshot") {
            print("[MigrationSnapshot] \(debugSnapshot())")
        }
        // Opt-in diagnostic: drop a JSON file with launch args + final state
        // into the app sandbox so external bash tests can read it via
        // `simctl get_app_container`. Only fires when explicitly requested.
        if args.contains("-poolfocus-write-diagnostic") {
            writeDiagnostic(args: args)
        }
    }

    private func writeDiagnostic(args: [String]) {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        guard let url = docs?.appendingPathComponent("migration-diagnostic.json") else { return }
        let payload: [String: Any] = [
            "launchArgs": args,
            "snapshot": debugSnapshot(),
            "wallClock": ISO8601DateFormatter().string(from: Date())
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) {
            try? data.write(to: url)
        }
    }

    /// Test inspector: read out the current demo-side state. Used by smoke
    /// tests to assert that fake friends really are gone after bring-over.
    func debugSnapshot() -> [String: String] {
        guard let demoStore else { return [:] }
        let pool = demoStore.loadPool()
        return [
            "poolName": pool?.name ?? "<none>",
            "memberCount": String(pool?.memberCount ?? 0),
            "memberNames": pool?.members.map(\.displayName).joined(separator: ",") ?? "",
            "streak": String(demoStore.loadStreak()),
            "selectedAppCount": String(appSelection?.selectedCount() ?? 0),
            "migrationChoice": groupStore?.string(forKey: PoolFocusConstants.demoMigrationChoiceKey) ?? "<unset>"
        ]
    }

    /// Snapshot of what we'd carry over if the user picks bring-over. Nil
    /// when there's nothing to migrate.
    func currentSnapshot() -> MigratableDemoState? {
        guard let demoStore, let pool = demoStore.loadPool() else { return nil }
        let myName = pool.me?.displayName ?? "You"
        return MigratableDemoState(
            poolName: pool.name,
            streak: demoStore.loadStreak(),
            selectedAppCount: appSelection?.selectedCount() ?? 0,
            myDisplayName: myName
        )
    }

    var hasCompletedMigration: Bool {
        groupStore?.string(forKey: PoolFocusConstants.demoMigrationChoiceKey) != nil
    }

    /// Evaluate after a sign-in completes. Returns true iff the prompt was shown.
    @discardableResult
    func evaluateAfterSignIn() -> Bool {
        if hasCompletedMigration { return false }
        guard currentSnapshot() != nil else { return false }
        isPromptVisible = true
        return true
    }

    /// User chose "Bring my pool over". Drops fake friends, keeps streak.
    func bringOver(signedInDisplayName: String?) {
        guard let demoStore, let pool = demoStore.loadPool() else {
            recordChoice(.bringOver)
            isPromptVisible = false
            return
        }
        let snapshot = currentSnapshot() ?? MigratableDemoState(
            poolName: pool.name, streak: 0, selectedAppCount: 0, myDisplayName: "You"
        )
        let plan = DemoMigration.plan(from: snapshot, signedInDisplayName: signedInDisplayName)

        // Mutate the existing pool: keep me + drop fake friends, take the
        // resolved display name. Streak survives (we don't touch it).
        var migrated = pool
        migrated.name = plan.poolName
        if let me = migrated.me {
            var newMe = me
            newMe.displayName = plan.myDisplayName
            migrated.members = [newMe]
        } else {
            // No `me` (corrupt state): create a placeholder with the resolved name.
            migrated.members = [DemoMember(
                id: UUID(),
                displayName: plan.myDisplayName,
                paletteIndex: 0,
                isMe: true
            )]
        }
        demoStore.savePool(migrated)
        // Streak is left as-is. App selection is left as-is.

        recordChoice(.bringOver)
        isPromptVisible = false
    }

    /// User chose "Start fresh". Wipe demo data entirely.
    func startFresh() {
        demoStore?.reset()
        recordChoice(.startFresh)
        isPromptVisible = false
    }

    private func recordChoice(_ choice: DemoMigrationChoice) {
        lastChoice = choice
        groupStore?.set(1, forKey: PoolFocusConstants.demoMigrationCompletedKey)
        groupStore?.set(choice.rawValue, forKey: PoolFocusConstants.demoMigrationChoiceKey)
    }

    // MARK: - Test seeding

    private func seedDemoStateForTesting(streak: Int, appCount: Int) {
        guard let demoStore, let appSelection else { return }
        if demoStore.loadPool() == nil {
            demoStore.savePool(DemoPool.makeSeeded(name: "Friends Focus"))
        }
        demoStore.saveStreak(streak)
        // Pretend the user picked N apps.
        appSelection.save(selectedIDs: Set((0..<appCount).map { "demo.app.\($0)" }))
        // Wipe the migration flag so the prompt fires.
        groupStore?.set(nil as Data?, forKey: PoolFocusConstants.demoMigrationCompletedKey)
        groupStore?.set(nil as String?, forKey: PoolFocusConstants.demoMigrationChoiceKey)
    }
}
