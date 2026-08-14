import type { MoleculeSummary } from "@/src/domain/molecules";
import {
  MOBILE_GALLERY_IDS,
  mobileGalleryAtomCount,
  type MobileGalleryId,
} from "@/src/domain/mobile-gallery";

export const MOBILE_GALLERY_MAX_ATOMS = 50_000;

export type GalleryCategory = "molecule" | "material" | "trajectory";
export type GalleryFilter =
  | "all"
  | "featured"
  | "molecules"
  | "materials"
  | "trajectories";

export interface CuratedGalleryItem extends MoleculeSummary {
  atomCount: number;
  category: GalleryCategory;
  domain: string;
  featured?: boolean;
  frameCount: number;
  palette: readonly [string, string, string];
  subtitle: string;
  thumbnailPath?: `gallery/snapshots/${string}.jpg`;
  id: MobileGalleryId;
}

export interface GalleryFilterOption {
  id: GalleryFilter;
  label: string;
}

export interface GalleryPresentation {
  catalog: CuratedGalleryItem[];
  featured: CuratedGalleryItem[];
  resultCount: number;
}

export const GALLERY_FILTERS: readonly GalleryFilterOption[] = [
  { id: "all", label: "All Structures" },
  { id: "featured", label: "Featured" },
  { id: "molecules", label: "Molecules" },
  { id: "materials", label: "Materials" },
  { id: "trajectories", label: "Trajectories" },
];

const FEATURED_DISCOVERY_ORDER: readonly MobileGalleryId[] = [
  "caffeine",
  "this_is_water",
  "c60_buckyball",
  "aspirin",
  "lupine_sphere_grid",
  "z1_science_path_27",
  "elliott_gst_crystallization",
];

