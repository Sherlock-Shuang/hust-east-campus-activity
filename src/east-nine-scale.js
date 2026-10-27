/** Photo-derived vertical composition, not a measured elevation. The local
 * frontal photograph shows three upper glazing rows above a lower arcade of
 * roughly one third of the building's height. OSM's min_level=3 remains source
 * metadata; multiplying it by a generic storey compressed those three rows
 * into only 40% of the facade. Explicit metre elevations always take priority. */
export const EAST_NINE_ARCADE_RATIO = .32;
export const EAST_NINE_SCALE_PHOTOS = Object.freeze([
  '/references/local-campus/east-nine-curtainwall.webp',
  '/references/local-campus/east-nine-approach.webp',
]);

export function resolveEastNineArcadeScale(height, { explicitMinHeight = null, sourceMinLevel = 3, floorHeight = height / 5 } = {}) {
  const sourceEstimate = sourceMinLevel * floorHeight;
  const explicit = Number.isFinite(explicitMinHeight) && explicitMinHeight >= 0;
  return {
    clearHeight: explicit ? explicitMinHeight : height * EAST_NINE_ARCADE_RATIO,
    sourceMinLevel,
    sourceMinLevelHeightEstimate: sourceEstimate,
    basis: explicit ? 'source-min-height' : 'estimated-photo-arcade-proportion',
    glazingRows: 3,
    glazingFractionOfUpperStorey: .62,
    estimatedArcadeRatioRange: [.28, .34],
    datum: 'ground at the column feet to soffit; excludes the foreground paving and entrance steps',
    photos: [...EAST_NINE_SCALE_PHOTOS],
    explanation: explicit
      ? 'Explicit source min_height in metres overrides the photo-derived proportion.'
      : 'Local frontal and approach photos show three upper glazing rows; ground at the column feet to soffit is estimated at 32% of facade height (plausible photo range 28–34%). Foreground paving and entrance steps are not added to the clearance. min_level=3 remains conflicting source metadata, not a measured clearance.',
  };
}
