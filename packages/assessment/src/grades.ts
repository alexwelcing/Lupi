import type { AssetClass, FacetAssessment, FacetGrade, Grade } from './types';

export const GRADE_ORDER: Grade[] = [
  'F-', 'F', 'F+',
  'D-', 'D', 'D+',
  'C-', 'C', 'C+',
  'B-', 'B', 'B+',
  'A-', 'A', 'A+',
  'S-', 'S', 'S+',
];

export const ASSET_CLASS_ORDER: AssetClass[] = [
  'atomistic-simulation',
  'scientific-benchmark',
  'literature-derived-structure',
  'reference-structure',
  'procedural-scientific-model',
  'visualization-demo',
  'unknown',
];

export function gradeFromPoints(points: number): Grade {
  const index = Math.max(0, Math.min(GRADE_ORDER.length - 1, Math.floor(points)));
  return GRADE_ORDER[index];
}

export function pointsForGrade(grade: FacetGrade): number | null {
  if (grade === 'N/A' || grade === 'Unrated') return null;
  const index = GRADE_ORDER.indexOf(grade);
  return index >= 0 ? index : null;
}

export function facetFromPoints(points: number, reasons: FacetAssessment['reasons']): FacetAssessment {
  const bounded = Math.max(0, Math.min(17, Math.floor(points)));
  return { grade: gradeFromPoints(bounded), points: bounded, reasons };
}

export function unratedFacet(ruleId: string, message: string): FacetAssessment {
  return { grade: 'Unrated', points: null, reasons: [{ ruleId, message }] };
}

export function notApplicableFacet(ruleId: string, message: string): FacetAssessment {
  return { grade: 'N/A', points: null, reasons: [{ ruleId, message }] };
}

export function averageFacets(facets: FacetAssessment[]): FacetAssessment {
  const applicable = facets.filter((facet) => facet.points !== null);
  if (applicable.length < 2) {
    return unratedFacet('overall.insufficient-facets', 'At least two applicable facet grades are required for an overall tier.');
  }
  const points = Math.floor(applicable.reduce((sum, facet) => sum + (facet.points ?? 0), 0) / applicable.length);
  return facetFromPoints(points, [{
    ruleId: 'overall.applicable-mean',
    message: `Rounded-down mean of ${applicable.length} applicable facet grades.`,
  }]);
}

export function makeRankKey(assetClass: AssetClass, overall: FacetAssessment, facets: FacetAssessment[]): string {
  const classIndex = ASSET_CLASS_ORDER.indexOf(assetClass);
  const overallPoints = overall.points ?? -1;
  const facetTotal = facets.reduce((sum, facet) => sum + (facet.points ?? 0), 0);
  const evidencePoints = facets[0]?.points ?? -1;
  const invert = (value: number, max: number) => String(max - Math.max(-1, value)).padStart(3, '0');
  return [
    String(classIndex < 0 ? ASSET_CLASS_ORDER.length : classIndex).padStart(2, '0'),
    invert(overallPoints, 17),
    invert(facetTotal, 68),
    invert(evidencePoints, 17),
  ].join(':');
}
