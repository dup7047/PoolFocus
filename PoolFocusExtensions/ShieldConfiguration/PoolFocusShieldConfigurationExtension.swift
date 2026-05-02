import ManagedSettings
import ManagedSettingsUI
import UIKit

final class PoolFocusShieldConfigurationExtension: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        ShieldConfiguration(
            backgroundBlurStyle: .systemUltraThinMaterial,
            backgroundColor: UIColor.systemBackground,
            icon: UIImage(systemName: "checkmark.shield"),
            title: ShieldConfiguration.Label(
                text: "Stay in the pool",
                color: UIColor.label
            ),
            subtitle: ShieldConfiguration.Label(
                text: "Opening this app will forfeit today's non-cash challenge.",
                color: UIColor.secondaryLabel
            ),
            primaryButtonLabel: ShieldConfiguration.Label(
                text: "Stay focused",
                color: UIColor.white
            ),
            primaryButtonBackgroundColor: UIColor.systemGreen,
            secondaryButtonLabel: ShieldConfiguration.Label(
                text: "Forfeit and open",
                color: UIColor.systemRed
            )
        )
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        configuration(shielding: application)
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        ShieldConfiguration()
    }

    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        ShieldConfiguration()
    }
}
