export const MOBILE_GALLERY_ATOM_COUNTS = {
  lupine_sphere_grid: 1_513,
  caffeine: 24,
  aspirin: 21,
  dopamine: 22,
  serotonin: 25,
  glucose: 24,
  ethanol: 9,
  water: 3,
  sodium_chloride: 2,
  acetone: 10,
  phenol: 13,
  nitrobenzene: 14,
  ethyl_acetate: 14,
  c60_buckyball: 60,
  cnt_6_6: 96,
  graphene_ribbon: 112,
  diamond_crystal: 512,
  sio2_glass: 12_000,
  cuzr_melt: 13_500,
  this_is_water: 450,
  oscillation_timeseries: 1_000,
  z1_science_path_16: 51,
  z1_science_path_27: 87,
  elliott_gst_crystallization: 4_096,
} as const;

export type MobileGalleryId = keyof typeof MOBILE_GALLERY_ATOM_COUNTS;

export const MOBILE_GALLERY_IDS = Object.freeze(
  Object.keys(MOBILE_GALLERY_ATOM_COUNTS) as MobileGalleryId[],
);

export function isMobileGalleryId(value: unknown): value is MobileGalleryId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MOBILE_GALLERY_ATOM_COUNTS, value)
  );
}

export function mobileGalleryAtomCount(id: MobileGalleryId): number {
  return MOBILE_GALLERY_ATOM_COUNTS[id];
}
