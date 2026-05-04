import AuthenticationServices
import Foundation
import SwiftUI

/// Talks to `/auth/apple` to exchange an Apple identity token for a backend
/// JWT. Pulled out so AuthService can be tested with a fake.
protocol BackendAuthExchanging: Sendable {
    func exchange(
        identityToken: Data,
        fullName: PersonNameComponents?,
        email: String?
    ) async throws -> BackendExchangeResult
}

struct BackendExchangeResult: Sendable {
    let token: String
    let expiresAt: Date
    let userId: String
}

/// Holds the current `AuthSession` and mediates Sign in with Apple.
///
/// Demo builds (`PoolFocusRuntime.isDemoMode`) get a synthetic
/// "Continue as Demo" path that produces a deterministic AuthSession without
/// touching Apple's services or the backend.
@MainActor
final class AuthService: ObservableObject {
    @Published private(set) var currentUser: AuthSession?
    @Published private(set) var lastError: String?

    private let store: AuthTokenStoring
    private let exchange: BackendAuthExchanging?

    init(
        store: AuthTokenStoring? = nil,
        exchange: BackendAuthExchanging? = HTTPBackendAuthExchanger()
    ) {
        self.store = store ?? KeychainAuthTokenStore()
        self.exchange = exchange
        do {
            self.currentUser = try self.store.load()
        } catch {
            self.currentUser = nil
            self.lastError = "Could not read auth from Keychain: \(error.localizedDescription)"
        }

        let args = CommandLine.arguments
        if args.contains("-poolfocus-reset-auth") {
            try? self.store.clear()
            self.currentUser = nil
        }
        if args.contains("-poolfocus-sign-in-demo") {
            self.signInDemo()
        }
    }

    /// Exposed for the API client: the backend JWT to attach as Bearer.
    /// Returns nil if we're signed out or the token has expired.
    func currentBackendToken() -> String? {
        guard let user = currentUser, user.hasFreshBackendToken else { return nil }
        return user.backendToken
    }

    /// Called by the API client when the backend rejects a JWT (401).
    /// Clears the backend token from Keychain so the gate flips back to
    /// Sign in with Apple, but keeps the Apple identity for context.
    func handleUnauthorized() {
        guard var user = currentUser else { return }
        user = user.clearingBackendToken()
        do {
            try store.save(user)
        } catch {
            lastError = "Could not clear backend token: \(error.localizedDescription)"
        }
        currentUser = user
    }

    func handleSignInWithApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let error):
            if let asError = error as? ASAuthorizationError, asError.code == .canceled {
                return
            }
            lastError = error.localizedDescription
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                lastError = "Sign in with Apple returned an unexpected credential."
                return
            }
            guard let tokenData = credential.identityToken else {
                lastError = "Sign in with Apple did not return an identity token."
                return
            }
            let displayName = credential.fullName.flatMap { name -> String? in
                let formatted = PersonNameComponentsFormatter().string(from: name)
                return formatted.isEmpty ? nil : formatted
            }
            let baseSession = AuthSession(
                userIdentifier: credential.user,
                identityToken: tokenData,
                email: credential.email,
                displayName: displayName
            )
            persist(baseSession)

            // Fire-and-forget the backend exchange so the UI flips immediately
            // and the JWT is filled in once it arrives.
            if let exchange {
                Task { [weak self] in
                    await self?.exchangeForBackendToken(
                        session: baseSession,
                        identityToken: tokenData,
                        fullName: credential.fullName,
                        email: credential.email,
                        exchange: exchange
                    )
                }
            }
        }
    }

    func signInDemo() {
        let session = AuthSession(
            userIdentifier: "demo.local.001",
            identityToken: Data("demo.identity.token".utf8),
            email: "demo@local.test",
            displayName: "Demo User"
        )
        persist(session)
    }

    func signOut() {
        do {
            try store.clear()
        } catch {
            lastError = "Could not clear Keychain: \(error.localizedDescription)"
        }
        currentUser = nil
    }

    private func persist(_ session: AuthSession) {
        do {
            try store.save(session)
            currentUser = session
            lastError = nil
        } catch {
            lastError = "Could not save auth to Keychain: \(error.localizedDescription)"
        }
    }

    private func exchangeForBackendToken(
        session: AuthSession,
        identityToken: Data,
        fullName: PersonNameComponents?,
        email: String?,
        exchange: BackendAuthExchanging
    ) async {
        do {
            let result = try await exchange.exchange(
                identityToken: identityToken,
                fullName: fullName,
                email: email
            )
            var updated = session
            updated.backendToken = result.token
            updated.backendTokenExpiresAt = result.expiresAt
            updated.backendUserId = result.userId
            persist(updated)
        } catch {
            lastError = "Backend sign-in failed: \(error.localizedDescription)"
        }
    }
}

/// Default `BackendAuthExchanging` impl: POSTs to `/auth/apple` on the
/// backend pointed at by `BackendBaseURL`. Returns the issued JWT + user id.
struct HTTPBackendAuthExchanger: BackendAuthExchanging {
    var baseURL: URL = BackendBaseURL.current
    var session: URLSession = .shared

    func exchange(
        identityToken: Data,
        fullName: PersonNameComponents?,
        email: String?
    ) async throws -> BackendExchangeResult {
        var body: [String: Any] = [
            "identityToken": String(data: identityToken, encoding: .utf8) ?? ""
        ]
        if let email { body["email"] = email }
        if let fullName {
            var name: [String: String] = [:]
            if let g = fullName.givenName, !g.isEmpty { name["givenName"] = g }
            if let f = fullName.familyName, !f.isEmpty { name["familyName"] = f }
            if !name.isEmpty { body["fullName"] = name }
        }
        var req = URLRequest(url: baseURL.appendingPathComponent("auth/apple"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, 200..<300 ~= http.statusCode else {
            throw URLError(.badServerResponse)
        }
        let decoded = try JSONDecoder().decode(AuthAppleResponse.self, from: data)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expiresAt = formatter.date(from: decoded.expiresAt)
            ?? ISO8601DateFormatter().date(from: decoded.expiresAt)
            ?? Date(timeIntervalSinceNow: 30 * 24 * 60 * 60)
        return BackendExchangeResult(
            token: decoded.token,
            expiresAt: expiresAt,
            userId: decoded.user.id
        )
    }
}

private struct AuthAppleResponse: Decodable {
    let token: String
    let expiresAt: String
    let user: AuthAppleUser
}
private struct AuthAppleUser: Decodable {
    let id: String
}

/// Where the real (non-demo) build points its API calls. Override at
/// build time via the `POOLFOCUS_BACKEND_URL` Info.plist key, or set
/// the env var of the same name in scheme settings for local dev.
enum BackendBaseURL {
    static var current: URL {
        if let s = Bundle.main.object(forInfoDictionaryKey: "POOLFOCUS_BACKEND_URL") as? String,
           let url = URL(string: s) { return url }
        if let s = ProcessInfo.processInfo.environment["POOLFOCUS_BACKEND_URL"],
           let url = URL(string: s) { return url }
        return URL(string: "http://localhost:8080")!
    }
}