export const CURATED_GALLERY: readonly CuratedGalleryItem[] = [
  galleryItem({
    id: "lupine_sphere_grid",
    name: "Lupine Sphere Grid",
    formula: "1,513 nodes",
    subtitle: "A live knowledge graph rendered as an atomistic structure.",
    domain: "Atomized Media",
    atomCount: 1_513,
    frameCount: 1,
    category: "material",
    featured: true,
    tags: ["knowledge graph", "atomized", "featured"],
    palette: ["#FF9F43", "#5F27CD", "#10AC84"],
    thumbnail: true,
  }),
  galleryItem({
    id: "caffeine",
    name: "Caffeine",
    formula: "C8H10N4O2",
    subtitle:
      "A fused-ring alkaloid with four nitrogens and two carbonyl groups.",
    domain: "Biomolecules",
    atomCount: 24,
    frameCount: 1,
    category: "molecule",
    featured: true,
    tags: ["organic", "alkaloid", "molecule"],
    palette: ["#F8FAFC", "#38BDF8", "#F97316"],
  }),
  galleryItem({
    id: "aspirin",
    name: "Aspirin",
    formula: "C9H8O4",
    subtitle: "Acetylsalicylic acid with ester, acid, and aromatic chemistry.",
    domain: "Biomolecules",
    atomCount: 21,
    frameCount: 1,
    category: "molecule",
    featured: true,
    tags: ["organic", "medicine", "ester"],
    palette: ["#F43F5E", "#F97316", "#F8FAFC"],
    thumbnail: true,
  }),
  galleryItem({
    id: "dopamine",
    name: "Dopamine",
    formula: "C8H11NO2",
    subtitle:
      "A catecholamine neurotransmitter with a flexible two-carbon side chain.",
    domain: "Biomolecules",
    atomCount: 22,
    frameCount: 1,
    category: "molecule",
    tags: ["organic", "neurotransmitter", "amine"],
    palette: ["#A78BFA", "#F8FAFC", "#F59E0B"],
  }),
  galleryItem({
    id: "serotonin",
    name: "Serotonin",
    formula: "C10H12N2O",
    subtitle: "An indole neurotransmitter with a compact organic scaffold.",
    domain: "Biomolecules",
    atomCount: 25,
    frameCount: 1,
    category: "molecule",
    tags: ["organic", "neurotransmitter", "indole"],
    palette: ["#14B8A6", "#F59E0B", "#F8FAFC"],
  }),
  galleryItem({
    id: "glucose",
    name: "Glucose",
    formula: "C6H12O6",
    subtitle:
      "A familiar carbohydrate rendered from a three-dimensional conformer.",
    domain: "Biomolecules",
    atomCount: 24,
    frameCount: 1,
    category: "molecule",
    tags: ["organic", "carbohydrate", "biomolecule"],
    palette: ["#E5E7EB", "#F8FAFC", "#F97316"],
  }),
  galleryItem({
    id: "ethanol",
    name: "Ethanol",
    formula: "C2H6O",
    subtitle: "A compact alcohol and solvent with clear molecular geometry.",
    domain: "Fluids & Solvents",
    atomCount: 9,
    frameCount: 1,
    category: "molecule",
    tags: ["organic", "alcohol", "solvent"],
    palette: ["#E5E7EB", "#F8FAFC", "#F97316"],
  }),
  galleryItem({
    id: "water",
    name: "Water",
    formula: "H2O",
    subtitle:
      "A bent triatomic molecule whose shape underpins water's polarity.",
    domain: "Fluids & Solvents",
    atomCount: 3,
    frameCount: 1,
    category: "molecule",
    tags: ["small", "solvent", "molecule"],
    palette: ["#E5E7EB", "#F97316", "#94A3B8"],
  }),
  galleryItem({
    id: "sodium_chloride",
    name: "Sodium Chloride",
    formula: "NaCl",
    subtitle: "The familiar ionic pair in a minimal two-atom structure.",
    domain: "Ceramics & Oxides",
    atomCount: 2,
    frameCount: 1,
    category: "molecule",
    tags: ["ionic", "salt", "small"],
    palette: ["#A78BFA", "#4ADE80", "#94A3B8"],
  }),
  galleryItem({
    id: "acetone",
    name: "Acetone",
    formula: "C3H6O",
    subtitle:
      "A symmetric carbonyl for reading trigonal geometry and polarity.",
    domain: "Biomolecules",
    atomCount: 10,
    frameCount: 1,
    category: "molecule",
    tags: ["organic", "ketone", "solvent"],
    palette: ["#F472B6", "#F8FAFC", "#94A3B8"],
  }),
  galleryItem({
    id: "phenol",
    name: "Phenol",
    formula: "C6H6O",
    subtitle: "An aromatic alcohol for inspecting rings and hydrogen bonding.",
    domain: "Biomolecules",
    atomCount: 13,
    frameCount: 1,
    category: "molecule",
    tags: ["organic", "aromatic", "alcohol"],
    palette: ["#34D399", "#38BDF8", "#F8FAFC"],
  }),
  galleryItem({
    id: "nitrobenzene",
    name: "Nitrobenzene",
    formula: "C6H5NO2",
    subtitle:
      "An aromatic nitro group with a clear resonance-withdrawing motif.",
    domain: "Biomolecules",
    atomCount: 14,
    frameCount: 1,
    category: "molecule",
    tags: ["organic", "aromatic", "nitro"],
    palette: ["#38BDF8", "#F97316", "#F8FAFC"],
  }),
  galleryItem({
    id: "ethyl_acetate",
    name: "Ethyl Acetate",
    formula: "C4H8O2",
    subtitle: "A small ester and common extraction solvent.",
    domain: "Biomolecules",
    atomCount: 14,
    frameCount: 1,
    category: "molecule",
    tags: ["organic", "ester", "solvent"],
    palette: ["#FB923C", "#34D399", "#F8FAFC"],
  }),
  galleryItem({
    id: "c60_buckyball",
    name: "Buckminsterfullerene",
    formula: "C60",
    subtitle: "The iconic truncated-icosahedron carbon allotrope.",
    domain: "Nanomaterials",
    atomCount: 60,
    frameCount: 1,
    category: "material",
    featured: true,
    tags: ["carbon", "fullerene", "nanomaterial"],
    palette: ["#6B7280", "#D1D5DB", "#111827"],
    thumbnail: true,
  }),
  galleryItem({
    id: "cnt_6_6",
    name: "Carbon Nanotube",
    formula: "C96",
    subtitle: "A (6,6) armchair single-walled carbon nanotube.",
    domain: "Nanomaterials",
    atomCount: 96,
    frameCount: 1,
    category: "material",
    tags: ["carbon", "nanotube", "nanomaterial"],
    palette: ["#4B5563", "#D1D5DB", "#111827"],
    thumbnail: true,
  }),
  galleryItem({
    id: "graphene_ribbon",
    name: "Graphene Nanoribbon",
    formula: "C112",
    subtitle: "An armchair graphene ribbon with passivated edges.",
    domain: "Nanomaterials",
    atomCount: 112,
    frameCount: 1,
    category: "material",
    tags: ["carbon", "graphene", "nanomaterial"],
    palette: ["#374151", "#D1D5DB", "#111827"],
    thumbnail: true,
  }),
  galleryItem({
    id: "diamond_crystal",
    name: "Diamond Crystal",
    formula: "C512",
    subtitle:
      "A repeating tetrahedral carbon lattice behind diamond's exceptional hardness.",
    domain: "Nanomaterials",
    atomCount: 512,
    frameCount: 1,
    category: "material",
    tags: ["carbon", "crystal", "lattice"],
    palette: ["#E0F2FE", "#94A3B8", "#F8FAFC"],
    thumbnail: true,
  }),
  galleryItem({
    id: "sio2_glass",
    name: "Amorphous Silica",
    formula: "SiO2",
    subtitle: "Vitreous silica with a 12,000-atom tetrahedral network.",
    domain: "Ceramics & Oxides",
    atomCount: 12_000,
    frameCount: 1,
    category: "material",
    tags: ["glass", "silica", "ceramic"],
    palette: ["#87CEEB", "#B0E0E6", "#FFD700"],
    thumbnail: true,
  }),
  galleryItem({
    id: "cuzr_melt",
    name: "Cu64Zr36 Metallic Glass",
    formula: "Cu64Zr36",
    subtitle:
      "A melt-quench structure showing short-range order in a metallic glass.",
    domain: "Metals & Alloys",
    atomCount: 13_500,
    frameCount: 1,
    category: "material",
    tags: ["alloy", "metallic glass", "materials"],
    palette: ["#4DA6FF", "#40FF80", "#4D4DFF"],
    thumbnail: true,
  }),
  galleryItem({
    id: "this_is_water",
    name: "This is Water",
    formula: "150 H2O",
    subtitle: "A continuous 120-frame loop of 150 moving water molecules.",
    domain: "Fluids & Solvents",
    atomCount: 450,
    frameCount: 120,
    category: "trajectory",
    featured: true,
    tags: ["water", "trajectory", "fluid"],
    palette: ["#38BDF8", "#E5E7EB", "#F97316"],
    thumbnail: true,
  }),
  galleryItem({
    id: "oscillation_timeseries",
    name: "Time-Series Oscillation",
    formula: "1,000 atoms",
    subtitle:
      "Thirty frames reveal a coordinated wave moving through 1,000 atoms.",
    domain: "Dynamic Systems",
    atomCount: 1_000,
    frameCount: 30,
    category: "trajectory",
    tags: ["trajectory", "timeseries", "validation"],
    palette: ["#F542D4", "#87247A", "#C78ABA"],
    thumbnail: true,
  }),
  galleryItem({
    id: "z1_science_path_16",
    name: "Z1 Path 16",
    formula: "C-Co-Li-Na-O-P",
    subtitle:
      "Five snapshots trace a lithium ion moving between neighboring sites.",
    domain: "Energy Materials",
    atomCount: 51,
    frameCount: 5,
    category: "trajectory",
    tags: ["lithium", "energy", "science path"],
    palette: ["#3D4DB3", "#16171D", "#FAF9F6"],
  }),
  galleryItem({
    id: "z1_science_path_27",
    name: "Z1 Path 27",
    formula: "C-Li-O-V",
    subtitle:
      "A five-stage lithium migration path through a vanadium oxide framework.",
    domain: "Energy Materials",
    atomCount: 87,
    frameCount: 5,
    category: "trajectory",
    featured: true,
    tags: ["lithium", "energy", "science path"],
    palette: ["#3D4DB3", "#4A7D5E", "#FAF9F6"],
  }),
  galleryItem({
    id: "elliott_gst_crystallization",
    name: "GST Crystallization",
    formula: "Ge2Sb2Te5",
    subtitle: "A representative phase-change memory crystallization structure.",
    domain: "Ceramics & Oxides",
    atomCount: 4_096,
    frameCount: 1,
    category: "material",
    featured: true,
    tags: ["phase change", "memory", "crystal"],
    palette: ["#800000", "#9A6324", "#FFD8B1"],
    thumbnail: true,
  }),
] as const;

