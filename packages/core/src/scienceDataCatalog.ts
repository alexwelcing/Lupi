/**
 * Small, provenance-first catalog of externally hosted atomistic research
 * files. Only metadata lives in this repository; payloads remain in immutable,
 * versioned Zenodo records and are fetched when a user chooses one.
 */

export type ResearchRepresentation = 'atomic' | 'coarse-grained';

export interface ResearchTypeDefinition {
  label: string;
  atomicNumber?: number;
  pseudo?: true;
}

export interface ExternalResearchDataset {
  id: string;
  title: string;
  summary: string;
  domain: string;
  format: 'lammps-dump' | 'lammps-data';
  sequenceKind: 'trajectory' | 'snapshot';
  representation: ResearchRepresentation;
  atomCount: number;
  frameCount: number;
  elements: string[];
  typeMap: Record<string, ResearchTypeDefinition>;
  remote: {
    provider: 'zenodo';
    recordId: string;
    fileKey: string;
    url: string;
    bytes: number;
    checksum: {
      /** Digest Lupi verifies over the fetched bytes before serving them. */
      algorithm: 'sha256';
      value: string;
      /** Checksum published by the versioned Zenodo record. */
      sourceMd5: string;
    };
    verifiedAt: string;
  };
  provenance: {
    sourceUrl: string;
    doi: string;
    citation: string;
    license: 'CC-BY-4.0';
    licenseUrl: string;
  };
  parser: {
    status: 'drop-in' | 'needs-type-map' | 'approximate-render';
    warning: string;
  };
  sourceTruth: {
    coordinates: 'source';
    bondTopology: 'source-when-present' | 'not-provided';
  };
}

const CC_BY_4_URL = 'https://creativecommons.org/licenses/by/4.0/';

