import Foundation
import SwiftUI

/// Bundled attribution remains readable without a network request.
struct DataCreditsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            credits
                .navigationTitle("Data credits")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }

    private var credits: some View {
        Form {
            Section {
                Text("Where Lupi’s molecular data comes from, and how it is processed.")
            }
            Section {
                Text("OMol25 — Levine et al. (2025), arXiv:2505.08762. Selected coordinates from the ColabFit OMol25 neutral-validation dataset contribute to Lupi’s bundled molecule-recognition reference.")
                Text("Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0).")
                Text("Lupi derives atomic-number/connectivity graphs from selected coordinates; bonds and recognition are Lupi processing, not source topology.")
                Link(destination: URL(string: "https://arxiv.org/abs/2505.08762")!) {
                    Text("OMol25 paper")
                }
                Link(destination: URL(string: "https://huggingface.co/datasets/colabfit/OMol25_neutral_validation")!) {
                    Text("ColabFit OMol25 neutral-validation dataset")
                }
                Link(destination: URL(string: "https://creativecommons.org/licenses/by/4.0/")!) {
                    Text("Creative Commons Attribution 4.0 licence")
                }
            } header: {
                Text("OMol25")
            }
            Section {
                Text("PubChem, National Center for Biotechnology Information (NCBI), U.S. National Library of Medicine, National Institutes of Health (NIH). PubChem supplies molecular structures, compound identifiers and periodic-table radius values used by Lupi.")
                Text("Where available, the 3D preview retains the PubChem compound identifier (CID) with the molecule’s source information.")
                Link(destination: URL(string: "https://pubchem.ncbi.nlm.nih.gov/")!) {
                    Text("PubChem")
                }
                Link(destination: URL(string: "https://www.ncbi.nlm.nih.gov/home/about/policies/")!) {
                    Text("NCBI data and reuse policies")
                }
            } header: {
                Text("PubChem")
            }
            Section {
                Text("NIST Computational Chemistry Comparison and Benchmark Database, NIST Standard Reference Database Number 101, Release 22, May 2022. Editor: Russell D. Johnson III. DOI: 10.18434/T47C7Z.")
                Text("Lupi constructs the displayed hydrogen, carbon dioxide, methane and ammonia coordinates from selected experimental geometry values. Motion and inferred bonds are Lupi processing, not NIST simulation.")
                Link(destination: URL(string: "https://cccbdb.nist.gov/")!) {
                    Text("NIST CCCBDB")
                }
                Link(destination: URL(string: "https://doi.org/10.18434/T47C7Z")!) {
                    Text("NIST database citation")
                }
                Link(destination: URL(string: "https://www.nist.gov/open/license")!) {
                    Text("NIST data reuse policy")
                }
            } header: {
                Text("NIST experimental geometry")
            }
            Section {
                Text("Lupi constructs its C60 model as a regular truncated icosahedron with equal 1.42 Å edges. This is an illustrative geometric model, not an experimental conformer or an optimized structure.")
            } header: {
                Text("C60 geometric model")
            }
            Section {
                Text("Covalent-radius values follow Cordero et al., “Covalent radii revisited”, Dalton Transactions (2008), 2832–2838; with Pyykkö and Atsumi, “Molecular Single-Bond Covalent Radii for Elements 1–118”, Chemistry—A European Journal 15 (2009), 186–197, where needed.")
                Link(destination: URL(string: "https://doi.org/10.1039/B801115J")!) {
                    Text("Cordero et al. — covalent radii")
                }
                Link(destination: URL(string: "https://doi.org/10.1002/chem.200800987")!) {
                    Text("Pyykkö and Atsumi — single-bond covalent radii")
                }
            } header: {
                Text("Element radii")
            }
            Section {
                Text("Attribution does not imply endorsement of Lupi by the data providers or authors. Lupi’s room interactions are illustrative play, not chemical-reaction simulation or prediction of material behaviour.")
            }
        }
    }
}
