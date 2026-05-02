import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

@available(iOS 16.0, *)
@MainActor
final class ChallengeCoordinator: ObservableObject {
    @Published private(set) var selectedAppCount: Int = 0
    @Published private(set) var selectionVersionHash: String?
    @Published private(set) var activeEntry: ChallengeEntry
    @Published private(set) var pendingEventCount: Int = 0
    @Published var latestMessage: String?

    @Published private(set) var pool: DemoPool?
    @Published private(set) var streak: Int = 0
    @Published private(set) var lastResults: [LeaderboardRow] = []
    @Published private(set) var challengeStart: Date?
    @Published private(set) var challengeEnd: Date?

    private let selectionStore: ScreenTimeSelectionStore?
    private let eventStore: LocalChallengeEventStore?
    private let deviceStore: DeviceIdentityStore?
    private let poolStore: DemoPoolStore?
    private let groupStore: AppGroupStore?
    private let center = DeviceActivityCenter()
    private let apiClient: ChallengeAPIClient
    private let appAttest: AppAttesting

    init(
        apiClient: ChallengeAPIClient = DevelopmentChallengeAPIClient(),
        appAttest: AppAttesting = AppAttestService()
    ) {
        self.selectionStore = ScreenTimeSelectionStore()
        self.eventStore = LocalChallengeEventStore()
        self.deviceStore = DeviceIdentityStore()
        self.poolStore = DemoPoolStore()
        self.groupStore = AppGroupStore()
        self.apiClient = apiClient
        self.appAttest = appAttest
        self.activeEntry = ChallengeEntry(
            userID: UUID(),
            displayName: "You",
            status: .pendingConfig
        )
        refreshLocalState()
    }

    // MARK: - State refresh

    func refreshLocalState() {
        if PoolFocusRuntime.isDemoMode {
            let demoStore = DemoAppSelectionStore()
            selectedAppCount = demoStore?.selectedCount() ?? 0
            selectionVersionHash = demoStore?.selectionVersionHash()
        } else {
            selectedAppCount = selectionStore?.appCount() ?? 0
            selectionVersionHash = selectionStore?.selectionVersionHash()
        }

        pendingEventCount = eventStore?.pendingEvents().count ?? 0
        pool = poolStore?.loadPool()
        streak = poolStore?.loadStreak() ?? 0

        challengeStart = groupStore?.date(forKey: PoolFocusConstants.activeChallengeStartKey)
        challengeEnd = groupStore?.date(forKey: PoolFocusConstants.activeChallengeEndKey)

        if PoolFocusRuntime.isDemoMode, let pool, let me = pool.me {
            alignActiveEntry(with: me)
        }
    }


    private func alignActiveEntry(with member: DemoMember) {
        activeEntry.id = member.id
        activeEntry.userID = member.id
        activeEntry.displayName = member.displayName
    }

    // MARK: - Pool management (demo)

    func createDemoPool(name: String) {
        guard PoolFocusRuntime.isDemoMode, let poolStore else { return }
        let pool = DemoPool.makeSeeded(name: name.isEmpty ? "Focus Pool" : name)
        poolStore.savePool(pool)
        self.pool = pool
        if let me = pool.me {
            alignActiveEntry(with: me)
        }
        latestMessage = nil
    }

    func joinDemoPool(code: String) {
        guard PoolFocusRuntime.isDemoMode, let poolStore else { return }
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        var pool = DemoPool.makeSeeded(name: "\(trimmed) Pool")
        pool.inviteCode = trimmed.isEmpty ? DemoPool.randomCode() : trimmed
        poolStore.savePool(pool)
        self.pool = pool
        if let me = pool.me {
            alignActiveEntry(with: me)
        }
        latestMessage = nil
    }

    func resetDemoState() {
        guard let poolStore else { return }
        poolStore.reset()
        activeEntry.status = .pendingConfig
        activeEntry.selectionVersionHash = nil
        lastResults = []
        challengeStart = nil
        challengeEnd = nil
        latestMessage = nil
        refreshLocalState()
    }

    // MARK: - Readiness + start

