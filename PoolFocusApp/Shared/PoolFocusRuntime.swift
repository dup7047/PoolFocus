import Foundation

enum PoolFocusRuntime {
    static var isDemoMode: Bool {
        #if POOLFOCUS_DEMO || targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }

    static var demoModeLabel: String {
        #if targetEnvironment(simulator)
        return "Simulator demo"
        #else
        return "Demo access"
        #endif
    }
}
