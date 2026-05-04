import SwiftUI

@available(iOS 16.0, *)
struct RootTabView: View {
    @StateObject private var authorization = ScreenTimeAuthorizationService()
    @StateObject private var coordinator = ChallengeCoordinator()
    @StateObject private var auth = AuthService()
    private let appAttest: AppAttesting = AppAttestService()

    var body: some View {
        TabView {
            TodayView()
                .tabItem {
                    Label("Today", systemImage: "checkmark.circle")
                }

            PoolView()
                .tabItem {
                    Label("Pool", systemImage: "person.3")
                }

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "gearshape")
                }
        }
        .environmentObject(authorization)
        .environmentObject(coordinator)
        .environmentObject(auth)
        .tint(.indigo)
        .dynamicTypeSize(.small ... .xxLarge)
        .task {
            authorization.refresh()
            coordinator.refreshLocalState()
            await appAttest.bootstrap()
            await coordinator.syncPendingEvents()
        }
    }
}