    func markReady() async {
        guard let selectionVersionHash, selectedAppCount > 0 else {
            latestMessage = "Pick at least one app first."
            return
        }

        activeEntry.status = .ready
        activeEntry.selectionVersionHash = selectionVersionHash

        if PoolFocusRuntime.isDemoMode {
            return
        }

        let request = ChallengeReadinessRequest(
            poolID: pool?.id ?? UUID(),
            challengeDayID: UUID(),
            deviceID: deviceStore?.deviceIdentifier() ?? "unknown-device",
            selectionVersionHash: selectionVersionHash,
            appAttestAssertion: nil
        )

        do {
            try await apiClient.submitReadiness(request)
        } catch {
            latestMessage = "Readiness saved locally. Sync failed: \(error.localizedDescription)"
        }
    }

    func startDemoChallenge(minutes: Int = 1) async {
        if PoolFocusRuntime.isDemoMode {
            let now = Date()
            let end = Calendar.current.date(byAdding: .minute, value: minutes, to: now) ?? now.addingTimeInterval(60)
            activeEntry.status = .active
            activeEntry.selectionVersionHash = selectionVersionHash ?? "demo-selection"
            persistActiveChallenge(start: now, end: end)
            challengeStart = now
            challengeEnd = end
            scheduleSyntheticFriendForfeits(start: now, end: end)
            lastResults = []
            return
        }

        guard let selectionStore else {
            latestMessage = "App Group storage is not available."
            return
        }

        let selection = selectionStore.loadSelection()
        guard !selection.applicationTokens.isEmpty else {
            latestMessage = "Select at least one app first."
            return
        }

        do {
            let now = Date()
            let end = Calendar.current.date(byAdding: .minute, value: minutes, to: now) ?? now.addingTimeInterval(60)
            try scheduleChallenge(from: now, to: end, selection: selection)
            activeEntry.status = .active
            activeEntry.selectionVersionHash = selectionVersionHash
            persistActiveChallenge(start: now, end: end)
            challengeStart = now
            challengeEnd = end
        } catch {
            latestMessage = "Could not start challenge: \(error.localizedDescription)"
        }
    }

    // MARK: - Forfeit + finalize (demo)

    func forfeitSelf() {
        guard PoolFocusRuntime.isDemoMode else { return }
        guard var pool, let meIndex = pool.members.firstIndex(where: { $0.isMe }) else { return }

        let now = Date()
        pool.members[meIndex].actualForfeitAt = now
        poolStore?.savePool(pool)
        self.pool = pool

        activeEntry.status = .forfeited
        activeEntry.forfeitedAt = now

        let event = ScreenTimeEvent(
            entryID: pool.members[meIndex].id,
            deviceID: deviceStore?.deviceIdentifier() ?? "demo-device",
            type: .shieldUnlock,
            selectionVersionHash: selectionVersionHash,
            clientOccurredAt: now,
            receivedAt: now
        )
        eventStore?.append(event)
        pendingEventCount = eventStore?.pendingEvents().count ?? pendingEventCount
    }

    func finalizeDemoChallenge() {
        guard PoolFocusRuntime.isDemoMode else { return }
        guard activeEntry.status == .active else { return }
        guard let pool, let challengeStart, let challengeEnd else { return }

        let now = Date()
        guard now >= challengeEnd else { return }

        let entries: [ChallengeEntry] = pool.members.map { member in
            let forfeit = member.resolvedForfeitDate(challengeEnd: challengeEnd)
            let initialStatus: ChallengeEntryStatus = forfeit != nil ? .forfeited : .active

            return ChallengeEntry(
                id: member.id,
                userID: member.id,
                displayName: member.displayName,
                status: initialStatus,
                selectionVersionHash: selectionVersionHash,
                forfeitedAt: forfeit
            )
        }

        let finalized = ChallengeScoring.finalizeEntries(
            entries: entries,
            events: [],
            challengeStart: challengeStart,
            challengeEnd: challengeEnd,
            finalizedAt: now
        )

        let scored = ChallengeScoring.awardPoints(
            entries: finalized,
            challengeStart: challengeStart,
            challengeEnd: challengeEnd
        )

        let rows = ChallengeScoring.leaderboard(
            entries: scored,
            challengeStart: challengeStart,
            challengeEnd: challengeEnd
        )

        lastResults = rows

        if let myRow = rows.first(where: { row in pool.me?.id == row.entry.id }) {
            if myRow.entry.status == .completed {
                activeEntry.status = .completed
                activeEntry.completedAt = challengeEnd
                streak += 1
                poolStore?.saveStreak(streak)
            } else if myRow.entry.status == .forfeited {
                activeEntry.status = .forfeited
                activeEntry.forfeitedAt = myRow.entry.forfeitedAt
                streak = 0
                poolStore?.saveStreak(0)
            }
        }
    }

