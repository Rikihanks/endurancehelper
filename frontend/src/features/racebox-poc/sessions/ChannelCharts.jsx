import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

// Telemetry charts (speed, g-forces, delta) plus the G-G plot, mirroring the
// official app's channel graphs. X axis is distance into the lap in metres so
// laps line up corner for corner.

const AXIS = { stroke: 'var(--muted)', fontSize: 11 };

export function SpeedChart({ grid }) {
  const data = grid.distances.map((d, i) => ({ d, speed: grid.speeds[i] }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="d" tick={AXIS} unit="m" />
        <YAxis tick={AXIS} width={44} />
        <Tooltip
          contentStyle={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
          formatter={(v) => [`${Number(v).toFixed(1)} km/h`, 'Velocidad']}
          labelFormatter={(d) => `${d} m`}
        />
        <Line type="monotone" dataKey="speed" stroke="#4ea1ff" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function GForceChart({ grid }) {
  const data = grid.distances.map((d, i) => ({
    d,
    lat: grid.gLat[i] / 1000,
    lon: grid.gLong[i] / 1000,
  }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="d" tick={AXIS} unit="m" />
        <YAxis tick={AXIS} width={44} unit="g" />
        <Tooltip
          contentStyle={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
          formatter={(v, name) => [`${Number(v).toFixed(2)} g`, name === 'lat' ? 'Lateral' : 'Longitudinal']}
          labelFormatter={(d) => `${d} m`}
        />
        <ReferenceLine y={0} stroke="var(--border2)" />
        <Line type="monotone" dataKey="lat" stroke="#ffb347" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="lon" stroke="#7ee787" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DeltaChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="d" tick={AXIS} unit="m" />
        <YAxis tick={AXIS} width={44} unit="s" />
        <Tooltip
          contentStyle={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
          formatter={(v) => [`${Number(v).toFixed(3)} s`, 'Delta']}
          labelFormatter={(d) => `${d} m`}
        />
        <ReferenceLine y={0} stroke="var(--border2)" />
        <Area type="monotone" dataKey="delta" stroke="#ff6b6b" fill="rgba(255,107,107,0.25)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function GgPlot({ points }) {
  const data = points.map((p) => ({ lat: p.lat, lon: p.lon }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 12, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis type="number" dataKey="lat" name="Lateral" tick={AXIS} unit="g" domain={[-2, 2]} />
        <YAxis type="number" dataKey="lon" name="Longitudinal" tick={AXIS} width={44} unit="g" domain={[-2, 2]} />
        <ReferenceLine x={0} stroke="var(--border2)" />
        <ReferenceLine y={0} stroke="var(--border2)" />
        <Tooltip
          contentStyle={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
          formatter={(v) => `${Number(v).toFixed(2)} g`}
        />
        <Scatter data={data} fill="#ffb347" fillOpacity={0.5} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Speed of two laps overlaid by distance into the lap. */
export function CompareSpeedChart({ gridA, gridB, labelA = 'A', labelB = 'B' }) {
  if (!gridA || !gridB) return null;
  const n = Math.min(gridA.distances.length, gridB.distances.length);
  const data = [];
  for (let i = 0; i < n; i++) {
    data.push({ d: gridA.distances[i], a: gridA.speeds[i], b: gridB.speeds[i] });
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="d" tick={AXIS} unit="m" />
        <YAxis tick={AXIS} width={44} />
        <Tooltip
          contentStyle={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }}
          formatter={(v, name) => [`${Number(v).toFixed(1)} km/h`, name === 'a' ? labelA : labelB]}
          labelFormatter={(d) => `${d} m`}
        />
        <Line type="monotone" dataKey="a" stroke="#4ea1ff" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="b" stroke="#ffb347" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}