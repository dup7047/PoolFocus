import CryptoKit
import Foundation

struct DemoAppOption: Identifiable, Hashable {
    let id: String
    let name: String
    let category: String
    let systemImage: String
}

struct DemoAppSelectionStore {
    static let options: [DemoAppOption] = [
        DemoAppOption(id: "instagram", name: "Instagram", category: "Social", systemImage: "camera"),
        DemoAppOption(id: "tiktok", name: "TikTok", category: "Entertainment", systemImage: "music.note"),
        DemoAppOption(id: "youtube", name: "YouTube", category: "Video", systemImage: "play.rectangle"),
        DemoAppOption(id: "reddit", name: "Reddit", category: "Community", systemImage: "text.bubble"),
        DemoAppOption(id: "safari", name: "Safari", category: "Browser", systemImage: "safari"),
        DemoAppOption(id: "games", name: "Games", category: "Entertainment", systemImage: "gamecontroller")
    ]

    private let store: AppGroupStore

    init?(store: AppGroupStore? = AppGroupStore()) {
        guard let store else {
            return nil
        }
        self.store = store
    }

    func selectedIDs() -> Set<String> {
        Set(store.codable([String].self, forKey: PoolFocusConstants.demoSelectedAppIDsKey) ?? [])
    }

    func selectedCount() -> Int {
        selectedIDs().count
    }

    func selectionVersionHash() -> String? {
        store.string(forKey: PoolFocusConstants.selectionVersionHashKey)
    }

    @discardableResult
    func save(selectedIDs: Set<String>) -> String {
        let sortedIDs = selectedIDs.sorted()
        let hash = Self.hash(sortedIDs.joined(separator: ","))

        store.setCodable(sortedIDs, forKey: PoolFocusConstants.demoSelectedAppIDsKey)
        store.set(sortedIDs.count, forKey: PoolFocusConstants.simulatorDemoAppCountKey)
        store.set(hash, forKey: PoolFocusConstants.selectionVersionHashKey)

        return hash
    }

    private static func hash(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
