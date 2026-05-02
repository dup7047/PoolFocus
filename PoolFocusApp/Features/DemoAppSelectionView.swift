import SwiftUI

@available(iOS 16.0, *)
struct DemoAppSelectionView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedIDs: Set<String>
    @State private var message: String?

    private let store = DemoAppSelectionStore()

    init() {
        let store = DemoAppSelectionStore()
        _selectedIDs = State(initialValue: store?.selectedIDs() ?? [])
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    headerCard

                    appList

                    if let message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

                    Text("This list simulates Apple's Screen Time picker for product testing. It does not inspect or block real apps on your phone.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                        .padding(.top, 4)
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Choose Demo Apps")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .fontWeight(.semibold)
                        .disabled(selectedIDs.isEmpty)
                }
            }
        }
        .tint(.indigo)
    }

    // MARK: - Sections

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.indigo.opacity(0.18))
                    Image(systemName: "hand.raised.fill")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(Color.indigo)
                }
                .frame(width: 48, height: 48)

                VStack(alignment: .leading, spacing: 3) {
                    Text("Apps to avoid")
                        .font(.headline)
                    Text(countLabel)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }

            HStack(spacing: 10) {
                Button {
                    selectAll()
                } label: {
                    Label("Select All", systemImage: "checkmark.circle")
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(.indigo)
                .disabled(selectedIDs.count == DemoAppSelectionStore.options.count)

                Button {
                    selectedIDs.removeAll()
                } label: {
                    Label("Clear", systemImage: "xmark.circle")
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(.gray)
                .disabled(selectedIDs.isEmpty)

                Spacer()
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var appList: some View {
        VStack(spacing: 0) {
            ForEach(Array(DemoAppSelectionStore.options.enumerated()), id: \.element.id) { index, app in
                Button {
                    toggle(app.id)
                } label: {
                    rowContent(for: app)
                }
                .buttonStyle(.plain)

                if index < DemoAppSelectionStore.options.count - 1 {
                    Divider()
                        .padding(.leading, 76)
                }
            }
        }
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func rowContent(for app: DemoAppOption) -> some View {
        let isSelected = selectedIDs.contains(app.id)
        let tint = DemoAppPalette.tint(for: app.id)

        return HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(tint.gradient)
                Image(systemName: app.systemImage)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 44, height: 44)
            .shadow(color: tint.opacity(0.25), radius: 3, x: 0, y: 1)

            VStack(alignment: .leading, spacing: 2) {
                Text(app.name)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(app.category)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            ZStack {
                Circle()
                    .stroke(isSelected ? Color.indigo : Color.secondary.opacity(0.35), lineWidth: 1.5)
                    .frame(width: 24, height: 24)
                if isSelected {
                    Circle()
                        .fill(Color.indigo)
                        .frame(width: 24, height: 24)
                    Image(systemName: "checkmark")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    private var countLabel: String {
        switch selectedIDs.count {
        case 0: return "None selected"
        case 1: return "1 app selected"
        default: return "\(selectedIDs.count) apps selected"
        }
    }

    // MARK: - Actions

    private func toggle(_ id: String) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }

    private func selectAll() {
        selectedIDs = Set(DemoAppSelectionStore.options.map(\.id))
    }

    private func save() {
        guard let store else {
            message = "Demo storage is unavailable."
            return
        }

        _ = store.save(selectedIDs: selectedIDs)
        dismiss()
    }
}
