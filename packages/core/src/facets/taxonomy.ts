/**
 * The library's facet taxonomy: a fixed vocabulary of things people ask of a
 * molecule or material ("a metal", "used in batteries", "floats on water").
 *
 * Every library entry is judged against every facet once, offline, by
 * `tools/enrich-library.mts`, and the probabilities are checked in as
 * `library-facts.json`. At search time the facts are data: filtering by a
 * facet costs nothing, works without a network, and is the same answer in the
 * switcher, the library, and the agent tools. Jev is asked live only to turn
 * typed words into facets and for what the taxonomy does not cover.
 *
 * Keep predicates short and plain. "floats on water, being less dense than
 * water and not dissolving in it" read from "floats in water" at 0.69 to
 * 0.77; "floats on water" read at 0.93. The precise meaning of a behaviour
 * belongs in `derivedFacts`, which decides it from reference data.
 *
 * Ids are permanent. Rewording a predicate changes what the stored
 * probabilities mean, so it requires a new id or a bump of
 * `FACET_TAXONOMY_VERSION` and a full re-enrichment.
 */

export const FACET_TAXONOMY_VERSION = 'facets-v1';

export type FacetGroup = 'kind' | 'source' | 'use' | 'behaviour' | 'library';

export interface FacetDefinition {
  id: string;
  group: FacetGroup;
  /** Chip label. */
  label: string;
  /** Completes "The substance ..." for enrichment and "things that ..." for queries. */
  predicate: string;
}

export const FACET_GROUP_LABELS: Record<FacetGroup, string> = {
  kind: 'What it is',
  source: 'Where it comes from',
  use: 'What it is used for',
  behaviour: 'How it behaves',
  library: 'In the library',
};

const facet = (group: FacetGroup, id: string, label: string, predicate: string): FacetDefinition => ({ id, group, label, predicate });

