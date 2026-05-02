import Foundation
import Testing
@testable import PoolFocusCore

@Suite("Auth token storage")
struct AuthTokenStoreTests {
    @Test("Codable round-trip preserves all fields")
    func codableRoundTripPreservesAllFields() throws {
        let original = AuthSession(
            userIdentifier: "001234.abcdef.0001",
            identityToken: Data("eyJhbGciOi...payload...".utf8),
            email: "user@example.com",
            displayName: "Test User",
            signedInAt: Date(timeIntervalSince1970: 1_770_000_000)
        )

        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AuthSession.self, from: encoded)

        #expect(decoded == original)
    }

    @Test("Codable round-trip with nil optionals")
    func codableRoundTripWithOptionalsNil() throws {
        let original = AuthSession(
            userIdentifier: "id",
            identityToken: Data("token".utf8),
            email: nil,
            displayName: nil,
            signedInAt: Date(timeIntervalSince1970: 0)
        )
        let encoded = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(AuthSession.self, from: encoded)
        #expect(decoded == original)
        #expect(decoded.email == nil)
        #expect(decoded.displayName == nil)
    }

    @Test("In-memory store: save / load / clear")
    func inMemorySaveLoadClear() throws {
        let store = InMemoryAuthTokenStore()
        #expect(try store.load() == nil, "fresh store is empty")

        let session = AuthSession(
            userIdentifier: "u-1",
            identityToken: Data("t".utf8)
        )
        try store.save(session)
        #expect(try store.load() == session)

        let updated = AuthSession(
            userIdentifier: "u-2",
            identityToken: Data("t2".utf8),
            email: "x@y.z"
        )
        try store.save(updated)
        #expect(try store.load() == updated, "save overwrites previous session")

        try store.clear()
        #expect(try store.load() == nil, "clear removes the session")
    }

    @Test("In-memory store: seeded with initial value")
    func inMemorySeededWithInitial() throws {
        let seed = AuthSession(userIdentifier: "u", identityToken: Data())
        let store = InMemoryAuthTokenStore(initial: seed)
        #expect(try store.load() == seed)
    }
}
