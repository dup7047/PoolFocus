// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PoolFocus",
    platforms: [
        .iOS(.v16),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "PoolFocusCore",
            targets: ["PoolFocusCore"]
        )
    ],
    targets: [
        .target(
            name: "PoolFocusCore"
        ),
        .testTarget(
            name: "PoolFocusCoreTests",
            dependencies: ["PoolFocusCore"]
        )
    ]
)
