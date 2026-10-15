import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import Landing from './Landing.jsx';
import './styles.css';

// Same site, two routes: "/" = landing, "/app" = the app. The backend serves
// both from the same build, so everything shares one origin (SameSite=Lax).
const isApp = window.location.pathname.startsWith('/app');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isApp ? <App /> : <Landing />}</React.StrictMode>
);
