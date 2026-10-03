/**
 * queue.mts — what Lupi Daily asks, in what order, and what else may be
 * guessed. Build-time only: the client never ships these names; it knows the
 * queue as opaque tokens (packages/ui/src/daily/schedule.ts).
 *
 * DAILY_QUEUE: 55 recognisable gallery molecules with a /m page, curated for
 * the first pass (No. 1 is 2026-10-01): friendly shapes first, a well-known
 * molecule most weekends, teaching molecules later. Later passes shuffle.
 * Left out of the answers on purpose: recreational and illicit drugs (LSD,
 * psilocybin, THC, CBD, MDMA, mescaline, DMT, ketamine, nicotine, nitrous
 * oxide), two-atom shapes (O₂, NaCl) and bulk structures (the diamond and the
 * water cluster). They stay guessable.
 *
 * Changing the order re-maps past days for every visitor (their stored days
 * reset, because a record remembers its token): append, do not reorder.
 *
 * DAILY_DECOYS: common molecules Lupi has no page for, guessable but never
 * the answer (as Wordle accepts many more words than it asks). Each carries
 * its formula and a few library facets (packages/core/src/facets/taxonomy.ts)
 * so its warmth is as meaningful as a gallery molecule's.
 */

export const DAILY_QUEUE: readonly string[] = [
  'water',
  'benzene',
  'caffeine',
  'c60_buckyball',
  'vanillin',
  'ethanol',
  'aspirin',
  'glucose',
  'menthol',
  'dopamine',
  'acetone',
  'capsaicin',
  'cnt_6_6',
  'sucrose',
  'serotonin',
  'limonene',
  'phenol',
  'cholesterol',
  'theobromine',
  'lactic_acid',
  'adrenaline',
  'curcumin',
  'ethyl_acetate',
  'melatonin',
  'atp',
  'histamine',
  'graphene_ribbon',
  'resveratrol',
  'creatine',
  'quinine',
  'benzaldehyde',
  'tryptophan',
  'linalool',
  'cortisol',
  'acetaldehyde',
  'piperine',
  'gaba',
  'ethanethiol',
  'adenosine',
  'geraniol',
  'nitrobenzene',
  'humulone',
  'theanine',
  'dimethyl_sulfide',
  'norepinephrine',
  'gingerol',
  'cyclohexanone',
  'phenethylamine',
  'ethylene_oxide',
  'acetic_anhydride',
  'acetonitrile',
  'tert_butyl_chloride',
  'benzonitrile',
  'bromobutane_1',
  'acetyl_chloride',
];

/** The seal and token salt (not a secret: it only keeps tokens from being guessable ids). */
export const DAILY_SALT = 'lupi-daily-2026';

export interface DailyDecoy {
  name: string;
  /** Hill formula. */
  formula: string;
  aliases?: string[];
  /** Library facet ids, each taken as 0.9. */
  facets: string[];
}

const SM = 'small_molecule';

