import SwiftUI

@available(iOS 16.0, *)
struct TodayView: View {
    @EnvironmentObject private var authorization: ScreenTimeAuthorizationService
    @EnvironmentObject private var coordinator: ChallengeCoordinator
    @EnvironmentObject private var auth: AuthService
    @State private var isShowingPoolSetup = false
    @State private var isShowingAppPicker = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    switch stage {
                    case .signIn:
                        SignInGate()
                    case .welcome:
                        WelcomeCard(onCreate: { isShowingPoolSetup = true }, onJoin: { isShowingPoolSetup = true })
                    case .needsApps:
                        PickAppsCard(pool: coordinator.pool, onChoose: { isShowingAppPicker = true })
                    case .readyToCommit:
                        CommitmentCard(
                            pool: coordinator.pool,
                            selectedAppCount: coordinator.selectedAppCount,
                            selectionVersionHash: coordinator.selectionVersionHash,
                            onCommit: { Task { await coordinator.markReady() } }
                        )
                    case .waitingForStart:
                        ReadyWaitingCard(
                            pool: coordinator.pool,
                            selectedAppCount: coordinator.selectedAppCount,
                            onStart: { Task { await coordinator.startDemoChallenge() } }
                        )
                    case .active:
                        ActiveChallengeView()
                    case .forfeited:
                        ForfeitView(onContinue: coordinator.continueToNextDay)
                    case .results:
                        ResultsView(onContinue: coordinator.continueToNextDay)
                    }

                    NonCashFooter()
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 120)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Today")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        authorization.refresh()
                        coordinator.refreshLocalState()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh")
                }
            }
            .sheet(isPresented: $isShowingPoolSetup) {
                PoolSetupSheet()
            }
            .sheet(isPresented: $isShowingAppPicker, onDismiss: coordinator.refreshLocalState) {
                if PoolFocusRuntime.isDemoMode {
                    DemoAppSelectionView()
                } else {
                    AppSelectionView()
                }
            }
        }
    }

    private var stage: TodayStage {
        if auth.currentUser == nil {
            return .signIn
        }
        if coordinator.pool == nil {
            return .welcome
        }
        if coordinator.activeEntry.status == .forfeited {
            return .forfeited
        }
        if coordinator.activeEntry.status == .completed || !coordinator.lastResults.isEmpty {
            return .results
        }
        if coordinator.activeEntry.status == .active {
            return .active
        }
        if coordinator.selectedAppCount == 0 {
            return .needsApps
        }
        if coordinator.activeEntry.status == .ready {
            return .waitingForStart
        }
        return .readyToCommit
    }
}

@available(iOS 16.0, *)
private enum TodayStage {
    case signIn
    case welcome
    case needsApps
    case readyToCommit
    case waitingForStart
    case active
    case forfeited
    case results
}