    func continueToNextDay() {
        guard PoolFocusRuntime.isDemoMode else { return }
        guard var pool else { return }

        for index in pool.members.indices {
            pool.members[index].scheduledForfeitAt = nil
            pool.members[index].actualForfeitAt = nil
        }
        poolStore?.savePool(pool)
        self.pool = pool

        activeEntry.status = .pendingConfig
        activeEntry.forfeitedAt = nil
        activeEntry.completedAt = nil
        challengeStart = nil
        challengeEnd = nil
        lastResults = []

        groupStore?.set(nil as Date?, forKey: PoolFocusConstants.activeChallengeStartKey)
        groupStore?.set(nil as Date?, forKey: PoolFocusConstants.activeChallengeEndKey)
    }

    // MARK: - Sync

    func syncPendingEvents() async {
        guard let eventStore else {
            latestMessage = "App Group storage is not available."
            return
        }

        let events = eventStore.pendingEvents()
        guard !events.isEmpty else {
            return
        }

        var syncedIDs = Set<UUID>()
        for event in events {
            do {
                let payload = try JSONEncoder.poolFocus.encode(event)
                let assertion = try await appAttest.assertion(for: payload)
                try await apiClient.submitEvent(ChallengeEventRequest(event: event, appAttestAssertion: assertion))
                syncedIDs.insert(event.id)
            } catch {
                latestMessage = "Event sync paused: \(error.localizedDescription)"
                break
            }
        }

        eventStore.remove(ids: syncedIDs)
        refreshLocalState()
        if !syncedIDs.isEmpty {
            latestMessage = "Synced \(syncedIDs.count) event(s)."
        }
    }

    // MARK: - Demo: synthetic friend forfeits

    private func scheduleSyntheticFriendForfeits(start: Date, end: Date) {
        guard var pool else { return }

        let duration = end.timeIntervalSince(start)
        let friendIndices = pool.members.indices.filter { !pool.members[$0].isMe }

        for index in friendIndices {
            pool.members[index].scheduledForfeitAt = nil
            pool.members[index].actualForfeitAt = nil
        }

        // 1..2 random friend forfeits during the challenge window so the demo visibly changes.
        let forfeitCount = friendIndices.isEmpty ? 0 : Int.random(in: 1...min(2, friendIndices.count))
        let chosen = friendIndices.shuffled().prefix(forfeitCount)

        for index in chosen {
            let offset = TimeInterval.random(in: max(3, duration * 0.15)...max(4, duration * 0.85))
            pool.members[index].scheduledForfeitAt = start.addingTimeInterval(offset)
        }

        poolStore?.savePool(pool)
        self.pool = pool
    }

    // MARK: - Real Screen Time (untouched)

    private func scheduleChallenge(
        from startDate: Date,
        to endDate: Date,
        selection: FamilyActivitySelection
    ) throws {
        let schedule = DeviceActivitySchedule(
            intervalStart: Calendar.current.dateComponents([.hour, .minute, .second], from: startDate),
            intervalEnd: Calendar.current.dateComponents([.hour, .minute, .second], from: endDate),
            repeats: false
        )

        let usageEvent = DeviceActivityEvent(
            applications: selection.applicationTokens,
            threshold: DateComponents(minute: 1)
        )

        try center.startMonitoring(
            DeviceActivityName(PoolFocusConstants.dailyActivityName),
            during: schedule,
            events: [
                DeviceActivityEvent.Name(PoolFocusConstants.appUsageEventName): usageEvent
            ]
        )
    }

    private func persistActiveChallenge(start: Date, end: Date) {
        guard let groupStore else { return }
        groupStore.set(activeEntry.id.uuidString, forKey: PoolFocusConstants.activeEntryIDKey)
        groupStore.set(start, forKey: PoolFocusConstants.activeChallengeStartKey)
        groupStore.set(end, forKey: PoolFocusConstants.activeChallengeEndKey)
    }
}