export const FACETS: readonly FacetDefinition[] = [
  // What it is
  facet('kind', 'metal', 'Metal', 'is a metal or a metal alloy'),
  facet('kind', 'ceramic', 'Ceramic or salt', 'is a ceramic, oxide, salt, glass, or other inorganic non-metal solid'),
  facet('kind', 'carbon_form', 'Pure carbon', 'is a form of pure carbon, such as diamond, graphite, graphene, a nanotube, or a fullerene'),
  facet('kind', 'framework', 'Framework or polymer', 'is a porous framework or a polymer, such as a metal-organic framework, zeolite, or plastic'),
  facet('kind', 'small_molecule', 'Small molecule', 'is a single small molecule of fewer than about 100 atoms rather than a bulk material'),
  facet('kind', 'sugar', 'Sugar', 'is a sugar or carbohydrate'),
  facet('kind', 'amino_acid', 'Amino acid or peptide', 'is an amino acid, a peptide, or a fragment of a protein'),
  facet('kind', 'lipid_steroid', 'Lipid or steroid', 'is a fat, lipid, or steroid'),
  facet('kind', 'nucleotide', 'DNA or RNA part', 'is a nucleobase, nucleoside, or nucleotide, a building block of DNA, RNA, or cellular energy'),
  facet('kind', 'alkaloid', 'Alkaloid', 'is an alkaloid, a nitrogen-containing compound made by plants or fungi'),
  facet('kind', 'terpene', 'Terpene', 'is a terpene or terpenoid, the family of many essential-oil compounds'),
  facet('kind', 'neurotransmitter', 'Neurotransmitter or hormone', 'is a neurotransmitter or a hormone'),
  facet('kind', 'aromatic_ring', 'Aromatic ring', 'contains an aromatic, benzene-like ring'),
  facet('kind', 'solvent', 'Solvent', 'is commonly used as a solvent'),

  // Where it comes from
  facet('source', 'in_body', 'In the human body', 'is made or found naturally in the human body'),
  facet('source', 'from_plants', 'From plants', 'is found naturally in plants, fruit, herbs, or spices'),
  facet('source', 'in_food', 'In food or drink', 'is found in everyday food or drink'),
  facet('source', 'mineral', 'Mined or mineral', 'is mined from the earth or occurs as a mineral'),
  facet('source', 'synthetic', 'Made by people', 'is mainly made industrially or in laboratories rather than taken from nature'),

  // What it is used for
  facet('use', 'medicine', 'Medicine', 'is used as a medicine or pharmaceutical drug'),
  facet('use', 'psychoactive', 'Psychoactive', 'acts on the mind, as a stimulant, psychedelic, sedative, or anaesthetic'),
  facet('use', 'flavor_fragrance', 'Flavour or scent', 'is used for flavour, scent, or perfume'),
  facet('use', 'energy_storage', 'Batteries and energy', 'is used in batteries, fuel cells, or energy storage'),
  facet('use', 'fuel', 'Fuel', 'is burned as a fuel'),
  facet('use', 'aerospace', 'Aircraft and spacecraft', 'is used to build aircraft, spacecraft, or other lightweight structures'),
  facet('use', 'electronics', 'Electronics', 'is used in electronics, semiconductors, wiring, or data storage'),
  facet('use', 'construction', 'Construction and tools', 'is used in construction, cutting tools, or heavy industry'),
  facet('use', 'jewelry', 'Gems and jewellery', 'is used as a gemstone or in jewellery'),
  facet('use', 'cooling', 'Cooling', 'is used for refrigeration or cooling'),
  facet('use', 'industrial_chemical', 'Industrial chemical', 'is an industrial chemical, laboratory reagent, or feedstock for making other chemicals'),

  // How it behaves, at room temperature and in ordinary conditions
  facet('behaviour', 'gas_rt', 'Gas', 'is a gas at room temperature'),
  facet('behaviour', 'liquid_rt', 'Liquid', 'is a liquid at room temperature'),
  facet('behaviour', 'solid_rt', 'Solid', 'is a solid at room temperature'),
  facet('behaviour', 'floats', 'Floats on water', 'floats on water'),
  facet('behaviour', 'water_soluble', 'Dissolves in water', 'dissolves readily in water'),
  facet('behaviour', 'flammable', 'Flammable', 'catches fire or burns easily'),
  facet('behaviour', 'toxic', 'Toxic', 'is toxic or hazardous to people in small amounts'),
  facet('behaviour', 'conducts', 'Conducts electricity', 'conducts electricity well as a solid or liquid'),
  facet('behaviour', 'magnetic', 'Magnetic', 'is attracted to a magnet'),
  facet('behaviour', 'hard', 'Very hard', 'is exceptionally hard or strong'),
  facet('behaviour', 'high_melting', 'Melts above 1000 °C', 'melts only above about 1000 °C'),
  facet('behaviour', 'sweet', 'Sweet', 'tastes sweet'),
  facet('behaviour', 'bitter', 'Bitter', 'tastes bitter'),
  facet('behaviour', 'smell', 'Strong smell', 'has a strong or distinctive smell'),

  // What kind of library entry it is
  facet('library', 'simulation', 'Simulation', 'is shown as a molecular-dynamics or research simulation of many atoms rather than one static structure'),
  facet('library', 'demo', 'Demo or artwork', 'is a demo, test pattern, QR code, or artwork made of atoms rather than a real substance'),
];

export type FacetId = (typeof FACETS)[number]['id'];

const BY_ID = new Map(FACETS.map((definition) => [definition.id, definition]));

export function facetById(id: string): FacetDefinition | undefined {
  return BY_ID.get(id);
}

export function isFacetId(id: unknown): id is FacetId {
  return typeof id === 'string' && BY_ID.has(id);
}

/** A stable fingerprint of the taxonomy wording; stored with every facts file. */
export function taxonomyFingerprint(): string {
  let hash = 2166136261;
  for (const definition of FACETS) {
    for (const char of `${definition.id}|${definition.group}|${definition.predicate}\n`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return `${FACET_TAXONOMY_VERSION}:${hash.toString(16).padStart(8, '0')}`;
}