export const CURATED_GALLERY_IDS: readonly MobileGalleryId[] =
  CURATED_GALLERY.map((item) => item.id);

// Keep the public ordering owned by this presentation layer, while the domain
// allowlist remains the single authority for which canonical IDs are valid.
const curatedGalleryIdSet = new Set(CURATED_GALLERY_IDS);
if (
  CURATED_GALLERY_IDS.length !== MOBILE_GALLERY_IDS.length ||
  curatedGalleryIdSet.size !== CURATED_GALLERY_IDS.length ||
  MOBILE_GALLERY_IDS.some((id) => !curatedGalleryIdSet.has(id))
) {
  throw new Error(
    "The curated gallery must cover the complete mobile gallery allowlist.",
  );
}

export function galleryFilterLabel(filter: GalleryFilter): string {
  return (
    GALLERY_FILTERS.find((option) => option.id === filter)?.label ??
    "All Structures"
  );
}

export function galleryFilterCount(filter: GalleryFilter): number {
  return filterGalleryItems(CURATED_GALLERY, "", filter).length;
}

export function selectGalleryPresentation(
  items: readonly CuratedGalleryItem[],
  query: string,
  filter: GalleryFilter,
): GalleryPresentation {
  const matches = filterGalleryItems(items, query, filter);
  const showFeaturedRail =
    filter === "all" && normalizeSearchText(query) === "";

  if (!showFeaturedRail) {
    return { catalog: matches, featured: [], resultCount: matches.length };
  }

  return {
    catalog: matches.filter((item) => !item.featured),
    featured: matches
      .filter((item) => item.featured)
      .sort(
        (left, right) =>
          featuredDiscoveryRank(left.id) - featuredDiscoveryRank(right.id),
      ),
    resultCount: matches.length,
  };
}

