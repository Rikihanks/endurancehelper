import { useMemo, useRef, useState } from 'react';
import { projectPath, svgPointFromEvent, snapToPath, trapGate } from '../mapGeometry.js';

// Interactive track editor: draws the circuit centreline and lets the user tap
// on it to place the Start/Finish line or a split. The trap heading is taken
// from the local path direction, so it always points the way the track goes.

export default function TrackEditor({ points, traps = [], onPick, instruction }) {
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);
  const proj = useMemo(() => projectPath(points), [points]);

  if (!proj) {
    return (
      <p className="rb-muted">
        Este circuito no tiene trazada guardada, así que no se puede editar en el mapa. Créalo desde
        una sesión grabada para tener la trazada, o márcalo con la posición en vivo.
      </p>
    );
  }

  const projected = points.map(proj.project);
  const pathData = `M ${projected.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`;

  function pickFromEvent(event) {
    const svg = svgRef.current;
    if (!svg) return null;
    const { x, y } = svgPointFromEvent(event, svg, proj.vw, proj.vh);
    const coarse = proj.unproject(x, y);
    return snapToPath(points, proj, coarse.lat, coarse.lon);
  }

  function handleClick(event) {
    const snapped = pickFromEvent(event);
    if (snapped) onPick(snapped);
  }

  function handleMove(event) {
    const snapped = pickFromEvent(event);
    setHover(snapped ? proj.project(snapped) : null);
  }

  return (
    <div className="rb-track">
      {instruction && <p className="rb-hint">{instruction}</p>}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${proj.vw} ${proj.vh}`}
        preserveAspectRatio="xMidYMid meet"
        className="rb-track-svg rb-editor-svg"
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Editor de circuito"
      >
        <path d={`${pathData} Z`} fill="none" stroke="var(--border2)" strokeWidth={12} strokeLinejoin="round" />
        <path d={pathData} fill="none" stroke="#6aa9ff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />

        {traps.map((trap, i) => {
          if (!trap || !Number.isFinite(trap.lat)) return null;
          const gate = trapGate(trap, 16);
          const a = proj.project(gate.a);
          const b = proj.project(gate.b);
          const c = proj.project(trap);
          const isSf = trap.type === 'startFinish';
          return (
            <g key={i}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={isSf ? '#ffffff' : '#22d3ee'}
                strokeWidth={isSf ? 7 : 6}
                strokeLinecap="round"
              />
              <circle cx={c.x} cy={c.y} r={4} fill={isSf ? '#ffffff' : '#22d3ee'} />
              <text x={c.x} y={c.y - 16} textAnchor="middle" fontSize="22" fill={isSf ? '#ffffff' : '#22d3ee'}>
                {isSf ? 'Meta' : trap.name || `S${i}`}
              </text>
            </g>
          );
        })}

        {hover && (
          <circle cx={hover.x} cy={hover.y} r={16} fill="none" stroke="#ffb347" strokeWidth={3} strokeDasharray="4 4" />
        )}
      </svg>
      <div className="rb-track-scale">
        <span>Toca sobre la línea azul para colocar</span>
        <span className="rb-muted">{points.length} puntos de trazada</span>
      </div>
    </div>
  );
}
