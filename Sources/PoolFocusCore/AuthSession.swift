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

    public init(
        userIdentifier: String,
        identityToken: Data,
        email: String? = nil,
        displayName: String? = nil,
        signedInAt: Date = Date()
    ) {
        self.userIdentifier = userIdentifier
        self.identityToken = identityToken
        self.email = email
        self.displayName = displayName
        self.signedInAt = signedInAt
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
