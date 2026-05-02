import SwiftUI

@available(iOS 16.0, *)
struct ProfileView: View {
    @EnvironmentObject private var authorization: ScreenTimeAuthorizationService
    @EnvironmentObject private var coordinator: ChallengeCoordinator
    @EnvironmentObject private var auth: AuthService
    @State private var isShowingPicker = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let user = auth.currentUser {
                        CardSection(title: "Account", systemImage: "person.crop.circle", tint: .indigo) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(user.displayName ?? user.email ?? "Apple ID")
                                    .font(.headline)
                                Text(user.userIdentifier)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            Button(role: .destructive) {
                                auth.signOut()
                            } label: {
                                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("signOutButton")
                        }
                    }

                    CardSection(title: "Access", systemImage: "shield", tint: .indigo) {
                        HStack {
                            Text("Screen Time")
                            Spacer()
                            StatusPill(text: authorization.status.displayText, tint: authorization.status.isApproved ? .green : .orange)
                        }
                        Button {
                            if PoolFocusRuntime.isDemoMode {
                                authorization.enableDemoAccess()
                            } else {
                                Task { await authorization.requestAuthorization() }
                            }
                        } label: {
                            Label(PoolFocusRuntime.isDemoMode ? "Use Demo Access" : "Request Access", systemImage: "lock.open")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }

                    CardSection(title: "Apps", systemImage: "hand.raised", tint: .cyan) {
                        HStack {
                            Text("Apps selected")
                            Spacer()
                            Text("\(coordinator.selectedAppCount)")
                                .fontWeight(.semibold)
                        }
                        if let hash = coordinator.selectionVersionHash {
                            Text("Selection \(hash.prefix(12))")
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                        }
                        Button {
                            isShowingPicker = true
                        } label: {
                            Label(PoolFocusRuntime.isDemoMode ? "Choose Demo Apps" : "Choose Apps", systemImage: "square.grid.2x2")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }

                    CardSection(title: "Sync", systemImage: "arrow.triangle.2.circlepath", tint: .green) {
                        HStack {
                            Text("Pending events")
                            Spacer()
                            Text("\(coordinator.pendingEventCount)")
                                .fontWeight(.semibold)
                        }
                        Button {
                            Task { await coordinator.syncPendingEvents() }
                        } label: {
                            Label("Sync Pending Events", systemImage: "icloud.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }

                    if PoolFocusRuntime.isDemoMode {
                        CardSection(title: "Demo mode", systemImage: "sparkles", tint: .orange) {
                            Text("This build simulates Screen Time access and app selection. It does not block real apps.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                            Button(role: .destructive) {
                                coordinator.resetDemoState()
                            } label: {
                                Label("Reset Demo Data", systemImage: "trash")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    if let message = coordinator.latestMessage {
                        MessageBanner(text: message)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 120)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $isShowingPicker, onDismiss: coordinator.refreshLocalState) {
                if PoolFocusRuntime.isDemoMode {
                    DemoAppSelectionView()
                } else {
                    AppSelectionView()
                }
            }
        }
    }
}
