/** Keep sharp still views without reallocating the drawing buffer every time
 * speed crosses a threshold. Only sustained frame pressure adjusts the moving
 * resolution; world geometry, simulation rates and shadows stay unchanged. */
export function createTraversalResolution({ deviceRatio = 1 } = {}) {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const still = Math.min(ratio, 1.75), maximum = Math.min(ratio, 1.25), minimum = Math.min(ratio, 1);
  let current = still, moving = maximum, rest = 0, window = 0, samples = 0, healthy = 0;
  return {
    get ratio() { return current; },
    update({ elapsedMs, traversing = false, visible = true } = {}) {
      if (!visible || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > 100) return current;
      if (!traversing) {
        rest += elapsedMs;
        window = samples = healthy = 0;
        if (rest >= 1200) { current = still; moving = maximum; }
        return current;
      }
      rest = 0;
      current = moving;
      window += elapsedMs; samples++;
      if (window < 700) return current;
      const average = window / samples;
      if (average > 21.5) { moving = Math.max(minimum, moving - .125); healthy = 0; }
      else if (average < 17.8) {
        healthy += window;
        if (healthy >= 2800) { moving = Math.min(maximum, moving + .125); healthy = 0; }
      } else healthy = 0;
      window = samples = 0;
      current = moving;
      return current;
    },
  };
}

/** Campus meshes have fixed world positions. Cache both transforms once so the
 * main, shadow and lake reflection passes don't recompute the entire campus.
 * Instance buffers, visibility and materials remain free to update for LOD.
 * Call only for fixed subtrees, never the player, traffic or source water layer. */
export function cacheStaticTransforms(root) {
  if (!root) return 0;
  root.updateWorldMatrix(true, true);
  let count = 0;
  root.traverse(object => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
    count++;
  });
  return count;
}
