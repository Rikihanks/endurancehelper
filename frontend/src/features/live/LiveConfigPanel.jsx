import { useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { CELL_CONTENTS, CONTENT_IDS, PRESET_ORDER, getPreset } from './liveConfig.js';
import { getCells, getOverrides } from './liveGridStore.js';
import RaceBoxConnector from './RaceBoxConnector.jsx';

function MiniGrid({ cells, showLabels = false, onSelect, selectedSlot = null }) {
  return (
    <div className={`live-mini ${showLabels ? 'is-editor' : ''}`}>
      {cells.map((cell, index) => {
        const meta = CELL_CONTENTS[cell.content];
        const style = {
          gridColumn: `${cell.c + 1} / span ${cell.w}`,
          gridRow: `${cell.r + 1} / span ${cell.h}`,
          background: meta.bg,
        };
        if (onSelect) {
          return (
            <button
              key={cell.slot}
              type="button"
              className={`live-mini-cell ${selectedSlot === index ? 'is-selected' : ''}`}
              style={style}
              onClick={() => onSelect(index)}
            >
              {showLabels ? <span className="live-mini-label">{meta.label}</span> : null}
            </button>
          );
        }
        return <div key={cell.slot} className="live-mini-cell" style={style} />;
      })}
    </div>
  );
}

export default function LiveConfigPanel({ presetId, onSelectPreset, config, onAssign, onReset, onClose, raceBox = null }) {
  const [editingSlot, setEditingSlot] = useState(null);
  const preset = getPreset(presetId);
  const cells = getCells(preset, getOverrides(config, presetId));
  const currentContent = editingSlot !== null ? cells[editingSlot].content : null;

  return (
    <div className="live-config">
      <header className="live-config-head">
        <h2>Configuración</h2>
        <button type="button" className="live-config-close" onClick={onClose} aria-label="Cerrar">
          <IconX size={22} />
        </button>
      </header>

      <div className="live-config-body">
        <section className="live-config-section">
          <h3>Grid</h3>
          <div className="live-preset-list">
            {PRESET_ORDER.map((id) => {
              const candidate = getPreset(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`live-preset ${id === presetId ? 'is-active' : ''}`}
                  onClick={() => {
                    onSelectPreset(id);
                    setEditingSlot(null);
                  }}
                >
                  <MiniGrid cells={getCells(candidate, getOverrides(config, id))} />
                  <span className="live-preset-name">{candidate.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        {raceBox && (
          <section className="live-config-section">
            <h3>RaceBox</h3>
            <RaceBoxConnector live={raceBox} />
          </section>
        )}

        <section className="live-config-section live-config-editor">
          <h3>Contenido · {preset.name}</h3>
          <MiniGrid
            cells={cells}
            showLabels
            selectedSlot={editingSlot}
            onSelect={(index) => setEditingSlot(index === editingSlot ? null : index)}
          />

          {editingSlot !== null && (
            <div className="live-content-list">
              {CONTENT_IDS.map((contentId) => {
                const meta = CELL_CONTENTS[contentId];
                const usedElsewhere = cells.some(
                  (cell, index) => cell.content === contentId && index !== editingSlot
                );
                return (
                  <button
                    key={contentId}
                    type="button"
                    className={`live-content-item ${contentId === currentContent ? 'is-active' : ''}`}
                    onClick={() => {
                      onAssign(presetId, editingSlot, contentId);
                      setEditingSlot(null);
                    }}
                  >
                    <span className="live-content-swatch" style={{ background: meta.bg }} />
                    <span className="live-content-text">{meta.label}</span>
                    {usedElsewhere && contentId !== currentContent ? (
                      <span className="live-content-swap">intercambia</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            className="live-restore"
            onClick={() => {
              onReset(presetId);
              setEditingSlot(null);
            }}
          >
            Restaurar valores por defecto
          </button>
        </section>
      </div>
    </div>
  );
}