export const EXTERNAL_RESEARCH_DATASETS: readonly ExternalResearchDataset[] = [
  {
    id: 'pyrophosphate-mg-hydrolysis-md',
    title: 'Mg-pyrophosphate hydrolysis MD',
    summary: 'Neural-network-potential trajectory of solvated MgP2O7 hydrolysis.',
    domain: 'aqueous reaction dynamics',
    format: 'lammps-dump',
    sequenceKind: 'trajectory',
    representation: 'atomic',
    atomCount: 518,
    frameCount: 201,
    elements: ['H', 'O', 'Mg', 'P'],
    typeMap: {
      '1': { label: 'H', atomicNumber: 1 },
      '2': { label: 'O', atomicNumber: 8 },
      '3': { label: 'Mg', atomicNumber: 12 },
      '4': { label: 'P', atomicNumber: 15 },
    },
    remote: {
      provider: 'zenodo',
      recordId: '18044294',
      fileKey: 'r_ppmg.lammpstrj',
      url: 'https://zenodo.org/api/records/18044294/files/r_ppmg.lammpstrj/content',
      bytes: 3_461_655,
      checksum: {
        algorithm: 'sha256',
        value: 'ed847e0304bf652324e31780c10954975ee9b0e32155860be31b8d0001457e96',
        sourceMd5: '2af811c29608677fc682564ae84f06ac',
      },
      verifiedAt: '2026-07-20',
    },
    provenance: {
      sourceUrl: 'https://zenodo.org/records/18044294',
      doi: '10.5281/zenodo.18044294',
      citation: 'García-Martínez, Laage, and Tuñón, Mg-pyrophosphate hydrolysis molecular-dynamics data.',
      license: 'CC-BY-4.0',
      licenseUrl: CC_BY_4_URL,
    },
    parser: {
      status: 'needs-type-map',
      warning: 'LAMMPS numeric type IDs are mapped from the companion source input; they are not atomic numbers.',
    },
    sourceTruth: { coordinates: 'source', bondTopology: 'not-provided' },
  },
  {
    id: 'plga-semicrystalline-400k-cg',
    title: 'Semi-crystalline PLGA at 400 K',
    summary: 'Thermalized 90-chain coarse-grained PLGA configuration with ellipsoidal lactide and glycolide beads.',
    domain: 'polymer coarse-graining',
    format: 'lammps-dump',
    sequenceKind: 'snapshot',
    representation: 'coarse-grained',
    atomCount: 4_320,
    frameCount: 1,
    elements: [],
    typeMap: {
      '1': { label: 'LA bead', pseudo: true },
      '2': { label: 'GA bead', pseudo: true },
    },
    remote: {
      provider: 'zenodo',
      recordId: '13905472',
      fileKey: 'plga_cryst_400K.dump',
      url: 'https://zenodo.org/api/records/13905472/files/plga_cryst_400K.dump/content',
      bytes: 682_394,
      checksum: {
        algorithm: 'sha256',
        value: 'e3ba701d5bf1bea0a7dae7fa08c8252c4009364c9e71c8e5aa74af3257bae022',
        sourceMd5: 'd08c4a080130485b07b98ed3b17107bc',
      },
      verifiedAt: '2026-07-20',
    },
    provenance: {
      sourceUrl: 'https://zenodo.org/records/13905472',
      doi: '10.5281/zenodo.13905472',
      citation: 'Bellussi et al., coarse-grained semi-crystalline PLGA molecular configurations.',
      license: 'CC-BY-4.0',
      licenseUrl: CC_BY_4_URL,
    },
    parser: {
      status: 'approximate-render',
      warning: 'Source particles are anisotropic ellipsoids with quaternion orientation and three diameters. Lupi currently renders their centers as spherical coarse-grained beads; orientation and ellipsoid shape are not yet visualized, and atomic bond inference stays disabled.',
    },
    sourceTruth: { coordinates: 'source', bondTopology: 'not-provided' },
  },
  {
    id: 'plga-amorphous-400k-cg',
    title: 'Amorphous PLGA at 400 K',
    summary: 'Paired amorphous coarse-grained PLGA configuration for comparison with the semi-crystalline state.',
    domain: 'polymer coarse-graining',
    format: 'lammps-dump',
    sequenceKind: 'snapshot',
    representation: 'coarse-grained',
    atomCount: 4_320,
    frameCount: 1,
    elements: [],
    typeMap: {
      '1': { label: 'LA bead', pseudo: true },
      '2': { label: 'GA bead', pseudo: true },
    },
    remote: {
      provider: 'zenodo',
      recordId: '13905472',
      fileKey: 'plga_amorph_400K.dump',
      url: 'https://zenodo.org/api/records/13905472/files/plga_amorph_400K.dump/content',
      bytes: 682_716,
      checksum: {
        algorithm: 'sha256',
        value: '1c97e4b4f8d7cb5fde40a7e1ca4ebc3e495f8743d0f55062ac498809d4badc38',
        sourceMd5: '8129af0f68b51b9a09b5110ef91d4a31',
      },
      verifiedAt: '2026-07-20',
    },
    provenance: {
      sourceUrl: 'https://zenodo.org/records/13905472',
      doi: '10.5281/zenodo.13905472',
      citation: 'Bellussi et al., coarse-grained amorphous PLGA molecular configurations.',
      license: 'CC-BY-4.0',
      licenseUrl: CC_BY_4_URL,
    },
    parser: {
      status: 'approximate-render',
      warning: 'Source particles are anisotropic ellipsoids with quaternion orientation and three diameters. Lupi currently renders their centers as spherical coarse-grained beads; orientation and ellipsoid shape are not yet visualized, and atomic bond inference stays disabled.',
    },
    sourceTruth: { coordinates: 'source', bondTopology: 'not-provided' },
  },
  {
    id: 'sodium-triflate-wise-nonpolarizable',
    title: 'Sodium triflate water-in-salt electrolyte',
    summary: 'Non-polarizable 333 K starting configuration for an aqueous sodium-triflate electrolyte.',
    domain: 'electrolyte molecular dynamics',
    format: 'lammps-data',
    sequenceKind: 'snapshot',
    representation: 'atomic',
    atomCount: 2_160,
    frameCount: 1,
    elements: ['C', 'F', 'S', 'O', 'Na', 'H'],
    typeMap: {
      '1': { label: 'C', atomicNumber: 6 },
      '2': { label: 'F', atomicNumber: 9 },
      '3': { label: 'F', atomicNumber: 9 },
      '4': { label: 'F', atomicNumber: 9 },
      '5': { label: 'S', atomicNumber: 16 },
      '6': { label: 'O', atomicNumber: 8 },
      '7': { label: 'O', atomicNumber: 8 },
      '8': { label: 'O', atomicNumber: 8 },
      '9': { label: 'Na', atomicNumber: 11 },
      '10': { label: 'H', atomicNumber: 1 },
      '11': { label: 'O', atomicNumber: 8 },
    },
    remote: {
      provider: 'zenodo',
      recordId: '10548743',
      fileKey: 'dataNP.lmp',
      url: 'https://zenodo.org/api/records/10548743/files/dataNP.lmp/content',
      bytes: 349_598,
      checksum: {
        algorithm: 'sha256',
        value: '1e151a9bea30a98fbd92412c10ca1e361291fde5191509029f2d6953c3faa60e',
        sourceMd5: '059c14998b7c6b62007dbc8872005157',
      },
      verifiedAt: '2026-07-20',
    },
    provenance: {
      sourceUrl: 'https://zenodo.org/records/10548743',
      doi: '10.5281/zenodo.10548743',
      citation: 'Rezaei, sodium-triflate water-in-salt electrolyte simulation files.',
      license: 'CC-BY-4.0',
      licenseUrl: CC_BY_4_URL,
    },
    parser: {
      status: 'drop-in',
      warning: 'A source snapshot, not the companion time trajectory; source Masses provide the element mapping.',
    },
    sourceTruth: { coordinates: 'source', bondTopology: 'source-when-present' },
  },
  {
    id: 'gst-phase-change-ace-start',
    title: 'Ge-Sb-Te phase-change starting structure',
    summary: 'ACE molecular-dynamics starting configuration for phase-change GST at 5.85 g/cm³.',
    domain: 'phase-change materials',
    format: 'lammps-data',
    sequenceKind: 'snapshot',
    representation: 'atomic',
    atomCount: 504,
    frameCount: 1,
    elements: ['Ge', 'Sb', 'Te'],
    typeMap: {
      '1': { label: 'Ge', atomicNumber: 32 },
      '2': { label: 'Sb', atomicNumber: 51 },
      '3': { label: 'Te', atomicNumber: 52 },
    },
    remote: {
      provider: 'zenodo',
      recordId: '12173540',
      fileKey: 'GST_config.data',
      url: 'https://zenodo.org/api/records/12173540/files/GST_config.data/content',
      bytes: 65_631,
      checksum: {
        algorithm: 'sha256',
        value: 'c2322a3ba13e88b8a4cb122e41ea3d656f7a3db91346dc8989348008189e8ab4',
        sourceMd5: '07644cbfe1f3e17b0776e3b403a443c1',
      },
      verifiedAt: '2026-07-20',
    },
    provenance: {
      sourceUrl: 'https://zenodo.org/records/12173540',
      doi: '10.5281/zenodo.12173540',
      citation: 'Dunton, Arbaugh, and Starr, Ge-Sb-Te ACE phase-change molecular-dynamics inputs.',
      license: 'CC-BY-4.0',
      licenseUrl: CC_BY_4_URL,
    },
    parser: { status: 'drop-in', warning: 'Source LAMMPS data snapshot with explicit element masses.' },
    sourceTruth: { coordinates: 'source', bondTopology: 'not-provided' },
  },
  {
    id: 'rdx-thin-film-300k',
    title: 'α-RDX thin film at 300 K',
    summary: 'Relaxed alpha-RDX thin-film structure used in a vibrational energy-transfer study.',
    domain: 'molecular crystal dynamics',
    format: 'lammps-data',
    sequenceKind: 'snapshot',
    representation: 'atomic',
    atomCount: 4_536,
    frameCount: 1,
    elements: ['H', 'N', 'O', 'C'],
    typeMap: {
      '1': { label: 'H', atomicNumber: 1 },
      '2': { label: 'N', atomicNumber: 7 },
      '3': { label: 'N', atomicNumber: 7 },
      '4': { label: 'O', atomicNumber: 8 },
      '5': { label: 'C', atomicNumber: 6 },
      '6': { label: 'H', atomicNumber: 1 },
      '7': { label: 'C', atomicNumber: 6 },
      '8': { label: 'N', atomicNumber: 7 },
      '9': { label: 'N', atomicNumber: 7 },
      '10': { label: 'O', atomicNumber: 8 },
    },
    remote: {
      provider: 'zenodo',
      recordId: '4663415',
      fileKey: 'RDX_NonReact_3xUnit_300K1atm.data',
      url: 'https://zenodo.org/api/records/4663415/files/RDX_NonReact_3xUnit_300K1atm.data/content',
      bytes: 1_032_865,
      checksum: {
        algorithm: 'sha256',
        value: '402174e71fbe3ee2083bdd2000f78c38993b1c6a42f104b7d2d2a8a1b3fe8a6c',
        sourceMd5: 'd94851315f71f9c9934e5c49cf945c73',
      },
      verifiedAt: '2026-07-20',
    },
    provenance: {
      sourceUrl: 'https://zenodo.org/records/4663415',
      doi: '10.5281/zenodo.4663415',
      citation: 'Cole-Filipiak et al., alpha-RDX thin-film simulation data for vibrational energy transfer.',
      license: 'CC-BY-4.0',
      licenseUrl: CC_BY_4_URL,
    },
    parser: {
      status: 'drop-in',
      warning: 'The depositor limits the associated modified potential; Lupi references the source structure only.',
    },
    sourceTruth: { coordinates: 'source', bondTopology: 'source-when-present' },
  },
  {
    id: 'zns-nanopillar-001-5nm',
    title: '[001] ZnS nanopillar, 5 nm',
    summary: 'Starting structure for a 5 nm zinc-sulfide nanopillar deformation simulation.',
    domain: 'nanomechanics',
    format: 'lammps-data',
    sequenceKind: 'snapshot',
    representation: 'atomic',
    atomCount: 10_355,
    frameCount: 1,
    elements: ['Zn', 'S'],
    typeMap: {
      '1': { label: 'Zn', atomicNumber: 30 },
      '2': { label: 'S', atomicNumber: 16 },
    },
    remote: {
      provider: 'zenodo',
      recordId: '18716572',
      fileKey: 'ZnS_nanopillar_001_5nm.data',
      url: 'https://zenodo.org/api/records/18716572/files/ZnS_nanopillar_001_5nm.data/content',
      bytes: 499_770,
      checksum: {
        algorithm: 'sha256',
        value: '8f4c6647f5d07f3469936e2e8d67657512b8d759ab4424fb6e0d5ff6b3c7b373',
        sourceMd5: '589b6f7266e75604686aac1dcfdae2a2',
      },
      verifiedAt: '2026-07-20',
    },
    provenance: {
      sourceUrl: 'https://zenodo.org/records/18716572',
      doi: '10.5281/zenodo.18716572',
      citation: 'Cao, An, and Luo, ZnS nanopillar molecular-dynamics structures.',
      license: 'CC-BY-4.0',
      licenseUrl: CC_BY_4_URL,
    },
    parser: { status: 'drop-in', warning: 'Source LAMMPS data snapshot with explicit element masses.' },
    sourceTruth: { coordinates: 'source', bondTopology: 'not-provided' },
  },
  {
    id: 'hbn-stone-wales-defect-ace',
    title: 'hBN Stone-Wales defect structure',
    summary: '14,040-atom hexagonal-boron-nitride defect configuration for ACE ripple validation.',
    domain: 'two-dimensional defects',
    format: 'lammps-data',
    sequenceKind: 'snapshot',
    representation: 'atomic',
    atomCount: 14_040,
    frameCount: 1,
    elements: ['B', 'N'],
    typeMap: {
      '1': { label: 'B', atomicNumber: 5 },
      '2': { label: 'N', atomicNumber: 7 },
    },
    remote: {
      provider: 'zenodo',
      recordId: '17050007',
      fileKey: '30sw-defect.dump',
      url: 'https://zenodo.org/api/records/17050007/files/30sw-defect.dump/content',
      bytes: 1_851_021,
      checksum: {
        algorithm: 'sha256',
        value: '7fd3867566501477c143c7468881b7b67d9d29eab1e99329a4c43f96d79f5f58',
        sourceMd5: 'a5fbe3432d63ffd78c3f6e84621907f4',
      },
      verifiedAt: '2026-07-20',
    },
    provenance: {
      sourceUrl: 'https://zenodo.org/records/17050007',
      doi: '10.5281/zenodo.17050007',
      citation: 'Hassan, Dunton, and Starr, hBN Stone-Wales defect configurations for ACE validation.',
      license: 'CC-BY-4.0',
      licenseUrl: CC_BY_4_URL,
    },
    parser: {
      status: 'drop-in',
      warning: 'The .dump filename contains a LAMMPS write_data snapshot using the atomic/kk style hint.',
    },
    sourceTruth: { coordinates: 'source', bondTopology: 'not-provided' },
  },
];

