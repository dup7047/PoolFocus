import AuthenticationServices
import SwiftUI

@available(iOS 16.0, *)
struct SignInGate: View {
    @EnvironmentObject private var auth: AuthService

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            ZStack {
                Circle()
                    .fill(Color.indigo.opacity(0.18))
                Image(systemName: "person.badge.shield.checkmark.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.indigo)
            }
            .frame(width: 76, height: 76)

            VStack(alignment: .leading, spacing: 8) {
                Text("Sign in to start a pool.")
                    .font(.largeTitle.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                Text("PoolFocus uses Sign in with Apple so your friends can find you in shared pools without us collecting passwords or extra profile info.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 12) {
                SignInWithAppleButton(.signIn,
                    onRequest: { request in
                        request.requestedScopes = [.fullName, .email]
                    },
                    onCompletion: { result in
                        auth.handleSignInWithApple(result)
                    }
                )
                .signInWithAppleButtonStyle(.black)
                .frame(height: 50)
                .accessibilityIdentifier("signInWithAppleButton")

                if PoolFocusRuntime.isDemoMode {
                    Button {
                        auth.signInDemo()
                    } label: {
                        Label("Continue as Demo User", systemImage: "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .accessibilityIdentifier("continueAsDemoButton")
                }
            }

            if let error = auth.lastError {
                MessageBanner(text: error)
            }
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}
