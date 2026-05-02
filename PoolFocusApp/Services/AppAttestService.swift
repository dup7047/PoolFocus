import DeviceCheck
import Foundation

protocol AppAttesting: Sendable {
    func assertion(for payload: Data) async throws -> Data?
}

struct AppAttestService: AppAttesting, Sendable {
    func assertion(for payload: Data) async throws -> Data? {
        guard DCAppAttestService.shared.isSupported else {
            return nil
        }

        // Production flow:
        // 1. Generate and register a key with the backend.
        // 2. Ask the backend for a challenge.
        // 3. Call generateAssertion(_:clientDataHash:) and send it with the event.
        // This scaffold returns nil until backend key registration exists.
        return nil
    }
}
