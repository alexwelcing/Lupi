import LupiData
import LupiGame
import SwiftUI

/// Find by everyday description, then choose Play. No camera, account or key is
/// needed for discovery; the bundled name/formula search also works offline.
struct DiscoveryView: View {
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var result: MoleculeRecommendation?
    @State private var message: String?
    @State private var searching = false
    @State private var requestTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Describe a molecule")
                        .font(.system(size: 28, weight: .bold))
                    Text("Try “a hollow carbon cage” or “the molecule in coffee”. Search 12 familiar molecules, then put one in your room.")
                        .foregroundStyle(.secondary)
                    TextField("A molecule name, formula or description", text: $query)
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.sage, lineWidth: 1))
                        .accessibilityLabel("Molecule description")
                        .onChange(of: query) { _, _ in cancelSearch() }
                    Button("Find molecule") { find() }
                        .buttonStyle(.borderedProminent)
                        .disabled(searching || query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || query.utf16.count > 200)
                    if query.utf16.count > 200 { Text("Use up to 200 characters.").font(.caption) }
                    if searching { ProgressView("Finding a catalogue match…") }
                    if let candidate = result?.candidate {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(candidate.name).font(.title2.weight(.bold))
                            Text("\(candidate.formula.subscriptedFormula) · \(candidate.atoms) atoms")
                            Text(candidate.description)
                            if result?.method == .jev {
                                Text("Suggested by Jev · \(result?.model ?? "") · inferred match")
                                    .font(.caption).foregroundStyle(.secondary)
                                Text("The match is a suggestion. The molecule below is a bundled structure; AR motion is illustrative.")
                                    .font(.caption).foregroundStyle(.secondary)
                            } else {
                                Text("Exact name or formula · available offline")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Button("Play with \(candidate.name)") {
                                onSelect(candidate.id)
                                dismiss()
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                    if let message { Text(message).foregroundStyle(.secondary) }
                    Text("Exact names and formulas work offline. Descriptions are sent to Lupi and Jev when you tap Find. Camera images stay on your device.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(20)
            }
            .navigationTitle("Find a molecule")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .onDisappear { requestTask?.cancel() }
        }
    }

    private func cancelSearch() {
        requestTask?.cancel()
        requestTask = nil
        searching = false
        result = nil
        message = nil
    }

    private func find() {
        requestTask?.cancel()
        searching = true
        result = nil
        message = nil
        let text = query
        requestTask = Task { @MainActor in
            do {
                let catalog = try DiscoveryCatalog.bundled()
                let answer = try await MoleculeDiscoveryClient(catalog: catalog).recommend(text)
                guard !Task.isCancelled else { return }
                result = answer
                if answer.candidate == nil { message = answer.note }
            } catch {
                guard !Task.isCancelled else { return }
                message = "Description search is unavailable. Try an exact name or formula, such as caffeine or H2O. Your bundled starters are ready to play."
            }
            searching = false
        }
    }
}
