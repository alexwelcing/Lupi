import Foundation
import LupiChem
import LupiData
import LupiGame
import struct LupiScaleCore.LeafNode
import RealityKit
import SwiftUI

/// A bundled molecule selected for inspection. Discovery describes the match,
/// while the preview always reads its actual geometry from the checked XYZ.
struct MoleculePreviewSelection: Identifiable {
    let id: String
    var recommendation: MoleculeRecommendation?
}

/// Camera-free inspection before choosing AR. This view never creates an
/// ARSession or calls AppModel.play; its presenter performs that handoff after dismissal.
struct MoleculePreviewView: View {
    let selection: MoleculePreviewSelection
    let onPlay: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var data: MoleculePreviewData?
    @State private var loadError: String?
    @State private var sceneID = UUID()
    @State private var playing = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let data {
                        Text(data.starter.name)
                            .font(.title2.weight(.bold))
                        Text("\(data.formula.subscriptedFormula) · \(data.atomCount) atoms")
                            .font(.headline)
                            .foregroundStyle(Color.lime)
                        if loadError == nil {
                            scene(data)
                            Button {
                                // Recreate the virtual camera, including its orbit state.
                                // Changing cameraTarget during an active orbit is unreliable.
                                sceneID = UUID()
                            } label: {
                                Label("Recenter", systemImage: "arrow.counterclockwise")
                            }
                            .buttonStyle(.bordered)
                            Text("Drag the molecule to look around it.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        provenance(data)
                        Button {
                            guard !playing else { return }
                            playing = true
                            onPlay(data.starter.id)
                            dismiss()
                        } label: {
                            Label("Play with \(data.starter.name)", systemImage: "arkit")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(playing || loadError != nil)
                        Text("Play opens your room. Lupi asks for camera access only when you choose it.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else if loadError == nil {
                        ProgressView("Loading bundled molecule…")
                            .frame(maxWidth: .infinity, minHeight: 260)
                    }
                    if let loadError {
                        Text(loadError)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(20)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(Color.sage.ignoresSafeArea())
            .navigationTitle("3D preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task(id: selection.id) { await load() }
        }
        .tint(Color.lime)
        .preferredColorScheme(.dark)
    }

    private func scene(_ data: MoleculePreviewData) -> some View {
        RealityView { content in
            // Apple's explicit non-AR camera: no permission or tracking session.
            content.camera = .virtual
            do {
                let assets = RenderAssets()
                let mesh = try assets.makeMesh(data.recipe.key, parts: data.parts)
                let model = ModelEntity(mesh: mesh, materials: PlayScene.materials(data.recipe, assets))
                // Metres are only a display convention here, not molecular life size.
                model.transform.scale = SIMD3<Float>(repeating: data.displayScale)
                content.add(model)
                content.cameraTarget = model
            } catch {
                loadError = "This bundled molecule could not be drawn. Close the preview and try again."
            }
        }
        .realityViewCameraControls(.orbit)
        .id(sceneID)
        .frame(height: 300)
        .background(Color.sageRaised)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement()
        .accessibilityLabel("3D model of \(data.starter.name), \(data.atomCount) atoms")
        .accessibilityHint("Drag to orbit. Recenter restores the starting view.")
    }

    private func provenance(_ data: MoleculePreviewData) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let recommendation = selection.recommendation {
                if recommendation.method == .jev {
                    Text("Suggested by Jev · \(recommendation.model ?? "") · inferred match")
                        .font(.footnote)
                    Text("The suggestion chooses a bundled molecule. These coordinates were not generated by Jev.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Exact name or formula · found offline")
                        .font(.footnote)
                }
            }
            Text("Bundled XYZ · available offline")
                .font(.footnote.weight(.semibold))
            Text(data.source)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("CPK atom colours. Bonds are estimated from distances with Lupi’s molecular bond recipe. AR motion is illustrative.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        let id = selection.id
        do {
            let found = try await Task.detached(priority: .userInitiated) {
                try MoleculePreviewData.load(id)
            }.value
            guard !Task.isCancelled else { return }
            data = found
            loadError = nil
        } catch {
            guard !Task.isCancelled else { return }
            loadError = "The bundled structure could not be loaded. Your other bundled starters are still available from Home."
        }
    }
}

/// File and chemistry work stays off the main actor; RealityKit receives finished triangles.
private struct MoleculePreviewData: Sendable {
    let starter: Starter
    let formula: String
    let atomCount: Int
    let recipe: MeshRecipe
    let parts: [MeshPart]
    let displayScale: Float

    var source: String {
        if let geometry = starter.geometry { return "Geometry: \(geometry)" }
        if let path = starter.lupiPath { return "Lupi gallery: \(path)" }
        return "Lupi bundled starter: \(starter.name)"
    }

    static func load(_ id: String) throws -> Self {
        guard let starter = try Starters.manifest().starters.first(where: { $0.id == id }) else {
            throw StarterError.missingResource(id)
        }
        // Starters.molecule checks the XYZ's SHA-256 before parsing it.
        let molecule = try Starters.molecule(starter)
        guard molecule.count > 0, molecule.count <= 2000,
              molecule.count == starter.atoms, molecule.hillFormula == starter.formula else {
            throw StarterError.integrity(starter.file)
        }
        let leaf = LeafNode(atomicNumbers: molecule.atomicNumbers.map { UInt8(clamping: $0) }, positions: molecule.positions)
        let recipe = MeshRecipe.of(leaf, centre: molecule.centroid, key: "preview-\(starter.sha256)")
        var radius: Float = 0
        for atom in recipe.atoms {
            let p = atom.position
            radius = max(radius, (p.x * p.x + p.y * p.y + p.z * p.z).squareRoot() + atom.radius)
        }
        return Self(
            starter: starter, formula: molecule.hillFormula, atomCount: molecule.count,
            recipe: recipe, parts: MeshBuilder.build(recipe), displayScale: 0.15 / max(radius, 0.01)
        )
    }
}
