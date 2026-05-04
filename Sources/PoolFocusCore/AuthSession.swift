import Foundation

/// The minimum set of fields we persist after a successful Sign in with Apple.
///
/// `userIdentifier` is the stable Apple-issued ID that survives across launches;
/// `identityToken` is the JWT we'll forward to the backend in chunk 2.2 to mint
/// a session JWT. `email` and `displayName` are only delivered on the *first*
/// successful sign-in for a given Apple ID, so we capture them when we can.
public struct AuthSession: Codable, Equatable, Sendable {
    public let userIdentifier: String
    public let identityToken: Data
    public var email: String?
    public var displayName: String?
    public let signedInAt: Date
    /// Backend-issued JWT (HS256, 30-day TTL) returned by `/auth/apple`.
    /// Optional so older sessions stored before chunk 2.3 still decode.
    public var backendToken: String?
    public var backendTokenExpiresAt: Date?
    /// User UUID assigned by the backend on first sign-in.
    public var backendUserId: String?

    public init(
        userIdentifier: String,
        identityToken: Data,
        email: String? = nil,
        displayName: String? = nil,
        signedInAt: Date = Date(),
        backendToken: String? = nil,
        backendTokenExpiresAt: Date? = nil,
        backendUserId: String? = nil
    ) {
        self.userIdentifier = userIdentifier
        self.identityToken = identityToken
        self.email = email
        self.displayName = displayName
        self.signedInAt = signedInAt
        self.backendToken = backendToken
        self.backendTokenExpiresAt = backendTokenExpiresAt
        self.backendUserId = backendUserId
    }

    /// True when we have a backend JWT that is not yet expired.
    public var hasFreshBackendToken: Bool {
        guard let backendToken, !backendToken.isEmpty,
              let expiry = backendTokenExpiresAt else { return false }
        return expiry > Date()
    }

    /// Returns a copy of this session with the backend token field cleared.
    /// Used after a 401 to bounce back through Sign in with Apple.
    public func clearingBackendToken() -> AuthSession {
        var copy = self
        copy.backendToken = nil
        copy.backendTokenExpiresAt = nil
        return copy
    }
}

/// Storage abstraction for the auth session, so the Keychain-backed
/// implementation can live in the app while tests use an in-memory fake.
public protocol AuthTokenStoring {
    func load() throws -> AuthSession?
    func save(_ session: AuthSession) throws
    func clear() throws
}

/// In-memory store for unit tests and previews.
public final class InMemoryAuthTokenStore: AuthTokenStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var session: AuthSession?

    public init(initial: AuthSession? = nil) {
        self.session = initial
    }

    public func load() throws -> AuthSession? {
        lock.lock(); defer { lock.unlock() }
        return session
    }

    public func save(_ session: AuthSession) throws {
        lock.lock(); defer { lock.unlock() }
        self.session = session
    }

    public func clear() throws {
        lock.lock(); defer { lock.unlock() }
        session = nil
    }
}
