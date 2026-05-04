import Foundation
import Testing
@testable import PoolFocusCore

@Suite("Demo migration plan")
struct DemoMigrationTests {
    private let state = MigratableDemoState(
        poolName: "Friends Focus",
        streak: 5,
        selectedAppCount: 4,
        myDisplayName: "You"
    )

    @Test("plan: preserves pool name, streak, and app count")
    func planPreservesPoolNameStreakAndAppCount() {
        let plan = DemoMigration.plan(from: state, signedInDisplayName: "Ada Lovelace")
        #expect(plan.poolName == "Friends Focus")
        #expect(plan.preservedStreak == 5)
        #expect(plan.preservedSelectedAppCount == 4)
    }

    @Test("plan: uses real display name when signed-in user has one")
    func planPrefersSignedInDisplayName() {
        let plan = DemoMigration.plan(from: state, signedInDisplayName: "Ada Lovelace")
        #expect(plan.myDisplayName == "Ada Lovelace")
    }

    @Test("plan: falls back to demo placeholder when no signed-in name")
    func planFallsBackToDemoName() {
        let plan = DemoMigration.plan(from: state, signedInDisplayName: nil)
        #expect(plan.myDisplayName == "You")
    }

    @Test("plan: trims whitespace from signed-in name")
    func planTrimsWhitespace() {
        let plan = DemoMigration.plan(from: state, signedInDisplayName: "   ")
        #expect(plan.myDisplayName == "You", "whitespace-only name → fall back to demo placeholder")

        let plan2 = DemoMigration.plan(from: state, signedInDisplayName: "  Ada  ")
        #expect(plan2.myDisplayName == "Ada", "trims surrounding whitespace")
    }

    @Test("plan: streak of 0 still passes through unchanged")
    func planZeroStreakPassesThrough() {
        let zeroStreak = MigratableDemoState(
            poolName: "n",
            streak: 0,
            selectedAppCount: 1,
            myDisplayName: "You"
        )
        let plan = DemoMigration.plan(from: zeroStreak, signedInDisplayName: "X")
        #expect(plan.preservedStreak == 0)
    }

    @Test("MigratableDemoState: Codable round-trip")
    func codableRoundTrip() throws {
        let encoded = try JSONEncoder().encode(state)
        let decoded = try JSONDecoder().decode(MigratableDemoState.self, from: encoded)
        #expect(decoded == state)
    }

    @Test("DemoMigrationChoice: raw values are stable")
    func choiceRawValues() {
        #expect(DemoMigrationChoice.bringOver.rawValue == "bringOver")
        #expect(DemoMigrationChoice.startFresh.rawValue == "startFresh")
    }
}
