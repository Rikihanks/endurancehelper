// Google Identity Services loader. Returns a promise of `window.google.accounts`
// but ONLY once the API is actually ready. NOTE: the real GIS API lives under
// `google.accounts.id.*` (initialize / renderButton) — `google.accounts` alone
// has no `initialize`.

let cached = null;

export function loadGoogleAccounts() {
  if (cached) return cached;
  cached = new Promise((resolve, reject) => {
    const isReady = () => {
      const id = window.google && window.google.accounts && window.google.accounts.id;
      return !!(id && typeof id.initialize === 'function');
    };

    if (isReady()) return resolve(window.google.accounts);

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const started = Date.now();
      const poll = () => {
        if (isReady()) return resolve(window.google.accounts);
        if (Date.now() - started > 8000) {
          cached = null; // allow a retry later
          return reject(new Error('Google Identity Services no se inicializó a tiempo'));
        }
        setTimeout(poll, 100);
      };
      poll();
    };
    script.onerror = () => {
      cached = null; // allow a retry later
      reject(new Error('No se pudo cargar Google Identity Services'));
    };
    document.head.appendChild(script);
  });
  return cached;
}

// Render a Google sign-in button. `onCredential` receives the id_token.
export async function renderGoogleButton({ clientId, target, onCredential }) {
  const accounts = await loadGoogleAccounts();
  const id = accounts && accounts.id;
  if (!id || typeof id.initialize !== 'function') {
    throw new Error('Google Identity Services no disponible');
  }
  // StrictMode double-mounts effects in dev; clear the container first so the
  // button is never rendered twice over itself.
  if (target) target.innerHTML = '';
  id.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response && response.credential) onCredential(response.credential);
    },
  });
  id.renderButton(target, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
}
