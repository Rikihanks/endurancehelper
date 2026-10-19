import LiveCell from './LiveCell.jsx';

function GridBlock({ cells, model, columns, shift = 0 }) {
  return (
    <div className="live-grid" style={{ '--live-cols': columns }}>
      {cells.map((cell) => (
        <div
          key={cell.slot ?? cell.content}
          className="lc-slot"
          style={{
            gridColumn: `${cell.c - shift + 1} / span ${cell.w}`,
            gridRow: `${cell.r + 1} / span ${cell.h}`,
          }}
        >
          <LiveCell content={cell.content} model={model} />
        </div>
      ))}
    </div>
  );
}

export default function LiveGrid({ cells, model, orientation }) {
  if (orientation === 'portrait') {
    const left = cells.filter((cell) => cell.c < 6);
    const right = cells.filter((cell) => cell.c >= 6);
    return (
      <div className="live-stack">
        {left.length > 0 && <GridBlock cells={left} model={model} columns={6} />}
        {right.length > 0 && <GridBlock cells={right} model={model} columns={6} shift={6} />}
      </div>
    );
  }
  return <GridBlock cells={cells} model={model} columns={12} />;
}
