/**
 * Zentrale Backend-Adresse für REST und WebSocket.
 *
 * Reihenfolge:
 * 1. Override im Browser (für die wechselnde ngrok-URL, OHNE Neu-Deploy):
 *      localStorage.setItem('backendUrl', 'https://<id>.ngrok-free.app'); location.reload();
 * 2. Lokal (localhost) -> lokales Backend auf :8080.
 * 3. Sonst (z.B. Netlify) -> der hier eingetragene Fallback (deine ngrok-URL).
 */
function resolveBackendBase(): string {
  const override = typeof localStorage !== 'undefined' ? localStorage.getItem('backendUrl') : null;
  if (override) {
    return override.replace(/\/$/, '');
  }
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8080';
  }
  // ngrok-URL des lokalen Backends (bei ngrok-Neustart hier aktualisieren):
  return 'https://embargo-sappy-fragment.ngrok-free.dev';
}

export const API_BASE = resolveBackendBase();
// https -> wss, http -> ws
export const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws/state';
