import Foundation

struct DemoPoolStore {
    private let store: AppGroupStore

    init?(store: AppGroupStore? = AppGroupStore()) {
        guard let store else { return nil }
        self.store = store
    }

    func loadPool() -> DemoPool? {
        store.codable(DemoPool.self, forKey: PoolFocusConstants.demoPoolKey)
    }

    func savePool(_ pool: DemoPool?) {
        store.setCodable(pool, forKey: PoolFocusConstants.demoPoolKey)
    }

    func loadStreak() -> Int {
        store.integer(forKey: PoolFocusConstants.demoStreakKey)
    }

    func saveStreak(_ value: Int) {
        store.set(value, forKey: PoolFocusConstants.demoStreakKey)
    }

    func reset() {
        store.set(nil as Data?, forKey: PoolFocusConstants.demoPoolKey)
        store.set(nil as Data?, forKey: PoolFocusConstants.demoSelectedAppIDsKey)
        store.set(nil as Data?, forKey: PoolFocusConstants.demoLastResultsKey)
        store.set(0, forKey: PoolFocusConstants.demoStreakKey)
        store.set(0, forKey: PoolFocusConstants.simulatorDemoAppCountKey)
        store.set(nil as String?, forKey: PoolFocusConstants.selectionVersionHashKey)
        store.set(nil as Date?, forKey: PoolFocusConstants.activeChallengeStartKey)
        store.set(nil as Date?, forKey: PoolFocusConstants.activeChallengeEndKey)
        store.set(nil as String?, forKey: PoolFocusConstants.activeEntryIDKey)
    }
}
