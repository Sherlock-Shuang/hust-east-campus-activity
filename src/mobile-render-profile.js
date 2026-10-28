/** Choose a bounded drawing budget once, without changing campus geometry or
 * simulation. The capped deviceRatio also feeds the adaptive resolution helper,
 * so its idle recovery cannot exceed the handheld budget. */
export function createMobileRenderProfile({
  coarsePointer = false,
  maxTouchPoints = 0,
  width = 0,
  height = 0,
  devicePixelRatio = 1,
} = {}) {
  const validSize = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const shortEdge = Math.min(width, height), longEdge = Math.max(width, height);
  const touchPhone = Number.isFinite(maxTouchPoints) && maxTouchPoints > 0 && shortEdge <= 600;
  const handheld = validSize && longEdge <= 1400 && (!!coarsePointer || touchPhone);
  const nativeRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    handheld,
    deviceRatio: Math.min(nativeRatio, handheld ? 1.25 : 1.75),
    shadowMapSize: handheld ? 1024 : 2048,
    reflection: !handheld,
  };
}
