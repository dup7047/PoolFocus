import Foundation

struct HTTPChallengeAPIClient: ChallengeAPIClient, Sendable {
    var baseURL: URL
    var session: URLSession = .shared
    /// Returns the current backend JWT, or nil if signed out / token expired.
    var tokenProvider: @Sendable () async -> String? = { nil }
    /// Called when any authenticated request returns 401, so the AuthService
    /// can clear the stored token and bounce the user to Sign in with Apple.
    var onUnauthorized: @Sendable () async -> Void = { }

    func submitReadiness(_ request: ChallengeReadinessRequest) async throws {
        let _: EmptyResponse = try await send(
            path: "/challenge/readiness",
            method: "POST",
            body: request
        )
    }

    func submitEvent(_ request: ChallengeEventRequest, attest: AppAttesting?) async throws {
        let bodyData = try JSONEncoder.poolFocus.encode(request)
        var headers: [String: String] = [:]
        if let attest, let signed = try await attest.generateAssertion(for: bodyData) {
            headers["X-AppAttest-KeyId"] = signed.keyId
            headers["X-AppAttest-Assertion"] = signed.data.base64EncodedString()
        }
        let _: EmptyResponse = try await sendRaw(
            path: "/challenge/events",
            method: "POST",
            bodyData: bodyData,
            extraHeaders: headers
        )
    }

    func submitEvent(_ request: ChallengeEventRequest) async throws {
        try await submitEvent(request, attest: nil)
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
        let bodyData = try body.flatMap { try JSONEncoder.poolFocus.encode($0) }
        return try await sendRaw(path: path, method: method, bodyData: bodyData, extraHeaders: [:])
    }

    private func sendRaw<ResponseBody: Decodable>(
        path: String,
        method: String,
        bodyData: Data?,
        extraHeaders: [String: String]
    ) async throws -> ResponseBody {
        var urlRequest = URLRequest(url: baseURL.appending(path: path))
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "accept")
        if let bodyData {
            urlRequest.httpBody = bodyData
            urlRequest.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        for (k, v) in extraHeaders { urlRequest.setValue(v, forHTTPHeaderField: k) }

        // Attach the backend JWT if we have one. The server enforces presence
        // for every protected route; missing token → 401 → onUnauthorized.
        if let token = await tokenProvider(), !token.isEmpty {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }

        if httpResponse.statusCode == 401 {
            await onUnauthorized()
            throw URLError(.userAuthenticationRequired)
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            throw URLError(.badServerResponse)
        }
        if data.isEmpty {
            return EmptyResponse() as! ResponseBody
        }
        return try JSONDecoder.poolFocus.decode(ResponseBody.self, from: data)
    }
}

private struct EmptyResponse: Codable {}
