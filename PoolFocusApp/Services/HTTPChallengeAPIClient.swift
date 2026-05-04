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

    func submitEvent(_ request: ChallengeEventRequest, attest: AppAttesting?) async throws {
        // Encode the body once so the client and server hash identical bytes.
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
