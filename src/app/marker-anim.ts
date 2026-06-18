export const TWEEN_MS = 320;

export function setMarkerTarget(marker: any, lat: number, lng: number): void {
  const cur = marker.getLatLng();
  marker.__from = { lat: cur.lat, lng: cur.lng };
  marker.__to = { lat, lng };
  marker.__t0 = performance.now();
  marker.__done = false;
}

export function tweenMarker(marker: any, now: number, dur: number = TWEEN_MS): void {
  if (marker.__done || !marker.__to || !marker.__from) {
    return;
  }
  const t = Math.min((now - marker.__t0) / dur, 1);
  marker.setLatLng([
    marker.__from.lat + (marker.__to.lat - marker.__from.lat) * t,
    marker.__from.lng + (marker.__to.lng - marker.__from.lng) * t,
  ]);
  if (t >= 1) {
    marker.__done = true;
  }
}
