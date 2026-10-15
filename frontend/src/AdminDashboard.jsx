import { useEffect, useRef, useState } from 'react';
import { adminApi, getMe, registerEsp32Device, getEsp32DeviceToken } from './api.js';
import { AppIcon } from './components/AppIcon.jsx';

const NAV = [
  { id: 'resumen', label: 'Resumen', icon: 'dashboard' },
  { id: 'users', label: 'Usuarios', icon: 'users' },
  { id: 'orgs', label: 'Equipos', icon: 'users-group' },
  { id: 'devices', label: 'Dispositivos', icon: 'cpu' },
  { id: 'licenses', label: 'Licencias', icon: 'license' },
  { id: 'logs', label: 'Auditoría', icon: 'history' },
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
const ROLE_LABEL = { user: 'Usuario', admin: 'Admin global' };

// small shared bits ---------------------------------------------------------
function initials(name, email) {
  const s = (name || email || '?').trim();
  const parts = s.split(/[\s@]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function Badge({ tone = 'off', children }) {
  return <span className={`a-badge a-badge-${tone}`}>{children}</span>;
}
function IconBtn({ icon = 'activity', tone, title, disabled, onClick }) {
  return (
    <button className={`a-icon${tone ? ` a-icon-${tone}` : ''}`} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <AppIcon name={icon} size={17} stroke={1.9} />
    </button>
  );
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString();
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
async function copyText(text, notify) {
  try { await navigator.clipboard.writeText(text); notify('Copiado al portapapeles'); }
  catch (_) { notify('No se pudo copiar, cópialo manualmente', 'err'); }
}

// data hook -----------------------------------------------------------------
function useAdmin() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const timer = useRef(null);

  const notify = (msg, type = 'ok') => {
    clearTimeout(timer.current);
    setToast({ msg, type });
    timer.current = setTimeout(() => setToast(null), 2600);
  };
  const ask = (message, title = 'Confirmar') => new Promise((resolve) => setConfirm({ message, title, resolve }));

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([adminApi.listUsers(), adminApi.listOrgs(), adminApi.listLicenses()])
      .then(([u, o, l]) => setData({ users: u.users, orgs: o.orgs, licenses: l.licenses }))
      .catch((e) => setError(e.message || 'Error al cargar'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  return { data, loading, error, reload: load, notify, ask, toast, setConfirm };
}

export default function AdminDashboard({ onBack }) {
  const a = useAdmin();
  const [view, setView] = useState('resumen');
  const [detailId, setDetailId] = useState(null);
  const [me, setMe] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => { getMe().then(setMe).catch(() => {}); }, []);

  const nav = (v) => { setView(v); setDetailId(null); setSidebarOpen(false); };

  function renderContent() {
    if (view === 'resumen') return <Resumen admin={a} onNav={nav} />;
    if (view === 'users') return <UsersView admin={a} />;
    if (view === 'orgs') return detailId
      ? <OrgDetail admin={a} id={detailId} onBack={() => setDetailId(null)} />
      : <OrgsView admin={a} onOpen={(id) => setDetailId(id)} />;
    if (view === 'devices') return <DevicesView admin={a} onOpenOrg={(id) => { setDetailId(id); setView('orgs'); }} />;
    if (view === 'licenses') return <LicensesView admin={a} />;
    if (view === 'logs') return <LogsView admin={a} />;
    return <SettingsView />;
  }

  return (
    <div className="a-shell">
      <aside className={`a-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="a-brand">
          <span className="a-brand-mark">IN</span>
          <div className="a-brand-text">
            <strong>INLAP</strong>
            <small>CONTROL GLOBAL</small>
          </div>
        </div>

        <nav className="a-nav">
          {NAV.map((n) => (
            <button key={n.id} className={`a-nav-item${view === n.id ? ' active' : ''}`} onClick={() => nav(n.id)}>
              <AppIcon name={n.icon} size={18} stroke={1.8} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <div className="a-side-user">
          <div className="a-avatar sm">{initials(me?.user?.name, me?.user?.email)}</div>
          <div className="a-side-user-text">
            <strong>{me?.user?.name || 'Administrador'}</strong>
            <small>Admin global</small>
          </div>
          <button className="a-side-user-menu" title="Cerrar sesión" onClick={onBack}>
            <AppIcon name="logout" size={17} stroke={1.8} />
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="a-backdrop" onClick={() => setSidebarOpen(false)} />}

      <main className="a-main">
        <header className="a-head">
          <div className="a-head-title">
            <button className="a-burger" onClick={() => setSidebarOpen(true)} aria-label="Menú">
              <AppIcon name="gauge" size={20} stroke={1.8} />
            </button>
            <div>
              <h1>Panel de administración</h1>
              <p className="a-head-sub"><span className="a-dot" /> CONTROL GLOBAL · INLAP</p>
            </div>
          </div>
          <button className="a-back-btn" onClick={onBack}><AppIcon name="back" size={16} /> Volver al sitio</button>
        </header>

        <div className="a-content">{renderContent()}</div>
      </main>

      {a.confirm && <ConfirmModal confirm={a.confirm} onDone={() => a.setConfirm(null)} />}
      {a.toast && <div className={`a-toast ${a.toast.type}`}><span className="a-toast-ico">{a.toast.type === 'ok' ? '✓' : '✗'}</span>{a.toast.msg}</div>}
    </div>
  );
}

function ConfirmModal({ confirm, onDone }) {
  const handle = async (val) => {
    await confirm.resolve(val);
    onDone();
  };
  return (
    <div className="a-overlay" onClick={() => handle(false)}>
      <div className="a-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{confirm.title}</h3>
        <p>{confirm.message}</p>
        <div className="a-modal-actions">
          <button className="a-btn" onClick={() => handle(false)}>Cancelar</button>
          <button className="a-btn a-btn-danger" onClick={() => handle(true)}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------- RESUMEN -----------------------------
function Resumen({ admin, onNav }) {
  const d = admin.data;
  const stats = d ? {
    users: d.users.length,
    admins: d.users.filter((u) => u.role === 'admin').length,
    orgs: d.orgs.length,
    licensed: d.orgs.filter((o) => o.plan).length,
    total: d.licenses.length,
    active: d.licenses.filter((l) => l.status === 'active' || l.status === 'trialing').length,
  } : null;

  return (
    <>
      <div className="a-stats">
        <div className="a-stat">
          <div className="a-stat-ico"><AppIcon name="users" size={22} stroke={1.6} /></div>
          <div>
            <div className="a-stat-num">{stats ? stats.users : '—'}</div>
            <div className="a-stat-sub">{stats ? `${stats.admins} ${stats.admins === 1 ? 'administrador global' : 'administradores globales'}` : 'Cargando…'}</div>
          </div>
        </div>
        <div className="a-stat">
          <div className="a-stat-ico"><AppIcon name="users-group" size={22} stroke={1.6} /></div>
          <div>
            <div className="a-stat-num">{stats ? stats.orgs : '—'}</div>
            <div className="a-stat-sub">{stats ? `${stats.licensed} ${stats.licensed === 1 ? 'con licencia' : 'con licencia'}` : 'Cargando…'}</div>
          </div>
        </div>
        <div className="a-stat">
          <div className="a-stat-ico"><AppIcon name="license" size={22} stroke={1.6} /></div>
          <div>
            <div className="a-stat-num ok">{stats ? stats.total : '—'}</div>
            <div className="a-stat-sub">{stats ? `${stats.active} activas de ${stats.total}` : 'Cargando…'}</div>
          </div>
        </div>
      </div>

      <div className="a-quick">
        <h2 className="a-section-title">Acceso rápido</h2>
        <div className="a-quick-grid">
          {NAV.filter((n) => n.id !== 'resumen').map((n) => (
            <button key={n.id} className="a-quick-card" onClick={() => onNav(n.id)}>
              <AppIcon name={n.icon} size={20} stroke={1.7} />
              <span>{n.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ----------------------------- USERS -----------------------------
function UsersView({ admin }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const users = (admin.data?.users || []).filter((u) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (u.email || '').toLowerCase().includes(s) || (u.name || '').toLowerCase().includes(s);
  });

  const act = async (fn, okMsg) => {
    try { await fn(); admin.reload(); admin.notify(okMsg); }
    catch (e) { admin.notify(e.message || 'Error', 'err'); }
  };

  async function createUser(e) {
    e.preventDefault();
    setBusy(true);
    try { await adminApi.createUser(newEmail.trim(), newName.trim()); setNewEmail(''); setNewName(''); admin.reload(); admin.notify('Usuario creado'); }
    catch (err) { admin.notify(err.message, 'err'); } finally { setBusy(false); }
  }

  const stateBadge = (u) =>
    !u.isActive ? <Badge tone="danger">Bloqueado</Badge>
    : <Badge tone="ok"><span className="a-dot" />Activo</Badge>;

  return (
    <section className="a-card">
      <div className="a-card-head">
        <div>
          <h2 className="a-card-title">Usuarios</h2>
          <p className="a-card-sub">Gestiona los usuarios del sistema</p>
        </div>
        <form className="a-head-actions" onSubmit={createUser}>
          <input className="a-input w-tight" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
          <input className="a-input w-tight" placeholder="Nombre" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="a-btn a-btn-gold" disabled={busy}>{busy ? '…' : '+ Nuevo usuario'}</button>
        </form>
      </div>

      <div className="a-toolbar">
        <div className="a-search"><AppIcon name="search" size={16} /><input placeholder="Buscar por email o nombre…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      <div className="a-table-wrap">
        <table className="a-table">
          <thead>
            <tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th className="a-t-right">Acciones</th></tr>
          </thead>
          <tbody>
            {!admin.data && <tr><td colSpan="6" className="a-muted">Cargando…</td></tr>}
            {admin.data && users.length === 0 && <tr><td colSpan="6" className="a-muted">Sin resultados</td></tr>}
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="a-cell-user">
                    <div className="a-avatar">{initials(u.name, u.email)}</div>
                    <div className="a-cell-user-text">
                      <span className="a-name">{u.name || 'Sin nombre'}</span>
                      {u.role === 'admin' && <Badge tone="gold">Admin global</Badge>}
                    </div>
                  </div>
                </td>
                <td className="a-mono">{u.email || '—'}</td>
                <td>{u.role === 'admin' ? 'Administrador' : 'Usuario'}</td>
                <td>{stateBadge(u)}</td>
                <td className="a-mono">{fmtDate(u.lastLoginAt)}</td>
                <td className="a-t-right">
                  <div className="a-row-actions">
                    {u.role === 'admin'
                      ? <IconBtn icon="user" title="Quitar admin" onClick={() => act(() => adminApi.demoteUser(u.id), 'Admin revocado')} />
                      : <IconBtn icon="lock" tone="gold" title="Hacer admin global" onClick={() => act(() => adminApi.promoteUser(u.id), 'Promovido a admin global')} />}
                    <IconBtn icon="refresh" title="Cerrar sesiones" onClick={() => act(() => adminApi.revokeSessions(u.id), 'Sesiones cerradas')} />
                    {u.isActive
                      ? <IconBtn icon="world" title="Bloquear usuario" onClick={() => act(() => adminApi.deactivateUser(u.id), 'Usuario bloqueado')} />
                      : <IconBtn icon="lock" title="Desbloquear usuario" onClick={() => act(() => adminApi.activateUser(u.id), 'Usuario desbloqueado')} />}
                    <IconBtn icon="trash" tone="danger" title="Eliminar usuario" onClick={async () => {
                      if (await admin.ask(`¿Eliminar definitivamente a ${u.email || u.name}? Esta acción no se puede deshacer.`, 'Eliminar usuario')) {
                        await act(() => adminApi.deleteUser(u.id), 'Usuario eliminado');
                      }
                    }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ----------------------------- ORGS -----------------------------
function OrgsView({ admin, onOpen }) {
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const orgs = admin.data?.orgs || [];

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await adminApi.createOrg(name.trim(), ownerEmail.trim());
      admin.reload(); admin.notify('Equipo creado'); onOpen(d.org.id);
    } catch (err) { admin.notify(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <section className="a-card">
      <div className="a-card-head">
        <div>
          <h2 className="a-card-title">Equipos</h2>
          <p className="a-card-sub">Organizaciones y sus propietarios</p>
        </div>
        <form className="a-head-actions" onSubmit={create}>
          <input className="a-input w-tight" placeholder="Nombre del equipo *" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="a-input w-tight" placeholder="Email del propietario" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          <button className="a-btn a-btn-gold" disabled={busy}>{busy ? '…' : '+ Crear equipo'}</button>
        </form>
      </div>

      <div className="a-list">
        {!admin.data && <p className="a-muted">Cargando…</p>}
        {admin.data && orgs.length === 0 && <p className="a-muted">Sin equipos todavía.</p>}
        {orgs.map((o) => (
          <div className="a-row" key={o.id}>
            <div className="a-avatar">{initials(o.name)}</div>
            <div className="a-row-main" onClick={() => onOpen(o.id)}>
              <span className="a-name">{o.name}</span>
              <span className="a-sub mono">{o.ownerEmail || o.ownerName || 'Sin propietario'}</span>
            </div>
            <div className="a-badges">
              {o.plan ? <Badge tone="ok"><span className="a-dot" />{PLAN[o.plan] || o.plan}</Badge> : <Badge>Sin licencia</Badge>}
              {o.licenseStatus && <Badge tone={LIC_STATUS[o.licenseStatus]?.[1] || 'off'}>{LIC_STATUS[o.licenseStatus]?.[0] || o.licenseStatus}</Badge>}
            </div>
            <div className="a-row-actions">
              <button className="a-btn a-btn-ghost" onClick={() => onOpen(o.id)}>Gestionar</button>
              <IconBtn icon="trash" tone="danger" title="Eliminar equipo" onClick={async () => {
                if (await admin.ask(`¿Eliminar el equipo "${o.name}" y todos sus datos?`, 'Eliminar equipo')) {
                  try { await adminApi.deleteOrg(o.id); admin.reload(); admin.notify('Equipo eliminado'); }
                  catch (e) { admin.notify(e.message, 'err'); }
                }
              }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function OrgDetail({ admin, id, onBack }) {
  const [detail, setDetail] = useState(null);
  const [devices, setDevices] = useState(null);
  const [pwInfo, setPwInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ uuid: '', deviceName: '', pilotName: '' });
  const [addResult, setAddResult] = useState(null);

  const loadDetail = () => adminApi.getOrg(id).then(setDetail).catch((e) => admin.notify(e.message, 'err'));
  const loadDevices = () => adminApi.listOrgDevices(id).then((d) => setDevices(d.devices || [])).catch(() => {});
  useEffect(() => { loadDetail(); loadDevices(); /* eslint-disable-next-line */ }, [id]);

  const act = async (fn, okMsg, confirmMsg) => {
    if (confirmMsg && !(await admin.ask(confirmMsg))) return;
    try { await fn(); await loadDetail(); admin.reload(); admin.notify(okMsg); }
    catch (e) { admin.notify(e.message, 'err'); }
  };

  if (!detail) return <p className="a-muted">Cargando…</p>;
  const org = detail.org;
  const lic = detail.license;
  const licTone = lic ? (LIC_STATUS[lic.status]?.[1] || 'off') : 'off';

  async function addMember(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    await act(() => adminApi.addOrgMember(id, fd.get('email').trim(), fd.get('role')), 'Miembro añadido');
    e.target.reset();
  }

  async function saveLicense(e) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.target);
    const payload = { plan: fd.get('plan'), seats: Number(fd.get('seats')), status: fd.get('status') };
    try {
      if (lic) await adminApi.updateLicense(id, payload);
      else await adminApi.createLicense(id, payload);
      admin.notify('Licencia guardada'); await loadDetail();
    } catch (err) { admin.notify(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="a-detail-head">
        <div className="a-detail-title">
          <button className="a-btn a-btn-ghost sm" onClick={onBack}><AppIcon name="back" size={16} /> Equipos</button>
          <div>
            <h2 className="a-org-name">{org.name} {lic && <Badge tone="ok"><span className="a-dot" />ACTIVO</Badge>}</h2>
            <p className="a-sub mono">ID · {org.id}</p>
          </div>
        </div>
        <IconBtn icon="trash" tone="danger" title="Eliminar equipo" onClick={async () => {
          if (await admin.ask(`¿Eliminar el equipo "${org.name}" y todos sus datos? No se puede deshacer.`, 'Eliminar equipo')) {
            try { await adminApi.deleteOrg(id); admin.notify('Equipo eliminado'); onBack(); }
            catch (e) { admin.notify(e.message, 'err'); }
          }
        }} />
      </div>

      <div className="a-grid-2">
        {/* Miembros */}
        <section className="a-card">
          <div className="a-card-head">
            <div>
              <h2 className="a-card-title">Miembros</h2>
              <p className="a-card-sub">Gestiona los miembros del equipo</p>
            </div>
          </div>
          <form className="a-addrow" onSubmit={addMember}>
            <input className="a-input" name="email" placeholder="Email del miembro" required />
            <select className="a-input" name="role" defaultValue="member">
              <option value="member">Miembro</option><option value="admin">Admin</option><option value="owner">Propietario</option>
            </select>
            <button className="a-btn a-btn-gold">+ Añadir miembro</button>
          </form>

          <div className="a-list">
            {detail.members.map((m) => (
              <div className="a-row" key={m.userId}>
                <div className="a-avatar">{initials(m.name, m.email)}</div>
                <div className="a-row-main">
                  <span className="a-name">{m.name || 'Sin nombre'} {m.role === 'owner' && <Badge tone="gold">Propietario</Badge>}</span>
                  <span className="a-sub mono">{m.email || m.userId}</span>
                </div>
                <div className="a-row-actions">
                  <select className="a-input xs inline" defaultValue={m.role} onChange={(e) => act(() => adminApi.setOrgMemberRole(id, m.userId, e.target.value), 'Rol actualizado')}>
                    <option value="member">Miembro</option><option value="admin">Admin</option><option value="owner">Propietario</option>
                  </select>
                  <IconBtn icon="trash" tone="danger" title="Quitar miembro" onClick={() => act(() => adminApi.removeOrgMember(id, m.userId), 'Miembro eliminado', `¿Quitar a ${m.name || m.email}?`)} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Licencia */}
        <section className="a-card a-license-card">
          <div className="a-card-head">
            <div>
              <h2 className="a-card-title">Licencia del equipo</h2>
              <p className="a-card-sub">Gestiona la licencia activa del equipo</p>
            </div>
            {lic && <Badge tone={licTone}><span className="a-dot" />{LIC_STATUS[lic.status]?.[0] || lic.status}</Badge>}
          </div>

          <form className="a-license-form" onSubmit={saveLicense}>
            <label className="a-field">
              <span>Tipo</span>
              <select className="a-input" name="plan" defaultValue={lic?.plan || 'annual'}>
                <option value="annual">Anual</option><option value="monthly">Mensual</option>
              </select>
            </label>
            <label className="a-field">
              <span>Nº de licencias</span>
              <input className="a-input" name="seats" type="number" min="1" defaultValue={lic?.seats || 5} />
            </label>
            <label className="a-field">
              <span>Estado</span>
              <select className="a-input" name="status" defaultValue={lic?.status || 'active'}>
                {Object.entries(LIC_STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <div className="a-license-actions">
              <button className="a-btn a-btn-gold" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
              {lic && (
                <button type="button" className="a-btn a-btn-danger-ghost" onClick={() => act(() => adminApi.deleteLicense(id), 'Licencia eliminada', '¿Quitar la licencia de este equipo?')}>Quitar licencia</button>
              )}
            </div>
            <p className="a-note">Las plazas de la licencia limitan el número de miembros que se pueden añadir al equipo.</p>
          </form>
        </section>
      </div>

      {/* Dispositivos ESP32 del equipo */}
      <section className="a-card">
        <div className="a-card-head">
          <div>
            <h2 className="a-card-title">Dispositivos ESP32</h2>
            <p className="a-card-sub">Boxes InLap registrados en este equipo</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="a-btn a-btn-gold" onClick={() => setAddOpen(!addOpen)}>
              {addOpen ? 'Cancelar' : '+ Registrar'}
            </button>
            <button
              className="a-btn"
              disabled={busy}
              onClick={async () => {
                if (!(await admin.ask('Se generará una password de equipo nueva. Los ESP32 que se configuren a partir de ahora la necesitarán; los ya registrados no se ven afectados.', '¿Regenerar password?'))) return;
                setBusy(true);
                try { setPwInfo(await adminApi.regenerateOrgDevicePassword(id)); admin.notify('Password regenerada'); }
                catch (e) { admin.notify(e.message, 'err'); }
                finally { setBusy(false); }
              }}
            >
              {busy ? '…' : 'Regenerar password'}
            </button>
          </div>
        </div>

        {addOpen && (
          <form className="a-addrow" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await registerEsp32Device(addForm);
              setAddForm({ uuid: '', deviceName: '', pilotName: '' });
              setAddOpen(false);
              admin.notify('Dispositivo registrado');
              loadDevices();
            } catch (err) { admin.notify(err.message, 'err'); }
            finally { setBusy(false); }
          }}>
            <input className="a-input" placeholder="UUID del chip (ej: AA:BB:CC:DD:EE:FF)" value={addForm.uuid} onChange={(e) => setAddForm((f) => ({ ...f, uuid: e.target.value }))} required />
            <input className="a-input" placeholder="Nombre del dispositivo (ej: Kart 3)" value={addForm.deviceName} onChange={(e) => setAddForm((f) => ({ ...f, deviceName: e.target.value }))} />
            <input className="a-input" placeholder="Nombre del piloto (ej: Juan)" value={addForm.pilotName} onChange={(e) => setAddForm((f) => ({ ...f, pilotName: e.target.value }))} />
            <button className="a-btn a-btn-gold" disabled={busy}>{busy ? '…' : 'Registrar'}</button>
          </form>
        )}

        <div className="a-list">
          {!devices && <p className="a-muted">Cargando…</p>}
          {devices && devices.length === 0 && <p className="a-muted">Este equipo todavía no tiene dispositivos registrados.</p>}
          {(devices || []).map((d) => (
            <div className="a-row" key={d.id}>
              <div className="a-avatar"><AppIcon name="cpu" size={18} stroke={1.7} /></div>
              <div className="a-row-main" style={{ cursor: 'default' }}>
                <span className="a-name">{d.deviceName || 'Sin nombre'}{d.approved === false && <Badge tone="danger">Revocado</Badge>}</span>
                <span className="a-sub mono">{d.uuid}</span>
              </div>
              <div className="a-row-main" style={{ flex: '0 0 auto' }}>
                <span className="a-sub">Registrado: <span className="mono">{fmtDateTime(d.registeredAt)}</span></span>
                <span className="a-sub">Última conexión: <span className="mono">{d.lastConnectionAt ? fmtDateTime(d.lastConnectionAt) : 'nunca conectado'}</span></span>
              </div>
              <div className="a-row-actions">
                <button className="a-icon" title="Ver token JWT" onClick={async () => {
                  try { const r = await getEsp32DeviceToken(d.id); setAddResult({ token: r.token, deviceName: d.deviceName, pilotName: d.pilotName }); }
                  catch (e) { admin.notify(e.message, 'err'); }
                }}>
                  <AppIcon name="lock" size={15} stroke={1.8} />
                </button>
                <IconBtn icon="trash" tone="danger" title="Revocar dispositivo" onClick={async () => {
                  if (await admin.ask(`¿Revocar "${d.deviceName || d.uuid}"? Ya no podrá conectarse al WebSocket de este equipo.`, 'Revocar dispositivo')) {
                    try { await adminApi.deleteDevice(d.id); admin.notify('Dispositivo revocado'); loadDevices(); }
                    catch (e) { admin.notify(e.message, 'err'); }
                  }
                }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {addResult?.token && (
        <div className="a-overlay" onClick={() => setAddResult(null)}>
          <div className="a-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Token JWT para InLapBox</h3>
            <p>Dispositivo: <strong>{addResult.deviceName || 'Sin nombre'}</strong>{addResult.pilotName ? ` (Piloto: ${addResult.pilotName})` : ''}</p>
            <div className="a-pw-box">
              <span className="a-pw-text mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{addResult.token}</span>
              <button className="a-btn a-btn-gold" onClick={() => { navigator.clipboard.writeText(addResult.token); admin.notify('Token copiado'); }}><AppIcon name="copy" size={15} /> Copiar</button>
            </div>
            <div className="a-modal-actions">
              <button className="a-btn a-btn-gold" onClick={() => setAddResult(null)}>Hecho</button>
            </div>
          </div>
        </div>
      )}

      {pwInfo && (
        <PasswordModal
          password={pwInfo.password}
          generatedAt={pwInfo.generatedAt}
          onCopy={(p) => copyText(p, admin.notify)}
          onClose={() => setPwInfo(null)}
        />
      )}
    </>
  );
}

// ----------------------------- DEVICES -----------------------------
function DevicesView({ admin, onOpenOrg }) {
  const [devices, setDevices] = useState(null);
  const [q, setQ] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const orgs = admin.data?.orgs || [];

  const load = (orgId) => {
    adminApi.listDevices(orgId || undefined)
      .then((d) => setDevices(d.devices || []))
      .catch((e) => admin.notify(e.message, 'err'));
  };
  useEffect(() => { load(orgFilter); /* eslint-disable-next-line */ }, [orgFilter]);

  const filtered = (devices || []).filter((d) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (d.deviceName || '').toLowerCase().includes(s)
      || d.uuid.toLowerCase().includes(s)
      || (d.orgName || '').toLowerCase().includes(s);
  });

  const revoke = async (d) => {
    if (!(await admin.ask(`¿Revocar "${d.deviceName || d.uuid}" (${d.orgName || 'equipo desconocido'})? Ya no podrá conectarse al WebSocket de su equipo.`, 'Revocar dispositivo'))) return;
    try { await adminApi.deleteDevice(d.id); admin.notify('Dispositivo revocado'); load(orgFilter); }
    catch (e) { admin.notify(e.message, 'err'); }
  };

  return (
    <section className="a-card">
      <div className="a-card-head">
        <div>
          <h2 className="a-card-title">Dispositivos ESP32</h2>
          <p className="a-card-sub">Boxes InLap registrados en todos los equipos</p>
        </div>
        <select className="a-input xs inline" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
          <option value="">Todos los equipos</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      <div className="a-toolbar">
        <div className="a-search"><AppIcon name="search" size={16} /><input placeholder="Buscar por nombre, uuid o equipo…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      <div className="a-table-wrap">
        <table className="a-table">
          <thead>
            <tr><th>Dispositivo</th><th>UUID</th><th>Equipo</th><th>Registrado</th><th>Última conexión</th><th className="a-t-right">Acciones</th></tr>
          </thead>
          <tbody>
            {!devices && <tr><td colSpan="6" className="a-muted">Cargando…</td></tr>}
            {devices && filtered.length === 0 && <tr><td colSpan="6" className="a-muted">Sin dispositivos.</td></tr>}
            {filtered.map((d) => (
              <tr key={d.id}>
                <td>
                  <div className="a-cell-user">
                    <div className="a-avatar"><AppIcon name="cpu" size={18} stroke={1.7} /></div>
                    <div className="a-cell-user-text">
                      <span className="a-name">{d.deviceName || 'Sin nombre'}</span>
                      {d.approved === false && <Badge tone="danger">Revocado</Badge>}
                    </div>
                  </div>
                </td>
                <td className="a-mono">{d.uuid}</td>
                <td>
                  <button className="a-link" title="Abrir equipo" onClick={() => onOpenOrg(d.orgId)}>{d.orgName || d.orgId.slice(0, 8)}</button>
                </td>
                <td className="a-mono">{fmtDateTime(d.registeredAt)}</td>
                <td className="a-mono">{d.lastConnectionAt ? fmtDateTime(d.lastConnectionAt) : 'nunca conectado'}</td>
                <td className="a-t-right">
                  <IconBtn icon="trash" tone="danger" title="Revocar dispositivo" onClick={() => revoke(d)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="a-note">Revocar un dispositivo impide que se conecte al WebSocket de su equipo. Puede volver a registrarse con la password de equipo de su equipo.</p>
    </section>
  );
}

// Modal that shows a password in clear ONCE (with copy).
function PasswordModal({ password, generatedAt, onCopy, onClose }) {
  return (
    <div className="a-overlay" onClick={onClose}>
      <div className="a-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Password ESP32</h3>
        <p>Dásela a los pilotos de este equipo: la introducirán en el portal del ESP32 para registrarlo. Generada el {fmtDateTime(generatedAt)}</p>
        <div className="a-pw-box">
          <span className="a-pw-text mono">{password}</span>
          <button className="a-btn a-btn-gold" onClick={() => onCopy(password)}><AppIcon name="copy" size={15} /> Copiar</button>
        </div>
        <p style={{ color: 'var(--a-red)', fontWeight: 700 }}>Esta es la única vez que se muestra en claro. Los dispositivos ya registrados no se ven afectados; solo los ESP32 nuevos usarán esta password.</p>
        <div className="a-modal-actions">
          <button className="a-btn a-btn-gold" onClick={() => { onCopy(password); onClose(); }}>Hecho</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------- LICENSES -----------------------------
function LicensesView({ admin }) {
  const licenses = admin.data?.licenses || [];
  return (
    <section className="a-card">
      <div className="a-card-head">
        <div><h2 className="a-card-title">Licencias</h2><p className="a-card-sub">Todas las licencias del sistema</p></div>
      </div>
      <div className="a-list">
        {!admin.data && <p className="a-muted">Cargando…</p>}
        {admin.data && licenses.length === 0 && <p className="a-muted">No hay licencias todavía.</p>}
        {licenses.map((l) => (
          <div className="a-row" key={l.id}>
            <div className="a-avatar"><AppIcon name="license" size={19} stroke={1.7} /></div>
            <div className="a-row-main">
              <span className="a-name">{PLAN[l.plan] || l.plan} · {l.seats} plazas</span>
              <span className="a-sub mono">Org {l.orgId.slice(0, 8)}</span>
            </div>
            <div className="a-badges">
              <Badge tone={LIC_STATUS[l.status]?.[1] || 'off'}><span className="a-dot" />{LIC_STATUS[l.status]?.[0] || l.status}</Badge>
              {l.currentPeriodEnd && <span className="a-sub mono">{fmtDate(l.currentPeriodEnd)}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ----------------------------- LOGS -----------------------------
function LogsView({ admin }) {
  const [logs, setLogs] = useState(null);
  const load = () => adminApi.logs().then((d) => setLogs(d.logs)).catch((e) => admin.notify(e.message, 'err'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const rows = logs || [];
  return (
    <section className="a-card">
      <div className="a-card-head">
        <div><h2 className="a-card-title">Auditoría</h2><p className="a-card-sub">Registro de acciones privilegiadas</p></div>
        <button className="a-btn" onClick={load}><AppIcon name="refresh" size={16} /> Actualizar</button>
      </div>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead><tr><th>Fecha</th><th>Admin</th><th>Acción</th><th>Tipo</th><th>Objetivo</th><th>Alcance</th></tr></thead>
          <tbody>
            {!logs && <tr><td colSpan="6" className="a-muted">Cargando…</td></tr>}
            {logs && rows.length === 0 && <tr><td colSpan="6" className="a-muted">Sin actividad.</td></tr>}
            {rows.map((l) => (
              <tr key={l.id}>
                <td className="a-mono">{new Date(l.createdAt).toLocaleString()}</td>
                <td className="a-mono">{l.actorUserId.slice(0, 8)}</td>
                <td>{l.action}</td>
                <td>{l.targetType}</td>
                <td className="a-mono">{l.targetId ? l.targetId.slice(0, 8) : '—'}</td>
                <td>{l.scope}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ----------------------------- SETTINGS -----------------------------
function SettingsView() {
  return (
    <section className="a-card">
      <div className="a-card-head"><div><h2 className="a-card-title">Ajustes</h2><p className="a-card-sub">Configuración del panel de administración</p></div></div>
      <p className="a-note">Próximamente podrás configurar aquí preferencias del panel, umbrales globales y opciones de auditoría.</p>
    </section>
  );
}
