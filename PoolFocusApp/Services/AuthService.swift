import AuthenticationServices
import Foundation
import SwiftUI

/// Holds the current `AuthSession` and mediates Sign in with Apple.
///
/// In demo builds (`PoolFocusRuntime.isDemoMode`), exposes a synthetic
/// "Continue as Demo" path that produces a deterministic AuthSession without
/// touching Apple's services — this keeps the gate testable in the simulator.
@MainActor
final class AuthService: ObservableObject {
    @Published private(set) var currentUser: AuthSession?
    @Published private(set) var lastError: String?

    private let store: AuthTokenStoring

    init(store: AuthTokenStoring? = nil) {
        self.store = store ?? KeychainAuthTokenStore()
        do {
            self.currentUser = try self.store.load()
        } catch {
            self.currentUser = nil
            self.lastError = "Could not read auth from Keychain: \(error.localizedDescription)"
        }

        // UI-test hooks. Honored in any build because they cost nothing at
        // runtime when the args are absent, and gate the only paths that need
        // exercising from outside the app.
        let args = CommandLine.arguments
        if args.contains("-poolfocus-reset-auth") {
            try? self.store.clear()
            self.currentUser = nil
        }
        if args.contains("-poolfocus-sign-in-demo") {
            self.signInDemo()
        }
    }

    /// Handle the result of an `ASAuthorization` from `SignInWithAppleButton`.
    func handleSignInWithApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .failure(let error):
            // User cancellation is a non-error from a UX standpoint.
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
            let session = AuthSession(
                userIdentifier: credential.user,
                identityToken: tokenData,
                email: credential.email,
                displayName: displayName
            )
            persist(session)
        }
    }

    /// Synthetic sign-in for demo / simulator builds. Lets us exercise the
    /// gate-flips-after-sign-in code path without going through Apple.
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
}
