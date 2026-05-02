import CryptoKit
import FamilyControls
import Foundation

@available(iOS 16.0, *)
struct ScreenTimeSelectionStore {
    private let store: AppGroupStore

    init?(store: AppGroupStore? = AppGroupStore()) {
        guard let store else {
            return nil
        }
        self.store = store
    }

    func loadSelection() -> FamilyActivitySelection {
        guard let data = store.data(forKey: PoolFocusConstants.currentSelectionKey),
              let selection = try? JSONDecoder.poolFocus.decode(FamilyActivitySelection.self, from: data) else {
            return FamilyActivitySelection()
        }

        return selection
    }

    func save(selection: FamilyActivitySelection) throws -> String {
        let data = try JSONEncoder.poolFocus.encode(selection)
        let hash = Self.hash(data)
        store.set(data, forKey: PoolFocusConstants.currentSelectionKey)
        store.set(hash, forKey: PoolFocusConstants.selectionVersionHashKey)
        return hash
    }

    func selectionVersionHash() -> String? {
        store.string(forKey: PoolFocusConstants.selectionVersionHashKey)
    }

    func appCount() -> Int {
        loadSelection().applicationTokens.count
    }

    private static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
