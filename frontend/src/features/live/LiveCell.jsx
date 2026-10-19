import FitText from './FitText.jsx';
import { CELL_CONTENTS } from './liveConfig.js';
import {
  formatRaceRemaining,
  formatStint,
  formatLap,
  formatDelta,
  formatPosition,
} from './timeFormat.js';

function lapTag(lap) {
  return Number.isFinite(lap) && lap > 0 ? `V${lap}` : 'V--';
}

function RivalCell({ rival }) {
  return (
    <div className="lc-split">
      <div className="lc-tag">
        <FitText text={formatPosition(rival ? rival.position : null)} />
      </div>
      <div className="lc-half">
        <FitText text={rival ? formatLap(rival.lastLapMs) : '--:---'} />
      </div>
    </div>
  );
}

export default function LiveCell({ content, model }) {
  const meta = CELL_CONTENTS[content];
  if (!meta) return null;

  let tone = '';
  let body = null;
  let missing = false;

  switch (content) {
    case 'race_remaining':
      missing = !Number.isFinite(model.raceRemainingMs);
      body = <FitText text={formatRaceRemaining(model.raceRemainingMs)} />;
      break;
    case 'position':
      missing = !Number.isFinite(model.position) || model.position <= 0;
      body = <FitText text={formatPosition(model.position)} />;
      break;
    case 'target_time':
      missing = !Number.isFinite(model.targetLapMs);
      body = <FitText text={formatLap(model.targetLapMs)} />;
      break;
    case 'stint_time':
      tone = `lc-tone-${model.stintTone || 'muted'}`;
      missing = !Number.isFinite(model.stintElapsedMs);
      body = <FitText text={formatStint(model.stintElapsedMs)} />;
      break;
    case 'current_lap_delta':
      tone = `lc-tone-${model.deltaTone || 'muted'}`;
      missing = !Number.isFinite(model.deltaSeconds);
      body = (
        <div className="lc-lap">
          <span className="lc-corner">{lapTag(model.currentLap)}</span>
          <FitText text={formatDelta(model.deltaSeconds)} />
        </div>
      );
      break;
    case 'rival_ahead':
      missing = !model.rivalAhead;
      body = <RivalCell rival={model.rivalAhead} />;
      break;
    case 'rival_behind':
      missing = !model.rivalBehind;
      body = <RivalCell rival={model.rivalBehind} />;
      break;
    case 'sectors': {
      const sectors = model.sectors && model.sectors.length ? model.sectors : ['empty'];
      body = (
        <div className="lc-sectors">
          {sectors.map((sectorTone, index) => (
            <span key={index} className={`lc-seg lc-seg-${sectorTone}`} />
          ))}
        </div>
      );
      break;
    }
    case 'best_lap':
      missing = !(model.bestLap && Number.isFinite(model.bestLap.timeMs));
      body = (
        <div className="lc-lap">
          <span className="lc-corner">{lapTag(model.bestLap && model.bestLap.lap)}</span>
          <FitText text={formatLap(model.bestLap && model.bestLap.timeMs)} />
        </div>
      );
      break;
    case 'last_lap':
      missing = !(model.lastLap && Number.isFinite(model.lastLap.timeMs));
      body = (
        <div className="lc-lap">
          <span className="lc-corner">{lapTag(model.lastLap && model.lastLap.lap)}</span>
          <FitText text={formatLap(model.lastLap && model.lastLap.timeMs)} />
        </div>
      );
      break;
    default:
      body = <FitText text="--" />;
  }

  const style = {
    '--cell-fg': meta.fg,
    '--tag-bg': meta.accent || meta.bg,
  };
  if (!tone) style['--cell-bg'] = meta.bg;

  return (
    <div className={`lc-cell ${tone} ${missing ? 'lc-missing' : ''}`} style={style}>
      <div className="lc-cell-inner">{body}</div>
    </div>
  );
}
