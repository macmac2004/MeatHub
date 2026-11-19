const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim();

export function resolveApiUrl() {
  if (!configuredApiUrl) return '';

  try {
    const configured = new URL(configuredApiUrl);
    const browserHost = window.location.hostname;
    const isLocalBrowser = browserHost === 'localhost' ||
      browserHost === '127.0.0.1' ||
      browserHost === '[::1]' ||
      browserHost.endsWith('.localhost');
    const isLocalApi = configured.hostname === 'localhost' ||
      configured.hostname === '127.0.0.1' ||
      configured.hostname === '[::1]' ||
      configured.hostname.endsWith('.localhost');

    if (isLocalApi && !isLocalBrowser) return '';
  } catch {
    return configuredApiUrl.replace(/\/$/, '');
  }

  return configuredApiUrl.replace(/\/$/, '');
}

export const API_URL = resolveApiUrl();
