import Foundation

struct DeviceIdentityStore {
    private let store: AppGroupStore

    init?(store: AppGroupStore? = AppGroupStore()) {
        guard let store else {
            return nil
        }
        self.store = store
    }

    func deviceIdentifier() -> String {
        if let existing = store.string(forKey: PoolFocusConstants.defaultDeviceIdentifierKey) {
            return existing
        }

        let created = UUID().uuidString
        store.set(created, forKey: PoolFocusConstants.defaultDeviceIdentifierKey)
        return created
    }
}
