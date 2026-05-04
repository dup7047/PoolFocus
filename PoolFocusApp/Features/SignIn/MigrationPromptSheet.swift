import SwiftUI

@available(iOS 16.0, *)
struct MigrationPromptSheet: View {
    @EnvironmentObject private var migration: DemoMigrationCoordinator
    @EnvironmentObject private var auth: AuthService
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let snapshot = migration.currentSnapshot()
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    ZStack {
                        Circle()
                            .fill(Color.indigo.opacity(0.18))
                        Image(systemName: "arrow.right.arrow.left.circle.fill")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(.indigo)
                    }
                    .frame(width: 64, height: 64)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Bring your demo pool over?")
                            .font(.title2.weight(.bold))
                        Text("You've been trying things out in demo mode. We can carry your pool name, streak, and selected apps over to your real account — your demo friends won't come along.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let snapshot {
                        VStack(spacing: 8) {
                            SummaryRow(label: "Pool name", value: snapshot.poolName, systemImage: "person.3")
                            SummaryRow(label: "Streak", value: "\(snapshot.streak) day\(snapshot.streak == 1 ? "" : "s")", systemImage: "flame.fill")
                            SummaryRow(label: "Apps selected", value: "\(snapshot.selectedAppCount)", systemImage: "app.badge")
                        }
                        .padding(14)
                        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }

                    VStack(spacing: 10) {
                        Button {
                            migration.bringOver(signedInDisplayName: auth.currentUser?.displayName)
                            dismiss()
                        } label: {
                            Label("Bring my pool over", systemImage: "checkmark.circle.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .accessibilityIdentifier("migrationBringOverButton")

                        Button(role: .destructive) {
                            migration.startFresh()
                            dismiss()
                        } label: {
                            Label("Start fresh", systemImage: "trash")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .accessibilityIdentifier("migrationStartFreshButton")
                    }

                    Text("Demo friends are simulated and never carry over to a real pool.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Migrate from demo")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(true)
        }
    }
}

@available(iOS 16.0, *)
private struct SummaryRow: View {
    let label: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(.secondary)
                .frame(width: 22)
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.semibold)
        }
        .font(.subheadline)
    }
}
