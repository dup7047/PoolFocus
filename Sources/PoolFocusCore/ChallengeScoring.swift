import Foundation

public enum ChallengeScoring {
    public static let disqualifyingEvents: Set<ScreenTimeEventType> = [
        .shieldUnlock,
        .authorizationRevoked,
        .monitorUnavailable,
        .heartbeatMissing,
        .selectionChanged
    ]

    public static func finalizeEntries(
        entries: [ChallengeEntry],
        events: [ScreenTimeEvent],
        challengeStart: Date,
        challengeEnd: Date,
        finalizedAt: Date
    ) -> [ChallengeEntry] {
        entries.map { entry in
            var updated = entry

            if let firstDisqualifyingEvent = firstDisqualifyingEvent(for: entry, in: events) {
                updated.status = firstDisqualifyingEvent.type == .selectionChanged ? .invalid : .forfeited
                updated.forfeitedAt = normalizedEventDate(firstDisqualifyingEvent, challengeStart: challengeStart, challengeEnd: challengeEnd)
                updated.pointsAwarded = 0
                return updated
            }

            if entry.status == .active || entry.status == .ready {
                updated.status = .completed
                updated.completedAt = min(finalizedAt, challengeEnd)
            }

            return updated
        }
    }

    public static func leaderboard(
        entries: [ChallengeEntry],
        challengeStart: Date,
        challengeEnd: Date
    ) -> [LeaderboardRow] {
        let sorted = entries.sorted { left, right in
            let leftSurvival = survivalEnd(for: left, challengeStart: challengeStart, challengeEnd: challengeEnd)
            let rightSurvival = survivalEnd(for: right, challengeStart: challengeStart, challengeEnd: challengeEnd)

            if leftSurvival != rightSurvival {
                return leftSurvival > rightSurvival
            }

            return left.displayName.localizedCaseInsensitiveCompare(right.displayName) == .orderedAscending
        }

        let bestSurvival = sorted.first.map {
            survivalEnd(for: $0, challengeStart: challengeStart, challengeEnd: challengeEnd)
        }

        var lastSurvival: Date?
        var currentRank = 0

        return sorted.enumerated().map { index, entry in
            let survivedUntil = survivalEnd(for: entry, challengeStart: challengeStart, challengeEnd: challengeEnd)
            if survivedUntil != lastSurvival {
                currentRank = index + 1
                lastSurvival = survivedUntil
            }

            return LeaderboardRow(
                entry: entry,
                rank: currentRank,
                survivedUntil: survivedUntil,
                isCoWinner: bestSurvival == survivedUntil && entry.status == .completed
            )
        }
    }

    public static func awardPoints(
        entries: [ChallengeEntry],
        challengeStart: Date,
        challengeEnd: Date,
        completionPoints: Int = 10
    ) -> [ChallengeEntry] {
        let winners = Set(
            leaderboard(entries: entries, challengeStart: challengeStart, challengeEnd: challengeEnd)
                .filter(\.isCoWinner)
                .map(\.entry.id)
        )

        return entries.map { entry in
            var updated = entry
            updated.pointsAwarded = winners.contains(entry.id) ? completionPoints : 0
            return updated
        }
    }

    private static func firstDisqualifyingEvent(
        for entry: ChallengeEntry,
        in events: [ScreenTimeEvent]
    ) -> ScreenTimeEvent? {
        events
            .filter { $0.entryID == entry.id && disqualifyingEvents.contains($0.type) }
            .sorted { first, second in
                eventOrderingDate(first) < eventOrderingDate(second)
            }
            .first
    }

    private static func survivalEnd(
        for entry: ChallengeEntry,
        challengeStart: Date,
        challengeEnd: Date
    ) -> Date {
        if let forfeitedAt = entry.forfeitedAt {
            return min(max(forfeitedAt, challengeStart), challengeEnd)
        }

        if entry.status == .completed {
            return challengeEnd
        }

        return challengeStart
    }

    private static func normalizedEventDate(
        _ event: ScreenTimeEvent,
        challengeStart: Date,
        challengeEnd: Date
    ) -> Date {
        min(max(eventOrderingDate(event), challengeStart), challengeEnd)
    }

    private static func eventOrderingDate(_ event: ScreenTimeEvent) -> Date {
        event.receivedAt ?? event.clientOccurredAt
    }
}
