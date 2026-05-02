import FamilyControls
import Foundation

@available(iOS 16.0, *)
@MainActor
final class ScreenTimeAuthorizationService: ObservableObject {
    @Published private(set) var status: AuthorizationStatus
    @Published var latestErrorMessage: String?

    init() {
        self.status = AuthorizationCenter.shared.authorizationStatus
    }

    func refresh() {
        status = AuthorizationCenter.shared.authorizationStatus
    }

    func requestAuthorization() async {
        if PoolFocusRuntime.isDemoMode {
            enableDemoAccess()
            return
        }

        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            status = AuthorizationCenter.shared.authorizationStatus
            latestErrorMessage = nil
        } catch {
            status = AuthorizationCenter.shared.authorizationStatus
            latestErrorMessage = error.localizedDescription
        }
    }

    func enableDemoAccess() {
        if PoolFocusRuntime.isDemoMode {
            latestErrorMessage = nil
            return
        }

        refresh()
    }

    func enableSimulatorDemoAccess() {
        if PoolFocusRuntime.isDemoMode {
            latestErrorMessage = nil
            return
        }

        refresh()
    }
}