export const DAILY_DECOYS: readonly DailyDecoy[] = [
  { name: 'Ammonia', formula: 'H3N', facets: ['gas_rt', 'toxic', 'smell', 'industrial_chemical', 'water_soluble', SM] },
  { name: 'Methane', formula: 'CH4', facets: ['gas_rt', 'fuel', 'flammable', SM] },
  { name: 'Carbon dioxide', formula: 'CO2', aliases: ['CO2'], facets: ['gas_rt', 'in_body', SM] },
  { name: 'Carbon monoxide', formula: 'CO', facets: ['gas_rt', 'toxic', SM] },
  { name: 'Hydrogen peroxide', formula: 'H2O2', facets: ['liquid_rt', 'industrial_chemical', 'water_soluble', SM] },
  { name: 'Ozone', formula: 'O3', facets: ['gas_rt', 'toxic', 'smell', SM] },
  { name: 'Nitrogen', formula: 'N2', facets: ['gas_rt', SM] },
  { name: 'Hydrogen', formula: 'H2', facets: ['gas_rt', 'fuel', 'flammable', 'energy_storage', SM] },
  { name: 'Methanol', formula: 'CH4O', aliases: ['Methyl alcohol'], facets: ['liquid_rt', 'solvent', 'toxic', 'flammable', 'fuel', 'water_soluble', SM] },
  { name: 'Isopropanol', formula: 'C3H8O', aliases: ['Isopropyl alcohol', 'Rubbing alcohol'], facets: ['liquid_rt', 'solvent', 'flammable', 'medicine', 'water_soluble', SM] },
  { name: 'Ethylene glycol', formula: 'C2H6O2', aliases: ['Antifreeze'], facets: ['liquid_rt', 'toxic', 'sweet', 'industrial_chemical', 'water_soluble', SM] },
  { name: 'Propane', formula: 'C3H8', facets: ['gas_rt', 'fuel', 'flammable', SM] },
  { name: 'Butane', formula: 'C4H10', facets: ['gas_rt', 'fuel', 'flammable', SM] },
  { name: 'Octane', formula: 'C8H18', facets: ['liquid_rt', 'fuel', 'flammable', 'floats', SM] },
  { name: 'Ethylene', formula: 'C2H4', aliases: ['Ethene'], facets: ['gas_rt', 'industrial_chemical', 'flammable', 'from_plants', SM] },
  { name: 'Acetylene', formula: 'C2H2', aliases: ['Ethyne'], facets: ['gas_rt', 'fuel', 'flammable', SM] },
  { name: 'Formaldehyde', formula: 'CH2O', aliases: ['Methanal'], facets: ['gas_rt', 'toxic', 'smell', 'industrial_chemical', SM] },
  { name: 'Acetic acid', formula: 'C2H4O2', aliases: ['Ethanoic acid'], facets: ['liquid_rt', 'in_food', 'smell', 'water_soluble', 'industrial_chemical', SM] },
  { name: 'Citric acid', formula: 'C6H8O7', facets: ['solid_rt', 'in_food', 'from_plants', 'water_soluble', 'in_body', SM] },
  { name: 'Urea', formula: 'CH4N2O', facets: ['solid_rt', 'in_body', 'water_soluble', SM] },
  { name: 'Diethyl ether', formula: 'C4H10O', aliases: ['Ether'], facets: ['liquid_rt', 'solvent', 'flammable', 'smell', SM] },
  { name: 'Chloroform', formula: 'CHCl3', aliases: ['Trichloromethane'], facets: ['liquid_rt', 'solvent', 'toxic', SM] },
  { name: 'Cyclohexane', formula: 'C6H12', facets: ['liquid_rt', 'solvent', 'flammable', 'floats', SM] },
  { name: 'Toluene', formula: 'C7H8', aliases: ['Methylbenzene'], facets: ['liquid_rt', 'solvent', 'aromatic_ring', 'flammable', 'floats', 'smell', SM] },
  { name: 'Styrene', formula: 'C8H8', facets: ['liquid_rt', 'industrial_chemical', 'aromatic_ring', 'smell', SM] },
  { name: 'Naphthalene', formula: 'C10H8', aliases: ['Mothballs'], facets: ['solid_rt', 'aromatic_ring', 'smell', SM] },
  { name: 'Pyridine', formula: 'C5H5N', facets: ['liquid_rt', 'solvent', 'smell', 'aromatic_ring', SM] },
  { name: 'Indole', formula: 'C8H7N', facets: ['aromatic_ring', 'smell', 'solid_rt', SM] },
  { name: 'Sulfuric acid', formula: 'H2O4S', facets: ['liquid_rt', 'industrial_chemical', 'toxic', SM] },
  { name: 'Hydrogen chloride', formula: 'ClH', aliases: ['Hydrochloric acid'], facets: ['gas_rt', 'toxic', 'industrial_chemical', SM] },
  { name: 'Sulfur hexafluoride', formula: 'F6S', facets: ['gas_rt', 'synthetic', SM] },
  { name: 'Ibuprofen', formula: 'C13H18O2', facets: ['medicine', 'aromatic_ring', 'solid_rt', 'synthetic', SM] },
  { name: 'Paracetamol', formula: 'C8H9NO2', aliases: ['Acetaminophen'], facets: ['medicine', 'aromatic_ring', 'solid_rt', 'synthetic', 'bitter', SM] },
  { name: 'Penicillin G', formula: 'C16H18N2O4S', aliases: ['Penicillin'], facets: ['medicine', 'solid_rt', SM] },
  { name: 'Lidocaine', formula: 'C14H22N2O', facets: ['medicine', 'aromatic_ring', 'synthetic', 'solid_rt', SM] },
  { name: 'Salicylic acid', formula: 'C7H6O3', facets: ['medicine', 'aromatic_ring', 'solid_rt', 'from_plants', SM] },
  { name: 'Methyl salicylate', formula: 'C8H8O3', aliases: ['Oil of wintergreen'], facets: ['flavor_fragrance', 'from_plants', 'aromatic_ring', 'liquid_rt', 'smell', 'medicine', SM] },
  { name: 'Benzoic acid', formula: 'C7H6O2', facets: ['aromatic_ring', 'solid_rt', 'in_food', SM] },
  { name: 'Testosterone', formula: 'C19H28O2', facets: ['neurotransmitter', 'lipid_steroid', 'in_body', 'solid_rt', SM] },
  { name: 'Estradiol', formula: 'C18H24O2', aliases: ['Oestradiol'], facets: ['neurotransmitter', 'lipid_steroid', 'in_body', 'solid_rt', 'aromatic_ring', SM] },
  { name: 'Progesterone', formula: 'C21H30O2', facets: ['neurotransmitter', 'lipid_steroid', 'in_body', 'solid_rt', SM] },
  { name: 'Acetylcholine', formula: 'C7H16NO2', facets: ['neurotransmitter', 'in_body', 'water_soluble', SM] },
  { name: 'Glutamic acid', formula: 'C5H9NO4', aliases: ['Glutamate'], facets: ['amino_acid', 'in_body', 'neurotransmitter', 'in_food', 'solid_rt', SM] },
  { name: 'Glycine', formula: 'C2H5NO2', facets: ['amino_acid', 'in_body', 'solid_rt', 'water_soluble', 'sweet', SM] },
  { name: 'Alanine', formula: 'C3H7NO2', facets: ['amino_acid', 'in_body', 'solid_rt', 'water_soluble', SM] },
  { name: 'Phenylalanine', formula: 'C9H11NO2', facets: ['amino_acid', 'aromatic_ring', 'in_body', 'solid_rt', SM] },
  { name: 'Tyrosine', formula: 'C9H11NO3', facets: ['amino_acid', 'aromatic_ring', 'in_body', 'solid_rt', SM] },
  { name: 'Uric acid', formula: 'C5H4N4O3', facets: ['in_body', 'solid_rt', SM] },
  { name: 'Fructose', formula: 'C6H12O6', aliases: ['Fruit sugar'], facets: ['sugar', 'sweet', 'in_food', 'from_plants', 'solid_rt', 'water_soluble', SM] },
  { name: 'Lactose', formula: 'C12H22O11', aliases: ['Milk sugar'], facets: ['sugar', 'in_food', 'solid_rt', 'water_soluble', 'sweet', SM] },
  { name: 'Ribose', formula: 'C5H10O5', facets: ['sugar', 'in_body', 'solid_rt', 'water_soluble', SM] },
  { name: 'Xylitol', formula: 'C5H12O5', facets: ['sweet', 'sugar', 'in_food', 'solid_rt', 'water_soluble', SM] },
  { name: 'Glycerol', formula: 'C3H8O3', aliases: ['Glycerin'], facets: ['liquid_rt', 'sweet', 'in_body', 'water_soluble', SM] },
  { name: 'Saccharin', formula: 'C7H5NO3S', facets: ['sweet', 'synthetic', 'aromatic_ring', 'solid_rt', 'in_food', SM] },
  { name: 'Aspartame', formula: 'C14H18N2O5', facets: ['sweet', 'synthetic', 'in_food', 'solid_rt', SM] },
  { name: 'Vitamin C', formula: 'C6H8O6', aliases: ['Ascorbic acid'], facets: ['in_food', 'from_plants', 'solid_rt', 'water_soluble', 'medicine', SM] },
  { name: 'Niacin', formula: 'C6H5NO2', aliases: ['Vitamin B3', 'Nicotinic acid'], facets: ['in_food', 'aromatic_ring', 'solid_rt', SM] },
  { name: 'Riboflavin', formula: 'C17H20N4O6', aliases: ['Vitamin B2'], facets: ['in_food', 'solid_rt', SM] },
  { name: 'Retinol', formula: 'C20H30O', aliases: ['Vitamin A'], facets: ['in_body', 'in_food', 'solid_rt', SM] },
  { name: 'Beta-carotene', formula: 'C40H56', aliases: ['Carotene'], facets: ['in_food', 'from_plants', 'solid_rt', SM] },
  { name: 'Squalene', formula: 'C30H50', facets: ['terpene', 'lipid_steroid', 'in_body', 'liquid_rt', 'floats', SM] },
  { name: 'Citral', formula: 'C10H16O', facets: ['terpene', 'flavor_fragrance', 'from_plants', 'liquid_rt', 'smell', SM] },
  { name: 'Camphor', formula: 'C10H16O', facets: ['terpene', 'from_plants', 'smell', 'solid_rt', 'flavor_fragrance', SM] },
  { name: 'Thymol', formula: 'C10H14O', facets: ['terpene', 'from_plants', 'aromatic_ring', 'solid_rt', 'smell', 'flavor_fragrance', SM] },
  { name: 'Eugenol', formula: 'C10H12O2', aliases: ['Clove oil'], facets: ['flavor_fragrance', 'from_plants', 'aromatic_ring', 'liquid_rt', 'smell', SM] },
  { name: 'Cinnamaldehyde', formula: 'C9H8O', facets: ['flavor_fragrance', 'from_plants', 'in_food', 'aromatic_ring', 'liquid_rt', 'smell', SM] },
  { name: 'Indigo', formula: 'C16H10N2O2', facets: ['from_plants', 'solid_rt', SM] },
];
