import Foundation

struct HTTPChallengeAPIClient: ChallengeAPIClient, Sendable {
    var baseURL: URL
    var session: URLSession = .shared

    func submitReadiness(_ request: ChallengeReadinessRequest) async throws {
        let _: EmptyResponse = try await send(
            path: "/challenge/readiness",
            method: "POST",
            body: request
        )
    }

    func submitEvent(_ request: ChallengeEventRequest) async throws {
        let _: EmptyResponse = try await send(
            path: "/challenge/events",
            method: "POST",
            body: request
        )
    }

    func fetchLeaderboard(challengeDayID: UUID) async throws -> LeaderboardResponse {
        try await send(
            path: "/challenge/leaderboard/\(challengeDayID.uuidString)",
            method: "GET",
            body: Optional<String>.none
        )
    }

    private func send<RequestBody: Encodable, ResponseBody: Decodable>(
        path: String,
        method: String,
        body: RequestBody?
    ) async throws -> ResponseBody {
        var urlRequest = URLRequest(url: baseURL.appending(path: path))
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "accept")

        if let body {
            urlRequest.httpBody = try JSONEncoder.poolFocus.encode(body)
            urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        }

        let (data, response) = try await session.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse,
              200..<300 ~= httpResponse.statusCode else {
            throw URLError(.badServerResponse)
        }

        if data.isEmpty {
            return EmptyResponse() as! ResponseBody
        }

        return try JSONDecoder.poolFocus.decode(ResponseBody.self, from: data)
    }
}

private struct EmptyResponse: Codable {}
