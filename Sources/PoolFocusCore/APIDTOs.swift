import Foundation

public struct PoolSummaryDTO: Identifiable, Codable, Equatable, Sendable {
    public var id: UUID
    public var name: String
    public var timezoneIdentifier: String
    public var memberCount: Int

    public init(
        id: UUID,
        name: String,
        timezoneIdentifier: String,
        memberCount: Int
    ) {
        self.id = id
        self.name = name
        self.timezoneIdentifier = timezoneIdentifier
        self.memberCount = memberCount
    }
}

public struct ChallengeReadinessRequest: Codable, Equatable, Sendable {
    public var poolID: UUID
    public var challengeDayID: UUID
    public var deviceID: String
    public var selectionVersionHash: String
    public var appAttestAssertion: Data?

    public init(
        poolID: UUID,
        challengeDayID: UUID,
        deviceID: String,
        selectionVersionHash: String,
        appAttestAssertion: Data?
    ) {
        self.poolID = poolID
        self.challengeDayID = challengeDayID
        self.deviceID = deviceID
        self.selectionVersionHash = selectionVersionHash
        self.appAttestAssertion = appAttestAssertion
    }
}

public struct ChallengeEventRequest: Codable, Equatable, Sendable {
    public var event: ScreenTimeEvent
    public var appAttestAssertion: Data?

    public init(event: ScreenTimeEvent, appAttestAssertion: Data?) {
        self.event = event
        self.appAttestAssertion = appAttestAssertion
    }
}

public struct LeaderboardResponse: Codable, Equatable, Sendable {
    public var challengeDayID: UUID
    public var generatedAt: Date
    public var entries: [ChallengeEntry]

    public init(challengeDayID: UUID, generatedAt: Date, entries: [ChallengeEntry]) {
        self.challengeDayID = challengeDayID
        self.generatedAt = generatedAt
        self.entries = entries
    }
}
