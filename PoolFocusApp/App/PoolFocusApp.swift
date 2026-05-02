import SwiftUI

@main
struct PoolFocusApp: App {
    var body: some Scene {
        WindowGroup {
            if #available(iOS 16.0, *) {
                RootTabView()
            } else {
                UnsupportedVersionView()
            }
        }
    }
}

struct UnsupportedVersionView: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "iphone.slash")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(.red)
            Text("PoolFocus requires iOS 16 or later.")
                .font(.headline)
            Text("Screen Time individual authorization is required for the accountability challenge.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}
