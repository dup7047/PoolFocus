import Foundation

public enum ChallengeEntryStatus: String, Codable, CaseIterable, Sendable {
    case pendingConfig = "pending_config"
    case ready
    case active
    case forfeited
    case completed
    case invalid
}

public enum ScreenTimeEventType: String, Codable, CaseIterable, Sendable {
    case shieldUnlock = "shield_unlock"
    case authorizationRevoked = "authorization_revoked"
    case monitorUnavailable = "monitor_unavailable"
    case heartbeatMissing = "heartbeat_missing"
    case selectionChanged = "selection_changed"
    case challengeCompleted = "challenge_completed"
}

public struct ChallengeRules: Codable, Equatable, Sendable {
    public var heartbeatGraceSeconds: TimeInterval

    public init(heartbeatGraceSeconds: TimeInterval = 15 * 60) {
        self.heartbeatGraceSeconds = heartbeatGraceSeconds
    }
}

public struct ChallengeEntry: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var userID: UUID
    public var displayName: String
    public var status: ChallengeEntryStatus
    public var selectionVersionHash: String?
    public var forfeitedAt: Date?
    public var completedAt: Date?
    public var pointsAwarded: Int

    public init(
        id: UUID = UUID(),
        userID: UUID,
        displayName: String,
        status: ChallengeEntryStatus = .pendingConfig,
        selectionVersionHash: String? = nil,
        forfeitedAt: Date? = nil,
        completedAt: Date? = nil,
        pointsAwarded: Int = 0
    ) {
        self.id = id
        self.userID = userID
        self.displayName = displayName
        self.status = status
        self.selectionVersionHash = selectionVersionHash
        self.forfeitedAt = forfeitedAt
        self.completedAt = completedAt
        self.pointsAwarded = pointsAwarded
    }
}

public struct ScreenTimeEvent: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var entryID: UUID
    public var deviceID: String
    public var type: ScreenTimeEventType
    public var selectionVersionHash: String?
    public var clientOccurredAt: Date
    public var receivedAt: Date?

    public init(
        id: UUID = UUID(),
        entryID: UUID,
        deviceID: String,
        type: ScreenTimeEventType,
        selectionVersionHash: String?,
        clientOccurredAt: Date,
        receivedAt: Date? = nil
    ) {
        self.id = id
        self.entryID = entryID
        self.deviceID = deviceID
        self.type = type
        self.selectionVersionHash = selectionVersionHash
        self.clientOccurredAt = clientOccurredAt
        self.receivedAt = receivedAt
    }
}

public struct LeaderboardRow: Identifiable, Equatable, Sendable {
    public var id: UUID { entry.id }
    public var entry: ChallengeEntry
    public var rank: Int?
    public var survivedUntil: Date?
    public var isCoWinner: Bool

    public init(
        entry: ChallengeEntry,
        rank: Int?,
        survivedUntil: Date?,
        isCoWinner: Bool
    ) {
        self.entry = entry
        self.rank = rank
        self.survivedUntil = survivedUntil
        self.isCoWinner = isCoWinner
    }
}
