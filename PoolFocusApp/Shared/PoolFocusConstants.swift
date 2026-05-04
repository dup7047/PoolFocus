import Foundation

enum PoolFocusConstants {
    static let appGroupIdentifier = "group.com.dantino.PoolFocus"
    static let defaultDeviceIdentifierKey = "defaultDeviceIdentifier"
    static let currentSelectionKey = "currentFamilyActivitySelection"
    static let selectionVersionHashKey = "selectionVersionHash"
    static let localEventsKey = "localScreenTimeEvents"
    static let activeEntryIDKey = "activeChallengeEntryID"
    static let activeChallengeStartKey = "activeChallengeStart"
    static let activeChallengeEndKey = "activeChallengeEnd"
    static let heartbeatKey = "latestHeartbeat"
    static let simulatorDemoAppCountKey = "simulatorDemoAppCount"
    static let demoSelectedAppIDsKey = "demoSelectedAppIDs"
    static let demoPoolKey = "demoPool"
    static let demoStreakKey = "demoStreak"
    static let demoLastResultsKey = "demoLastResults"
    static let demoMigrationCompletedKey = "demoMigrationCompleted"
    static let demoMigrationChoiceKey = "demoMigrationChoice"

    static let dailyActivityName = "daily-focus-challenge"
    static let appUsageEventName = "selected-app-usage"
}

enum PoolFocusCopy {
    static let appName = "PoolFocus"
    static let noMoneyMVPNotice = "MVP uses points and streaks only. No stakes, pots, or payouts."
}
