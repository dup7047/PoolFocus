import Foundation
import Testing
@testable import PoolFocusCore

@Suite("Challenge scoring")
struct ChallengeScoringTests {
    private let start = Date(timeIntervalSince1970: 1000)
    private let end = Date(timeIntervalSince1970: 2000)

    @Test("first disqualifying event forfeits an active entry")
    func firstDisqualifyingEventForfeitsEntry() {
        let entry = ChallengeEntry(userID: UUID(), displayName: "Ari", status: .active)
        let later = ScreenTimeEvent(
            entryID: entry.id,
            deviceID: "device",
            type: .authorizationRevoked,
            selectionVersionHash: "v1",
            clientOccurredAt: start.addingTimeInterval(200)
        )
        let earlier = ScreenTimeEvent(
            entryID: entry.id,
            deviceID: "device",
            type: .shieldUnlock,
            selectionVersionHash: "v1",
            clientOccurredAt: start.addingTimeInterval(100)
        )

        let finalized = ChallengeScoring.finalizeEntries(
            entries: [entry],
            events: [later, earlier],
            challengeStart: start,
            challengeEnd: end,
            finalizedAt: end
        )

        #expect(finalized[0].status == .forfeited)
        #expect(finalized[0].forfeitedAt == earlier.clientOccurredAt)
    }

    @Test("selection changes invalidate the entry")
    func selectionChangeInvalidatesEntry() {
        let entry = ChallengeEntry(userID: UUID(), displayName: "Bo", status: .active)
        let event = ScreenTimeEvent(
            entryID: entry.id,
            deviceID: "device",
            type: .selectionChanged,
            selectionVersionHash: "v2",
            clientOccurredAt: start.addingTimeInterval(30)
        )

        let finalized = ChallengeScoring.finalizeEntries(
            entries: [entry],
            events: [event],
            challengeStart: start,
            challengeEnd: end,
            finalizedAt: end
        )

        #expect(finalized[0].status == .invalid)
        #expect(finalized[0].pointsAwarded == 0)
    }

    @Test("completed entries become co-winners")
    func completedEntriesBecomeCoWinners() {
        let first = ChallengeEntry(userID: UUID(), displayName: "Cora", status: .active)
        let second = ChallengeEntry(userID: UUID(), displayName: "Dev", status: .ready)

        let finalized = ChallengeScoring.finalizeEntries(
            entries: [first, second],
            events: [],
            challengeStart: start,
            challengeEnd: end,
            finalizedAt: end
        )
        let awarded = ChallengeScoring.awardPoints(
            entries: finalized,
            challengeStart: start,
            challengeEnd: end
        )
        let leaderboard = ChallengeScoring.leaderboard(
            entries: awarded,
            challengeStart: start,
            challengeEnd: end
        )

        #expect(leaderboard.count == 2)
        #expect(leaderboard.allSatisfy { $0.isCoWinner })
        #expect(awarded.allSatisfy { $0.pointsAwarded == 10 })
    }

    @Test("receivedAt is preferred over client timestamp")
    func receivedAtDrivesOrdering() {
        let entry = ChallengeEntry(userID: UUID(), displayName: "Eli", status: .active)
        let clientEarlyServerLate = ScreenTimeEvent(
            entryID: entry.id,
            deviceID: "device",
            type: .shieldUnlock,
            selectionVersionHash: "v1",
            clientOccurredAt: start.addingTimeInterval(5),
            receivedAt: start.addingTimeInterval(300)
        )

        let finalized = ChallengeScoring.finalizeEntries(
            entries: [entry],
            events: [clientEarlyServerLate],
            challengeStart: start,
            challengeEnd: end,
            finalizedAt: end
        )

        #expect(finalized[0].forfeitedAt == clientEarlyServerLate.receivedAt)
    }
}