@available(iOS 16.0, *)
private struct WelcomeCard: View {
    let onCreate: () -> Void
    let onJoin: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            ZStack {
                Circle()
                    .fill(Color.indigo.opacity(0.18))
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.indigo)
            }
            .frame(width: 76, height: 76)

            VStack(alignment: .leading, spacing: 8) {
                Text("Stay off the apps that pull you away.")
                    .font(.largeTitle.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                Text("Create a private pool with friends, choose the apps you want to avoid, and commit to today's non-cash focus challenge.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 10) {
                Button(action: onCreate) {
                    Label("Create Private Pool", systemImage: "person.3.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Button(action: onJoin) {
                    Label("Join with Code", systemImage: "number")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

@available(iOS 16.0, *)
private struct PoolSetupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var coordinator: ChallengeCoordinator
    @State private var poolName = "Focus Pool"
    @State private var inviteCode = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Create") {
                    TextField("Pool name", text: $poolName)
                    Button {
                        coordinator.createDemoPool(name: poolName)
                        dismiss()
                    } label: {
                        Label("Create Pool", systemImage: "plus.circle.fill")
                    }
                }

                Section("Join") {
                    TextField("Invite code", text: $inviteCode)
                        .textInputAutocapitalization(.characters)
                    Button {
                        coordinator.joinDemoPool(code: inviteCode)
                        dismiss()
                    } label: {
                        Label("Join Pool", systemImage: "arrow.right.circle.fill")
                    }
                    .disabled(inviteCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Section {
                    Text("Demo mode accepts any non-empty code and creates a private test pool with four friends.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Pool Setup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

@available(iOS 16.0, *)
private struct PickAppsCard: View {
    let pool: DemoPool?
    let onChoose: () -> Void

    var body: some View {
        CardSection(title: "Next step", systemImage: "square.grid.2x2", tint: .indigo) {
            Text("Pick the apps that pull you off track")
                .font(.title2.weight(.semibold))
            Text("Your friends will see your status and selected app count, not the app names you chose.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let pool {
                MemberStrip(pool: pool)
                    .padding(.vertical, 4)
            }

            Button(action: onChoose) {
                Label(PoolFocusRuntime.isDemoMode ? "Choose Demo Apps" : "Choose Apps", systemImage: "hand.raised.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }
}

@available(iOS 16.0, *)
private struct CommitmentCard: View {
    let pool: DemoPool?
    let selectedAppCount: Int
    let selectionVersionHash: String?
    let onCommit: () -> Void

    var body: some View {
        CardSection(title: "Commitment", systemImage: "checkmark.seal", tint: .green) {
            Text("Lock in for today")
                .font(.title2.weight(.semibold))
            Text("You are committing to a 1-minute demo focus block with your private pool.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            VStack(spacing: 10) {
                InfoRow(label: "Apps selected", value: "\(selectedAppCount)", systemImage: "app.badge")
                InfoRow(label: "Pool members", value: "\(pool?.memberCount ?? 0)", systemImage: "person.3")
                if let hash = selectionVersionHash {
                    InfoRow(label: "Selection", value: String(hash.prefix(10)), systemImage: "lock.doc")
                }
            }
            .padding(.vertical, 6)

            Button(action: onCommit) {
                Label("Lock In for Today", systemImage: "checkmark.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(.green)
        }
    }
}

@available(iOS 16.0, *)
private struct ReadyWaitingCard: View {
    let pool: DemoPool?
    let selectedAppCount: Int
    let onStart: () -> Void

    var body: some View {
        CardSection(title: "Ready", systemImage: "clock", tint: .cyan) {
            Text("You're locked in")
                .font(.title2.weight(.semibold))
            Text("Start the 1-minute demo challenge when you're ready. In the real app, this screen will count down to the scheduled pool window.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            InfoRow(label: "Private apps", value: "\(selectedAppCount)", systemImage: "eye.slash")
            if let pool {
                MemberStrip(pool: pool)
            }

            Button(action: onStart) {
                Label("Start 1-Minute Demo", systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(.cyan)
        }
    }
}

@available(iOS 16.0, *)
private struct ActiveChallengeView: View {
    @EnvironmentObject private var coordinator: ChallengeCoordinator

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let start = coordinator.challengeStart ?? context.date
            let end = coordinator.challengeEnd ?? context.date.addingTimeInterval(60)
            let total = max(1, end.timeIntervalSince(start))
            let remaining = max(0, end.timeIntervalSince(context.date))
            let remainingSeconds = Int(remaining.rounded(.up))
            let progress = min(1, max(0, 1 - remaining / total))

            VStack(spacing: 16) {
                CardSection(title: "Live challenge", systemImage: "timer", tint: .indigo) {
                    VStack(spacing: 16) {
                        ZStack {
                            FocusProgressRing(progress: progress)
                                .frame(width: 210, height: 210)
                            VStack(spacing: 4) {
                                Text(FocusTimeFormatter.remaining(from: context.date, until: end))
                                    .font(.system(size: 54, weight: .bold, design: .rounded))
                                Text("remaining")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .textCase(.uppercase)
                            }
                        }
                        .frame(maxWidth: .infinity)

                        Text("Stay off your selected apps. Your friends can see whether you're still in, not which apps you picked.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }

                MemberStatusCard(now: context.date)

                Button(role: .destructive) {
                    coordinator.forfeitSelf()
                } label: {
                    Label("I broke focus", systemImage: "flag.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
            .onChange(of: remainingSeconds) { newValue in
                if newValue <= 0 {
                    coordinator.finalizeDemoChallenge()
                }
            }
        }
    }
}

@available(iOS 16.0, *)
private struct ForfeitView: View {
    let onContinue: () -> Void

    var body: some View {
        CardSection(title: "Challenge ended", systemImage: "flag", tint: .orange) {
            Text("You're out for today")
                .font(.title2.weight(.semibold))
            Text("That happens. PoolFocus is here to make the commitment visible, not to pile on shame. Reset for tomorrow and try again with your pool.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: onContinue) {
                Label("Try Again Tomorrow", systemImage: "arrow.clockwise")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(.orange)
        }
    }
}

@available(iOS 16.0, *)
private struct ResultsView: View {
    @EnvironmentObject private var coordinator: ChallengeCoordinator
    let onContinue: () -> Void

    var body: some View {
        CardSection(title: "Results", systemImage: "trophy", tint: .green) {
            Text(resultHeadline)
                .font(.title2.weight(.semibold))
            Text("Streak: \(coordinator.streak)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.green)

            VStack(spacing: 10) {
                ForEach(coordinator.lastResults) { row in
                    LeaderboardRowView(row: row)
                }
            }
            .padding(.vertical, 6)

            Button(action: onContinue) {
                Label("Continue Tomorrow", systemImage: "sun.max.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(.green)
        }
    }

    private var resultHeadline: String {
        let winners = coordinator.lastResults.filter(\.isCoWinner)
        if winners.contains(where: { $0.entry.displayName == "You" }) {
            return "You made it through"
        }
        return "Today's pool is complete"
    }
}

@available(iOS 16.0, *)
private struct MemberStatusCard: View {
    @EnvironmentObject private var coordinator: ChallengeCoordinator
    let now: Date

    var body: some View {
        CardSection(title: "Pool progress", systemImage: "person.3", tint: .cyan) {
            VStack(spacing: 10) {
                ForEach(coordinator.pool?.members ?? []) { member in
                    MemberLiveRow(
                        member: member,
                        now: now,
                        challengeStart: coordinator.challengeStart,
                        challengeEnd: coordinator.challengeEnd
                    )
                }
            }
        }
    }
}

@available(iOS 16.0, *)
private struct MemberLiveRow: View {
    let member: DemoMember
    let now: Date
    let challengeStart: Date?
    let challengeEnd: Date?

    var body: some View {
        let status = member.liveStatus(now: now, challengeStart: challengeStart, challengeEnd: challengeEnd)
        HStack(spacing: 12) {
            MemberAvatar(initial: member.initial, tint: DemoAppPalette.memberTint(for: member.paletteIndex), size: 38, dimmed: status == .forfeited)
            VStack(alignment: .leading, spacing: 2) {
                Text(member.displayName)
                    .font(.subheadline.weight(.semibold))
                Text(detailText(status: status))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(text: status == .forfeited ? "Out" : status.displayLabel, tint: status.tint)
        }
    }

    private func detailText(status: ChallengeEntryStatus) -> String {
        if status == .forfeited, let forfeit = member.resolvedForfeitDate(challengeEnd: challengeEnd), let start = challengeStart {
            let elapsed = max(0, Int(forfeit.timeIntervalSince(start)))
            return "Out at \(elapsed / 60):\(String(format: "%02d", elapsed % 60))"
        }
        return member.isMe ? "You" : "Private apps hidden"
    }
}

@available(iOS 16.0, *)
private struct LeaderboardRowView: View {
    let row: LeaderboardRow

    var body: some View {
        HStack(spacing: 12) {
            Text("#\(row.rank ?? 1)")
                .font(.headline.monospacedDigit())
                .frame(width: 34, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.entry.displayName)
                    .font(.subheadline.weight(.semibold))
                Text(row.isCoWinner ? "Co-winner" : row.entry.status.displayLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            StatusPill(text: "\(row.entry.pointsAwarded) pts", tint: row.isCoWinner ? .green : .gray)
        }
        .padding(12)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

@available(iOS 16.0, *)
private struct FocusProgressRing: View {
    let progress: Double

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.secondary.opacity(0.16), lineWidth: 18)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    AngularGradient(colors: [.indigo, .cyan, .green], center: .center),
                    style: StrokeStyle(lineWidth: 18, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
        }
    }
}

@available(iOS 16.0, *)
private struct InfoRow: View {
    let label: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(.secondary)
                .frame(width: 22)
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.semibold)
        }
        .font(.subheadline)
    }
}

@available(iOS 16.0, *)
private struct MemberStrip: View {
    let pool: DemoPool

    var body: some View {
        HStack(spacing: -8) {
            ForEach(pool.members.prefix(5)) { member in
                MemberAvatar(initial: member.initial, tint: DemoAppPalette.memberTint(for: member.paletteIndex), size: 34)
                    .overlay(Circle().stroke(Color(.secondarySystemGroupedBackground), lineWidth: 2))
            }
            Spacer()
            Text("\(pool.memberCount) members")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
    }
}
