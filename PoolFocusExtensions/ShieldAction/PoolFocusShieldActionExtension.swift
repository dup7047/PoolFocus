import Foundation
import ManagedSettings

final class PoolFocusShieldActionExtension: ShieldActionDelegate {
    override func handle(
        action: ShieldAction,
        for application: ApplicationToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        switch action {
        case .primaryButtonPressed:
            completionHandler(.close)
        case .secondaryButtonPressed:
            recordForfeit()
            completionHandler(.defer)
        default:
            completionHandler(.close)
        }
    }

    override func handle(
        action: ShieldAction,
        for webDomain: WebDomainToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        completionHandler(.close)
    }

    override func handle(
        action: ShieldAction,
        for category: ActivityCategoryToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        completionHandler(.close)
    }

    private func recordForfeit() {
        guard let store = AppGroupStore(),
              let entryIDString = store.string(forKey: PoolFocusConstants.activeEntryIDKey),
              let entryID = UUID(uuidString: entryIDString) else {
            return
        }

        let event = ScreenTimeEvent(
            entryID: entryID,
            deviceID: DeviceIdentityStore()?.deviceIdentifier() ?? "unknown-device",
            type: .shieldUnlock,
            selectionVersionHash: store.string(forKey: PoolFocusConstants.selectionVersionHashKey),
            clientOccurredAt: Date()
        )

        LocalChallengeEventStore(store: store)?.append(event)
    }
}
