import FamilyControls
import SwiftUI

@available(iOS 16.0, *)
struct AppSelectionView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selection: FamilyActivitySelection
    @State private var message: String?

    private let selectionStore = ScreenTimeSelectionStore()

    init() {
        let store = ScreenTimeSelectionStore()
        _selection = State(initialValue: store?.loadSelection() ?? FamilyActivitySelection())
    }

    var body: some View {
        NavigationStack {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("Choose Apps")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            dismiss()
                        }
                    }

                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            saveSelection()
                        }
                    }
                }
                .safeAreaInset(edge: .bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Selected app identities stay on this device.")
                            .font(.footnote.weight(.medium))
                        Text("Friends and the backend receive only a selection version hash.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        if let message {
                            Text(message)
                                .font(.caption)
                                .foregroundStyle(.red)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .background(.thinMaterial)
                }
        }
    }

    private func saveSelection() {
        guard let selectionStore else {
            message = "App Group storage is unavailable."
            return
        }

        do {
            _ = try selectionStore.save(selection: selection)
            dismiss()
        } catch {
            message = error.localizedDescription
        }
    }
}
