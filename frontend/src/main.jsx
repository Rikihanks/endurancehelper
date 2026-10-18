import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import Landing from './Landing.jsx';
import RaceBoxPocPage from './features/racebox-poc/RaceBoxPocPage.jsx';
import { isNativePlatform } from './services/bluetooth/index.js';
import './styles.css';

// Same site, multiple routes:
//   "/"         landing
//   "/app"      the InLap app (backend serves the same build)
//   "/racebox"  isolated BLE diagnostic PoC
//
// Inside the Capacitor container the start path is "/" and the user cannot type
// a URL, so the hash form ("#racebox", "#app", "#home") is the one that works
// there. Exact hashes take priority so they work regardless of the pathname.
function routeFromLocation() {
  const path = window.location.pathname || '/';
  const hash = window.location.hash || '';
  if (hash === '#racebox') return 'racebox';
  if (hash === '#app') return 'app';
  if (hash === '#home' || hash === '#') return 'landing';
  if (path.startsWith('/racebox')) return 'racebox';
  if (path.startsWith('/app')) return 'app';
  return 'landing';
}

// The PoC link is only exposed during development or inside the native app, so
// the public landing page stays unchanged for web users.
function showPocLink() {
  if (import.meta.env.DEV) return true;
  return isNativePlatform();
}

function navigate(hash) {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

function PocLauncher() {
  if (!showPocLink()) return null;
  return (
    <button
      type="button"
      onClick={() => navigate('#racebox')}
      style={{
        position: 'fixed',
        top: 14,
        right: 14,
        zIndex: 9999,
        padding: '10px 14px',
        borderRadius: 999,
        border: '1px solid #e2a33d',
        background: 'rgba(20,22,26,0.92)',
        color: '#f5f5f5',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.02em',
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
      }}
    >
      RaceBox PoC
    </button>
  );
}

function Root() {
  const [route, setRoute] = useState(routeFromLocation);

  useEffect(() => {
    const onChange = () => setRoute(routeFromLocation());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  if (route === 'racebox') return <RaceBoxPocPage />;
  return (
    <>
      <PocLauncher />
      {route === 'app' ? <App /> : <Landing />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
