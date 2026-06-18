function resolveBackendBase(): string {
  const override = typeof localStorage !== 'undefined' ? localStorage.getItem('backendUrl') : null;
  if (override) {
    return override.replace(/\/$/, '');
  }
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:8080';
  }

  return 'https://nondeficiently-indeterministic-mignon.ngrok-free.dev';
}

export const API_BASE = resolveBackendBase();

export const WS_URL = API_BASE.replace(/^http/, 'ws') + '/ws/state';
