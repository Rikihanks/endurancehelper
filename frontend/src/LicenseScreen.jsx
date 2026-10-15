import { useState } from 'react';
import { createCheckout, grantDevLicense } from './api.js';
import { AppIcon } from './components/AppIcon.jsx';

// Shown when the backend returns 402 (license_required). One product with two
// billing options: monthly or annual (annual is cheaper). In dev, a "fake
// license" tool is available (backend must be running with NODE_ENV !== prod).
const OPTIONS = [
  { id: 'monthly', name: 'Mensual', price: 'Precio mensual', note: 'Paga mes a mes' },
  { id: 'annual', name: 'Anual', price: 'Precio anual', note: 'Más barato · paga una vez al año' },
];

export default function LicenseScreen({ onRetry }) {
  const [msg, setMsg] = useState('');
  const isDev = import.meta.env.DEV;

  async function subscribe(interval) {
    setMsg('');
    try {
      const d = await createCheckout(interval);
      if (d.url) window.location.href = d.url;
      else setMsg('✗ No se pudo iniciar el pago');
    } catch (e) {
      setMsg(`✗ ${e.message || 'fallo'}`);
    }
  }

  async function fakeLicense(interval) {
    setMsg('');
    try {
      await grantDevLicense(interval);
      window.location.reload();
    } catch (e) {
      setMsg(`✗ ${e.message || 'fallo'}`);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card license-card">
        <div className="login-logo"><AppIcon name="lock" size={52} stroke={1.5} /></div>
        <h1 className="login-title">Tu equipo necesita una licencia</h1>
        <p className="login-sub">Todos nuestros planes incluyen 10 pilotos, estrategia en tiempo real y análisis post resistencia. Elige cómo pagar.</p>
        <div className="plan-list">
          {OPTIONS.map((p) => (
            <button key={p.id} className="plan-card" onClick={() => subscribe(p.id)}>
              <span className="plan-name">{p.name}</span>
              <span className="plan-cta">Suscribirse →</span>
              <span className="plan-price">{p.price}</span>
              <span className="plan-perks">{p.note}</span>
            </button>
          ))}
        </div>
        {isDev && (
          <div className="dev-tool">
            <span className="dev-tool-label">Modo desarrollo — sin Stripe:</span>
            <button onClick={() => fakeLicense('monthly')}>Fake licencia Mensual</button>
            <button onClick={() => fakeLicense('annual')}>Fake licencia Anual</button>
          </div>
        )}
        {msg && <p className="login-error">{msg}</p>}
        <button className="login-btn-ghost" onClick={onRetry}>Reintentar</button>
      </div>
    </div>
  );
}
