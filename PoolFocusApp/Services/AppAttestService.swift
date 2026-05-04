import CryptoKit
import DeviceCheck
import Foundation

protocol AppAttesting: Sendable {
    /// Generate a key + attestation if we don't have one yet, then POST it to
    /// the backend. Idempotent and safe to call on every launch.
    func bootstrap() async
    /// Returns nil until 6.2 wires real assertions. Kept for compatibility
    /// with `ChallengeCoordinator` which already calls it on every event.
    func assertion(for payload: Data) async throws -> Data?
}

/// Default `AppAttesting` implementation. Talks to Apple's DeviceCheck framework
/// for real key generation + attestation; gracefully degrades on the simulator
/// (`DCAppAttestService.shared.isSupported` is false there) by skipping the
/// whole flow with a single log line.
final class AppAttestService: AppAttesting, @unchecked Sendable {
    private let baseURL: URL
    private let keyStore: AppAttestKeyStore
    private let attest: DCAppAttestService
    private let session: URLSession

    init(baseURL: URL = URL(string: "http://localhost:8080")!,
         keyStore: AppAttestKeyStore = AppAttestKeyStore(),
         attest: DCAppAttestService = .shared,
         session: URLSession = .shared) {
        self.baseURL = baseURL
        self.keyStore = keyStore
        self.attest = attest
        self.session = session
    }

    func bootstrap() async {
        // UI-test hook: pre-seed a fake keyId so we can prove the "key exists →
        // skip re-attestation" branch from outside the app.
        if CommandLine.arguments.contains("-poolfocus-seed-attest-key") {
            try? keyStore.save("test-seeded-key-1234567890")
        }
        if CommandLine.arguments.contains("-poolfocus-reset-attest-key") {
            try? keyStore.clear()
        }

        guard attest.isSupported else {
            #if DEBUG
            print("[AppAttest] skipped: DCAppAttestService.isSupported == false (simulator?).")
            #endif
            // Even on simulator, exercise the keystore-load branch so the
            // "second launch reuses the key" assertion is verifiable from CI.
            if let existing = try? keyStore.load() {
                #if DEBUG
                print("[AppAttest] (sim) keystore has keyId (\(existing.prefix(8))…) — would reuse on device.")
                #endif
            }
            return
        }

        do {
            if let existing = try keyStore.load() {
                #if DEBUG
                print("[AppAttest] reusing keyId from Keychain (\(existing.prefix(8))…).")
                #endif
                return
            }

            let challenge = try await fetchChallenge()
            let keyId = try await generateKey()
            let attestation = try await attestKey(keyId: keyId, challenge: challenge)
            try await postAttestation(keyId: keyId, attestation: attestation, challenge: challenge)
            try keyStore.save(keyId)

            #if DEBUG
            print("[AppAttest] registered new keyId (\(keyId.prefix(8))…).")
            #endif
        } catch {
            // App Attest is best-effort at the iOS layer in 6.1a — failure here
            // does not block the app. The backend will refuse unattested
            // requests once we wire enforcement in 6.2.
            #if DEBUG
            print("[AppAttest] bootstrap failed: \(error.localizedDescription)")
            #endif
        }
    }

    func assertion(for payload: Data) async throws -> Data? {
        // Real assertions land in 6.2.
        return nil
    }

    // MARK: - DeviceCheck wrappers

    private func generateKey() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            attest.generateKey { keyId, error in
                if let error = error { continuation.resume(throwing: error); return }
                guard let keyId else {
                    continuation.resume(throwing: AppAttestError.missingKeyId); return
                }
                continuation.resume(returning: keyId)
            }
        }
    }

    private func attestKey(keyId: String, challenge: String) async throws -> Data {
        let challengeData = Data(challenge.utf8)
        let clientDataHash = Data(SHA256.hash(data: challengeData))
        return try await withCheckedThrowingContinuation { continuation in
            attest.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
                if let error = error { continuation.resume(throwing: error); return }
                guard let attestation else {
                    continuation.resume(throwing: AppAttestError.missingAttestation); return
                }
                continuation.resume(returning: attestation)
            }
        }
    }

    // MARK: - Backend HTTP

    private func fetchChallenge() async throws -> String {
        let url = baseURL.appendingPathComponent("auth/attest/challenge")
        let (data, response) = try await session.data(from: url)
        try Self.expectStatus(response, 200)
        let payload = try JSONDecoder().decode(ChallengeResponse.self, from: data)
        return payload.challenge
    }

    private func postAttestation(keyId: String, attestation: Data, challenge: String) async throws {
        let url = baseURL.appendingPathComponent("auth/attest")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = AttestPostBody(
            keyId: keyId,
            attestation: attestation.base64EncodedString(),
            challenge: challenge
        )
        request.httpBody = try JSONEncoder().encode(body)
        let (_, response) = try await session.data(for: request)
        try Self.expectStatus(response, 200, 201)
    }

    private static func expectStatus(_ response: URLResponse, _ allowed: Int...) throws {
        guard let http = response as? HTTPURLResponse else {
            throw AppAttestError.networkError("non-HTTP response")
        }
        guard allowed.contains(http.statusCode) else {
            throw AppAttestError.networkError("HTTP \(http.statusCode)")
        }
    }
}

private struct ChallengeResponse: Decodable {
    let challenge: String
    let expiresAt: String
}

private struct AttestPostBody: Encodable {
    let keyId: String
    let attestation: String
    let challenge: String
}

enum AppAttestError: LocalizedError {
    case missingKeyId
    case missingAttestation
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .missingKeyId: return "App Attest did not return a keyId."
        case .missingAttestation: return "App Attest did not return an attestation."
        case .networkError(let why): return "App Attest network error: \(why)"
        }
    }
}
