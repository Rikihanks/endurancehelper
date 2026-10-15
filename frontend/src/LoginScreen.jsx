import { useEffect, useRef, useState } from 'react';
import { renderGoogleButton } from './auth/google.js';
import { AppIcon } from './components/AppIcon.jsx';
import logo from '../assets/inlap-logo-sm.png';

// Login / entry screen for InLap Karting.
// When a Google client id is configured (VITE_GOOGLE_CLIENT_ID) it renders the
// Google Identity Services button; otherwise it falls back to the plain
// "Entrar" button so the app keeps working without OAuth configured.
export default function LoginScreen({ onEnter, onGoogleLogin, googleClientId }) {
  const [googleError, setGoogleError] = useState('');
  const gsiRef = useRef(null);
  const onGoogleLoginRef = useRef(onGoogleLogin);
  onGoogleLoginRef.current = onGoogleLogin;

  useEffect(() => {
    if (!googleClientId || !gsiRef.current) return;
    let cancelled = false;
    renderGoogleButton({
      clientId: googleClientId,
      target: gsiRef.current,
      onCredential: (credential) => {
        if (cancelled) return;
        onGoogleLoginRef.current?.(credential).catch((e) => setGoogleError(e.message || 'Error al iniciar sesión'));
      },
    }).catch((e) => {
      if (!cancelled) setGoogleError(e.message || 'No se pudo cargar Google');
    });
    return () => { cancelled = true; };
  }, [googleClientId]);

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo"><img className="login-logo-img" src={logo} alt="InLap Karting" /></div>
        <h1 className="login-title">InLap Karting</h1>
        <p className="login-sub">Motor de estrategia.</p>
        {googleClientId ? (
          <div ref={gsiRef} className="login-gsi"></div>
        ) : (
          <button className="login-btn" onClick={onEnter}>
            Entrar
          </button>
        )}
        {googleError && <p className="login-error">{googleError}</p>}
        <p className="login-hint">
          {googleClientId ? 'Inicio de sesión con Google' : 'Inicio de sesión con Google disponible próximamente'}
        </p>
      </div>
    </div>
  );
}
