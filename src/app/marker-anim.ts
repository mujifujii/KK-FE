/**
 * Sanfte Marker-Bewegung zwischen den ~3 Server-Updates pro Sekunde.
 *
 * Das Backend liefert nur alle ~300 ms neue Positionen. Ohne Zwischenschritte
 * "springen" die Marker (sieht ruckelig aus, unabhängig von der Spielerzahl).
 * Hier wird per requestAnimationFrame zur jeweils letzten bekannten Position
 * geglidet -> flüssig (~60 fps) und unabhängig vom Netzwerk-Takt. Das versteckt
 * auch den Jitter des ngrok-Tunnels.
 *
 * Die Zustands-Felder hängen direkt am (untypisierten) Leaflet-Marker.
 */

// Etwas länger als der 300-ms-Server-Takt -> keine Mikro-Stopps bei leichtem Jitter.
export const TWEEN_MS = 320;

/** Neues Ziel setzen: ab der aktuellen Position sanft dorthin gleiten. */
export function setMarkerTarget(marker: any, lat: number, lng: number): void {
  const cur = marker.getLatLng();
  marker.__from = { lat: cur.lat, lng: cur.lng };
  marker.__to = { lat, lng };
  marker.__t0 = performance.now();
  marker.__done = false;
}

/** Einen Animationsschritt rechnen. Tut nichts, wenn der Marker am Ziel ist. */
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
