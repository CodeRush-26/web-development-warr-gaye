const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

function haversineDistance([lat1, lng1], [lat2, lng2]) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

function bearingBetween([lat1, lon1], [lat2, lon2]) {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((toDegrees(Math.atan2(y, x)) + 360) % 360);
}

function destinationPoint([lat, lon], bearing, distanceKm) {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const φ1 = toRadians(lat);
  const λ1 = toRadians(lon);
  const θ = toRadians(bearing);

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(angularDistance) + Math.cos(φ1) * Math.sin(angularDistance) * Math.cos(θ)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(angularDistance) * Math.cos(φ1),
      Math.cos(angularDistance) - Math.sin(φ1) * Math.sin(φ2)
    );

  return [toDegrees(φ2), ((toDegrees(λ2) + 540) % 360) - 180];
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function lineIntersectsSegment(p1, p2, p3, p4) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-9) return false;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

function lineIntersectsPolygon(start, end, polygon) {
  for (let i = 0; i < polygon.length - 1; i += 1) {
    if (lineIntersectsSegment(start, end, polygon[i], polygon[i + 1])) {
      return true;
    }
  }
  return false;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHeading(heading) {
  let value = heading % 360;
  if (value < 0) value += 360;
  return value;
}

module.exports = {
  haversineDistance,
  bearingBetween,
  destinationPoint,
  pointInPolygon,
  lineIntersectsPolygon,
  lineIntersectsSegment,
  clamp,
  normalizeHeading,
};
