import { useEffect, useRef, useState } from 'react';
import {
  getSetupStatus,
  getConfig,
  saveConfig,
  setCircuit,
  toggleOffline,
  captureQualy,
  clearQualy,
  connectLive,
  googleLogin,
  logout,
  getMe,
  getMyOrg,
  finishRaceSession,
  onLicenseRequired,
} from './api.js';
import SetupPage from './SetupPage.jsx';
import Topbar from './components/Topbar.jsx';
import Standings from './components/Standings.jsx';
import Strategy from './components/Strategy.jsx';
import Explanation from './components/Explanation.jsx';
import RelativePace from './components/RelativePace.jsx';
import Timeline from './components/Timeline.jsx';
import Stints from './components/Stints.jsx';
import Qualy from './components/Qualy.jsx';
import Comments from './components/Comments.jsx';
import InLapBoxRaceModal from './components/InLapBoxRaceModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import MenuBar from './components/MenuBar.jsx';
import { AppIcon } from './components/AppIcon.jsx';
import LoginScreen from './LoginScreen.jsx';
import LicenseScreen from './LicenseScreen.jsx';
import OnboardingScreen from './OnboardingScreen.jsx';
import HomeScreen from './HomeScreen.jsx';
import ReportScreen from './ReportScreen.jsx';
import TeamScreen from './TeamScreen.jsx';
import AdminDashboard from './AdminDashboard.jsx';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [authed, setAuthed] = useState(false); // true when logged in via Google
  const [setupComplete, setSetupComplete] = useState(null);
  const [view, setView] = useState(null);
  const [config, setConfig] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('eh-theme') || 'dark');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inlapBoxOpen, setInlapBoxOpen] = useState(false);
  const [stepOffset, setStepOffset] = useState(0);
  const [qualyMsg, setQualyMsg] = useState('');
  const [licenseRequired, setLicenseRequired] = useState(false);
  const [onboardingRequired, setOnboardingRequired] = useState(null);
  const [teamInfo, setTeamInfo] = useState(null); // { name, plan }
  const [isAdmin, setIsAdmin] = useState(false); // GLOBAL admin (platform-wide)
  const [orgRole, setOrgRole] = useState(null); // membership role in own org (member|admin|owner)
  const [adminOpen, setAdminOpen] = useState(false); // global admin dashboard
  const [teamOpen, setTeamOpen] = useState(false); // org team/member management
  const [activeSessionId, setActiveSessionId] = useState(null); // DB race session in live view
  const [reportSessionId, setReportSessionId] = useState(null); // session shown in ReportScreen
  const [editorConfigId, setEditorConfigId] = useState(undefined); // race_config editor (null=new, string=edit)
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  function showToast(text, tone = 'ok') {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }
  const [liveAnim, setLiveAnim] = useState(false);
  const disclaimerShownRef = useRef(false);
  const viewRef = useRef(null);
  viewRef.current = view;
  const liveRef = useRef(null);

  // theme on <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Restore an existing session on reload (HttpOnly cookie): skip the login
  // screen if /api/auth/me recognizes us.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await getMe();
        if (alive && me?.user) {
          setLoggedIn(true);
          setAuthed(true);
        }
      } catch (_) {
        /* no session */
      }
    })();
    return () => { alive = false; };
  }, []);

  // Legacy (no Google) bootstrap: default single-session flow.
  useEffect(() => {
    if (!loggedIn || authed) return;
    let alive = true;
    (async () => {
      try {
        const st = await getSetupStatus();
        if (!alive) return;
        setSetupComplete(!!st.complete);
        if (st.complete) {
          const cfg = await getConfig();
          if (!alive) return;
          setConfig(cfg);
          setTheme(cfg.ui?.theme || 'dark');
          liveRef.current = connectLive((snap) => setView(snap.view || snap));
        }
      } catch (_) {
        if (alive) setSetupComplete(false);
      }
    })();
    return () => { alive = false; };
  }, [loggedIn, authed]);

  // After Google login, ask the backend whether the user must onboard.
  useEffect(() => {
    if (!loggedIn || !authed) return;
    let alive = true;
    (async () => {
      try {
        const me = await getMe();
        if (!alive) return;
        setIsAdmin(!!me.user?.isAdmin);
        setOrgRole(me.org?.role || null);
        setOnboardingRequired(!!me.onboardingRequired);
        if (!me.onboardingRequired) {
          const o = await getMyOrg();
          if (alive && o.org) setTeamInfo({ name: o.org.name, plan: o.org.plan });
        }
      } catch (_) {
        if (alive) setOnboardingRequired(false);
      }
    })();
    return () => { alive = false; };
  }, [loggedIn, authed]);

  // Live view: connect the WebSocket to the chosen race session.
  useEffect(() => {
    if (!authed || !activeSessionId) return;
    liveRef.current = connectLive((snap) => setView(snap.view || snap), activeSessionId, (msg) => {
      if (msg.event === 'connected') {
        showToast(`InLapBox conectado: ${msg.detail || ''}`, 'ok');
      } else if (msg.event === 'disconnected') {
        showToast(`InLapBox desconectado: ${msg.detail || ''}`, 'warn');
      }
    });
    return () => {
      liveRef.current?.();
      liveRef.current = null;
    };
  }, [authed, activeSessionId]);

  // Disclaimer modal: show once per race session the first time the live view
  // becomes active (sessionStorage = one acceptance per browser session). The
  // live-view entrance animation is deferred until the modal is accepted so it
  // is actually visible.
  useEffect(() => {
    if (!view || disclaimerShownRef.current) return;
    disclaimerShownRef.current = true;
    const key = `inlap-disclaimer-${activeSessionId || 'legacy'}`;
    if (sessionStorage.getItem(key)) { setLiveAnim(true); return; }
    setDisclaimerOpen(true);
  }, [view, activeSessionId]);

  // Load the active session's config so Ajustes shows its circuit URL etc.
  useEffect(() => {
    if (!authed || !activeSessionId) return;
    let alive = true;
    (async () => {
      try {
        const cfg = await getConfig(activeSessionId);
        if (!alive) return;
        setConfig(cfg);
      } catch (_) {
        /* session runtime not ready */
      }
    })();
    return () => { alive = false; };
  }, [authed, activeSessionId]);

  // Centralized 402 handling (spec 16): close WS, clear race state, show the
  // license screen and block actions that require a license.
  useEffect(() => {
    return onLicenseRequired(() => {
      liveRef.current?.();
      liveRef.current = null;
      setView(null);
      setActiveSessionId(null);
      setLicenseRequired(true);
    });
  }, []);

  async function handleLogout() {
    try { await logout(); } catch (_) {}
    setLoggedIn(false);
    setAuthed(false);
    setAdminOpen(false);
    setTeamOpen(false);
    setActiveSessionId(null);
    setReportSessionId(null);
    setEditorConfigId(undefined);
    setView(null);
  }

  if (licenseRequired) {
    return (
      <LicenseScreen
        onRetry={() => {
          setLicenseRequired(false);
          window.location.reload();
        }}
      />
    );
  }

  if (!loggedIn) {
    return (
      <LoginScreen
        onEnter={() => { setLoggedIn(true); setAuthed(false); }}
        googleClientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}
        onGoogleLogin={async (credential) => {
          await googleLogin(credential);
          setLoggedIn(true);
          setAuthed(true);
        }}
      />
    );
  }

  if (authed && onboardingRequired === null) return null;

  if (authed && onboardingRequired) {
    return <OnboardingScreen onComplete={() => { setOnboardingRequired(false); }} />;
  }

  // ---- Authed flow: Home -> editor -> session (live or report) ----
  if (authed) {
    if (adminOpen && isAdmin) {
      return <AdminDashboard onBack={() => setAdminOpen(false)} />;
    }
    if (teamOpen && orgRole) {
      return (
        <TeamScreen
          onBack={() => setTeamOpen(false)}
          canManageOwner={orgRole === 'owner' || isAdmin}
          canManageDevices={orgRole === 'owner' || orgRole === 'admin' || isAdmin}
        />
      );
    }
    if (reportSessionId) {
      return <ReportScreen sessionId={reportSessionId} onBack={() => setReportSessionId(null)} />;
    }
    if (editorConfigId !== undefined) {
      return (
        <SetupPage
          authed
          configId={editorConfigId}
          onDone={(id) => {
            setEditorConfigId(undefined); // close the editor
            setActiveSessionId(id);
          }}
          onCancel={() => setEditorConfigId(undefined)}
        />
      );
    }
    if (!activeSessionId) {
      return (
        <HomeScreen
          team={teamInfo?.name}
          plan={teamInfo?.plan}
          onStartSession={(id) => { setActiveSessionId(id); }}
          onOpenSession={(id) => { setActiveSessionId(id); }}
          onOpenReport={(id) => { setReportSessionId(id); }}
          onCreateConfig={() => setEditorConfigId(null)}
          onEditConfig={(id) => setEditorConfigId(id)}
          onLogout={handleLogout}
          onOpenTeam={() => setTeamOpen(true)}
          onOpenAdmin={() => setAdminOpen(true)}
          isAdmin={isAdmin}
          orgRole={orgRole}
        />
      );
    }
    if (!view) {
      return <div id="root" className="card" style={{ padding: 24 }}>Esperando datos de la sesión...</div>;
    }
  }

  // ---- Legacy (no Google) flow ----
  if (!authed) {
    if (setupComplete === null) return null;
    if (!setupComplete) return <SetupPage />;
    if (!view || !config) {
      return <div id="root" className="card" style={{ padding: 24 }}>Esperando datos...</div>;
    }
  }

  const sessionQ = activeSessionId || null;

  async function postConfig(patch) {
    try {
      const cfg = await saveConfig({ ...patch, theme }, sessionQ);
      setConfig(cfg);
      setTheme(cfg.ui?.theme || theme);
    } catch (e) {
      console.error(e);
    }
  }

  function handleSelectTeam(kart) {
    postConfig({ ourKart: kart });
  }

  function handleNextStop(v) {
    const tb = viewRef.current?.topbar;
    const base = tb ? tb.nextStop.base : 0;
    if (typeof v === 'number') {
      setStepOffset((o) => o + v);
    } else {
      const parsed = parseInt(v, 10);
      setStepOffset((isNaN(parsed) ? 0 : parsed) - base);
    }
  }

  // "Llamar a parada": zero the counter so the crew counts down from the call.
  function handleCallPitStop() {
    const base = viewRef.current?.topbar?.nextStop?.base ?? 0;
    setStepOffset(-base);
  }

  function handleAcceptDisclaimer() {
    sessionStorage.setItem(`inlap-disclaimer-${activeSessionId || 'legacy'}`, '1');
    setDisclaimerOpen(false);
    setLiveAnim(true);
  }

  // Overlay the manual stop offset for display only (pure presentation).
  const displayView = view.topbar
    ? {
        ...view,
        topbar: {
          ...view.topbar,
          nextStop: {
            ...view.topbar.nextStop,
            value:
              view.topbar.nextStop.value === ''
                ? ''
                : Math.max(0, view.topbar.nextStop.base + stepOffset),
            urgent: view.topbar.nextStop.value !== '' && Math.max(0, view.topbar.nextStop.base + stepOffset) < 2,
          },
        },
      }
    : view;

  async function handleOffline() {
    const d = await toggleOffline(!view.offline, sessionQ);
    if (d) setView((v) => ({ ...v, offline: d.offline }));
  }

  async function handleFinish() {
    if (!activeSessionId) return;
    if (!window.confirm('¿Finalizar la carrera?')) return;
    try {
      await finishRaceSession(activeSessionId);
      setActiveSessionId(null);
      setView(null);
    } catch (e) {
      console.error(e);
    }
  }

  function handleTheme(t) {
    setTheme(t);
    localStorage.setItem('eh-theme', t);
  }
  const liveMenus = authed
    ? [
        {
          label: 'Archivo',
          items: [
            { label: 'Inicio', action: () => { setActiveSessionId(null); setView(null); } },
            { label: 'Finalizar carrera', action: handleFinish },
            { divider: true },
            { label: 'Cerrar sesión', action: handleLogout, danger: true },
          ],
        },
        {
          label: 'Ver',
          items: [
            { label: 'Configuración (circuito)', action: () => setSettingsOpen(true) },
            { label: 'Comandos InLapBox', action: () => setInlapBoxOpen(true) },
            { divider: true },
            { label: 'Tema oscuro', checked: theme === 'dark', action: () => handleTheme('dark') },
            { label: 'Tema claro', checked: theme === 'light', action: () => handleTheme('light') },
            { divider: true },
            { label: 'Modo offline', checked: !!view?.offline, action: handleOffline },
          ],
        },
      ]
    : [];

  return (
    <>
      <div className="app-head">
        {authed && <MenuBar menus={liveMenus} />}
        <span id="circuit-msg" className="sr-only"></span>
        <Topbar
          view={displayView}
          config={config}
          onWeather={(v) => postConfig({ weather: v })}
          onSurface={(v) => postConfig({ trackCondition: v })}
          onPilot={(v) => postConfig({ manualDriverIdx: parseInt(v, 10) })}
          onObjective={(v) => postConfig({ raceObjective: v })}
        onNextStop={handleNextStop}
        onCallPitStop={handleCallPitStop}
        onOpenSettings={() => setSettingsOpen(true)}
          onToggleOffline={handleOffline}
          showControls={!authed}
        />
      </div>

      <div id="main-area" className={liveAnim ? 'live-anim' : ''}>
        <div id="standings-section" className="card">
          <Standings rows={view.standings} onSelect={handleSelectTeam} />
        </div>
        <Strategy
          rows={view.strategy.rows}
          objectiveValue={view.topbar.raceObjectiveValue}
          onObjective={(v) => postConfig({ raceObjective: v })}
        />
      </div>

      <div id="timeline-section" className={`card${liveAnim ? ' live-anim' : ''}`}>
        <Timeline timeline={view.timeline} />
      </div>

      <div id="mid-area" className={liveAnim ? 'live-anim' : ''}>
        <section id="our-panel" className="card">
          <h2>Razonamiento de parada</h2>
          <div id="explanation"><Explanation items={view.explanation} /></div>
        </section>
        <RelativePace paceRows={view.pace.rows} rows={view.relative} onSelect={handleSelectTeam} />
      </div>

      <div id="below-area" className={liveAnim ? 'live-anim' : ''}>
        <section id="stint-panel" className="card"><h2>Our Stints</h2><div id="stints"><Stints stints={view.stints} /></div></section>
        <section id="qualy-panel" className="card">
          <h2>Qualifying Analysis</h2>
          <Qualy
            qualy={view.qualy}
            message={qualyMsg}
            onCapture={async () => {
              setQualyMsg('capturing...');
              try {
                const d = await captureQualy(sessionQ);
                setQualyMsg(`✓ ${d.drivers.length}`);
                setTimeout(() => setQualyMsg(''), 4000);
              } catch (e) {
                setQualyMsg(`✗ ${e.message}`);
              }
            }}
            onClear={async () => {
              await clearQualy(sessionQ);
              setQualyMsg('cleared');
              setTimeout(() => setQualyMsg(''), 3000);
            }}
          />
        </section>
        <section id="comments-panel" className="card"><h2>Race Comments</h2><div id="comments"><Comments comments={view.comments} /></div></section>
      </div>

      <SettingsModal
        open={settingsOpen}
        config={config}
        onClose={() => setSettingsOpen(false)}
        onSave={async (payload) => {
          const cfg = await saveConfig(payload, sessionQ);
          setConfig(cfg);
          setTheme(cfg.ui?.theme || theme);
          setSettingsOpen(false);
        }}
        onReconnect={async (url) => {
          await setCircuit(url, sessionQ);
        }}
      />

      <InLapBoxRaceModal
        open={inlapBoxOpen}
        onClose={() => setInlapBoxOpen(false)}
        activeDriverName={config?.race?.drivers?.[config?.race?.manualDriverIdx]?.name}
      />

      {disclaimerOpen && (
        <div id="disclaimer-modal" className="modal-overlay modal-overlay-center">
          <div className="modal-card disclaimer-card">
            <div className="modal-head">
              <h2><AppIcon name="flag" size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} /> Disclaimer</h2>
              <button className="modal-x" title="Cerrar" onClick={handleAcceptDisclaimer}><AppIcon name="x" size={18} /></button>
            </div>
            <div className="modal-body">
              <p>
                <b>inlap</b> es un software que utiliza algoritmos matemáticos para ayudar a los pilotos y a los
                ingenieros de pista con la estrategia de la resistencia.
              </p>
              <p>
                En ningún momento sustituye al sentido común ni a las decisiones humanas. <b>Las decisiones finales
                son siempre del equipo</b>, y el software es simplemente una herramienta de ayuda.
              </p>
            </div>
            <div className="modal-footer">
              <button id="disclaimer-accept" className="login-btn" onClick={handleAcceptDisclaimer}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications (ESP32 connect/disconnect, etc.) */}
      {toasts.length > 0 && (
        <div className="eh-toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`eh-toast ${t.tone}`}>
              <span className="eh-toast-dot" />
              {t.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
