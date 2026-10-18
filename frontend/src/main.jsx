import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import Landing from './Landing.jsx';
import RaceBoxPocPage from './features/racebox-poc/RaceBoxPocPage.jsx';
import './styles.css';

// Same site, multiple routes:
//   "/"         landing
//   "/app"      the InLap app (backend serves the same build)
//   "/racebox"  isolated BLE diagnostic PoC (also via "#racebox", which works
//               inside the Capacitor container where the start path is "/")
//
// The existing routes keep their exact previous behaviour.
function routeFromLocation() {
  const path = window.location.pathname || '/';
  const hash = window.location.hash || '';
  if (path.startsWith('/racebox') || hash === '#racebox' || hash.startsWith('#racebox')) {
    return 'racebox';
  }
  if (path.startsWith('/app')) return 'app';
  return 'landing';
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
  if (route === 'app') return <App />;
  return <Landing />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