function featuredDiscoveryRank(id: MobileGalleryId): number {
  const index = FEATURED_DISCOVERY_ORDER.indexOf(id);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function filterGalleryItems(
  items: readonly CuratedGalleryItem[],
  query: string,
  filter: GalleryFilter,
): CuratedGalleryItem[] {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  return items.filter((item) => {
    if (!matchesFilter(item, filter)) return false;
    if (!terms.length) return true;
    const haystack = normalizeSearchText(
      [
        item.id,
        item.name,
        item.formula,
        item.subtitle,
        item.domain,
        item.category,
        ...item.tags,
      ].join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

export function galleryThumbnailUrl(
  item: CuratedGalleryItem,
  baseUrl: string,
): string | null {
  if (!item.thumbnailPath) return null;
  return new URL(item.thumbnailPath, withTrailingSlash(baseUrl)).toString();
}

function galleryItem(
  input: Omit<CuratedGalleryItem, "load" | "thumbnailPath"> & {
    id: MobileGalleryId;
    thumbnail?: boolean;
  },
): CuratedGalleryItem {
  const { thumbnail, ...item } = input;
  const atomCount = mobileGalleryAtomCount(item.id);
  return {
    ...item,
    atomCount,
    load: {
      inputType: "gallery",
      input: item.id,
      atomCount,
    },
    ...(thumbnail
      ? { thumbnailPath: `gallery/snapshots/${item.id}.jpg` as const }
      : {}),
  };
}

function matchesFilter(
  item: CuratedGalleryItem,
  filter: GalleryFilter,
): boolean {
  switch (filter) {
    case "featured":
      return item.featured === true;
    case "molecules":
      return item.category === "molecule";
    case "materials":
      return item.category === "material";
    case "trajectories":
      return item.category === "trajectory";
    default:
      return true;
  }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