export function externalResearchLoadPath(dataset: ExternalResearchDataset): string {
  return `/v1/datasets/research/${dataset.id}/files/${dataset.remote.fileKey}`;
}

export function atomicTypeMap(dataset: ExternalResearchDataset): Record<number, number> | null {
  const mapped = Object.entries(dataset.typeMap).flatMap(([rawType, definition]) => (
    definition.atomicNumber === undefined ? [] : [[Number(rawType), definition.atomicNumber] as const]
  ));
  if (mapped.length !== Object.keys(dataset.typeMap).length) return null;
  return Object.fromEntries(mapped);
}

/** Resolve only an exact catalog asset path. Absolute same-origin/edge URLs
 * and root-relative deep links intentionally converge on the same identity. */
export function externalResearchDatasetForLoadUrl(loadUrl: string): ExternalResearchDataset | null {
  let parsed: URL;
  try {
    parsed = new URL(loadUrl, 'https://lupi.live');
  } catch {
    return null;
  }
  if (parsed.search || parsed.hash) return null;
  return EXTERNAL_RESEARCH_DATASETS.find(
    (dataset) => externalResearchLoadPath(dataset) === parsed.pathname,
  ) ?? null;
}

export function atomicTypeMapForExternalResearchLoadUrl(loadUrl: string): Record<number, number> | null {
  const dataset = externalResearchDatasetForLoadUrl(loadUrl);
  return dataset ? atomicTypeMap(dataset) : null;
}
