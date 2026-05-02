import Foundation

struct DemoMember: Codable, Identifiable, Hashable {
    var id: UUID
    var displayName: String
    var paletteIndex: Int
    var isMe: Bool
    var scheduledForfeitAt: Date?
    var actualForfeitAt: Date?

    var initial: String {
        displayName.first.map { String($0).uppercased() } ?? "?"
    }

    func liveStatus(now: Date, challengeStart: Date?, challengeEnd: Date?) -> ChallengeEntryStatus {
        if let actual = actualForfeitAt, now >= actual {
            return .forfeited
        }

        if !isMe, let scheduled = scheduledForfeitAt, now >= scheduled {
            return .forfeited
        }

        if let end = challengeEnd, now >= end {
            return .completed
        }

        if let start = challengeStart, now >= start {
            return .active
        }

        return .ready
    }

    func resolvedForfeitDate(challengeEnd: Date?) -> Date? {
        if let actual = actualForfeitAt {
            return actual
        }
        if !isMe, let scheduled = scheduledForfeitAt {
            if let end = challengeEnd, scheduled > end {
                return nil
            }
            return scheduled
        }
        return nil
    }
}

struct DemoPool: Codable, Identifiable, Hashable {
    var id: UUID
    var name: String
    var inviteCode: String
    var createdAt: Date
    var members: [DemoMember]

    var memberCount: Int { members.count }

    var me: DemoMember? {
        members.first(where: \.isMe)
    }

    var others: [DemoMember] {
        members.filter { !$0.isMe }
    }
}

extension DemoPool {
    static func makeSeeded(name: String) -> DemoPool {
        let me = DemoMember(
            id: UUID(),
            displayName: "You",
            paletteIndex: 0,
            isMe: true
        )

        let friends: [(String, Int)] = [
            ("Alex", 1),
            ("Priya", 2),
            ("Sam", 3),
            ("Jordan", 4)
        ]

        let others = friends.map { name, index in
            DemoMember(
                id: UUID(),
                displayName: name,
                paletteIndex: index,
                isMe: false
            )
        }

        return DemoPool(
            id: UUID(),
            name: name,
            inviteCode: Self.randomCode(),
            createdAt: Date(),
            members: [me] + others
        )
    }

    static func randomCode() -> String {
        let alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        return String((0..<6).compactMap { _ in alphabet.randomElement() })
    }
}
