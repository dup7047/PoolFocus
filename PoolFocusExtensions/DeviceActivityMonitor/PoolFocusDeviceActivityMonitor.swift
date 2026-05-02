import DeviceActivity
import Foundation
import ManagedSettings

final class PoolFocusDeviceActivityMonitor: DeviceActivityMonitor {
    private let managedSettingsStore = ManagedSettingsStore()

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        guard activity.rawValue == PoolFocusConstants.dailyActivityName else {
            return
        }

        if #available(iOS 16.0, *), let selectionStore = ScreenTimeSelectionStore() {
            let selection = selectionStore.loadSelection()
            managedSettingsStore.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
            LocalChallengeEventStore()?.recordHeartbeat()
        } else {
            recordEvent(type: .monitorUnavailable)
        }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        guard activity.rawValue == PoolFocusConstants.dailyActivityName else {
            return
        }

        managedSettingsStore.clearAllSettings()
        recordEvent(type: .challengeCompleted)
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        guard activity.rawValue == PoolFocusConstants.dailyActivityName,
              event.rawValue == PoolFocusConstants.appUsageEventName else {
            return
        }

        recordEvent(type: .monitorUnavailable)
    }

    private func recordEvent(type: ScreenTimeEventType) {
        guard let store = AppGroupStore(),
              let entryIDString = store.string(forKey: PoolFocusConstants.activeEntryIDKey),
              let entryID = UUID(uuidString: entryIDString) else {
            return
        }

        let event = ScreenTimeEvent(
            entryID: entryID,
            deviceID: DeviceIdentityStore()?.deviceIdentifier() ?? "unknown-device",
            type: type,
            selectionVersionHash: store.string(forKey: PoolFocusConstants.selectionVersionHashKey),
            clientOccurredAt: Date()
        )

        LocalChallengeEventStore(store: store)?.append(event)
    }
}
