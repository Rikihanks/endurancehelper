// Pure presentation: draws an inline SVG sparkline from the lap series the
// backend already provides. No business logic here.
export default function Sparkline({ laps, width = 72, height = 22, pad = 2 }) {
  if (!laps || laps.length < 2) return <span className="lap-none">-</span>;

  const min = Math.min(...laps);
  const max = Math.max(...laps);
  const range = max - min || 1;
  const n = laps.length;
  const pts = laps
    .map((t, i) => {
      const x = pad + (i * (width - 2 * pad)) / (n - 1);
      const y = height - pad - ((t - min) / range) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const last = laps[n - 1];
  const color =
    last > min + range * 0.6 ? '#f87171' : last < min + range * 0.4 ? '#34d399' : '#fbbf24';

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
    </svg>
  );
}
