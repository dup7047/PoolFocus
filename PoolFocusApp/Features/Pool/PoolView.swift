import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@available(iOS 16.0, *)
struct PoolView: View {
    @EnvironmentObject private var coordinator: ChallengeCoordinator
    @State private var copiedCode = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let pool = coordinator.pool {
                        poolHeader(pool)
                        members(pool)
                        historyStrip
                    } else {
                        emptyPool
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 120)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Pool")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var emptyPool: some View {
        CardSection(title: "Private pool", systemImage: "person.3", tint: .indigo) {
            Text("No pool yet")
                .font(.title2.weight(.semibold))
            Text("Create or join a pool from Today to start a private challenge with friends.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private func poolHeader(_ pool: DemoPool) -> some View {
        CardSection(title: "Friend group", systemImage: "person.3.fill", tint: .cyan) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(pool.name)
                        .font(.title2.weight(.bold))
                    Text("\(pool.memberCount) members · private accountability")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            Button {
                #if canImport(UIKit)
                UIPasteboard.general.string = pool.inviteCode
                #endif
                copiedCode = true
            } label: {
                HStack {
                    Image(systemName: copiedCode ? "checkmark" : "doc.on.doc")
                    Text(copiedCode ? "Copied \(pool.inviteCode)" : "Copy Invite Code \(pool.inviteCode)")
                    Spacer()
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
    }

    private func members(_ pool: DemoPool) -> some View {
        CardSection(title: "Members", systemImage: "list.bullet", tint: .green) {
            VStack(spacing: 12) {
                ForEach(pool.members) { member in
                    HStack(spacing: 12) {
                        MemberAvatar(initial: member.initial, tint: DemoAppPalette.memberTint(for: member.paletteIndex), size: 42)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.displayName)
                                .font(.subheadline.weight(.semibold))
                            Text(member.isMe ? "You" : "Apps hidden")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        StatusPill(text: member.isMe ? coordinator.activeEntry.status.displayLabel : "Ready", tint: member.isMe ? coordinator.activeEntry.status.tint : .blue)
                    }
                }
            }
        }
    }

    private var historyStrip: some View {
        CardSection(title: "Last 7 days", systemImage: "calendar", tint: .indigo) {
            HStack(spacing: 8) {
                ForEach(0..<7, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(index < max(1, coordinator.streak) ? Color.green.opacity(0.85) : Color.secondary.opacity(0.18))
                        .frame(height: 34)
                }
            }
            Text("Demo history is synthetic until the backend stores completed challenge days.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
