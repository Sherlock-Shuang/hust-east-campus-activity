// Rigid wheel support on the route's estimated vertical profile. Coordinates
// and wheel dimensions are the same metre-scale ones used by commute-actors.
export function sampleVehicleContact(route, agent) {
  const points = route.points;
  function heightAt(progress) {
    const s = Math.max(0, Math.min(route.length, progress));
    let low = 1, high = points.length - 1;
    while (low < high) { const mid = (low + high) >> 1; if (points[mid].progress < s) low = mid + 1; else high = mid; }
    const a = points[low - 1], b = points[low];
    const t = (s - a.progress) / Math.max(.0001, b.progress - a.progress);
    return a.y + (b.y - a.y) * t - .02;
  }
  const s = agent.progress ?? 0, scale = Math.max(.5, agent.pathScale || 1), direction=agent.direction===-1?-1:1;
  const frontY = heightAt(s + direction*.59 / scale), rearY = heightAt(s - direction*.56 / scale);
  const pitch = Math.atan2(frontY - rearY, 1.15);
  const lean = Math.max(-.18, Math.min(.18, agent.lean || 0));
  // A tilted torus has support radius R*cos(lean)+tube, not the full radius.
  const support = .208 * Math.cos(lean) + .046;
  const originSurfaceY = (frontY * .56 + rearY * .59) / 1.15;
  const y = originSurfaceY + (support - .255 * Math.cos(lean)) / Math.cos(pitch);
  return { pitch, y, frontY, rearY, lean };
}
