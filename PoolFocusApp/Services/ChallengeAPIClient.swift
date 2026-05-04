import Foundation

protocol ChallengeAPIClient: Sendable {
    func submitReadiness(_ request: ChallengeReadinessRequest) async throws
    func submitEvent(_ request: ChallengeEventRequest) async throws
    func submitEvent(_ request: ChallengeEventRequest, attest: AppAttesting?) async throws
    func fetchLeaderboard(challengeDayID: UUID) async throws -> LeaderboardResponse
}

extension ChallengeAPIClient {
    /// Default convenience overload: don't attach an attestation.
    func submitEvent(_ request: ChallengeEventRequest) async throws {
        try await submitEvent(request, attest: nil)
    }
}

struct DevelopmentChallengeAPIClient: ChallengeAPIClient, Sendable {
    func submitReadiness(_ request: ChallengeReadinessRequest) async throws {
        // Server integration will attach App Attest assertions and persist readiness.
    }

    func submitEvent(_ request: ChallengeEventRequest, attest: AppAttesting?) async throws {
        // Server integration will record received_at and idempotently accept events.
    }

    func fetchLeaderboard(challengeDayID: UUID) async throws -> LeaderboardResponse {
        LeaderboardResponse(challengeDayID: challengeDayID, generatedAt: Date(), entries: [])
    }
}
