import { useEffect, useRef, useState } from 'react';

// Desktop-style menu bar (Archivo · Ver · …). Compact, always on top, with
// dropdown menus — like a native app's menu bar.
export default function MenuBar({ menus }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(null);
    };
    const key = (e) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, []);

  return (
    <nav ref={ref} className="menubar">
      {menus.map((m) => (
        <div className="menubar-item" key={m.label}>
          <button
            className={`menubar-trigger${open === m.label ? ' open' : ''}`}
            onClick={() => setOpen(open === m.label ? null : m.label)}
            onMouseEnter={() => open && setOpen(m.label)}
          >
            {m.label}
          </button>
          {open === m.label && (
            <div className="menubar-menu">
              {m.items.map((it, i) =>
                it.divider ? (
                  <div className="menubar-sep" key={i} />
                ) : (
                  <button
                    key={i}
                    className={`menubar-opt${it.danger ? ' danger' : ''}`}
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.action?.();
                    }}
                  >
                    <span className="menubar-check">{it.checked ? '✓' : ''}</span>
                    <span>{it.label}</span>
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
