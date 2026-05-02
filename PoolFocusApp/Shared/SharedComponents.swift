import FamilyControls
import SwiftUI

// MARK: - Card chrome

@available(iOS 16.0, *)
struct CardSection<Content: View>: View {
    let title: String
    let systemImage: String
    let tint: Color
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(tint)
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                    .kerning(0.6)
            }

            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

@available(iOS 16.0, *)
struct StatusPill: View {
    let text: String
    let tint: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(tint.opacity(0.15), in: Capsule())
            .lineLimit(1)
    }
}

@available(iOS 16.0, *)
struct MessageBanner: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle")
                .foregroundStyle(.blue)
            Text(text)
                .font(.footnote)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

@available(iOS 16.0, *)
struct NonCashFooter: View {
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "leaf")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.green)
            Text(PoolFocusCopy.noMoneyMVPNotice)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer()
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
    }
}

// MARK: - Member avatar

@available(iOS 16.0, *)
struct MemberAvatar: View {
    let initial: String
    let tint: Color
    let size: CGFloat
    var dimmed: Bool = false

    var body: some View {
        ZStack {
            Circle()
                .fill(tint.gradient)
                .opacity(dimmed ? 0.45 : 1.0)
            Text(initial)
                .font(.system(size: size * 0.42, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Demo brand palette

enum DemoAppPalette {
    static func tint(for id: String) -> Color {
        switch id {
        case "instagram": return .pink
        case "tiktok": return .cyan
        case "youtube": return .red
        case "reddit": return .orange
        case "safari": return .blue
        case "games": return .green
        default: return .indigo
        }
    }

    static let memberPalette: [Color] = [.indigo, .pink, .teal, .orange, .purple, .blue, .green]

    static func memberTint(for index: Int) -> Color {
        memberPalette[abs(index) % memberPalette.count]
    }
}

// MARK: - Status display

extension ChallengeEntryStatus {
    var displayLabel: String {
        switch self {
        case .pendingConfig: return "Setup"
        case .ready: return "Ready"
        case .active: return "In focus"
        case .forfeited: return "Out"
        case .completed: return "Completed"
        case .invalid: return "Invalid"
        }
    }

    var tint: Color {
        switch self {
        case .pendingConfig: return .gray
        case .ready: return .blue
        case .active: return .indigo
        case .forfeited: return .orange
        case .completed: return .green
        case .invalid: return .red
        }
    }
}

@available(iOS 16.0, *)
extension AuthorizationStatus {
    var isApproved: Bool {
        if PoolFocusRuntime.isDemoMode {
            return true
        }

        switch self {
        case .approved, .approvedWithDataAccess:
            return true
        case .notDetermined, .denied:
            return false
        @unknown default:
            return false
        }
    }

    var displayText: String {
        if PoolFocusRuntime.isDemoMode {
            return PoolFocusRuntime.demoModeLabel
        }

        switch self {
        case .notDetermined: return "Not requested"
        case .denied: return "Denied"
        case .approved: return "Approved"
        case .approvedWithDataAccess: return "Approved"
        @unknown default: return "Unknown"
        }
    }
}

// MARK: - Time formatting

enum FocusTimeFormatter {
    static func remaining(from now: Date, until end: Date) -> String {
        let interval = max(0, Int(end.timeIntervalSince(now).rounded()))
        let minutes = interval / 60
        let seconds = interval % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    static func clock(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
