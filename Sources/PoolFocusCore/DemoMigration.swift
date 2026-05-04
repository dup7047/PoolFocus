import Foundation

/// Snapshot of demo-mode state worth carrying into a real account.
public struct MigratableDemoState: Codable, Equatable, Sendable {
    public let poolName: String
    public let streak: Int
    public let selectedAppCount: Int
    /// Member identities the user controls. Always exactly the local user;
    /// fake friends are intentionally excluded.
    public let myDisplayName: String

    public init(poolName: String, streak: Int, selectedAppCount: Int, myDisplayName: String) {
        self.poolName = poolName
        self.streak = streak
        self.selectedAppCount = selectedAppCount
        self.myDisplayName = myDisplayName
    }
}

/// Outcome the user picked from the demo→real prompt.
public enum DemoMigrationChoice: String, Codable, Sendable {
    case bringOver
    case startFresh
}

/// Pure migration logic. Drives both the unit tests and the app-side
/// service. No I/O — callers wire this into Keychain / AppGroup stores.
public enum DemoMigration {
    /// What the migration should produce when the user picks "bring over".
    public struct BringOverResult: Equatable, Sendable {
        /// Pool name to use for the new real pool.
        public let poolName: String
        /// Streak we preserve into the real account.
        public let preservedStreak: Int
        /// User's selected app count, surfaced so the real-mode picker can
        /// show "X apps still selected" or similar.
        public let preservedSelectedAppCount: Int
        /// The display name we use for the user in the new pool. Either
        /// the demo display name or the freshly signed-in real one.
        public let myDisplayName: String
    }

    /// Build the bring-over plan from the demo state plus the just-signed-in
    /// user. We prefer the real Apple display name over the placeholder demo
    /// "You" label when one is available.
    public static func plan(
        from state: MigratableDemoState,
        signedInDisplayName: String?
    ) -> BringOverResult {
        let myName = signedInDisplayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolved = (myName?.isEmpty == false) ? myName! : state.myDisplayName
        return BringOverResult(
            poolName: state.poolName,
            preservedStreak: state.streak,
            preservedSelectedAppCount: state.selectedAppCount,
            myDisplayName: resolved
        )
    }
}
