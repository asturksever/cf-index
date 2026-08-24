// Is a point inside the London Banana? Standard even-odd ray-cast over the
// polygon's single ring — 403 vertices, so no geometry library is worth its
// bundle weight for this one test.
//
// The answer inherits the layer's honesty caveat: the source stroke is a
// freehand marker line 1-2 km wide on the ground, so near the edge this is
// a coin toss, not a survey. Callers should say "inside/outside" and stop.

/**
 * @param {number} lng
 * @param {number} lat
 * @param {[number, number][]} ring closed or open [lng, lat] ring
 * @returns {boolean}
 */
export function insideBanana(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
