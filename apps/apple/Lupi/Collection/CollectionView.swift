import LupiData
import LupiGame
import SwiftUI

/// The collection (plan §3.2's Cabinet, §6.4 step 5): every trophy, whatever happened to its
/// shelf, each one tap from coming back into play. Works without the camera and signed out.
struct CollectionView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var renaming: TrophyRecord?
    @State private var newName = ""

    var body: some View {
        let collection = app.collection
        NavigationStack {
            List {
                if collection.trophies.isEmpty {
                    Section {
                        Text("Nothing kept yet. Hold a molecule and tap Keep, or leave one on a shelf for three seconds.")
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    ForEach(collection.trophies) { trophy in
                        Button {
                            // Spawned once this sheet has closed.
                            app.chosenTrophy = trophy
                            dismiss()
                        } label: {
                            TrophyRow(trophy: trophy, room: collection.room(of: trophy.id), plaque: { await app.plaque(of: $0) })
                        }
                        .buttonStyle(.plain)
                        .swipeActions {
                            Button("Delete", role: .destructive) { Task { await collection.delete(trophy.id) } }
                            Button("Rename") {
                                newName = trophy.name
                                renaming = trophy
                            }
                        }
                        .accessibilityHint("Brings it into play")
                    }
                } header: {
                    if !collection.trophies.isEmpty { Text("\(collection.trophies.count) kept") }
                }
                if !collection.rooms.isEmpty {
                    Section {
                        ForEach(collection.rooms) { room in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(room.name)
                                    Text(room.placements.count == 1 ? "1 trophy on its shelf" : "\(room.placements.count) trophies on its shelves")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if collection.shelves.lastUsed == room.id {
                                    Text("Opens next")
                                        .font(.caption)
                                        .foregroundStyle(Color.lime)
                                }
                            }
                            .swipeActions {
                                Button("Delete", role: .destructive) { collection.deleteRoom(room.id) }
                                Button("Open next") { collection.openNext(room.id) }
                            }
                        }
                    } header: {
                        Text("Rooms")
                    } footer: {
                        Text("A room remembers where its trophies sit. Rooms, their maps and their photos stay on this device.")
                    }
                }
                if collection.accountsEnabled {
                    Section {
                        LabeledContent("Account", value: accountLine(collection.status))
                    }
                }
                if let notice = collection.notice {
                    Section {
                        Text(notice).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Collection")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .refreshable { await collection.sync() }
            .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("Name", text: $newName)
                Button("Save") {
                    if let trophy = renaming { Task { await collection.rename(trophy.id, to: newName) } }
                    renaming = nil
                }
                Button("Cancel", role: .cancel) { renaming = nil }
            }
            .task { await collection.refresh() }
        }
    }

    private func accountLine(_ status: AccountStatus) -> String {
        switch status {
        case .unavailable: "Not configured"
        case .signedOut: "Signed out: kept on this device"
        case .signedIn: "Signed in: syncing"
        case .deletionPending: "Deletion unfinished"
        }
    }
}

/// One trophy: its name, formula, exact count and origin story (contracts.md §1.3).
struct TrophyRow: View {
    let trophy: TrophyRecord
    let room: String?
    /// Its personality's reason (plan §8 M4), read once it is on screen.
    let plaque: @MainActor (TrophyRecord) async -> TrophyPlaque?
    @State private var reason: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(swatch)
                .frame(width: 28, height: 28)
                .overlay(Circle().strokeBorder(.white.opacity(0.25)))
            VStack(alignment: .leading, spacing: 3) {
                Text(trophy.name)
                    .font(.headline)
                Text(trophy.molecule.source == .scale ? trophy.molecule.formula : trophy.molecule.formula.subscriptedFormula)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.lime)
                Text("\(trophy.molecule.scale?.count ?? String(trophy.molecule.atoms)) atoms")
                    .font(.footnote.monospacedDigit())
                if let reason {
                    Text(reason)
                        .font(.footnote)
                }
                Text(room.map { "\(trophy.story()) · on a shelf in \($0)" } ?? trophy.story())
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .task(id: trophy.updatedAt) { reason = await plaque(trophy)?.reasons.first }
    }

    /// The piece's colour when the record has one, else the lime accent.
    private var swatch: Color {
        guard let hex = trophy.molecule.scale?.aggregate?.colour, hex.count == 7, let v = Int(hex.dropFirst(), radix: 16) else {
            return Color.lime
        }
        return Color(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }
}
