import { useEffect, useRef, useState } from 'react';
import { listMembers, addMember, setMemberRole, removeMember, getMyLicense, getMyOrg, getMe, listEsp32Devices, deleteEsp32Device, getOrCreateEsp32Password, regenerateEsp32Password, updateEsp32Device, registerEsp32Device, getEsp32DeviceToken } from './api.js';
import { AppIcon } from './components/AppIcon.jsx';
import InLapBoxCommands from './components/InLapBoxCommands.jsx';

const NAV = [
  { id: 'resumen', label: 'Resumen', icon: 'dashboard' },
  { id: 'members', label: 'Miembros', icon: 'users' },
  { id: 'devices', label: 'Dispositivos', icon: 'cpu' },
  { id: 'license', label: 'Licencia', icon: 'license' },
  { id: 'settings', label: 'Ajustes', icon: 'settings' },
];
const PLAN = { monthly: 'Mensual', annual: 'Anual' };
const LIC_STATUS = {
  active: ['Activa', 'ok'],
  trialing: ['Prueba', 'gold'],
  past_due: ['Impago', 'warn'],
  canceled: ['Cancelada', 'off'],
  expired: ['Expirada', 'off'],
};

function initials(name, email) {
  const s = (name || email || '?').trim();
  const parts = s.split(/[\s@]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function Badge({ tone = 'off', children }) {
  return <span className={`a-badge a-badge-${tone}`}>{children}</span>;
}
function IconBtn({ icon, tone, title, disabled, onClick }) {
  return <button className={`a-icon${tone ? ` a-icon-${tone}` : ''}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}><AppIcon name={icon} size={17} stroke={1.9} /></button>;
}

export default function TeamScreen({ onBack, canManageOwner, canManageDevices }) {
  const [view, setView] = useState('resumen');
  const [me, setMe] = useState(null);
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState(null);
  const [license, setLicense] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandDevice, setCommandDevice] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const timer = useRef(null);

  const navItems = NAV.filter((n) => n.id !== 'devices' || canManageDevices);

  const notify = (msg, type = 'ok') => {
    clearTimeout(timer.current);
    setToast({ msg, type });
    timer.current = setTimeout(() => setToast(null), 2500);
  };
  const ask = (message, title = 'Confirmar') => new Promise((resolve) => setConfirm({ message, title, resolve }));

  const load = async () => {
    try { setMembers((await listMembers()).members || []); }
    catch (e) { notify(e.message || 'Error', 'err'); }
    getMyLicense().then((d) => setLicense(d.license)).catch(() => {});
  };
  useEffect(() => { load(); getMe().then(setMe).catch(() => {}); getMyOrg().then((o) => setTeam(o.org || null)).catch(() => {}); }, []);

  const act = async (fn, okMsg) => {
    try { await fn(); notify(okMsg); await load(); }
    catch (e) { notify(e.message || 'Error', 'err'); }
  };

  const nav = (v) => { setView(v); setSidebarOpen(false); };
  const roleLabel = me?.org?.role === 'owner' ? 'Propietario' : me?.org?.role === 'admin' ? 'Admin' : 'Miembro';
  const licTone = license ? (LIC_STATUS[license.status]?.[1] || 'off') : 'off';

  return (
    <div className="a-shell">
      <aside className={`a-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="a-brand">
          <span className="a-brand-mark">IN</span>
          <div className="a-brand-text"><strong>INLAP</strong><small>PANEL DE EQUIPO</small></div>
        </div>
        <nav className="a-nav">
          {navItems.map((n) => (
            <button key={n.id} className={`a-nav-item${view === n.id ? ' active' : ''}`} onClick={() => nav(n.id)}>
              <AppIcon name={n.icon} size={18} stroke={1.8} /><span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="a-side-user">
          <div className="a-avatar sm">{initials(me?.user?.name, me?.user?.email)}</div>
          <div className="a-side-user-text">
            <strong>{me?.user?.name || 'Miembro'}</strong>
            <small>{roleLabel}</small>
          </div>
          <button className="a-side-user-menu" title="Volver" onClick={onBack}><AppIcon name="logout" size={17} stroke={1.8} /></button>
        </div>
      </aside>

      {sidebarOpen && <div className="a-backdrop" onClick={() => setSidebarOpen(false)} />}

      <main className="a-main">
        <header className="a-head">
          <div className="a-head-title">
            <button className="a-burger" onClick={() => setSidebarOpen(true)} aria-label="Menú"><AppIcon name="gauge" size={20} stroke={1.8} /></button>
            <div>
              <h1 style={{ fontSize: 26 }}>Panel del equipo</h1>
              <p className="a-head-sub"><span className="a-dot" /> {team?.name ? `EQUIPO · ${team.name.toUpperCase()}` : 'EQUIPO'}</p>
            </div>
          </div>
          <button className="a-back-btn" onClick={onBack}><AppIcon name="back" size={16} /> Volver al sitio</button>
        </header>

        <div className="a-content">
          {view === 'resumen' && <Resumen members={members} license={license} onNav={nav} navItems={navItems} />}
          {view === 'members' && <Members members={members} canManageOwner={canManageOwner} ask={ask} act={act} />}
          {view === 'devices' && canManageDevices && !commandDevice && <Devices notify={notify} ask={ask} onSelectDevice={setCommandDevice} />}
          {view === 'devices' && canManageDevices && commandDevice && (
            <InLapBoxCommands
              deviceId={commandDevice.id}
              deviceName={commandDevice.deviceName}
              pilotName={commandDevice.pilotName}
              connected={false}
              onBack={() => setCommandDevice(null)}
            />
          )}
          {view === 'license' && <License license={license} />}
          {view === 'settings' && <Settings />}
        </div>
      </main>

      {confirm && (
        <div className="a-overlay" onClick={() => { confirm.resolve(false); setConfirm(null); }}>
          <div className="a-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.title}</h3><p>{confirm.message}</p>
            <div className="a-modal-actions">
              <button className="a-btn" onClick={() => { confirm.resolve(false); setConfirm(null); }}>Cancelar</button>
              <button className="a-btn a-btn-danger" onClick={() => { confirm.resolve(true); setConfirm(null); }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`a-toast ${toast.type}`}><span className="a-toast-ico">{toast.type === 'ok' ? '✓' : '✗'}</span>{toast.msg}</div>}
    </div>
  );
}

function Resumen({ members, license, onNav, navItems }) {
  const m = members?.length;
  return (
    <>
      <div className="a-stats">
        <div className="a-stat">
          <div className="a-stat-ico"><AppIcon name="users" size={22} stroke={1.6} /></div>
          <div><div className="a-stat-num">{m ?? '—'}</div><div className="a-stat-sub">{m === 1 ? 'miembro' : 'miembros'} en el equipo</div></div>
        </div>
        <div className="a-stat">
          <div className="a-stat-ico"><AppIcon name="license" size={22} stroke={1.6} /></div>
          <div><div className="a-stat-num">{license ? PLAN[license.plan] || license.plan : '—'}</div><div className="a-stat-sub">plan de suscripción</div></div>
        </div>
        <div className="a-stat">
          <div className="a-stat-ico"><AppIcon name="user" size={22} stroke={1.6} /></div>
          <div><div className="a-stat-num ok">{license?.seats ?? '—'}</div><div className="a-stat-sub">plazas de licencia</div></div>
        </div>
      </div>
      <div className="a-quick">
        <h2 className="a-section-title">Acceso rápido</h2>
        <div className="a-quick-grid">
          {navItems.filter((n) => n.id !== 'resumen').map((n) => (
            <button key={n.id} className="a-quick-card" onClick={() => onNav(n.id)}>
              <AppIcon name={n.icon} size={20} stroke={1.7} /><span>{n.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function Members({ members, canManageOwner, ask, act }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);

  async function doAdd(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await act(() => addMember(email.trim(), role), 'Miembro añadido');
      setEmail(''); setRole('member');
    } finally { setBusy(false); }
  }

  return (
    <section className="a-card">
      <div className="a-card-head">
        <div><h2 className="a-card-title">Miembros</h2><p className="a-card-sub">Gestiona los miembros del equipo</p></div>
      </div>

      <form className="a-addrow" onSubmit={doAdd}>
        <input className="a-input" placeholder="Email del miembro" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select className="a-input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">Miembro</option>
          <option value="admin">Admin</option>
          {canManageOwner && <option value="owner">Propietario</option>}
        </select>
        <button className="a-btn a-btn-gold" disabled={busy}>{busy ? '…' : '+ Añadir miembro'}</button>
      </form>

      <div className="a-list">
        {!members && <p className="a-muted">Cargando…</p>}
        {members && members.length === 0 && <p className="a-muted">Sin miembros todavía. Añade a tu equipo desde aquí.</p>}
        {(members || []).map((m) => (
          <div className="a-row" key={m.userId}>
            <div className="a-avatar">{initials(m.name, m.email)}</div>
            <div className="a-row-main">
              <span className="a-name">{m.name || 'Sin nombre'} {m.role === 'owner' && <Badge tone="gold">Propietario</Badge>}</span>
              <span className="a-sub mono">{m.email || m.userId}</span>
            </div>
            <div className="a-row-actions">
              <select className="a-input xs inline" value={m.role} disabled={m.role === 'owner' && !canManageOwner}
                onChange={(e) => act(() => setMemberRole(m.userId, e.target.value), 'Rol actualizado')}>
                <option value="member">Miembro</option>
                <option value="admin">Admin</option>
                {canManageOwner && <option value="owner">Propietario</option>}
              </select>
              <IconBtn icon="trash" tone="danger" title={m.role === 'owner' ? 'El propietario no se puede quitar' : 'Quitar miembro'} disabled={m.role === 'owner'}
                onClick={async () => { if (await ask(`¿Quitar a ${m.name || m.email} del equipo?`, 'Quitar miembro')) { await act(() => removeMember(m.userId), 'Miembro eliminado'); } }} />
            </div>
          </div>
        ))}
      </div>
      <p className="a-note">Solo el propietario (o un admin global) puede conceder el rol de propietario y degradar o quitar a otro propietario.</p>
    </section>
  );
}

function License({ license }) {
  if (!license) return <section className="a-card"><p className="a-muted">Cargando…</p></section>;
  const tone = LIC_STATUS[license.status]?.[1] || 'off';
  return (
    <section className="a-card a-license-card">
      <div className="a-card-head">
        <div><h2 className="a-card-title">Licencia del equipo</h2><p className="a-card-sub">Estado de la licencia activa</p></div>
        <Badge tone={tone}><span className="a-dot" />{LIC_STATUS[license.status]?.[0] || license.status}</Badge>
      </div>
      <div className="a-license-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 16 }}>
        <div className="a-field"><span>Tipo</span><div className="a-sub" style={{ fontSize: 15, color: 'var(--a-text)' }}>{PLAN[license.plan] || license.plan}</div></div>
        <div className="a-field"><span>Nº de licencias</span><div className="a-sub" style={{ fontSize: 15, color: 'var(--a-text)' }}>{license.seats}</div></div>
        <div className="a-field"><span>Estado</span><div className="a-sub" style={{ fontSize: 15, color: 'var(--a-text)' }}>{LIC_STATUS[license.status]?.[0] || license.status}</div></div>
      </div>
      <p className="a-note">Las plazas de la licencia limitan el número de miembros que se pueden añadir al equipo. Para cambiar tu plan o plazas, usa la sección de facturación.</p>
    </section>
  );
}

function Settings() {
  return (
    <section className="a-card">
      <div className="a-card-head"><div><h2 className="a-card-title">Ajustes</h2><p className="a-card-sub">Preferencias del equipo</p></div></div>
      <p className="a-note">Próximamente podrás configurar aquí las preferencias de tu equipo.</p>
    </section>
  );
}

function Devices({ notify, ask, onSelectDevice }) {
  const [devices, setDevices] = useState(null);
  const [passwordInfo, setPasswordInfo] = useState(null); // { configured, firstTime, generatedAt, password }
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ uuid: '', deviceName: '', pilotName: '' });
  const [addResult, setAddResult] = useState(null);

  const loadDevices = async () => {
    try { setDevices((await listEsp32Devices()).devices || []); }
    catch (e) { notify(e.message || 'Error', 'err'); }
  };
  useEffect(() => { loadDevices(); }, []);

  const genero = (iso) => (iso ? new Date(iso).toLocaleString() : '');
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); notify('Password copiada al portapapeles'); }
    catch (_) { notify('No se pudo copiar, cópiala manualmente', 'err'); }
  };

  const onGenerateFirst = async () => {
    setBusy(true);
    try { setPasswordInfo(await getOrCreateEsp32Password()); }
    catch (e) { notify(e.message || 'Error', 'err'); }
    finally { setBusy(false); }
  };

  const onRegenerate = async () => {
    if (!(await ask(
      'Se generará una password nueva. Los ESP32 nuevos que se configuren tendrán que usar la nueva. Los dispositivos ya registrados NO se ven afectados y seguirán funcionando con su token actual.',
      '¿Regenerar password de equipo?'
    ))) return;
    setBusy(true);
    try {
      const d = await regenerateEsp32Password();
      setPasswordInfo({ configured: true, firstTime: false, generatedAt: d.generatedAt, password: d.password });
    } catch (e) { notify(e.message || 'Error', 'err'); }
    finally { setBusy(false); }
  };

  const onRegister = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await registerEsp32Device(addForm);
      setAddForm({ uuid: '', deviceName: '', pilotName: '' });
      setAddOpen(false);
      notify('Dispositivo registrado');
      await loadDevices();
    } catch (e) {
      notify(e.message || 'Error', 'err');
    } finally {
      setBusy(false);
    }
  };

  const onShowToken = async (d) => {
    try {
      const result = await getEsp32DeviceToken(d.id);
      setAddResult({ token: result.token, deviceUuid: result.deviceUuid, deviceName: d.deviceName, pilotName: d.pilotName });
    } catch (e) {
      notify(e.message || 'Error', 'err');
    }
  };

  const onRevoke = async (d) => {
    if (!(await ask(`Se revocará el acceso de "${d.deviceName || d.uuid}". Este dispositivo ya no podrá conectarse al WebSocket del equipo.`, '¿Revocar dispositivo?'))) return;
    try { await deleteEsp32Device(d.id); notify('Dispositivo revocado'); setDevices((ds) => (ds || []).filter((x) => x.id !== d.id)); }
    catch (e) { notify(e.message || 'Error', 'err'); }
  };

  const handleEditPilot = async (d) => {
    const newName = prompt('Nombre del piloto:', d.pilotName || '');
    if (newName === null) return;
    try {
      const result = await updateEsp32Device(d.id, { pilotName: newName.trim() });
      notify('Piloto actualizado');
      setDevices((ds) => (ds || []).map((x) => x.id === d.id ? { ...x, pilotName: result.device.pilotName } : x));
    } catch (e) {
      notify(e.message || 'Error', 'err');
    }
  };

  const fmtDateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString() : '-');
  const fmtTimeOnly = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-');

  return (
    <>
      {/* Password de registro (InLap Box) */}
      <section className="a-card">
        <div className="a-card-head">
          <div><h2 className="a-card-title">Password de equipo</h2><p className="a-card-sub">La password que los pilotos introducen en el portal cautivo del ESP32 para registrarlo en este equipo</p></div>
          <Badge tone={passwordInfo ? (passwordInfo.configured ? 'ok' : 'off') : 'off'}>
            {passwordInfo?.configured ? 'CONFIGURADA' : 'SIN GENERAR'}
          </Badge>
        </div>

        {passwordInfo?.configured && (
          <p className="a-note" style={{ marginTop: -6 }}>
            {'Generada el ' + genero(passwordInfo.generatedAt)}
            {passwordInfo.password ? null : ' · Ya existe una password en uso. Solo se muestra una vez al generarla/regenerarla.'}
          </p>
        )}

        <div className="a-row-actions" style={{ marginTop: 8 }}>
          {!passwordInfo?.configured && (
            <button className="a-btn a-btn-gold" onClick={onGenerateFirst} disabled={busy}>
              {busy ? '…' : '+ Generar password'}
            </button>
          )}
          {passwordInfo?.configured && (
            <button className="a-btn" onClick={onRegenerate} disabled={busy}>
              {busy ? '…' : 'Regenerar password'}
            </button>
          )}
        </div>
      </section>

      {/* Dispositivos ESP32 registrados */}
      <section className="a-card">
        <div className="a-card-head">
          <div><h2 className="a-card-title">Dispositivos registrados</h2><p className="a-card-sub">Boxes InLap asociados a este equipo</p></div>
          <Badge tone={devices && devices.length ? 'ok' : 'off'}>{devices ? `${devices.length} en total` : 'Cargando…'}</Badge>
        </div>

        <div className="a-list">
          {!devices && <p className="a-muted">Cargando…</p>}
          {devices && devices.length === 0 && <p className="a-muted">Todavía no hay dispositivos registrados. Comparte la password de equipo para que los pilotos configuren sus ESP32.</p>}
          {(devices || []).map((d) => (
            <div className="a-row" key={d.id} style={{ cursor: 'pointer' }} onClick={() => onSelectDevice({ id: d.id, deviceName: d.deviceName, pilotName: d.pilotName, uuid: d.uuid })}>
              <div className="a-avatar"><AppIcon name="cpu" size={18} stroke={1.8} /></div>
              <div className="a-row-main" style={{ cursor: 'default' }}>
                <span className="a-name">
                  {d.deviceName || 'Sin nombre'}
                  {d.pilotName && <span className="a-sub" style={{ marginLeft: 8 }}>Piloto: {d.pilotName}</span>}
                  {d.approved === false && <Badge tone="danger">Revocado</Badge>}
                </span>
                <span className="a-sub mono">{d.uuid}</span>
              </div>
              <div className="a-row-main" style={{ flex: '0 0 auto' }}>
                <span className="a-sub">Registrado: <span className="mono">{fmtDateOnly(d.registeredAt)}</span></span>
                <span className="a-sub">Ultima conexion: <span className="mono">{d.lastConnectionAt ? fmtDateOnly(d.lastConnectionAt) + ' ' + fmtTimeOnly(d.lastConnectionAt) : 'nunca conectado'}</span></span>
              </div>
              <div className="a-row-actions">
                <button className="a-icon" title="Ver token JWT del dispositivo" onClick={(e) => { e.stopPropagation(); onShowToken(d); }}>
                  <AppIcon name="lock" size={15} stroke={1.8} />
                </button>
                <button className="a-icon" title="Editar nombre del piloto" onClick={(e) => { e.stopPropagation(); handleEditPilot(d); }}>
                  <AppIcon name="pencil" size={15} stroke={1.8} />
                </button>
                <IconBtn icon="trash" tone="danger" title="Revocar dispositivo" onClick={(e) => { e.stopPropagation(); onRevoke(d); }} />
              </div>
            </div>
          ))}
        </div>
        <p className="a-note">Revocar un dispositivo impide que se conecte al WebSocket del equipo. Si se vuelve a registrar con la password de equipo, aparecerá de nuevo automáticamente.</p>
      </section>

      {/* Registrar nuevo dispositivo */}
      <section className="a-card">
        <div className="a-card-head">
          <div><h2 className="a-card-title">Registrar dispositivo</h2><p className="a-card-sub">Dar de alta un InLapBox desde la web (sin portal cautivo)</p></div>
          <button className="a-btn a-btn-gold" onClick={() => setAddOpen(!addOpen)}>
            {addOpen ? 'Cancelar' : '+ Registrar'}
          </button>
        </div>
        {addOpen && (
          <form className="a-addrow" onSubmit={onRegister}>
            <input className="a-input" placeholder="UUID del chip (ej: AA:BB:CC:DD:EE:FF)" value={addForm.uuid} onChange={(e) => setAddForm((f) => ({ ...f, uuid: e.target.value }))} required />
            <input className="a-input" placeholder="Nombre del dispositivo (ej: Kart 3)" value={addForm.deviceName} onChange={(e) => setAddForm((f) => ({ ...f, deviceName: e.target.value }))} />
            <input className="a-input" placeholder="Nombre del piloto (ej: Juan)" value={addForm.pilotName} onChange={(e) => setAddForm((f) => ({ ...f, pilotName: e.target.value }))} />
            <button className="a-btn a-btn-gold" disabled={busy}>{busy ? '...' : 'Registrar'}</button>
          </form>
        )}
      </section>

      {/* Token modal — shows JWT for an ESP32 device */}
      {addResult?.token && (
        <div className="a-overlay" onClick={() => setAddResult(null)}>
          <div className="a-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Token JWT para InLapBox</h3>
            <p>Dispositivo: <strong>{addResult.deviceName || addResult.deviceUuid}</strong>{addResult.pilotName ? ` (Piloto: ${addResult.pilotName})` : ''}</p>
            <p>Copia este token y ponlo en el firmware del ESP32. El ESP32 se conectara directamente al WebSocket sin hacer ningun POST.</p>
            <div className="a-pw-box">
              <span className="a-pw-text mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{addResult.token}</span>
              <button className="a-btn a-btn-gold" onClick={() => { navigator.clipboard.writeText(addResult.token); notify('Token copiado al portapapeles'); }}><AppIcon name="copy" size={15} /> Copiar</button>
            </div>
            <div className="a-modal-actions">
              <button className="a-btn a-btn-gold" onClick={() => setAddResult(null)}>Hecho</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de password (solo se muestra UNA vez en claro) */}
      {passwordInfo?.password && (
        <div className="a-overlay" onClick={() => setPasswordInfo(null)}>
          <div className="a-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Password de equipo</h3>
            <p>Dásela a tus pilotos: la introducirán en el portal del ESP32 para configurarlo.</p>
            <div className="a-pw-box">
              <span className="a-pw-text mono">{passwordInfo.password}</span>
              <button className="a-btn a-btn-gold" onClick={() => copy(passwordInfo.password)}><AppIcon name="copy" size={15} /> Copiar</button>
            </div>
            <p style={{ color: 'var(--a-red)', fontWeight: 700 }}>Cópiala ahora: esta es la única vez que se muestra en claro. Si la pierdes, tendrás que regenerarla (los dispositivos ya registrados no se ven afectados).</p>
            <div className="a-modal-actions">
              <button className="a-btn a-btn-gold" onClick={() => { copy(passwordInfo.password); setPasswordInfo(null); }}>Hecho</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
