import Foundation

struct LocalChallengeEventStore {
    private let store: AppGroupStore

    init?(store: AppGroupStore? = AppGroupStore()) {
        guard let store else {
            return nil
        }
        self.store = store
    }

    func append(_ event: ScreenTimeEvent) {
        var events = pendingEvents()
        if events.contains(where: { $0.id == event.id }) {
            return
        }
        events.append(event)
        store.setCodable(events, forKey: PoolFocusConstants.localEventsKey)
    }

    func pendingEvents() -> [ScreenTimeEvent] {
        store.codable([ScreenTimeEvent].self, forKey: PoolFocusConstants.localEventsKey) ?? []
    }

    func remove(ids: Set<UUID>) {
        let remaining = pendingEvents().filter { !ids.contains($0.id) }
        store.setCodable(remaining, forKey: PoolFocusConstants.localEventsKey)
    }

    func recordHeartbeat(at date: Date = Date()) {
        store.set(date, forKey: PoolFocusConstants.heartbeatKey)
    }
}
